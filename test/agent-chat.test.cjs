const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const answer = text => ({ id: 'response-' + Math.random(), model: 'fixture/model', output_text: text, output: [] });
const call = (name, args) => ({ ...answer(''), output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'call-' + Math.random() }] });

function fixture(respond, env = process.env) {
  let epoch = 0, count = 0;
  const state = { bots: [{ id: 'ops', name: 'Bapi', role: 'Operations', isMain: false, teamRole: 'operations', effort: 'high' }, { id: 'finance', name: 'Penny', role: 'Finance', effort: 'low' }, { id: 'foreign', name: 'Other team', role: 'Other', workspaceId: 'other' }], chats: [{ id: 'bot:ops', botIds: ['ops'], kind: 'bot', typing: [] }, { id: 'bot:finance', botIds: ['finance'], kind: 'bot', typing: [] }], messages: [], sessions: [], routines: [], host: 'orgo' };
  const store = {
    getState: () => state, stateEpoch: () => epoch, bot: id => state.bots.find(b => b.id === id), chat: id => state.chats.find(c => c.id === id),
    update: fn => fn(state), ownerName: () => 'Owner', ownerLine: () => 'You work for Owner.',
    addMessage: m => { const value = { id: 'm' + ++count, at: Date.now(), ...m }; state.messages.push(value); return value; },
    setTyping: (id, botId, on) => { const c = state.chats.find(c => c.id === id); if (c) c.typing = on ? [...new Set([...c.typing, botId])] : c.typing.filter(id => id !== botId); },
    setAsking: () => {}, patchSession: (id, patch) => { const task = state.sessions.find(s => s.id === id); if (typeof patch === 'function') patch(task); else Object.assign(task, patch); }, react: () => {},
  };
  const requests = [];
  const mocks = {
    './store': store, './models': { modelFor: (_kind, id) => `fixture/${id}` }, './custom-tools': { connectedTools: async () => [] },
    './openai-client': { openRouterOn: () => false, openaiClient: () => ({ responses: { create: async body => { requests.push(structuredClone(body)); return respond(body, requests.length); } } }) },
    './memory': { isSecret: () => false, memoryOn: () => false, memoryBlock: async () => '', wsOf: () => 'ws_main', rememberMessage: () => {}, saveToMemory: () => {} },
    './composio': { APP_TOOLS: () => [] }, './skills': { appsNote: () => '', placesNote: () => '' }, './bots': { contactLine: () => '' },
    './cloud': { creditsOut: async () => false, noteOutOfCredit: () => false }, './briefing': { computerBriefing: async () => '', teamBriefing: () => '' },
    './pages': {}, './routines': { routinesNote: () => '' }, './decide': { decide: async () => null, chose: () => null, yes: () => 0 },
    './sessions': {}, './where': {}, './judgment': { needsMemory: async () => false }, './uploads': { uploadPath: () => undefined },
    './watches': { watchesNote: () => '' }, './mail': { mailOn: () => false }, './phone': { textingLine: () => null, ownerPhone: () => null },
    './remove': {}, './attention': {}, './usage': { recordTokens: () => {} },
  };
  const chat = load('lib/server/chat.ts', mocks, { process: { env } });
  return { chat, state, requests, mocks, swap: () => { epoch++; state.messages = []; } };
}

test('chat starts and hands off Hermes browser work with its requested screen mode', async () => {
  for (const name of ['start_task', 'hand_off']) {
    const f = fixture(async body => {
      const tool = body.tools.find(t => t.name === name);
      assert.deepEqual(Array.from(tool.parameters.properties.task_mode.enum), ['headless', 'screen']);
      return call(name, { bot_id: 'finance', title: 'Browser check', goal: 'Open the private browser and take a screenshot.', say: 'Opening the browser.', where: 'cloud', then_on_mac: null, task_mode: 'screen' });
    }, { BOPS_BUSINESS_RUNTIME: 'hermes' });
    const tasks=[];
    f.mocks['./sessions'].startSession = opts => { tasks.push(opts); return { id: 'browser-task' }; };
    await f.chat.handleMessage('bot:ops', 'Use a screen and take a screenshot.');
    assert.equal(tasks.length, 1); assert.equal(tasks[0].taskMode, 'screen');
    assert.equal(tasks[0].botId, name === 'hand_off' ? 'finance' : 'ops');
  }
});

