const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { linkServer, stopProcessTree } = require('../desktop/runtime.cjs');

test('fresh install and upgrade in paths with spaces preserve state and refresh server files', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'Bops Windows '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bundle = path.join(temp, 'Program Files', 'resources', 'server');
  const home = path.join(temp, 'User Data', 'server');
  fs.mkdirSync(path.join(bundle, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(bundle, '.next'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'server.js'), 'version 1');
  fs.writeFileSync(path.join(bundle, '.env.local'), 'must not copy');
  linkServer(bundle, home);
  assert.equal(fs.existsSync(path.join(home, '.env.local')), false);
  fs.writeFileSync(path.join(home, '.data', 'state.json'), '{"saved":true}');
  const next = path.join(temp, 'upgrade');
  fs.cpSync(bundle, next, { recursive: true });
  fs.writeFileSync(path.join(next, 'server.js'), 'version 2');
  linkServer(next, home);
  assert.equal(fs.readFileSync(path.join(home, 'server.js'), 'utf8'), 'version 2');
  assert.equal(fs.readFileSync(path.join(home, '.data/state.json'), 'utf8'), '{"saved":true}');
  assert.equal(fs.realpathSync(path.join(home, 'node_modules')), fs.realpathSync(path.join(next, 'node_modules')));
});

test('shutdown stops the owned process tree', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  stopProcessTree(child.pid);
  await exited;
  assert.throws(() => process.kill(child.pid, 0));
  stopProcessTree(undefined);
});

test('Windows credential store round-trips Unicode and deletes encrypted secrets', { skip: process.platform !== 'win32' }, async t => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/server/windows-vault.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === 'server-only' ? {} : require(name), Buffer, setTimeout, clearTimeout });
  const account = `bops-windows-test-${process.pid}`;
  t.after(() => exports.windowsSecret('delete', account));
  const secret = 'Unicode 🔐 "quotes" $() `backticks`\nsecond line';
  assert.equal(await exports.windowsSecret('get', account), null);
  await exports.windowsSecret('set', account, secret);
  assert.equal(await exports.windowsSecret('get', account), secret);
  const vault = path.join(process.env.LOCALAPPDATA, 'Better Than GrokBot Vault');
  const hash = require('node:crypto').createHash('sha256').update(account).digest('hex').toUpperCase();
  assert.equal(fs.readFileSync(path.join(vault, `${hash}.bin`)).includes(Buffer.from(secret)), false);
  await exports.windowsSecret('set', account, 'updated');
  assert.equal(await exports.windowsSecret('get', account), 'updated');
  await exports.windowsSecret('delete', account);
  assert.equal(await exports.windowsSecret('get', account), null);
});
