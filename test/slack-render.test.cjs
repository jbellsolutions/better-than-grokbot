const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = require('./helpers/load-ts.cjs');

/**
 * A bot's turn drawn live in Slack (lib/server/slack-render.ts) from the turn stream: thread status at
 * once, one message edited no faster than every 0.8 s, the saved answer in Block Kit in its place,
 * approval cards only the paired person can decide, sent to their direct message from a channel.
 */
class SlackError extends Error {
  constructor(code) {
    super(`Slack: ${code}`);
    this.code = code;
  }
}

function fixture({ dm = 'D_OWNER', fail = [] } = {}) {
  const calls = [];
  let n = 0;
  const state = {
    bots: [{ id: 'ops', name: 'Bapi', isMain: true }],
    channels: [{ id: 'L1', kind: 'slack', botId: 'ops', handle: 'Team', owner: 'U_OWNER', pairCode: '1', status: 'live', at: 0, slack: { accountId: 'slackapp:T1', teamId: 'T1', botUserId: 'U_BOT', channels: [{ id: 'C1', name: 'sales' }], dm } }],
    messages: [],
  };
  const store = { getState: () => state, bot: id => state.bots.find(b => b.id === id), ownerName: () => 'Sam' };
  const stamp = (method, args) => calls.push({ method, args, at: Date.now() });
  const slackApi = {
    SlackError,
    SLACK_API: () => 'https://slack.com/api',
    isOwnSlack: id => !!id && id.startsWith('slackapp:'),
    slackCall: async (account, method, args) => {
      stamp(method, args);
      if (fail.includes(method)) throw new SlackError('method_not_supported_for_channel_type');
      return { ok: true, ts: `9${++n}.0`, channel: { id: 'D_OPENED' } };
    },
  };
  const channels = {
    channelLink: id => state.channels.find(l => l.id === id),
    slackIdentityOf: b => ({ username: b.name, icon_url: `https://bops.test/mascot/${b.id}.png` }),
    slackThreadOf: (l, p) => p.thread ?? p.messageId,
    slackPostAs: async (l, body) => (stamp('chat.postMessage', { ...body, username: 'Bapi' }), `8${++n}.0`),
  };
  const turns = load('lib/server/turn-events.ts', { '@/lib/types': {} });
  const pending = new Map();
  const decided = [];
  const interrupts = {
    isInterruptId: s => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s),
    approvalIdOf: s => s,
    pendingInterrupt: id => pending.get(id),
    decideInterrupt: async (id, d) => (decided.push({ id, ...d }), pending.delete(id)),
  };
  const render = load('lib/server/slack-render.ts', {
    './channels': channels, './slack-api': slackApi, './store': store, './turn-events': turns, './interrupts': interrupts, './instance': { instanceId: () => 'stream-pilot' },
  }, { globalThis: {} });
  render.startSlackRenderer();
  return { state, calls, turns, render, pending, decided };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const place = (chat, extra = {}) => ({ linkId: 'L1', chat, messageId: '111.1', from: 'U_OWNER', ...extra });

