const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

/**
 * The turn stream (lib/server/turn-events.ts) with the real chat engine and the real SSE route:
 * a model that answers in delayed chunks, a page that drops its connection mid-answer and
 * reconnects with Last-Event-ID, and a page that loads fresh mid-answer.
 */
const CHUNKS = ['The ', 'answer ', 'arrives ', 'in ', 'pieces.\n', 'Options: Yes | No'];
const wait = ms => new Promise(r => setTimeout(r, ms));

function streamed(chunks, gate) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'response.created', response: {} };
      for (const [i, delta] of chunks.entries()) {
        if (gate && i === gate.at) await gate.open;
        await wait(15);
        yield { type: 'response.output_text.delta', delta };
      }
      const text = chunks.join('');
      yield { type: 'response.completed', response: { id: 'r1', model: 'fixture/model', output_text: '', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1 } } };
    },
  };
}

function fixture(respond) {
  let count = 0;
  const state = { bots: [{ id: 'ops', name: 'Bapi', role: 'Operations', isMain: true }], chats: [{ id: 'bot:ops', botIds: ['ops'], kind: 'bot', typing: [] }], messages: [], sessions: [], routines: [], host: 'orgo' };
  const store = {
    getState: () => state, stateEpoch: () => 0, bot: id => state.bots.find(b => b.id === id), chat: id => state.chats.find(c => c.id === id),
    update: fn => fn(state), ownerName: () => 'Owner', ownerLine: () => 'You work for Owner.',
    addMessage: (m, o = {}) => { const value = { id: o.id ?? 'm' + ++count, at: Date.now(), ...m }; state.messages.push(value); return value; },
    setTyping: () => {}, setAsking: () => {}, patchSession: () => {}, react: () => {},
  };
  const turns = load('lib/server/turn-events.ts', { '@/lib/types': {} });
  const requests = [];
  const mocks = {
    './store': store, './turn-events': turns, './models': { modelFor: () => 'fixture/model' }, './custom-tools': { connectedTools: async () => [] },
    './openai-client': { openRouterOn: () => true, openaiClient: () => ({ responses: { create: async body => { requests.push(body); return respond(body, requests.length); } } }) },
    './memory': { isSecret: () => false, memoryOn: () => true, memoryBlock: async () => '', wsOf: () => 'ws_main', rememberMessage: () => {}, saveToMemory: () => {}, recall: async () => 'Nothing saved.', learn: async () => 'ok' },
    './composio': { APP_TOOLS: () => [] }, './skills': { appsNote: () => '', placesNote: () => '' }, './bots': { contactLine: () => '' },
    './cloud': { creditsOut: async () => false, noteOutOfCredit: () => false }, './briefing': { computerBriefing: async () => '', teamBriefing: () => '' },
    './pages': {}, './routines': { routinesNote: () => '' }, './decide': { decide: async () => null, chose: () => null, yes: () => 0 },
    './sessions': {}, './where': {}, './judgment': { needsMemory: async () => false }, './uploads': { uploadPath: () => undefined },
    './watches': { watchesNote: () => '' }, './mail': { mailOn: () => false }, './phone': { textingLine: () => null, ownerPhone: () => null },
    './attention': {}, './usage': { recordTokens: () => {} },
  };
  const chat = load('lib/server/chat.ts', mocks);
  const route = load('app/api/chat/[chatId]/stream/route.ts', {
    '@/lib/server/turn-events': turns, '@/lib/server/store': store, '@/lib/server/chat': chat,
    '@/lib/server/interrupts': { resumeFromInput: () => null, decideInterrupt: async () => false },
  });
  return { chat, route, turns, state, requests };
}

/** Read an SSE response into events (with their ids) until `stop` says so or it ends. */
async function readEvents(response, stop = () => false, timeoutMs = 5000) {
  const reader = response.body.getReader();
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), timeoutMs);
  const decoder = new TextDecoder();
  const out = [];
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const id = /^id: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data) out.push({ id, at: Date.now(), event: JSON.parse(data) });
      if (data && stop(out)) {
        clearTimeout(timer);
        await reader.cancel();
        return out;
      }
    }
  }
  clearTimeout(timer);
  return out;
}

const get = (route, headers = {}, signal) => route.GET(new Request('http://localhost/api/chat/bot%3Aops/stream', { headers, signal }), { params: Promise.resolve({ chatId: 'bot:ops' }) });
const textOf = events => events.filter(e => e.event.type === 'TEXT_MESSAGE_CONTENT').map(e => e.event.delta).join('');

