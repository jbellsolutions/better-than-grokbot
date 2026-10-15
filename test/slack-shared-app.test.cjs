const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');

/**
 * One Slack app for every Bops on a Mac, next to other agents' own Slack apps (Hermes'):
 * - the front door (edge/slack-route.mjs) sends each event to exactly one Bops, and a click to the
 *   Bops its button names;
 * - a Bops answers in a channel only when the app is @mentioned or in a thread it started, and stays
 *   out of any thread another app's bot is part of (lib/server/channels.ts), so no message is
 *   answered twice;
 * - its bots post as "<name> · Bops" (or the team's name), never as just another agent's name.
 */

const edge = () => import(path.resolve('edge/slack-route.mjs'));
const hash = code => crypto.createHash('sha256').update(code).digest('hex');
const table = (instance, over = {}) => ({ instance, app: { team: 'T1', user: 'UBOPS', bot: 'BBOPS' }, teams: ['T1'], channels: [], owners: ['UOWNER'], codes: [], names: [], threads: [], talked: {}, ...over });
const env = (event, over = {}) => ({ type: 'event_callback', team_id: 'T1', event_id: `Ev${Math.random()}`, event: { type: 'message', ts: '100.1', user: 'UOWNER', ...event }, ...over });

test('the front door sends each Slack event to exactly one Bops', async () => {
  const { routeSlack, emptyMemory, remember } = await edge();
  const tables = [
    table('default', { names: [{ name: 'Boppy', main: true }, { name: 'Bapi' }], channels: ['CGEN'] }),
    table('sales-team', { names: [{ name: 'Head of Sales', main: true }, { name: 'Pipeline Review' }, { name: 'Bapi' }], channels: ['CSALES', 'CGEN'], codes: [hash('482913')], threads: ['CSALES:50.1'] }),
    table('research-team', { names: [{ name: 'Research Team', main: true }, { name: 'Bapi' }], talked: { UOWNER: 1000 } }),
  ];
  const to = (event, memory = emptyMemory(), over) => routeSlack(env(event, over), tables, memory).to;

  // A pairing code goes to the Bops whose code it is, wherever it's sent.
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: '482 913' }), 'sales-team');
  assert.equal(to({ channel: 'CGEN', channel_type: 'channel', text: '<@UBOPS> 482913' }), 'sales-team');
  // A direct message: the one named (longest name), else where they last wrote, else theirs.
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'Head of Sales, how is the pipeline?' }), 'sales-team');
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'Research Team: plan the week' }), 'research-team');
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'Bapi, help' }), 'research-team', 'every team has a Bapi: the name never decides, the last one written to does');
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'and then?' }), 'research-team');
  const memory = emptyMemory();
  memory.talked.set('UOWNER', { to: 'default', at: 2000 });
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'and then?' }, memory), 'default', 'this front door saw a later one');
  assert.equal(routeSlack(env({ channel: 'DJ', channel_type: 'im', text: 'hi' }), tables.map(t => ({ ...t, talked: {} })), emptyMemory()).to, 'default', 'nobody written to yet: the first of theirs');
  // A reply in a thread goes to the Bops that started it (its own thread, or one this front door sent it the first message of).
  assert.equal(to({ channel: 'CSALES', channel_type: 'channel', ts: '60.1', thread_ts: '50.1', text: 'and the rest?' }), 'sales-team');
  const m2 = emptyMemory();
  const first = env({ channel: 'CGEN', channel_type: 'channel', ts: '70.1', text: '<@UBOPS> Boppy, hi' });
  assert.equal(routeSlack(first, tables, m2).to, 'default');
  remember(m2, first, 'default');
  assert.equal(to({ channel: 'CGEN', channel_type: 'channel', ts: '71.1', thread_ts: '70.1', text: 'thanks' }, m2), 'default');
  // A channel: only when the app is mentioned; of several Bops there, the one named, else the first listed.
  assert.equal(to({ channel: 'CSALES', channel_type: 'channel', text: 'Head of Sales, anyone?' }), null);
  assert.equal(to({ channel: 'CSALES', channel_type: 'channel', text: '<@UBOPS> pipeline?' }), 'sales-team');
  assert.equal(to({ channel: 'CGEN', channel_type: 'channel', text: '<@UBOPS> Pipeline Review: numbers' }), 'sales-team');
  assert.equal(to({ channel: 'CGEN', channel_type: 'channel', text: '<@UBOPS> numbers' }), 'default');
  assert.equal(to({ channel: 'CNONE', channel_type: 'channel', text: '<@UBOPS> hello' }), null);
  // Another app's bot: only to the Bops whose thread it is (so it knows that bot is in it); otherwise nobody.
  assert.equal(to({ channel: 'CSALES', channel_type: 'channel', ts: '61.1', thread_ts: '50.1', bot_id: 'BHERMES', text: 'my take' }), 'sales-team');
  assert.equal(to({ channel: 'CSALES', channel_type: 'channel', bot_id: 'BHERMES', text: '<@UBOPS> hi' }), null);
  // Another workspace, or not a message: nobody.
  assert.equal(to({ channel: 'DJ', channel_type: 'im', text: 'hi' }, emptyMemory(), { team_id: 'T2' }), null);
  assert.equal(routeSlack({ type: 'event_callback', team_id: 'T1', event: { type: 'reaction_added', channel: 'C1', ts: '1.1' } }, tables).to, null);
});

