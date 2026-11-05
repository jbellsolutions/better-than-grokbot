const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const source = ts.createSourceFile('main.cjs', fs.readFileSync('desktop/main.cjs', 'utf8'), ts.ScriptTarget.Latest, true);
function load(name, context) {
  const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  vm.runInNewContext(declaration.getText(source), context);
  return context[name];
}
function startup(extra = {}) {
  const context = {
    serverUp: async () => false, portTaken: async () => false,
    process: { platform: 'win32', execPath: 'Bops.exe', env: {} },
    path: require('node:path'), REPO: 'C:/Bops', PORT: 3210, URL: 'http://localhost:3210', servers: new Map(),
    setTimeout: fn => fn(), packagedServer: () => null, loginPath: () => '',
    app: { isPackaged: true, getPath: () => 'logs' }, ...extra,
  };
  return load('startServer', context);
}
test('an existing healthy coordinator is reused without spawning', async () => {
  await startup({ serverUp: async () => true, spawn: () => assert.fail('unexpected spawn') })();
});
test('an occupied port can finish starting before it is reused', async () => {
  let checks = 0;
  await startup({ portTaken: async () => true, serverUp: async () => ++checks >= 3 })();
  assert.equal(checks, 3);
});
test('an unrelated occupied port fails clearly instead of opening a broken page', async () => {
  await assert.rejects(startup({ portTaken: async () => true })(), /occupied/);
});
test('spawn errors fail promptly instead of leaving the splash open', async () => {
  await assert.rejects(startup({ spawn: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', Error('spawn denied')));
    return child;
  } })(), /spawn denied/);
});
test('a server that exits during startup reports its exit and log location', async () => {
  await assert.rejects(startup({ spawn: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 7));
    return child;
  } })(), /exited \(7\)/);
});
test('health probe checks Bops identity and tolerates malformed or unreachable responses', async () => {
  for (const [response, expected] of [[{ ok: true, json: async () => ({ bops: true, product: "better-than-grokbot", instance: { id: "default" } }) }, true], [{ ok: true, json: async () => ({}) }, false], [{ ok: false }, false], [{ ok: true, json: async () => { throw Error('not JSON'); } }, false]]) {
    const check = load('serverUp', { fetch: async () => response, URL: 'http://localhost:3210', AbortSignal });
    assert.equal(await check(), expected);
  }
  assert.equal(await load('serverUp', { fetch: async () => { throw Error('offline'); }, URL: '', AbortSignal })(), false);
});

test('local bring-your-own-key sign-in accepts AI providers while hosted deployments still require identity', async () => {
  const file = ts.createSourceFile('orgo-sign-in.ts', fs.readFileSync('lib/server/orgo-sign-in.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'authStatus');
  const code = ts.transpileModule(declaration.getText(file).replace("async function inspectMac", "export async function inspectMac"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  for (const key of [undefined, 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ORGO_API_KEY']) {
    for (const selfHosted of [false, true]) {
      for (const postgres of [false, true]) {
        const exports = {};
        const env = { ...(selfHosted ? { BOPS_SELF_HOSTED: '1' } : {}), ...(key ? { [key]: 'test-placeholder' } : {}) };
        vm.runInNewContext(code, { exports, process: { env }, loadOrgoKey: async () => null, signedInUser: () => null, onPostgres: () => postgres });
        const result = await exports.authStatus();
        assert.equal(result.needsSignIn, !(key && selfHosted && !postgres), JSON.stringify({ key, selfHosted, postgres }));
      }
    }
  }
});

test('a Windows Codex installation cannot advertise or start the macOS automation helper', async () => {
  const file = ts.createSourceFile('codex.ts', fs.readFileSync('lib/server/codex.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'inspectMac');
  const code = ts.transpileModule(declaration.getText(file).replace("async function inspectMac", "export async function inspectMac"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  const state = { mac: { rules: 'keep existing rules' } };
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env: {} }, macAccessAllowed: () => true, existsSync: () => false, findCodex: () => 'C:/npm/codex', onTheMac: () => false,
    installStatus: () => undefined, getState: () => state, update: fn => fn(state), emptyMac: () => ({}),
    codex: { ready: () => { assert.fail('must not start a Mac helper on Windows'); } },
  });
  assert.equal(await exports.inspectMac(), false);
  assert.equal(state.mac.next, 'elsewhere');
  assert.equal(state.mac.rules, 'keep existing rules');
});


test('worker scripts shipped from Windows retain Unix line endings for Linux execution', () => {
  function check(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = require('node:path').join(dir, entry.name);
      if (entry.isDirectory()) check(file);
      else {
        const bytes = fs.readFileSync(file);
        if (!bytes.includes(0)) assert.equal(bytes.includes(13), false, file);
      }
    }
  }
  check('vm');
});
