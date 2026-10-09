const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const loadInstance = require('./helpers/instance.cjs');
function load(file, modules = {}, env = {}, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: n => (n === './instance' || n === '@/lib/server/instance') ? loadInstance({ env, cwd: () => process.cwd() }) : n === 'server-only' ? {} : n in modules ? modules[n] : require(n), process: { env, cwd: () => process.cwd() }, Buffer, console, setTimeout, AbortSignal, ...extras });
  return exports;
}
const types = load('lib/types.ts');
const original = 'afdb8c8d-345a-4d52-ad45-e0f60e7ca9ea';
const target = 'eed51fbb-8f2e-4b78-8d8f-8aa672b11df5';
function fixture() {
  const main = { id: 'main', name: 'Main', isMain: true, computerId: original, computerStatus: 'ready' };
  const scout = { id: 'scout', name: 'Scout', isMain: false, computer: 'shared', computerStatus: 'none' };
  const state = { host: 'orgo', bots: [main, scout], sessions: [], watches: [], screens: { 'scout:100': { url: 'old' } } };
  const store = { bot: id => state.bots.find(b => b.id === id), getState: () => state, update: fn => fn(state) };
  const screens = load('lib/server/screens.ts', { '@/lib/types': types, './local': {}, './store': store });
  let inventory = [{ id: original, name: 'Content', os: 'linux', status: 'running', ram: 8 }, { id: target, name: 'Other', os: 'linux', status: 'running', ram: 8 }];
  const runtime = load('lib/server/existing-computers.ts', { '@/lib/types': types, './store': store, './screens': screens, './orgo': { orgo: { computers: async () => inventory } } }, { BOPS_ORGO_COMPUTER_ID: original });
  return { main, scout, state, store, screens, runtime, inventory };
}
test('selecting an account computer persists a borrowed assignment and leaves the original machine intact', async () => {
  const f = fixture();
  assert.equal((await f.runtime.assignComputer('scout', target)).ok, true);
  assert.equal(f.scout.computerId, target);
  assert.equal(f.scout.externalComputer, true);
  assert.equal(f.main.computerId, original);
  assert.equal(f.scout.computerName, 'Other');
  assert.equal(f.state.screens['scout:100'], undefined);
});
test('switching refuses unavailable, stopped, non-Linux and busy target computers', async () => {
  const f = fixture();
  assert.match((await f.runtime.assignComputer('scout', 'ffffffff-ffff-ffff-ffff-ffffffffffff')).error, /not available/);
  f.inventory[1].status = 'frozen';
  assert.match((await f.runtime.assignComputer('scout', target)).error, /Start/);
  f.inventory[1].status = 'running'; f.inventory[1].os = 'windows';
  assert.match((await f.runtime.assignComputer('scout', target)).error, /Linux/);
  f.inventory[1].os = 'linux';
  f.state.bots.push({ id: 'other', computerId: target, isMain: false, computerStatus: 'ready' });
  f.state.sessions.push({ botId: 'other', status: 'running', runsOn: 'cloud' });
  assert.match((await f.runtime.assignComputer('scout', target)).error, /Pause/);
  assert.equal(f.scout.computerId, undefined);
});
test('moving the main agent refuses active shared-agent tasks and screen watches', async () => {
  const f = fixture();
  f.state.sessions.push({ botId: 'scout', status: 'running', runsOn: 'cloud' });
  assert.match((await f.runtime.assignComputer('main', target)).error, /Pause/);
  f.state.sessions = []; f.state.watches.push({ botId: 'scout', mac: false });
  assert.match((await f.runtime.assignComputer('main', target)).error, /watching/);
  assert.equal(f.main.computerId, original);
});
test('independently assigned agents on one VM use one computer identity and screen ledger', async () => {
  const f = fixture();
  await f.runtime.assignComputer('scout', original);
  assert.equal(f.screens.sameComputer('scout', 'main'), true);
  assert.equal(f.screens.workComputer(f.scout), f.main);
  f.state.host = 'mac';
  assert.equal(f.screens.sameComputer('scout', 'main'), false);
});
test('deleting and resizing a borrowed VM are blocked before any provider request', async () => {
  let calls = 0;
  const state = { bots: [{ computerId: target, externalComputer: true }] };
  const { orgo } = load('lib/server/orgo.ts', { './orgo-auth': { loadOrgoKey: async () => 'test-key', orgoOrigin: () => 'https://example.test' }, './usage': {}, './store': { getState: () => state } }, {}, { fetch: async () => { calls++; throw Error('should not call provider'); } });
  await assert.rejects(orgo.remove(target), /cannot delete/);
  await orgo.growDisk(target);
  assert.equal(calls, 0);
});
test('account inventory includes other workspaces and removes all connection secrets', async () => {
  const calls = [];
  const { orgo } = load('lib/server/orgo.ts', { './orgo-auth': { loadOrgoKey: async () => 'test-key', orgoOrigin: () => 'https://example.test' }, './usage': {} }, {}, {
    fetch: async url => { calls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(url.endsWith('/workspaces') ? { workspaces: [{ id: 'one' }, { id: 'two' }] } : { desktops: [{ id: url.endsWith('/one') ? original : target, name: 'VM', status: 'running', os: 'linux', cpu: 2, ram: 8, vnc_password: 'never-return', instance_details: { secret: 'hidden' } }] }) }; },
  });
  const machines = await orgo.computers();
  assert.equal(machines.length, 2);
  assert.equal(machines[0].workspaceId, "one");
  assert.equal(machines[1].workspaceId, "two");
  assert.ok(!JSON.stringify(machines).includes('never-return'));
  assert.ok(!JSON.stringify(machines).includes('hidden'));
  assert.equal(calls.length, 3);
});
test('moving a borrowed agent to Shared detaches instead of deleting its VM', async () => {
  const f = fixture(); f.scout.computer = 'own'; f.scout.computerId = target; f.scout.externalComputer = true;
  let deleted = false;
  const { setComputer } = load('lib/server/bots.ts', { '@/lib/types': types, './store': f.store, './mail': {}, './plan': {}, './sessions': { resetComputer: async () => { deleted = true; } } });
  assert.equal((await setComputer('scout', 'shared')).ok, true);
  assert.equal(deleted, false);
  assert.equal(f.scout.computerId, undefined);
  assert.equal(f.scout.computer, 'shared');
});