test('the front door drops what can be nobody\'s without asking, and routes clicks by their button', async () => {
  const { maybeOurs, clickedFor, codeIn } = await edge();
  assert.equal(maybeOurs(env({ channel: 'CGEN', channel_type: 'channel', text: 'lunch?' })), false);
  assert.equal(maybeOurs(env({ channel: 'CGEN', channel_type: 'channel', bot_id: 'BX', text: 'report' })), false);
  assert.equal(maybeOurs(env({ channel: 'CGEN', channel_type: 'channel', text: 'hey <@UBOPS>' })), true);
  assert.equal(maybeOurs(env({ channel: 'CGEN', channel_type: 'channel', ts: '2.1', thread_ts: '1.1', text: 'ok' })), true);
  assert.equal(maybeOurs(env({ channel: 'DJ', channel_type: 'im', text: 'hi' })), true);
  assert.equal(clickedFor({ actions: [{ action_id: 'bops_approve_once', value: 'research-team:0123456789abcdef0123456789abcdef' }] }), 'research-team');
  assert.equal(clickedFor({ actions: [{ action_id: 'hermes_approve_once', value: '{"x":1}' }] }), null);
  assert.equal(clickedFor({ type: 'view_submission' }), null);
  assert.equal(codeIn(env({ text: '<@UBOPS> 123 456' })), '123456');
  assert.equal(codeIn(env({ text: 'call me at 5' })), null);
});

/* ---------------- One Bops: when it answers in Slack ---------------- */

