const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function access() {
  const exports = {};
  class Response { constructor(_, options) { this.status = options.status; } static next() { return { status: 200 }; } }
  const code = ts.transpileModule(fs.readFileSync('proxy.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, Set, URL, process: { env: { BOPS_PUBLIC_HOST: 'bops.example.ts.net', BOPS_TAILSCALE_USER: 'owner@example.com' } }, require: () => ({ NextResponse: Response }) });
  return (headers) => exports.proxy({ headers: new Headers(headers), nextUrl: { pathname: '/api/state' } }).status;
}

test('private browser access requires the configured Tailscale owner', () => {
  const status = access();
  assert.equal(status({ host: 'localhost:3210' }), 200);
  assert.equal(status({ host: 'bops.example.ts.net:8443', origin: 'https://bops.example.ts.net:8443', 'tailscale-user-login': 'owner@example.com' }), 200);
  assert.equal(status({ host: 'bops.example.ts.net:8443' }), 403);
  assert.equal(status({ host: 'bops.example.ts.net:8443', 'tailscale-user-login': 'other@example.com' }), 403);
  assert.equal(status({ host: 'localhost:3210', origin: 'https://evil.example' }), 403);
  assert.equal(status({ host: 'evil.example', 'tailscale-user-login': 'owner@example.com' }), 403);
});

test('managed Electron startup asks launchd to start the server instead of owning a second server', async () => {
  const source = ts.createSourceFile('main.cjs', fs.readFileSync('desktop/main.cjs', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'startServer');
  const calls = [];
  let checks = 0;
  const context = { serverUp: async () => ++checks > 1, fs: { existsSync: () => true }, path: require('node:path'), REPO: '/test',
    process: { platform: 'darwin', getuid: () => 501 }, execFileSync: (...args) => calls.push(args), setTimeout,
    portTaken: () => { throw Error('managed clients must not start their own server'); } };
  vm.runInNewContext(declaration.getText(source), context);
  await context.startServer();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/bin/launchctl');
  assert.deepEqual(Array.from(calls[0][1]), ['kickstart', 'gui/501/ai.orgo.bops.selfhosted.server']);
});
