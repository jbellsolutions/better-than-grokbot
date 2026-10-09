const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loadInstance = require('./helpers/instance.cjs');
const { initialize } = require('../scripts/instances.cjs');
const { readRegistry, instanceEnv, verify } = require('../desktop/instances.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-instances-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.data'));
  fs.writeFileSync(path.join(root, '.data/state.json'), '{"existing":"preserve exactly"}');
  return { root, entries: initialize(root) };
}

test('setup preserves the current team byte for byte and reruns preserve each new instance history', t => {
  const { root, entries } = fixture(t);
  const file = e => path.join(root, '.data/instances', e.id, 'state.json');
  const ai = JSON.parse(fs.readFileSync(file(entries[1])));
  const rev = JSON.parse(fs.readFileSync(file(entries[2])));
  assert.equal(ai.bots[0].computerId, entries[1].computerId);
  assert.equal(rev.bots[0].computerId, entries[2].computerId);
  assert.equal(ai.bots[0].externalComputer, true);
  assert.equal(ai.messages.length, 0);
  assert.equal(rev.routines.length, 0);
  ai.messages.push({ id: 'original', text: 'Saved conversation' });
  fs.writeFileSync(file(entries[1]), JSON.stringify(ai));
  initialize(root);
  assert.equal(JSON.parse(fs.readFileSync(file(entries[1]))).messages[0].text, 'Saved conversation');
  assert.equal(JSON.parse(fs.readFileSync(file(entries[2]))).messages.length, 0);
  assert.equal(fs.readFileSync(path.join(root, '.data/state.json'), 'utf8'), '{"existing":"preserve exactly"}');
  assert.equal(fs.statSync(file(entries[2])).mode & 0o777, 0o600);
});

test('business instances exclude shared provider identities and subscriptions but retain inference configuration', t => {
  const { root, entries } = fixture(t);
  fs.writeFileSync(path.join(root, '.env.local'), 'OPENROUTER_API_KEY=test-inference\nCOMPOSIO_API_KEY=test-app\nHONCHO_WORKSPACE_ID=shared\nTAILSCALE_AUTH_KEY=test-network\nTWILIO_API_KEY_SECRET=test-verify\nBOPS_DATABASE_URL=test-db\nORGO_API_KEY=test-orgo\nBOPS_CHAT_MODEL=test/model\n');
  const env = instanceEnv(root, entries[1], { PATH: '/usr/bin', COMPOSIO_USER_ID: 'existing-user' });
  for (const key of ['COMPOSIO_API_KEY', 'COMPOSIO_USER_ID', 'HONCHO_WORKSPACE_ID', 'TAILSCALE_AUTH_KEY', 'TWILIO_API_KEY_SECRET', 'BOPS_DATABASE_URL', 'ORGO_API_KEY']) assert.equal(env[key], '');
  assert.equal(env.OPENROUTER_API_KEY, 'test-inference');
  assert.equal(env.BOPS_CHAT_MODEL, 'test/model');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.BOPS_SELF_HOSTED, '1');
  assert.equal(env.BOPS_COMPUTER_OBSERVE_ONLY, '1');
  assert.equal(env.PORT, '3211');
  fs.writeFileSync(path.join(root, '.data/instances/ai-guy/.env.local'), 'COMPOSIO_API_KEY=own-app\nBOPS_INSTANCE_ID=wrong\nBOPS_ORGO_COMPUTER_ID=wrong\n');
  const own = instanceEnv(root, entries[1], {});
  assert.equal(own.COMPOSIO_API_KEY, 'own-app');
  assert.equal(own.BOPS_INSTANCE_ID, 'ai-guy');
  assert.equal(own.BOPS_ORGO_COMPUTER_ID, entries[1].computerId);
});

test('default paths and secrets stay compatible; business instances have independent roots and namespaces', t => {
  const { root, entries } = fixture(t);
  const current = loadInstance({ env: {}, cwd: () => root });
  const ai = loadInstance({ env: instanceEnv(root, entries[1], {}), cwd: () => root });
  const rev = loadInstance({ env: instanceEnv(root, entries[2], {}), cwd: () => root });
  assert.equal(current.dataPath('state.json'), path.join(root, '.data/state.json'));
  assert.equal(current.keychainService(), 'Bops Vault');
  for (const resource of ['state.json', 'openrouter/same.json', 'models.json', 'phone-secrets.json', 'memory-reviews.json', 'uploads/same.png', 'pages/same.html']) assert.notEqual(ai.dataPath(resource), rev.dataPath(resource));
  assert.notEqual(ai.keychainService(), rev.keychainService());
  assert.notEqual(ai.localHome(), rev.localHome());
  assert.notEqual(ai.localPortBase(), rev.localPortBase());
  assert.throws(() => loadInstance({ env: { BOPS_INSTANCE_ID: '../other' }, cwd: () => root }).instanceId(), /Invalid/);
});