function bops({ instance = 'sales-team', replies = {} } = {}) {
  const handled = [];
  const calls = [];
  const users = { UOWNER: { real_name: 'Sam Rivera' }, USARA: { real_name: 'Sara' }, UHERMES: { real_name: 'Head of Sales', is_bot: true } };
  const state = {
    bots: [{ id: 'sales', name: 'Head of Sales', isMain: true, color: '#0A0A0A' }, { id: 'bapi', name: 'Bapi', color: '#E9FF3B' }],
    channels: [{ id: 'L1', kind: 'slack', botId: 'sales', handle: 'Team', owner: 'UOWNER', pairCode: '482913', pairCodeAt: Date.now(), status: 'live', at: 0, slack: { accountId: 'slackapp:T1', teamId: 'T1', botUserId: 'UBOPS', channels: [{ id: 'CSALES', name: 'sales' }], dm: 'DJ' } }],
    messages: [], sessions: [], accounts: [],
  };
  const slackApi = {
    SlackError: class extends Error {},
    SLACK_API: () => 'https://slack.com/api',
    OWN_SLACK: 'slackapp:',
    isOwnSlack: id => !!id && id.startsWith('slackapp:'),
    slackApp: async () => ({ token: 'xoxb-test', secret: 's' }),
    slackAppKnown: () => true,
    ensureSlackAppAccount: async () => {},
    slackFrontDoor: () => 'https://hooks.example.test',
    slackMe: async () => ({ team_id: 'T1', user_id: 'UBOPS', bot_id: 'BBOPS' }),
    slackCall: async (account, method, args) => {
      calls.push({ method, args });
      if (method === 'users.info') return { ok: true, user: users[args.user] };
      if (method === 'conversations.replies') return { ok: true, messages: replies[args.ts] ?? [] };
      return { ok: true, ts: '9.9' };
    },
  };
  const channels = load('lib/server/channels.ts', {
    './cloud': { cloudOn: () => false, cloudJson: async () => ({}), cloudSession: async () => ({}), cloudSessionNow: () => null },
    './keychain': { getSecret: async () => null, setSecret: async () => {}, deleteSecret: async () => {} },
    './composio': { composio: () => ({}), composioUser: () => 'u', publicUrl: () => 'https://front.example.com' },
    './slack-api': slackApi,
    './store': {
      getState: () => state, bot: id => state.bots.find(b => b.id === id), ownerName: () => 'Sam', id: () => `id${Math.random()}`,
      addMessage: () => {}, patchSession: () => {}, update: fn => fn(state), watchChanges: () => {},
    },
    './uploads': { saveUpload: async () => ({}) },
    './instance': { instanceId: () => instance, instanceName: () => (instance === 'research-team' ? 'Research Team' : 'Head of Sales') },
    './chat': { handleMessage: async (chatId, text) => (handled.push(text), null) },
    './slack-render': { slackDrawn: () => undefined, startSlackRenderer: () => {} },
  }, { globalThis: {} });
  let ts = 1000;
  const say = async (event) => {
    const e = { type: 'message', ts: `${++ts}.1`, user: 'UOWNER', channel: 'CSALES', channel_type: 'channel', ...event };
    await channels.slackEventIn(['T1'], e);
    return e.ts;
  };
  const answered = (link, root) => channels.slackThreadOf(state.channels[0], { linkId: 'L1', chat: 'CSALES', messageId: root });
  return { channels, state, handled, calls, say, answered };
}
const ephemeral = calls => calls.filter(c => c.method === 'chat.postEphemeral');

test('in a channel a Bops bot answers only when the app is mentioned, or in a thread it started', async () => {
  const b = bops();
  await b.say({ text: 'Head of Sales, what do you think?' });
  assert.deepEqual(b.handled, [], 'naming the bot is not mentioning the app: another agent may go by that name');
  assert.equal(b.calls.length, 0, 'and nothing was looked up for it');
  const root = await b.say({ text: '<@UBOPS> what is the pipeline?' });
  assert.deepEqual(b.handled, ['what is the pipeline?']);
  b.answered(null, root);
  await b.say({ text: 'and next week?', thread_ts: root });
  assert.deepEqual(b.handled.at(-1), 'and next week?', 'a reply in its own thread needs no mention');
  const other = await b.say({ text: 'unrelated root' });
  await b.say({ text: 'reply there', thread_ts: other });
  assert.equal(b.handled.length, 2, 'a reply in somebody else\'s thread is not for it');
  await b.say({ text: '<@UBOPS> ask <@USARA> too' });
  assert.equal(b.handled.length, 3, 'mentioning a person besides the app is fine');
});