test('the real chat engine serializes messages and retries uncertain sends without duplicate work', async () => {
  let release;
  const held = new Promise(resolve => release = resolve);
  const f = fixture(async (_body, n) => { if (n === 1) await held; return answer(`reply ${n}`); });
  const first = f.chat.handleMessage('bot:ops', 'first', undefined, undefined, undefined, undefined, undefined, 'first-id');
  const duplicate = f.chat.handleMessage('bot:ops', 'first', undefined, undefined, undefined, undefined, undefined, 'first-id');
  const second = f.chat.handleMessage('bot:ops', 'second', undefined, undefined, undefined, undefined, undefined, 'second-id');
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.messages.filter(m => m.role === 'user').length, 2);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].input.some(m => m.content === 'second'), false);
  release(); await Promise.all([first, duplicate, second]);
  assert.equal(f.requests.length, 2);
  assert.ok(f.state.messages.filter(m => m.role === 'user').every(m => m.delivery === 'answered'));
  assert.equal(f.requests[0].reasoning.effort, 'high');
});

test('tagging another agent in a direct chat calls that agent and skips routing inference', async () => {
  const f = fixture(async body => answer(body.model === 'fixture/finance' ? 'The invoice is ready.' : 'wrong agent'));
  await f.chat.handleMessage('bot:ops', '@Penny is the invoice ready?');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].model, 'fixture/finance'); assert.equal(f.requests[0].reasoning.effort, 'low');
  assert.equal(f.state.messages.find(m => m.role === 'bot').botId, 'finance');
});

test('a teammate can ask the operations lead back and every exchange has a visible transcript', async () => {
  const f = fixture(async (_body, n) => {
    if (n === 1) return call('ask_teammate', { bot_id: 'finance', question: 'Which account is cleared?' });
    if (n === 2) return call('ask_teammate', { bot_id: 'ops', question: 'Which account did the owner choose?' });
    if (n === 3) return answer('Account A.');
    if (n === 4) return answer('Account A is cleared.');
    return answer('Penny confirmed that Account A is cleared.');
  });
  await f.chat.handleMessage('bot:ops', 'Ask Penny which account is cleared.');
  assert.equal(f.requests.length, 5);
  const transcript = f.state.messages.filter(m => m.chatId === 'pair:finance:ops');
  assert.equal(transcript.length, 4);
  assert.equal(transcript[0].botId, 'ops'); assert.equal(transcript[1].botId, 'finance');
  assert.ok(f.state.messages.some(m => m.chatId === 'bot:finance' && m.exchange));
  assert.ok(f.state.messages.some(m => m.chatId === 'bot:ops' && m.asked?.[0].answer === 'Account A is cleared.'));
  assert.ok(f.state.chats.every(c => !c.typing.length));
});

test('failed turns expose a retry and do not leave typing stuck; later messages still work', async () => {
  const f = fixture(async (_body, n) => { if (n === 1) throw Error('temporary outage'); return answer('Recovered.'); });
  await f.chat.handleMessage('bot:ops', 'Try this', undefined, undefined, undefined, undefined, undefined, 'retry-id');
  assert.equal(f.state.messages[0].delivery, 'failed'); assert.match(f.state.messages[0].deliveryError, /outage/);
  await f.chat.handleMessage('bot:ops', 'Try this', undefined, undefined, undefined, undefined, undefined, 'retry-id');
  assert.equal(f.state.messages.filter(m => m.role === 'user').length, 1); assert.equal(f.state.messages[0].delivery, 'answered');
  assert.ok(f.state.chats.every(c => !c.typing.length));
});

