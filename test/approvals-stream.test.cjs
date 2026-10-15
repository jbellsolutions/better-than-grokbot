const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

/**
 * Approvals on the turn stream: an app action that needs the user becomes an AG-UI interrupt in the
 * run that asked; an AG-UI resume (or a card click) applies the decision through answerApp, and the
 * decision runs as its own run. "Always allow" is remembered only where it's offered.
 */
function fixture(tags = []) {
  let count = 0;
  const executed = [];
  const state = {
    bots: [{ id: 'ops', name: 'Bapi', role: 'Operations', isMain: true, access: { acc1: 'act' } }],
    chats: [{ id: 'bot:ops', botIds: ['ops'], kind: 'bot', typing: [] }],
    accounts: [{ id: 'acc1', app: 'slackbot', appName: 'Slack', name: 'Team', status: 'active' }],
    messages: [], sessions: [], routines: [], appApprovals: [], host: 'orgo',
  };
  const store = {
    getState: () => state, bot: id => state.bots.find(b => b.id === id), chat: id => state.chats.find(c => c.id === id),
    update: fn => fn(state), ownerName: () => 'Owner', id: p => `${p}_${++count}`, installId: () => 'test', session: id => state.sessions.find(s => s.id === id),
    addMessage: m => { const value = { id: 'm' + ++count, at: Date.now(), ...m }; state.messages.push(value); return value; },
  };
  class Composio {
    constructor() {
      this.tools = {
        getRawComposioToolBySlug: async slug => ({ tags, name: 'Send message', toolkit: { slug: 'slackbot' } }),
        execute: async (slug, body) => (executed.push({ slug, args: body.arguments }), { successful: true, data: { ok: true } }),
      };
    }
  }
  const turns = load('lib/server/turn-events.ts', { '@/lib/types': {} });
  const ref = {};
  const interrupts = load('lib/server/interrupts.ts', { './store': store, './turn-events': turns, './composio': new Proxy({}, { get: (_, k) => ref.m[k] }) });
  ref.m = load('lib/server/composio.ts', {
    './store': store, './interrupts': interrupts, '@composio/core': { Composio }, './judgment': { lowRisk: async () => false },
    './cloud': { cloudOn: () => false, cloudProxy: () => null, cloudSession: async () => ({}), cloudSessionNow: () => null, cloudUrl: () => '' },
  }, { process: { ...process, env: { ...process.env, COMPOSIO_API_KEY: 'test' } } });
  const events = [];
  turns.onTurnEvent(e => events.push(e));
  return { state, store, turns, interrupts, composio: ref.m, events, executed };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test('an action that needs the user is an interrupt in the run that asked, with redacted fields', async () => {
  const f = fixture();
  const run = f.turns.startRun({ chatId: 'bot:ops', botId: 'ops', kind: 'chat' });
  let asked;
  const said = await f.composio.runAppAction('ops', 'SLACKBOT_SEND_MESSAGE', { channel: 'C1', markdown_text: 'Hi team', api_key: 'sk-live-123' }, { chatId: 'bot:ops' }, ask => (asked = ask));
  assert.match(said, /needs Owner's approval/);
  assert.ok(asked);
  const interrupt = f.events.find(e => e.event.type === 'CUSTOM' && e.event.name === 'on_interrupt');
  assert.equal(interrupt.runId, run.runId);
  const value = interrupt.event.value;
  const approval = f.state.appApprovals[0];
  assert.equal(value.__opentag_interrupt_id__, approval.id.replaceAll('-', ''));
  assert.match(value.__opentag_interrupt_id__, /^[0-9a-f]{32}$/);
  const args = value.__copilotkit_interrupt_value__.args;
  assert.equal(args.action, 'Bapi: Send message in Slack (Team)');
  assert.equal(args.effect, 'write');
  assert.equal(args.allow_always, true);
  assert.deepEqual(Array.from(args.fields, f => f.label), ['channel', 'markdown text', 'api key']);
  assert.equal(args.fields[2].value, '••••••');
  assert.equal(JSON.stringify(f.events).includes('sk-live-123'), false);
  assert.equal(f.executed.length, 0);
});

test('an AG-UI resume with "always" runs the action, says how it went, and stops asking next time', async () => {
  const f = fixture();
  f.turns.startRun({ chatId: 'bot:ops', botId: 'ops', kind: 'chat' });
  await f.composio.runAppAction('ops', 'SLACKBOT_SEND_MESSAGE', { channel: 'C1', markdown_text: 'Hi' }, { chatId: 'bot:ops' }, () => {});
  const interruptId = f.state.appApprovals[0].id.replaceAll('-', '');
  const resume = f.interrupts.resumeFromInput({ threadId: 'bot:ops', runId: 'r', messages: [], forwardedProps: { command: { resume: { [interruptId]: { confirmed: true, always: true, by: 'slack:T1:U1' } } } } });
  assert.equal(resume.invalid, false);
  assert.equal(await f.interrupts.decideInterrupt(resume.interruptId, resume), true);
  await settle();
  assert.equal(f.executed.length, 1);
  const decision = f.events.filter(e => e.event.metadata.kind === 'resume').map(e => e.event);
  assert.deepEqual(decision.map(e => e.type), ['RUN_STARTED', 'CUSTOM', 'TOOL_CALL_START', 'TOOL_CALL_END', 'TOOL_CALL_RESULT', 'RUN_FINISHED']);
  assert.equal(decision[1].value.by, 'slack:T1:U1');
  assert.equal(decision[4].content, 'done');
  assert.equal(decision.at(-1).result.text, 'done');
  assert.equal(f.state.appAlways.length, 1);
  // Deciding again finds nothing waiting.
  assert.equal(await f.interrupts.decideInterrupt(interruptId, { confirmed: true }), false);
  // The same bot, action and account: done at once, said in the chat.
  await f.composio.runAppAction('ops', 'SLACKBOT_SEND_MESSAGE', { channel: 'C1', markdown_text: 'Again' }, { chatId: 'bot:ops' }, () => assert.fail('asked again'));
  assert.equal(f.executed.length, 2);
  assert.equal(f.state.appApprovals.length, 0);
  assert.match(f.state.messages.at(-1).text, /you always allow this/);
});

test('a destructive action offers no "always", and "always" on it is not remembered', async () => {
  const f = fixture(['destructiveHint']);
  await f.composio.runAppAction('ops', 'SLACKBOT_DELETE_MESSAGE', { channel: 'C1' }, { chatId: 'bot:ops' }, () => {});
  const a = f.state.appApprovals[0];
  assert.equal(a.allowAlways, false);
  assert.equal(a.effect, 'destructive');
  const value = f.events.find(e => e.event.name === 'on_interrupt').event.value.__copilotkit_interrupt_value__.args;
  assert.equal(value.allow_always, false);
  assert.equal(value.effect, 'destructive');
  f.composio.answerApp(a.id, true, { always: true });
  await settle();
  assert.equal((f.state.appAlways ?? []).length, 0);
  assert.equal(f.executed.length, 1);
});

test('a no is applied once and the decision run says so', async () => {
  const f = fixture();
  await f.composio.runAppAction('ops', 'SLACKBOT_SEND_MESSAGE', { channel: 'C1' }, { chatId: 'bot:ops' }, () => {});
  const a = f.state.appApprovals[0];
  assert.equal(f.composio.answerApp(a.id, false, { by: 'owner' }), true);
  await settle();
  assert.equal(f.executed.length, 0);
  const finished = f.events.filter(e => e.event.metadata.kind === 'resume' && e.event.type === 'RUN_FINISHED');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].event.result.text, 'declined');
  assert.equal(f.interrupts.resumeFromInput({ forwardedProps: { command: { resume: { nothex: { confirmed: true } } } } }).invalid, true);
  assert.equal(f.interrupts.resumeFromInput({ forwardedProps: {} }), null);
});
