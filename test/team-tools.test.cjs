const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

function fixture() {
  const state = { bots: [{ id: 'ops', name: 'Bapi', teamRole: 'operations' }, { id: 'writer', name: 'Writer' }, { id: 'foreign', name: 'Other', workspaceId: 'other' }], sessions: [{ id: 'parent', botId: 'ops', status: 'done', replies: [] }] };
  const replies = [], messages = [];
  const store = { getState: () => state, stateEpoch: () => 0, id: () => 'receipt-reply', bot: id => state.bots.find(b => b.id === id), session: id => state.sessions.find(s => s.id === id), patchSession: (id, patch) => { const s = state.sessions.find(s => s.id === id); if (typeof patch === 'function') patch(s); else Object.assign(s, patch); }, addMessage: m => messages.push(m) };
  const tools = load('lib/server/team-tools.ts', { './store': store, './bots': {}, './remove': {}, './sessions': {
    startSession: options => { const task = { ...options, id: 'child', status: 'queued', replies: [] }; state.sessions.push(task); return task; },
    replyToSession: (id, text, note) => replies.push({ id, text, note }),
  } });
  return { state, tools, replies, messages };
}

test('worker delegation stays within the team and child results resume their parent exactly once', async () => {
  const f = fixture();
  const handoff = f.tools.teamTools('ops', 'bot:ops', 'parent').find(t => t.name === 'hand_off');
  await assert.rejects(handoff.run({ bot_id: 'foreign', title: 'x', goal: 'x' }), /accessible/);
  await handoff.run({ bot_id: 'writer', title: 'Draft brief', goal: 'Draft the requested brief.' });
  const child = f.state.sessions.find(s => s.id === 'child'); assert.equal(child.delegatedFrom, 'parent');
  child.status = 'done'; child.answer = 'The brief is ready.'; child.endedAt = 10; child.publicReads = [{ url: 'https://example.com/', text: 'Actual fetched text', at: 8 }];
  f.tools.deliverDelegationResult('child'); f.tools.deliverDelegationResult('child');
  assert.equal(f.replies.length, 1); assert.equal(f.replies[0].id, 'parent'); assert.match(f.replies[0].text, /brief is ready/);
  assert.match(f.replies[0].text, /child, status done/); assert.match(f.replies[0].text, /Actual fetched text/);
});

test('circular delegation is rejected and deliberately stopped parents are never reopened', async () => {
  const f = fixture();
  f.state.sessions.push({ id: 'nested', botId: 'writer', delegatedFrom: 'parent' });
  const handoff = f.tools.teamTools('writer', 'bot:ops', 'nested').find(t => t.name === 'hand_off');
  await assert.rejects(handoff.run({ bot_id: 'ops', title: 'delegate back', goal: 'same task' }), /cycle/);
  f.state.sessions[0].status = 'failed'; f.state.sessions[0].error = 'Stopped by you';
  f.state.sessions[1].status = 'done'; f.state.sessions[1].answer = 'result'; f.state.sessions[1].endedAt = 1;
  f.tools.deliverDelegationResult('nested'); assert.equal(f.replies.length, 0);
});

test('worker screen handoffs retain the selected mode and reject invalid modes', async () => {
  const f = fixture(), handoff = f.tools.teamTools('ops', 'bot:ops', 'parent').find(t => t.name === 'hand_off');
  await handoff.run({ bot_id: 'writer', title: 'Screenshot', goal: 'Inspect the browser.', task_mode: 'screen' });
  assert.equal(f.state.sessions.find(s => s.id === 'child').taskMode, 'screen');
  await assert.rejects(handoff.run({ bot_id: 'writer', title: 'Bad mode', goal: 'Inspect.', task_mode: 'other' }), /Invalid task mode/);
});