test('an old in-flight model answer cannot post into a replaced workspace session', async () => {
  let release;
  const held = new Promise(resolve => release = resolve);
  const f = fixture(async () => { await held; return answer('Old private answer'); });
  const work = f.chat.handleMessage('bot:ops', 'old request');
  while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
  f.swap(); release(); await work;
  assert.equal(f.state.messages.length, 0);
});

test('the coordinator reviews a completed handoff once and stops after four automatic reviews', async () => {
  const f = fixture(async body => { assert.match(body.instructions, /Finish the report/); assert.match(body.instructions, /Verified invoice/); return answer('The requested report is complete.'); });
  const task = { id: 'handoff', botId: 'finance', sentVia: 'ops', chatId: 'bot:ops', status: 'done', originGoal: 'Finish the report', answer: 'Verified invoice', coordinationHop: 0 };
  f.state.sessions.push(task);
  await Promise.all([f.chat.coordinateTaskResult(task.id), f.chat.coordinateTaskResult(task.id)]);
  assert.equal(f.requests.length, 1); assert.equal(task.coordinationReviewed, true);
  assert.match(f.state.messages.find(m => m.role === 'bot').text, /report is complete/);
  f.state.sessions.push({ ...task, id: 'limit', coordinationReviewed: false, coordinationHop: 4 });
  await f.chat.coordinateTaskResult('limit'); assert.equal(f.requests.length, 1);
  assert.match(f.state.messages.at(-1).text, /review limit/);
  f.state.sessions.push({ ...task, id: 'blocked', coordinationReviewed: false, blocker: 'sign_in' });
  await f.chat.coordinateTaskResult('blocked'); assert.equal(f.requests.length, 1);
});

test('an agent reviews its own partial task against the whole owner request and continues once', async () => {
  const goal='Open the page, wait for the owner checkpoint, then read IANA and finish the original goal.';
  const f=fixture(async (body,n)=>{
    if(n===1)return call('start_task',{title:'Open page',goal:'Open only the page.',task_mode:'screen'});
    assert.match(body.instructions,/wait for the owner checkpoint/);assert.match(body.instructions,/Only opened the page/);
    return call('start_task',{title:'Finish checkpoint',goal,task_mode:'screen'});
  });
  f.mocks['./sessions'].startSession=opts=>{const task={id:'own-'+f.state.sessions.length,status:'queued',...opts};f.state.sessions.push(task);return task;};
  await f.chat.handleMessage('bot:ops',goal);
  const task=f.state.sessions[0];assert.equal(task.sentVia,'you');assert.equal(task.originGoal,goal);
  task.status='done';task.answer='Only opened the page.';
  await Promise.all([f.chat.coordinateTaskResult(task.id),f.chat.coordinateTaskResult(task.id)]);
  assert.equal(f.requests.length,2);assert.equal(task.coordinationReviewed,true);assert.equal(f.state.sessions.length,2);
  assert.equal(f.state.sessions[1].goal,goal);assert.equal(f.state.sessions[1].coordinationHop,1);
});
test('repeated teammate consultations exhaust a shared budget and produce an honest final answer', async () => {
  const f = fixture(async body => body.tools?.length ? call('ask_teammate', { bot_id: body.model === 'fixture/ops' ? 'finance' : 'ops', question: 'Clarify the evidence.' }) : answer('The evidence is incomplete.'));
  await f.chat.handleMessage('bot:ops', 'Ask Penny to clarify.');
  assert.ok(f.requests.length < 45, `bounded calls: ${f.requests.length}`);
  assert.equal(f.state.messages.filter(m => m.chatId === 'pair:finance:ops' && m.text === 'Clarify the evidence.').length, 8);
  assert.match(f.state.messages.filter(m => m.role === 'bot' && m.chatId === 'bot:ops').at(-1).text, /evidence is incomplete/);
  assert.ok(f.state.chats.every(c => !c.typing.length));
});

