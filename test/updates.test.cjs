const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync('scripts/check-updates.cjs', 'utf8').replace(/main\(\)\.catch[\s\S]*$/, '');

test('update checks establish a quiet baseline, notify only changes, and preserve feeds during outages', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-updates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.data'));
  fs.writeFileSync(path.join(root, '.data/state.json'), '{"bots":[]}');
  let version = '0.0.21', offline = false, syncOffline = false, syncCalls = 0;
  const logs = [], errors = [];
  const context = { require: name => name === './sync-upstream.cjs' ? { syncUpstream: dir => { assert.equal(dir, root); syncCalls++; if (syncOffline) throw Error('Sync offline'); } } : name === 'node:os' ? { homedir: () => root } : require(name), __dirname: path.join(root, 'scripts'), process: { env: { BOPS_PROJECT_DIR: root, BOPS_NO_NOTIFY: '1' }, pid: process.pid, platform: 'darwin' }, console: { log: s => logs.push(s), error: s => errors.push(s) }, AbortSignal, Date, fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    if (offline) return new Response('', { status: 503 });
    return Response.json(url.includes('latest.json') ? { version, released: version, notes: ['Release note'] } : url.includes('/commits/') ? { sha: 'a'.repeat(40), commit: { message: 'Source change' } } : { tag_name: 'v0.0.6', id: 1, updated_at: 'today' });
  } };
  vm.runInNewContext(code, context);
  await context.main(); await context.main();
  assert.equal(logs.length, 0);
  version = '0.0.22'; await context.main();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Official Bops app: 0.0.22/);
  await context.main(); assert.equal(logs.length, 1);
  offline = true; await context.main();
  const status = JSON.parse(fs.readFileSync(path.join(root, '.data/updates.json')));
  assert.equal(status.sources[0].version, '0.0.22');
  assert.equal(status.errors.length, 3);
  offline = false; syncOffline = true; await context.main();
  const syncStatus = JSON.parse(fs.readFileSync(path.join(root, '.data/updates.json')));
  assert.equal(syncStatus.errors.length, 1);
  assert.match(syncStatus.errors[0], /Upstream source sync failed/);
  assert.equal(syncStatus.sources.length, 3);
  assert.equal(syncCalls, 6);
  const backup = path.join(root, 'Library/Application Support/Bops Self-Hosted/backups', `state-${new Date().toISOString().slice(0, 10)}`, 'state.json');
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
});

const install = fs.readFileSync('scripts/install-selfhost.cjs', 'utf8').replace(/main\(\)\.catch[\s\S]*$/, '');
test('installer refuses busy tasks and restores the login service after build failure', async () => {
  const calls = [];
  let busy = true;
  const context = { require: name => name === '../desktop/instances.cjs' ? { readRegistry: () => [] } : name === 'node:fs' ? { existsSync: p => !p.includes('build-rollback'), mkdtempSync: () => '/tmp/bops-build-rollback-test', realpathSync: p => p, cpSync: (...args) => calls.push(['backup-build', args]), rmSync: (...args) => calls.push(['remove-build', args]), renameSync: (...args) => calls.push(['restore-build', args]) } : name === 'node:child_process' ? { execFileSync: (cmd, args) => { if (cmd === '/usr/libexec/PlistBuddy') return '/project\n'; calls.push([cmd, args]); if (cmd === 'npm') throw Error('Build failed'); } } : require(name), __dirname: '/project/scripts', process: { platform: 'darwin', getuid: () => 501 }, fetch: async () => Response.json({ state: { sessions: busy ? [{ status: 'running' }] : [], chats: [{ typing: [] }] } }), AbortSignal, console };
  vm.runInNewContext(install, context);
  await assert.rejects(context.main(), /Wait until/); assert.equal(calls.length, 0);
  busy = false; await assert.rejects(context.main(), /Build failed/);
  assert.equal(calls[0][0], 'backup-build');
  assert.ok(!calls[0][1][1].startsWith('/project'));
  assert.equal(calls[0][1][2].verbatimSymlinks, true);
  assert.equal(calls[1][1][0], 'bootout');
  assert.ok(calls.some(([cmd]) => cmd === 'restore-build'));
  assert.equal(calls.at(-1)[1][0], 'bootstrap');
  assert.ok(!calls.some(([cmd]) => cmd === '/usr/bin/ditto'));
});