test('a Bops bot stays out of a thread another app\'s bot is part of, so nothing is answered twice', async () => {
  const b = bops({ replies: { '500.1': [{ ts: '500.1', user: 'UOWNER', text: '<@UHERMES> draft the deck' }, { ts: '501.1', bot_id: 'BHERMES', text: 'on it' }], '600.1': [{ ts: '600.1', user: 'UOWNER', text: 'plain thread' }] } });
  // Mentioned at the top with another bot: both were asked, both answer that one, but the thread is shared after.
  const both = await b.say({ text: '<@UBOPS> <@UHERMES> compare notes' });
  assert.equal(b.handled.length, 1);
  b.answered(null, both);
  await b.say({ text: 'and?', thread_ts: both });
  assert.equal(b.handled.length, 1, 'an unmentioned reply there would reach the other bot too');
  // Its own thread, until another bot posts in it.
  const mine = await b.say({ text: '<@UBOPS> forecast' });
  b.answered(null, mine);
  await b.channels.slackEventIn(['T1'], { type: 'message', ts: '777.1', thread_ts: mine, channel: 'CSALES', channel_type: 'channel', bot_id: 'BBOPS', text: 'our own post' });
  await b.say({ text: 'more detail', thread_ts: mine });
  assert.equal(b.handled.length, 3, 'its own posts don\'t make the thread shared');
  await b.channels.slackEventIn(['T1'], { type: 'message', ts: '778.1', thread_ts: mine, channel: 'CSALES', channel_type: 'channel', bot_id: 'BHERMES', text: 'jumping in' });
  await b.say({ text: 'what now?', thread_ts: mine });
  assert.equal(b.handled.length, 3, 'another bot posted there: it may answer replies too');
  await b.say({ text: '<@UBOPS> what now?', thread_ts: mine });
  assert.equal(b.handled.length, 3, 'mentioned there, it still stays out');
  assert.match(ephemeral(b.calls).at(-1).args.text, /staying out of this thread/);
  assert.equal(ephemeral(b.calls).at(-1).args.user, 'UOWNER', 'told only to the person who asked');
  // Another bot's thread it never saw: read from Slack.
  await b.say({ text: '<@UBOPS> your view?', thread_ts: '500.1' });
  assert.equal(b.handled.length, 3, 'a Hermes thread: stays out');
  assert.equal(ephemeral(b.calls).length, 2);
  await b.say({ text: '<@UBOPS> your view?', thread_ts: '600.1' });
  assert.equal(b.handled.length, 4, 'a thread no bot is part of: answers');
  await b.say({ text: '<@UBOPS> <@UHERMES> both of you', thread_ts: '500.1' });
  assert.equal(b.handled.length, 5, 'asked together with the other bot: both answer, as asked');
  // In its own thread, a reply that calls on another bot only is that bot's to answer, and so are the replies after it.
  const own = await b.say({ text: '<@UBOPS> quarter plan' });
  b.answered(null, own);
  await b.say({ text: 'more?', thread_ts: own });
  assert.equal(b.handled.length, 7);
  await b.say({ text: '<@UHERMES> your take?', thread_ts: own });
  assert.equal(b.handled.length, 7, 'a reply to the other bot only: not answered here');
  await b.say({ text: 'and after that?', thread_ts: own });
  assert.equal(b.handled.length, 7, 'the other bot is in the thread now');
});

test('Bops bots post under names that say they\'re Bops, with this Mac\'s pictures; the route table hides codes', async () => {
  const sales = bops();
  const main = sales.channels.slackIdentityOf(sales.state.bots[0], 'slackapp:T1');
  assert.equal(main.username, 'Head of Sales · Bops');
  assert.match(main.icon_url, /^https:\/\/hooks\.example\.test\/mascot\/[A-Za-z0-9-]+\.png$/, 'its picture from this Mac\'s front door');
  assert.equal(sales.channels.slackIdentityOf(sales.state.bots[1], 'slackapp:T1').username, 'Bapi · Head of Sales');
  assert.equal(sales.channels.slackIdentityOf(sales.state.bots[0], 'ca_composio').username, 'Head of Sales', 'Composio\'s app is unchanged');
  assert.equal(bops({ instance: 'research-team' }).channels.slackIdentityOf({ id: 'bapi', name: 'Bapi', color: '#E9FF3B' }, 'slackapp:T1').username, 'Bapi · Research Team');
  await sales.say({ channel: 'DJ', channel_type: 'im', text: 'hello' });
  // A second bot waiting for its code (a code works only while nobody is paired).
  sales.state.channels.push({ id: 'L2', kind: 'slack', botId: 'bapi', handle: 'Team', pairCode: '482913', pairCodeAt: Date.now(), status: 'live', at: 0, slack: { accountId: 'slackapp:T1', teamId: 'T1', botUserId: 'UBOPS', channels: [] } });
  const routes = await sales.channels.slackRoutes();
  assert.equal(routes.instance, 'sales-team');
  assert.deepEqual(JSON.parse(JSON.stringify(routes.app)), { team: 'T1', user: 'UBOPS', bot: 'BBOPS' });
  assert.deepEqual(Array.from(routes.channels), ['CSALES']);
  assert.deepEqual(Array.from(routes.codes), [hash('482913')], 'codes only hashed');
  assert.ok(!JSON.stringify(routes).includes('482913'));
  assert.ok(routes.talked.UOWNER > 0, 'when they last wrote directly');
  assert.deepEqual(Array.from(routes.names, n => n.name), ['Head of Sales', 'Bapi']);
  // Taken out of this Bops (the others on the Mac keep the app): the front door sends it nothing.
  sales.state.slackAppOff = true;
  assert.equal((await sales.channels.slackRoutes()).app, null);
});