test('a chat turn streams its text in order, then saves one final answer that names its run', async () => {
  const f = fixture(() => streamed(CHUNKS));
  const page = get(f.route).then(r => readEvents(r, events => events.some(e => e.event.type === 'RUN_FINISHED')));
  await wait(5);
  await f.chat.handleMessage('bot:ops', 'Hello');
  const events = await page;
  const types = events.map(e => e.event.type).filter(t => !t.startsWith('CUSTOM'));
  assert.deepEqual(types, ['RUN_STARTED', 'TEXT_MESSAGE_START', ...CHUNKS.map(() => 'TEXT_MESSAGE_CONTENT'), 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  assert.equal(textOf(events), CHUNKS.join(''));
  // Ids only go up, and every event says which run it's from.
  const seqs = events.filter(e => e.id).map(e => Number(e.id.split('-')[1]));
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  const runId = events[0].event.runId;
  assert.ok(events.every(e => e.event.metadata.runId === runId));
  // The saved answer is the tidy one (its options are buttons) and replaces the run's text.
  const reply = f.state.messages.find(m => m.role === 'bot');
  assert.equal(reply.text, 'The answer arrives in pieces.');
  assert.deepEqual(Array.from(reply.options), ['Yes', 'No']);
  assert.equal(reply.runId, runId);
  assert.equal(events.at(-1).event.result.messageId, reply.id);
  assert.equal(f.requests[0].stream, true);
});

test('a reconnect mid-answer resumes after the last event: one answer, no repeated pieces', async () => {
  let release;
  const gate = { at: 3, open: new Promise(r => (release = r)) };
  const f = fixture(() => streamed(CHUNKS, gate));
  const first = new AbortController();
  const page = get(f.route, {}, first.signal).then(r => readEvents(r, events => textOf(events) === CHUNKS.slice(0, 3).join('')));
  await wait(5);
  const turn = f.chat.handleMessage('bot:ops', 'Hello');
  const before = await page;
  first.abort();
  const last = before.filter(e => e.id).at(-1).id;
  // While the page is away, the rest of the answer is written.
  release();
  await wait(60);
  const after = await get(f.route, { 'Last-Event-ID': last }).then(r => readEvents(r, events => events.some(e => e.event.type === 'RUN_FINISHED')));
  await turn;
  assert.equal(textOf(before) + textOf(after), CHUNKS.join(''));
  assert.equal(after.filter(e => e.event.type === 'RUN_STARTED').length, 0);
  assert.equal(after.filter(e => e.event.type === 'RUN_FINISHED').length, 1);
  assert.equal(f.state.messages.filter(m => m.role === 'bot').length, 1);
});

test('a page that loads mid-answer gets the answer so far once, then the rest live', async () => {
  let release;
  const gate = { at: 2, open: new Promise(r => (release = r)) };
  const f = fixture(() => streamed(CHUNKS, gate));
  const turn = f.chat.handleMessage('bot:ops', 'Hello');
  while (!f.turns.openRun('bot:ops')) await wait(2);
  await wait(60);
  const page = get(f.route).then(r => readEvents(r, events => events.some(e => e.event.type === 'RUN_FINISHED')));
  await wait(10);
  release();
  const events = await page;
  await turn;
  assert.equal(events.filter(e => e.event.type === 'RUN_STARTED').length, 1);
  assert.equal(textOf(events), CHUNKS.join(''));
  // A page that loads after the answer is saved replays nothing: the answer is in the chat.
  const late = await get(f.route).then(r => readEvents(r, () => false, 150));
  assert.equal(late.filter(e => e.event.type && e.event.type !== 'CUSTOM').length, 0);
});

test('tool calls show as chips with no arguments, around the work, in the same run', async () => {
  const f = fixture((_body, n) => n === 1
    ? { id: 'r0', model: 'fixture/model', output_text: '', output: [{ type: 'function_call', name: 'recall', call_id: 'call-1', arguments: JSON.stringify({ question: 'secret plans for Q4' }) }] }
    : streamed(['Done.']));
  const page = get(f.route).then(r => readEvents(r, events => events.some(e => e.event.type === 'RUN_FINISHED')));
  await wait(5);
  await f.chat.handleMessage('bot:ops', 'What did we decide?');
  const events = (await page).map(e => e.event).filter(e => e.type !== 'CUSTOM');
  assert.deepEqual(events.map(e => e.type), ['RUN_STARTED', 'TOOL_CALL_START', 'TOOL_CALL_END', 'TOOL_CALL_RESULT', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  const start = events[1];
  assert.equal(start.toolCallName, 'recall');
  assert.equal(start.metadata.label, 'Checking memory');
  assert.equal(events.some(e => e.type === 'TOOL_CALL_ARGS'), false);
  assert.equal(JSON.stringify(events).includes('secret plans'), false);
});