test('actual persistence flushes independent histories and reloads them without copying the other instance', async t => {
  const { root, entries } = fixture(t);
  const code = ts.transpileModule(fs.readFileSync('lib/server/persist.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const stores = [];
  for (const e of entries.slice(1)) {
    const processStub = { env: instanceEnv(root, e, {}), cwd: () => root, once: () => {} };
    const exports = {};
    vm.runInNewContext(code, { exports, require: n => n === 'server-only' ? {} : n === './instance' ? loadInstance(processStub) : require(n), process: processStub, setTimeout, clearTimeout, console });
    const state = { messages: [{ id: 'same-id', text: e.name }] };
    const store = exports.fileStore({ get: () => state });
    store.changed(); stores.push({ store, expected: e.name });
  }
  await new Promise(resolve => setTimeout(resolve, 450));
  for (const { store, expected } of stores) assert.equal(store.initial().messages[0].text, expected);
  assert.equal(fs.readFileSync(path.join(root, '.data/state.json'), 'utf8'), '{"existing":"preserve exactly"}');
});

test('switch targets require matching instance and computer identities, not merely a healthy port', async t => {
  const { entries } = fixture(t);
  const entry = entries[1];
  await verify(entry, async () => Response.json({ bops: true, instance: { id: entry.id, computerId: entry.computerId } }));
  for (const instance of [{ id: 'revenue-partners', computerId: entry.computerId }, { id: entry.id, computerId: 'wrong' }, undefined]) {
    await assert.rejects(verify(entry, async () => Response.json({ bops: true, instance })), /Another server|wrong computer/);
  }
  await assert.rejects(verify(entry, async () => { throw Error('offline'); }), /offline/);
});

test('registry rejects remote hosts and duplicate or reordered instance identities', t => {
  const { root, entries } = fixture(t);
  for (const changed of [entries.map(e => ({ ...e, url: 'https://outside.example' })), [entries[1], entries[0], entries[2]], [entries[0], entries[1], entries[1]]]) {
    fs.writeFileSync(path.join(root, '.data/instances.json'), JSON.stringify(changed));
    assert.throws(() => readRegistry(root), /Invalid/);
  }
});

test('native packaging removes traced instance secrets, history and checkout copies', t => {
  const { root } = fixture(t);
  const { prune } = require('../scripts/prune-standalone.cjs');
  const dir = path.join(root, 'standalone');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'server.js'), 'server');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  for (const name of ['.next', 'node_modules', 'vm', 'public', '.data', '.git', 'cloud', 'dist-desktop']) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'fixture'), 'preserved runtime or private checkout data');
  }
  fs.writeFileSync(path.join(dir, '.env'), 'PRIVATE_KEY=fixture');
  prune(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.next', 'node_modules', 'package.json', 'public', 'server.js', 'vm'].sort());
  assert.equal(fs.readFileSync(path.join(dir, 'vm/fixture'), 'utf8'), 'preserved runtime or private checkout data');
  assert.throws(() => prune(root), /Not a standalone build/);
  assert.ok(fs.existsSync(path.join(root, '.data/state.json')));
});

test('the registry accepts the two separately hosted instances but rejects arbitrary endpoints', t => {
  const { root, entries } = fixture(t);
  const file = path.join(root, '.data/instances.json');
  const all = [...entries, { id: 'chief-sales-officer', port: 3213, url: 'http://localhost:3213' }, { id: 'co-founder', port: 3214, url: 'http://localhost:3214' }];
  fs.writeFileSync(file, JSON.stringify(all)); assert.equal(readRegistry(root).length, 5);
  for (const change of [{ id: '../unsafe' }, { url: 'https://example.com' }, { port: 443 }]) {
    fs.writeFileSync(file, JSON.stringify(all.map((e, i) => i === 4 ? { ...e, ...change } : e)));
    assert.throws(() => readRegistry(root), /Invalid/);
  }
});
