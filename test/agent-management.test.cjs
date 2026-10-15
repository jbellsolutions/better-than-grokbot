const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

function fixture() {
  const state = { workspace: 'ws_main', bots: [
    { id: 'main', name: 'Boppy', isMain: true, computerId: 'shared-machine' },
    { id: 'ops', name: 'Bapi', teamRole: 'operations' },
    { id: 'writer', name: 'Writer' },
    { id: 'foreign', name: 'Other', workspaceId: 'other' },
  ], chats: ['main', 'ops', 'writer', 'foreign'].map(id => ({ id: `bot:${id}`, kind: 'bot', botIds: [id], typing: [] })), sessions: [], messages: [], routines: [], watches: [], screens: {} };
  const stopped = [], reset = [], keys = [], inboxes = [], connections = [];
  const store = { bot: id => state.bots.find(b => b.id === id), getState: () => state, update: fn => fn(state), addMessage: m => state.messages.push(m), session: id => state.sessions.find(s => s.id === id), patchSession: (id, patch) => Object.assign(state.sessions.find(s => s.id === id), patch) };
  const sessions = { startSession: opts => { const task = { ...opts, id: `task-${state.sessions.length}`, status: 'queued' }; state.sessions.push(task); return task; }, stopSession: id => stopped.push(id), resetComputer: async id => reset.push(id), dropGuestKey: async id => keys.push(id) };
  const mocks = { './store': store, './sessions': sessions, './mail': { ensureInbox: async () => {}, deleteInboxes: async b => inboxes.push(b.id) }, './watches': { stopWatch: async () => {} }, './plan': { noOwnComputer: async () => null }, './custom-tools': { deleteAgentTools: id => connections.push(id) } };
  const tools = load('lib/server/team-tools.ts', mocks);
  return { state, tools: (id = 'ops', parent) => tools.teamTools(id, `bot:${id}`, parent), stopped, reset, keys, inboxes, connections };
}

test('Head of Ops creates, delegates to and deletes a specialist with full cleanup and a visible audit', async () => {
  const f = fixture(), tools = f.tools();
  const result = JSON.parse(await tools.find(t => t.name === 'create_bot').run({ name: 'Nova', role: 'Research', goal: 'Inspect the browser.', task_mode: 'screen' }));
  const nova = f.state.bots.find(b => b.id === result.botId);
  assert.equal(nova.teamRole, undefined); assert.equal(nova.workspaceId, 'ws_main'); assert.equal(nova.computer, 'shared');
  assert.ok(f.state.chats.some(c => c.id === result.chatId));
  assert.equal(f.state.sessions.find(s => s.id === result.taskId).taskMode, 'screen');
  // The tool list predates Nova: a running orchestrator can still delegate to its new teammate.
  await tools.find(t => t.name === 'hand_off').run({ bot_id: nova.id, title: 'Draft', goal: 'Write a brief.' });
  f.state.routines.push({ id: 'schedule', botId: nova.id }); f.state.screens[`${nova.id}:0`] = 'preview';
  const deleted = JSON.parse(await tools.find(t => t.name === 'delete_bot').run({ bot_id: nova.id, reason: 'Temporary specialist finished its purpose.' }));
  assert.equal(deleted.deleted, true); assert.ok(!f.state.bots.some(b => b.id === nova.id)); assert.ok(!f.state.chats.some(c => c.id === result.chatId));
  assert.equal(f.state.sessions.length, 0); assert.equal(f.state.routines.length, 0); assert.equal(Object.keys(f.state.screens).length, 0);
  assert.equal(f.stopped.length, 2); assert.deepEqual(f.reset, []); assert.deepEqual(f.keys, [nova.id]); assert.deepEqual(f.inboxes, [nova.id]); assert.deepEqual(f.connections, [nova.id]);
  assert.ok(f.state.messages.some(m => /Bapi added Nova/.test(m.text))); assert.ok(f.state.messages.some(m => /Bapi removed Nova/.test(m.text)));
  assert.equal(f.state.bots.find(b => b.id === 'main').computerId, 'shared-machine');
});

