const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

test('routine schedules reject invalid times and save reminders without starting a computer', () => {
  const state = { routines: [] }; let starts = 0;
  const routines = load('lib/server/routines.ts', {
    './store': { bot: id => id === 'a' ? { id } : undefined, getState: () => state, id: () => 'routine', update: fn => fn(state) },
    './sessions': { startSession: () => starts++ },
  }, { setInterval: () => 0 });
  assert.throws(() => routines.createRoutine('missing', 'x', 'x', { kind: 'daily', time: '09:00' }), /agent/);
  assert.throws(() => routines.createRoutine('a', 'x', 'x', { kind: 'daily', time: '25:00' }), /HH:MM/);
  assert.throws(() => routines.createRoutine('a', 'x', 'x', { kind: 'weekly', time: '09:00', day: 7 }), /weekday/);
  assert.throws(() => routines.createRoutine('a', 'x', 'x', { kind: 'once', at: Date.now() - 1 }), /future/);
  const r = routines.createRoutine('a', ' Check in ', ' Review the team ', { kind: 'weekdays', time: '09:00' }, { reminder: 'Review the team' });
  assert.equal(r.title, 'Check in'); assert.equal(r.reminder, 'Review the team'); assert.ok(r.nextRunAt > Date.now()); assert.equal(starts, 0);
});

test('message acceptance validates attachments and attaches background replies to the request lifecycle', async () => {
  let accepted = 0, completed = 0; const callbacks = [];
  const route = load('app/api/chats/[chatId]/messages/route.ts', {
    'next/server': { after: fn => callbacks.push(fn) },
    '@/lib/server/chat': { handleMessage: async () => { accepted++; await Promise.resolve(); completed++; } },
    '@/lib/server/uploads': { uploadPath: id => id === 'valid' ? { path: 'fixture.png' } : undefined },
    '@/lib/server/remove': {}, '@/lib/server/store': { chat: () => ({ id: 'a' }) },
  });
  const post = body => route.POST(new Request('http://localhost/messages', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ chatId: 'a' }) });
  for (const body of [null, [], { text: 2 }, { images: [null] }, { images: [{ id: 1, type: 'image/png' }] }, { requestId: 'bad id', text: 'hello' }, { replyTo: {}, text: 'hello' }]) assert.equal((await post(body)).status, 400);
  assert.equal(accepted, 0);
  assert.equal((await post({ text: 'hello', requestId: 'send-1' })).status, 200); assert.equal(accepted, 1);
  await callbacks[0](); assert.equal(completed, 1);
});
