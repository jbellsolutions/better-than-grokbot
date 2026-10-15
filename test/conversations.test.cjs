const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

test('outgoing messages do not hide an earlier unread incoming message; manual unread survives read position', () => {
  const c = load('lib/conversations.ts');
  const messages = [{ chatId: 'a', role: 'bot', at: 20 }, { chatId: 'a', role: 'user', at: 30 }, { chatId: 'b', role: 'bot', at: 25 }];
  const index = c.conversationIndex(messages);
  assert.equal(index.get('a').last.at, 30);
  assert.equal(c.conversationUnread({ readAt: 10 }, index.get('a').incomingAt), true);
  assert.equal(c.conversationUnread({ readAt: 25 }, index.get('a').incomingAt), false);
  assert.equal(c.conversationUnread({ readAt: 50, unread: true }, index.get('a').incomingAt), true);
  assert.deepEqual([...index].sort((a, b) => b[1].last.at - a[1].last.at).map(([id]) => id), ['a', 'b']);
});

test('mentions match names and stable IDs, escape punctuation, and reject partial names', () => {
  const c = load('lib/conversations.ts');
  const bots = [{ id: 'ops', name: 'Bapi' }, { id: 'writer', name: 'Anne Marie' }, { id: 'finance', name: 'Fin+' }];
  assert.equal(c.mentionedBots('@Bapi2 please', bots).length, 0);
  assert.deepEqual(Array.from(c.mentionedBots('@ops ask @Anne Marie. @Fin+?', bots), b => b.id), ['ops', 'writer', 'finance']);
  assert.equal(c.leadsTeam({ isMain: false, teamRole: 'operations' }), true);
});

test('turns serialize per chat, run unrelated chats concurrently, and recover after failure', async () => {
  const { queueTurn } = load('lib/server/turn-queue.ts');
  let release;
  const waiting = new Promise(resolve => release = resolve);
  const order = [];
  const first = queueTurn('a', async () => { order.push('a1'); await waiting; throw Error('interrupted'); });
  const rejected = assert.rejects(first, /interrupted/);
  const second = queueTurn('a', async () => order.push('a2'));
  await queueTurn('b', async () => order.push('b'));
  assert.deepEqual(order, ['a1', 'b']);
  release(); await rejected; await second;
  assert.deepEqual(order, ['a1', 'b', 'a2']);
});

test('read controls validate inputs and acknowledge only the messages actually displayed', async () => {
  const chat = { id: 'a', readAt: 10 };
  const route = load('app/api/chats/[chatId]/read/route.ts', { '@/lib/server/store': { chat: id => id === 'a' ? chat : undefined, update: fn => fn() } });
  const context = { params: Promise.resolve({ chatId: 'a' }) };
  const post = body => route.POST(new Request('http://localhost/read', { method: 'POST', body: JSON.stringify(body) }), context);
  assert.equal((await post({ through: 20 })).status, 200); assert.equal(chat.readAt, 20);
  await post({ unread: true }); assert.equal(chat.unread, true); assert.equal(chat.readAt, 20);
  assert.equal((await post({ unread: 'yes' })).status, 400);
  assert.equal((await post({ through: -1 })).status, 400);
  assert.equal((await route.POST(new Request('http://localhost/read'), { params: Promise.resolve({ chatId: 'missing' }) })).status, 404);
});

test('operations lead is unique per team and hiding its card preserves its role', async () => {
  const state = { bots: [{ id: 'main', isMain: true }, { id: 'ops', teamRole: 'operations' }, { id: 'writer' }, { id: 'other', workspaceId: 'other', teamRole: 'operations' }] };
  const route = load('app/api/bots/route.ts', { '@/lib/server/bots': {}, '@/lib/server/remove': {}, '@/lib/server/store': { bot: id => state.bots.find(b => b.id === id), getState: () => state, update: fn => fn(state) } });
  const patch = body => route.PATCH(new Request('http://localhost/bots', { method: 'PATCH', body: JSON.stringify(body) }));
  assert.equal((await patch({ botId: 'ops', hidden: true })).status, 200);
  assert.equal(state.bots[1].hidden, true); assert.equal(state.bots[1].teamRole, 'operations');
  assert.equal((await patch({ botId: 'main', teamRole: 'operations' })).status, 400);
  assert.equal((await patch({ botId: 'writer', teamRole: 'operations' })).status, 200);
  assert.equal(state.bots[1].teamRole, 'specialist');
  assert.equal(state.bots.filter(b=>b.workspaceId !== 'other' && b.teamRole === 'operations').length, 1);
  assert.equal(state.bots[3].teamRole, 'operations');
  assert.equal(state.bots[2].teamRole, 'operations'); assert.equal(state.bots[2].hidden, false);
});