test('a Slack turn: status at once, one message edited at most every 0.8 s, then the saved answer in Block Kit', async () => {
  const f = fixture();
  const run = f.turns.startRun({ chatId: 'bot:ops', botId: 'ops', kind: 'chat', channel: place('D1') });
  await wait(20);
  assert.equal(f.calls[0].method, 'assistant.threads.setStatus');
  assert.equal(f.calls[0].args.thread_ts, '111.1');
  assert.equal(f.calls[0].args.username, 'Bapi', 'the status shows the bot as itself');
  const started = Date.now();
  for (let i = 0; i < 12; i++) {
    run.text(`word${i} `);
    await wait(150);
  }
  const posts = f.calls.filter(c => c.method === 'chat.postMessage');
  assert.equal(posts.length, 1, 'one live message, not one per piece');
  assert.ok(posts[0].at - started < 100, 'the first words go out at once');
  assert.equal(posts[0].args.thread_ts, '111.1');
  const edits = f.calls.filter(c => c.method === 'chat.update').map(c => c.at);
  assert.ok(edits.length >= 1);
  for (let i = 1; i < edits.length; i++) assert.ok(edits[i] - edits[i - 1] >= 790, `edits ${edits[i] - edits[i - 1]} ms apart`);
  assert.match(JSON.stringify(f.calls.at(-1).args.blocks), /▍/, 'still being written');

  f.state.messages.push({ id: 'msg1', chatId: 'bot:ops', role: 'bot', text: '**Plan**\n\n| Lead | Stage |\n|---|---|\n| Acme | Demo |\n\nNext step below.', options: ['Send it', 'Wait'] });
  run.finish({ messageId: 'msg1' });
  assert.ok(f.render.slackDrawn('msg1'), 'noted as drawn at once, before channels.ts looks');
  assert.equal(await f.render.slackDrawn('msg1'), true);
  const last = f.calls.filter(c => c.method === 'chat.update').at(-1);
  const blocks = JSON.stringify(last.args.blocks);
  assert.match(blocks, /"type":"table"/);
  assert.match(blocks, /\*Plan\*/);
  assert.match(blocks, /Reply with: Send it/);
  assert.doesNotMatch(blocks, /▍/);
});

test('a table is Slack\'s own, one per message; long text splits under Slack\'s limits', () => {
  const f = fixture();
  const two = f.render.slackMessages('| a | b |\n|---|---|\n| 1 | 2 |\n\nbetween\n\n| c |\n|---|\n| 3 |');
  assert.equal(two.length, 2, 'a second table starts a second message');
  assert.equal(two[0].blocks.filter(b => b.type === 'table').length, 1);
  assert.deepEqual(Array.from(two[0].blocks[0].rows[1], c => c.text), ['1', '2']);
  const long = f.render.slackMessages(Array.from({ length: 80 }, (_, i) => `Paragraph ${i} ${'x'.repeat(200)}`).join('\n\n'));
  for (const m of long) assert.ok(m.blocks.length <= 50 && m.blocks.every(b => (b.text?.text ?? '').length <= 3000));
  assert.equal(f.render.mrkdwn('**bold** [site](https://x.test) <b>'), '*bold* <https://x.test|site> &lt;b&gt;');
});