test('AgentMail default-domain setup requires no external DNS lookup or ownership claim', async () => {
  const source = ts.createSourceFile('mail.ts', fs.readFileSync('lib/server/mail.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'mailStatus');
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, mailOn: () => true, MAIL_DOMAIN: 'agentmail.to', domainInfo: () => { throw Error('must not try to claim the provider domain'); }, getState: () => ({ bots: [] }), live: {} };
  vm.runInNewContext(code, context);
  const status = await context.exports.mailStatus();
  assert.equal(status.managedDomain, true);
  assert.equal(status.status, 'PROVIDER_DEFAULT');
  assert.equal(status.records.length, 0);
});

test('switching a computer preserves the agent model, team and saved conversations', async () => {
  const f = fixture();
  f.scout.model = 'x-ai/grok-4.7';
  f.state.messages = [{ chatId: 'bot:scout', text: 'Keep this context' }];
  const bots = f.state.bots; const messages = f.state.messages;
  await f.runtime.assignComputer('scout', target);
  assert.equal(f.scout.model, 'x-ai/grok-4.7');
  assert.equal(f.state.bots, bots); assert.equal(f.state.messages, messages);
  assert.equal(f.state.messages[0].text, 'Keep this context');
});

test('observing an ordinary desktop falls back only when its multi-screen endpoint is absent', async () => {
  class OrgoError extends Error { constructor(status) { super('provider error'); this.status = status; } }
  let response = [{ id: 'one', display: 'default', default: true }];
  let failure;
  const runtime = load('lib/server/existing-computers.ts', { '@/lib/types': types, './store': {}, './screens': {}, './orgo': { OrgoError, orgo: { screens: async () => { if (failure) throw failure; return response; } } } });
  assert.equal((await runtime.observedScreens(target))[0].id, 'one');
  failure = new OrgoError(404);
  assert.equal((await runtime.observedScreens(target))[0].display, 'default');
  for (const code of [403, 500]) { failure = new OrgoError(code); await assert.rejects(runtime.observedScreens(target)); }
});