test('login handoff resumes the saved task once and payment cannot use the login shortcut', async () => {
  const task = { id: 'task', blocker: 'sign_in' }; let replies = 0, returns = 0;
  const state = { takeover: { sessionId: 'task' } };
  const route = load('app/api/sessions/[sessionId]/reply/route.ts', {
    '@/lib/server/business-runtime': {}, '@/lib/server/sessions': { replyToSession: () => replies++, returnControl: () => returns++ }, '@/lib/server/watches': {},
    '@/lib/server/store': { session: () => task, getState: () => state, patchSession: (_id, patch) => Object.assign(task, patch) },
  });
  const run = () => route.POST(new Request('http://localhost/reply', { method: 'POST', body: JSON.stringify({ handoff: true }) }), { params: Promise.resolve({ sessionId: 'task' }) });
  await run(); await run(); assert.equal(returns, 1); assert.equal(replies, 0); assert.equal(task.blocker, undefined);
  task.blocker = 'payment'; assert.equal((await run()).status, 409); assert.equal(task.blocker, 'payment');
  state.takeover = undefined; task.blocker = 'two_factor'; await run(); assert.equal(replies, 1);
});

test('live state stream sends the current version, coalesces changes, and releases subscriptions on abort', async () => {
  let listener, version = 1, disposed = 0;
  const route = load('app/api/state/events/route.ts', { '@/lib/server/store': { getVersion: () => version, subscribeChanges: fn => { listener = fn; return () => disposed++; } } });
  const abort = new AbortController(); const res = route.GET(new Request('http://localhost/events', { signal: abort.signal }));
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
  const reader = res.body.getReader(); const decode = value => new TextDecoder().decode(value);
  assert.match(decode((await reader.read()).value), /data: 1/);
  version = 2; listener(); version = 3; listener();
  assert.match(decode((await reader.read()).value), /data: 3/);
  abort.abort(); assert.equal(disposed, 1); assert.equal((await reader.read()).done, true);
});

test('manual card order survives incoming activity, filtered moves and newly created agents', () => {
  const c = load('lib/conversations.ts');
  const chats = ['a', 'hidden', 'b', 'new'].map((id, i) => ({ id, createdAt: i }));
  const index = c.conversationIndex([{ chatId: 'a', role: 'bot', at: 900 }, { chatId: 'b', role: 'bot', at: 10 }]);
  const order = c.moveConversation(['a', 'hidden', 'b'], 'b', 'a');
  assert.deepEqual(Array.from(order), ['b', 'a', 'hidden']);
  assert.deepEqual(Array.from(c.orderConversations(chats, index, order), x => x.id), ['b', 'a', 'hidden', 'new']);
  assert.deepEqual(Array.from(c.orderConversations(chats, index), x => x.id), ['a', 'b', 'new', 'hidden']);
  assert.deepEqual(Array.from(c.moveConversation(order, 'missing', 'a')), Array.from(order));
});

test('card order is scoped to its team, rejects invalid IDs and can return to recent activity', async () => {
  const state = { bots: [], workspaces: [{ id: 'one' }, { id: 'two', chatOrder: ['foreign'] }], chats: [{ id: 'a', workspaceId: 'one' }, { id: 'hidden', workspaceId: 'one' }, { id: 'b', workspaceId: 'one' }, { id: 'foreign', workspaceId: 'two' }] };
  let updates = 0;
  const store = { getState: () => state, update: fn => { updates++; fn(state); } };
  const route = load('app/api/chats/order/route.ts', { '@/lib/server/store': store });
  const put = (chatIds, workspaceId = 'one') => route.PUT(new Request('http://localhost/order', { method: 'PUT', body: JSON.stringify({ workspaceId, chatIds }) }));
  for (const bad of [['a', 'a'], ['foreign'], [4], 'a', undefined]) assert.equal((await put(bad)).status, 400);
  assert.equal((await put([], 'missing')).status, 404); assert.equal(updates, 0);
  assert.equal((await put(['b', 'a'])).status, 200);
  assert.deepEqual(Array.from(state.workspaces[0].chatOrder), ['b', 'a', 'hidden']);
  assert.deepEqual(state.workspaces[1].chatOrder, ['foreign']);
  assert.equal((await put(null)).status, 200); assert.equal(state.workspaces[0].chatOrder, undefined);
});