test('an approval asked in a channel goes to the owner\'s direct message, with a line in the thread', async () => {
  const f = fixture();
  const run = f.turns.startRun({ chatId: 'bot:ops', botId: 'ops', kind: 'chat', channel: place('C1') });
  const id = 'a'.repeat(32);
  run.custom('on_interrupt', { __opentag_interrupt_id__: id, __copilotkit_interrupt_value__: { action: 'confirm_write', args: { action: 'Bapi: Create a LinkedIn post', approver: 'Sam', effect: 'write', fields: [{ label: 'commentary', value: 'Hello' }], allow_always: true } } });
  await wait(30);
  const posts = f.calls.filter(c => c.method === 'chat.postMessage');
  assert.equal(posts[0].args.channel, 'C1');
  assert.equal(posts[0].args.thread_ts, '111.1');
  assert.match(posts[0].args.text, /Waiting for Sam's OK/);
  const card = posts[1].args;
  assert.equal(card.channel, 'D_OWNER', 'the card itself goes to the owner');
  const buttons = card.blocks.find(b => b.type === 'actions').elements;
  assert.deepEqual(Array.from(buttons, b => b.action_id), ['bops_approve_once', 'bops_approve_always', 'bops_deny']);
  assert.ok(buttons.every(b => b.value === `stream-pilot:${id}`));
  // The decision (from any surface) shows on the card.
  run.custom('bops.decision', { interruptId: id, confirmed: true, always: false, by: 'Sam' });
  await wait(30);
  const update = f.calls.filter(c => c.method === 'chat.update').at(-1);
  assert.equal(update.args.channel, 'D_OWNER');
  assert.match(JSON.stringify(update.args.blocks), /Approved by Sam/);
  assert.doesNotMatch(JSON.stringify(update.args.blocks), /"actions"/);
});

test('a click: only the owner decides; a stranger, another instance or a second click changes nothing', async () => {
  const replies = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => (replies.push({ url, body: JSON.parse(init.body) }), new Response('ok'));
  try {
    const f = fixture();
    const id = 'b'.repeat(32);
    f.pending.set(id, { chatId: 'bot:ops', channel: place('D1'), title: 'Post' });
    const click = (user, value = `stream-pilot:${id}`, action_id = 'bops_approve_once') =>
      f.render.slackAction({ type: 'block_actions', team: { id: 'T1' }, user: { id: user }, response_url: 'https://hooks.slack.com/actions/x', actions: [{ action_id, value }] });
    await click('U_STRANGER');
    assert.equal(f.decided.length, 0);
    assert.match(replies.at(-1).body.text, /Only Sam can decide/);
    assert.equal(replies.at(-1).body.response_type, 'ephemeral');
    await click('U_OWNER', `sales-team:${id}`);
    assert.equal(f.decided.length, 0, "another instance's click is refused");
    assert.match(replies.at(-1).body.text, /another Bops/);
    await click('U_OWNER', `stream-pilot:${id}`, 'bops_approve_always');
    assert.deepEqual(f.decided.map(d => ({ ...d })), [{ id, confirmed: true, always: true, by: 'Sam' }]);
    await click('U_OWNER');
    assert.equal(f.decided.length, 2);
    assert.match(replies.at(-1).body.text, /already decided/);
  } finally {
    global.fetch = realFetch;
  }
});

test("Slack's signature is required: a stale or forged request is refused", async () => {
  const secret = crypto.randomBytes(16).toString('hex'); // made up for this run
  const api = load('lib/server/slack-api.ts', { './keychain': { getSecret: async () => null, setSecret: async () => {}, deleteSecret: async () => {} }, './store': {} }, {
    process: { ...process, env: { ...process.env, BOPS_SLACK_SIGNING_SECRET: secret } }, globalThis: {},
  });
  const body = 'payload=%7B%7D';
  const signed = (ts, key = secret) => new Request('http://x/', { method: 'POST', headers: { 'x-slack-request-timestamp': String(ts), 'x-slack-signature': `v0=${crypto.createHmac('sha256', key).update(`v0:${ts}:${body}`).digest('hex')}` } });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await api.slackSigned(signed(now), body), true);
  assert.equal(await api.slackSigned(signed(now - 600), body), false, 'stale');
  assert.equal(await api.slackSigned(signed(now, 'f'.repeat(32)), body), false, 'forged');
  assert.equal(await api.slackSigned(signed(now), body + 'x'), false, 'changed body');
});

test('a task started from Slack: one status line edited in place as it works, not a message per step', async () => {
  const f = fixture();
  const s = { id: 's1', chatId: 'bot:ops', botId: 'ops', title: 'Research Acme', status: 'starting', channelBack: place('C1', { thread: '111.1' }) };
  f.turns.noteSession(s, { status: 'queued' });
  s.status = 'running';
  s.activity = 'Opening the CRM';
  f.turns.noteSession(s, { status: 'starting' });
  f.turns.noteTaskStep('s1', 'browser', 'Reading acme.com · pricing');
  await wait(900);
  s.activity = 'Writing the summary';
  f.turns.noteSession(s, { status: 'running', activity: 'Opening the CRM' });
  f.turns.noteTaskStep('s1', 'text', 'Acme has three plans');
  await wait(900);
  s.status = 'done';
  s.answer = 'Acme: three plans.';
  f.turns.noteSession(s, { status: 'running', activity: 'Writing the summary' });
  await wait(100);
  const posts = f.calls.filter(c => c.method === 'chat.postMessage');
  const edits = f.calls.filter(c => c.method === 'chat.update');
  assert.equal(posts.length, 1, 'one status line');
  assert.equal(posts[0].args.thread_ts, '111.1');
  assert.ok(edits.length >= 2, 'edited as it goes');
  assert.match(JSON.stringify(edits[0].args.blocks), /Reading acme\.com: pricing/);
  const last = JSON.stringify(edits.at(-1).args.blocks);
  assert.match(last, /✓ Done: Research Acme/);
  assert.match(last, /Writing the summary ✓/);
});