test('lifecycle permissions reject specialists, cross-workspace deletion, self-deletion, leads and stale roles', async () => {
  const f = fixture();
  assert.ok(!f.tools('writer').some(t => ['create_bot', 'delete_bot', 'list_agents'].includes(t.name)));
  assert.ok(f.tools('main').some(t => t.name === 'create_bot'));
  const tools = f.tools(), remove = tools.find(t => t.name === 'delete_bot');
  for (const id of ['main', 'ops']) await assert.rejects(remove.run({ bot_id: id, reason: 'No longer needed.' }), /Cannot delete/);
  await assert.rejects(remove.run({ bot_id: 'foreign', reason: 'No longer needed.' }), /workspace/);
  assert.ok(!JSON.parse(await tools.find(t => t.name === 'list_agents').run({})).some(b => b.id === 'foreign'));
  f.state.bots.find(b => b.id === 'ops').teamRole = 'specialist';
  await assert.rejects(remove.run({ bot_id: 'writer', reason: 'No longer needed.' }), /head of operations/);
  await assert.rejects(tools.find(t => t.name === 'create_bot').run({ name: 'Nova', role: 'Research' }), /head of operations/);
  assert.equal(f.state.bots.length, 4);
});

test('a solo orchestrator can build its team and a worker cannot remove a parent coordinating its task', async () => {
  const f = fixture(); f.state.sessions.push({ id: 'parent', botId: 'writer' }, { id: 'worker', botId: 'ops', delegatedFrom: 'parent' });
  const tools = f.tools('ops', 'worker');
  await assert.rejects(tools.find(t => t.name === 'delete_bot').run({ bot_id: 'writer', reason: 'No longer needed.' }), /coordinating/);
  const made = JSON.parse(await tools.find(t => t.name === 'create_bot').run({ name: 'Nova', role: 'Research', goal: 'Draft a brief.' }));
  assert.equal(f.state.sessions.find(s => s.id === made.taskId).delegatedFrom, 'worker');
  f.state.bots = f.state.bots.filter(b => b.id === 'ops');
  assert.ok(f.tools().some(t => t.name === 'create_bot'));
});

test('invalid creation fails before adding an agent, and owned computers are removed only with their owner', async () => {
  const f = fixture(), tools = f.tools(), create = tools.find(t => t.name === 'create_bot');
  for (const args of [{ name: '', role: 'Research' }, { name: 'Nova', role: 'Research', own_computer: 'yes' }, { name: 'Nova', role: 'Research', task_mode: 'invalid' }]) await assert.rejects(create.run(args));
  assert.equal(f.state.bots.length, 4);
  f.state.bots.find(b => b.id === 'writer').computerId = 'owned-machine';
  await tools.find(t => t.name === 'delete_bot').run({ bot_id: 'writer', reason: 'Consolidated research responsibilities.' });
  assert.deepEqual(f.reset, ['writer']);
});

test('Ops can request app building on the Mac only after this computer is ready', async () => {
  const f=fixture();const tool=f.tools().find(t=>t.name==='run_on_mac');
  await assert.rejects(tool.run({title:'Build app',goal:'Build an application in the project workspace.'}),/Connect and allow/);
  f.state.mac={ready:true};const result=JSON.parse(await tool.run({title:'Build app',goal:'Build an application in the project workspace.'}));
  const task=f.state.sessions.find(s=>s.id===result.taskId);assert.equal(task.where,'mac');assert.equal(task.botId,'ops');assert.equal(task.fresh,true);
  const parent={id:'mac-parent',botId:'ops',runsOn:'mac'};f.state.sessions.push(parent);
  await assert.rejects(f.tools('ops',parent.id).find(t=>t.name==='run_on_mac').run({title:'Again',goal:'Same app'}),/already run on the Mac/);
});