test('a delegated result is saved without resuming past a human login or approval', async () => {
  const f = fixture();
  f.state.sessions[0].blocker = 'sign_in';
  await f.tools.teamTools('ops', 'bot:ops', 'parent').find(t => t.name === 'hand_off').run({ bot_id: 'writer', title: 'Read invoice', goal: 'Read the invoice.' });
  const child = f.state.sessions.find(s => s.id === 'child'); child.status = 'done'; child.answer = 'Invoice ready.'; child.endedAt = 1;
  f.tools.deliverDelegationResult('child'); f.tools.deliverDelegationResult('child');
  assert.equal(f.replies.length, 0); assert.equal(f.state.sessions[0].blocker, 'sign_in');
  assert.equal(f.state.sessions[0].replies.length, 1); assert.match(f.state.sessions[0].replies[0].text, /Invoice ready/);
});

test('Hermes services pending tool requests through a durable receipt and honors agent reasoning', async () => {
  const task = { id: 'task', botId: 'ops', title: 'Read record', goal: 'Read a record', chatId: 'bot:ops', runtime: 'hermes', status: 'queued', replies: [] };
  let calls = 0, statuses = 0, deliveries = 0;
  const requests = [];
  const modules = {
    './store': { session: () => task, bot: () => ({ id: 'ops', name: 'Bapi', effort: 'high' }), id: () => 'reply', patchSession: (_id, patch) => typeof patch === 'function' ? patch(task) : Object.assign(task, patch), addMessage: () => {} },
    './business-records': { addScreenRequest: () => {} }, './screen-capacity': { claimScreen: () => 0, releaseScreen: () => {}, ownedScreenTurns: () => [] },
    './business-profiles': { instructionsFor: () => 'Read only' }, './models': { modelFor: () => 'fixture/model', modelReasoning: async (_model, effort) => ({ effort }) },
    './custom-tools': { connectedTools: async () => [{ name: 'custom_records', description: 'Read records', parameters: { type: 'object' }, run: async () => { calls++; return 'record result'; } }] },
    './team-tools': { teamTools: () => [], deliverDelegationResult: () => deliveries++ },
    './orgo': { orgo: { hermes: async request => {
      requests.push(request);
      if (request.action === 'submit') return { status: 'running', toolCalls: [{ id: 'call1', name: 'custom_records', arguments: { id: 'record1' } }] };
      if (request.action === 'tool_result') return { accepted: true };
      if (++statuses === 1) return { status: 'missing' };
      if (statuses === 2) return { status: 'running', toolCalls: [{ id: 'call1', name: 'custom_records', arguments: { id: 'record1' } }] };
      return { status: 'done', answer: 'Verified record.', publicReads: [{ url: 'https://example.com/', text: 'Fetched evidence', at: 1 }] };
    } } },
  };
  const runtime = load('lib/server/business-runtime.ts', modules, { process: { env: { OPENROUTER_API_KEY: 'fixture' } }, setTimeout: (fn, ms) => setTimeout(fn, ms === 2000 ? 1 : ms) });
  await runtime.runBusinessSession('task', new AbortController().signal);
  assert.equal(task.status, 'done'); assert.equal(task.answer, 'Verified record.'); assert.equal(calls, 1); assert.equal(deliveries, 1);
  assert.equal(task.toolReceipts.call1, 'record result');
  assert.equal(task.publicReads[0].text, 'Fetched evidence');
  const submit = requests.find(r => r.action === 'submit'); assert.equal(submit.reasoning.effort, 'high'); assert.equal(submit.tools[0].name, 'custom_records');
  assert.match(submit.instructions, /Original user goal for this task: Read a record/);
  assert.equal(requests.filter(r => r.action === 'tool_result').length, 2);
});

test('hiding a card does not revoke worker delegation access or cross-team isolation', async () => {
  const f = fixture(); f.state.bots.find(b => b.id === 'writer').hidden = true;
  const handoff = f.tools.teamTools('ops', 'bot:ops', 'parent').find(t => t.name === 'hand_off');
  await handoff.run({ bot_id: 'writer', title: 'Hidden specialist', goal: 'Continue working with the team.' });
  assert.equal(f.state.sessions.find(s => s.id === 'child').botId, 'writer');
  await assert.rejects(handoff.run({ bot_id: 'foreign', title: 'Foreign', goal: 'No cross-team access.' }), /accessible/);
});