test('Head of Ops gets real creation/deletion receipts before answering and specialists cannot forge lifecycle calls', async () => {
  const f = fixture(async (body, n) => {
    if (n === 1) {
      for (const name of ['create_bot', 'delete_bot', 'list_agents']) assert.ok(body.tools.some(t => t.name === name));
      return call('create_bot', { name: 'Nova', role: 'Research' });
    }
    if (n === 2) {
      assert.ok(body.input.some(m => m.type === 'function_call_output' && /nova/.test(m.output)));
      return call('delete_bot', { bot_id: 'nova', reason: 'Temporary role finished.' });
    }
    assert.ok(!f.state.bots.some(b => b.id === 'nova'));
    return answer('Created and removed Nova.');
  });
  f.mocks['./bots'].createBot = async () => { f.state.bots.push({ id: 'nova', name: 'Nova', role: 'Research' }); return { botId: 'nova', chatId: 'bot:nova' }; };
  f.mocks['./remove'].deleteBot = async id => { f.state.bots = f.state.bots.filter(b => b.id !== id); };
  await f.chat.handleMessage('bot:ops', 'Create Nova and then remove the temporary agent.');
  assert.equal(f.requests.length, 3); assert.match(f.state.messages.at(-1).text, /Created and removed/);
  const specialist = fixture(async (body, n) => {
    if (n === 1) {
      assert.ok(!body.tools.some(t => ['create_bot', 'delete_bot'].includes(t.name)));
      return call('delete_bot', { bot_id: 'ops', reason: 'Forged call.' });
    }
    assert.ok(body.input.some(m => m.type === 'function_call_output' && /Only a team orchestrator/.test(m.output)));
    return answer('I cannot manage the team.');
  });
  await specialist.chat.handleMessage('bot:finance', 'Remove Bapi.');
  assert.equal(specialist.state.bots.length, 3);
});

test('an orchestrator can create and hand off to a new agent within the same chat turn', async () => {
  const f = fixture(async (body, n) => n === 1 ? call('create_bot', { name: 'Nova', role: 'Research' }) : call('hand_off', { bot_id: 'nova', title: 'Brief', goal: 'Draft the brief.', where: 'cloud' }));
  f.mocks['./bots'].createBot = async () => { f.state.bots.push({ id: 'nova', name: 'Nova' }); return { botId: 'nova', chatId: 'bot:nova' }; };
  const tasks = [];
  f.mocks['./sessions'].startSession = opts => { tasks.push(opts); const task = { ...opts, id: 'created-task' }; f.state.sessions.push(task); return task; };
  await f.chat.handleMessage('bot:ops', 'Create a researcher and assign the brief.');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].botId, 'nova');
  assert.equal(f.requests[1].tools.find(t => t.name === 'hand_off').parameters.properties.bot_id.enum, undefined);
});

test('hidden cards still support direct tags and real teammate consultation without cross-team access', async () => {
  const f = fixture(async body => answer(body.model === 'fixture/finance' ? 'The invoice is ready.' : 'wrong agent'));
  f.state.bots.find(b => b.id === 'finance').hidden = true;
  await f.chat.handleMessage('bot:ops', '@Penny is the invoice ready?');
  assert.equal(f.state.messages.find(m => m.role === 'bot').botId, 'finance');
  assert.equal(await f.chat.consultTeammate('ops', 'finance', 'Check the invoice.', 'bot:ops'), 'Penny says: The invoice is ready.');
  assert.equal(await f.chat.consultTeammate('ops', 'foreign', 'No cross-team access.', 'bot:ops'), 'No such teammate.');
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.model === 'fixture/finance'));
  assert.ok(f.state.messages.some(m => m.chatId === 'pair:finance:ops' && m.botId === 'finance'));
});
