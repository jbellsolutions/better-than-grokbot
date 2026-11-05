// Runs on a real Windows runner. Installs NSIS, launches the installed Electron app, then
// exercises the rendered page and server without any provider keys or developer checkout paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { _electron } = require('playwright');
const evidence = path.resolve('windows/evidence');
fs.mkdirSync(evidence, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'Bops Install Test '));
const installed = path.join(temp, 'Installed App');
const profile = path.join(temp, 'User Profile');
const env = { ...process.env, APPDATA: path.join(temp, 'App Data'), LOCALAPPDATA: path.join(temp, 'Local Data'), BOPS_SELF_HOSTED: '1' };
for (const key of Object.keys(env)) if (/KEY|SECRET|TOKEN|PASSWORD|BOPS_DATABASE|BOPS_SERVER|ELECTRON_RUN_AS_NODE/.test(key) || key.toUpperCase() === 'PATH') delete env[key];
// Prove the installed app works without Node/npm, Git, or developer tools on PATH.
const systemRoot = process.env.SystemRoot;
env.PATH = `${systemRoot}\\System32;${systemRoot}\\System32\\WindowsPowerShell\\v1.0;${systemRoot}`;
const installer = path.resolve('dist-desktop', fs.readdirSync('dist-desktop').find(n => n.endsWith('setup.exe')));
const exe = path.join(installed, 'Better Than GrokBot.exe');
const checks = [];
const skipped = [];
let app;
async function api(route, method = 'GET', body) {
  return app.evaluate(async (_electron, { route, method, body }) => {
    const response = await fetch(`http://127.0.0.1:3210${route}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { route, method, body });
}
const authCases = [
  ['normal', {}, 200],
  ['reload', { 'Cache-Control': 'no-cache' }, 200],
  ['stale-session-cookie', { Cookie: 'session=stale' }, 200],
  ['matching-ip-origin', { Origin: 'http://127.0.0.1:3210' }, 200],
  ['matching-localhost-origin', { Host: 'localhost:3210', Origin: 'http://localhost:3210' }, 200],
  ['case-insensitive-localhost', { Host: 'LOCALHOST:3210', Origin: 'http://localhost:3210' }, 200],
  ['foreign-origin', { Origin: 'https://foreign.invalid' }, 403],
  ['sandboxed-origin', { Origin: 'null' }, 403],
  ['foreign-host', { Host: 'foreign.invalid' }, 403],
  ['wrong-port-origin', { Origin: 'http://127.0.0.1:9999' }, 403],
];
const authResults = [];
async function checkAuth(needsSignIn) {
  for (const [name, headers, status] of authCases) {
    const result = await app.evaluate(async (_, headers) => {
      // fetch normalizes Host; use HTTP directly to exercise rebinding defenses accurately.
      const http = process.getBuiltinModule('node:http');
      return new Promise((resolve, reject) => {
        const request = http.get({ hostname: '127.0.0.1', port: 3210, path: '/api/auth/status', headers }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body: response.statusCode === 200 ? JSON.parse(text) : null }));
        });
        request.on('error', reject);
      });
    }, headers);
    assert.equal(result.status, status, name);
    if (status === 200) assert.equal(result.body.needsSignIn, needsSignIn, name);
    authResults.push({ mode: needsSignIn ? 'no-key' : 'local-provider-key', name, status: result.status, needsSignIn: result.body?.needsSignIn });
  }
  fs.writeFileSync(path.join(evidence, 'auth-evaluation.json'), JSON.stringify(authResults, null, 2));
}
async function launch() {
  app = await _electron.launch({ executablePath: exe, env, args: ['--disable-gpu', `--user-data-dir=${profile}`], timeout: 120000 });
  const page = await app.firstWindow();
  await page.waitForURL('http://localhost:3210/**', { timeout: 120000 });
  await page.locator('body').waitFor();
  return page;
}
async function close() {
  if (!app) return;
  await app.close();
  app = undefined;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const alive = await Promise.all([3210, 3211].map(async port => {
      try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) }); return true; }
      catch { return false; }
    }));
    if (alive.every(value => !value)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw Error('Server still running after closing the app');
}
async function main() {
  // NSIS /D must be last and unquoted, including when the directory contains spaces.
  execFileSync(installer, ['/S', `/D=${installed}`], { env, windowsVerbatimArguments: true, timeout: 180000 });
  assert.ok(fs.existsSync(exe), 'NSIS installed executable');
  checks.push('Silent per-user NSIS install to a path containing spaces');
  let page = await launch();
  assert.equal((await api('/api/health')).status, 200);
  await checkAuth(true);
  const first = await api('/api/state');
  assert.equal(first.status, 200);
  assert.ok(first.body.state.bots.length > 0);
  assert.equal((await api(`/api/state?v=${first.body.version}`)).body.state, undefined);
  checks.push('Clean packaged startup, health, initial state, conditional polling without API keys');
  const version = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), packaged: app.isPackaged }));
  assert.equal(version.packaged, true);
  assert.equal(version.userData, profile);
  assert.equal(await page.evaluate(() => typeof window.bopsMac?.screens), 'function');
  assert.ok((await page.locator('body').innerText()).length > 50);
  const staticResponse = await page.locator('script[src]').first().getAttribute('src');
  assert.ok(staticResponse?.startsWith('/_next/'));
  assert.equal((await page.request.get(`http://localhost:3210${staticResponse}`)).status(), 200);
  checks.push('Installed native window renders UI, preload bridge, static JS assets');
  const rejected = await api('/api/host', 'POST', { host: 'mac' });
  assert.equal(rejected.status, 400);
  assert.equal((await api('/api/host', 'POST', { host: 'orgo' })).status, 200);
  assert.equal((await api('/api/bots', 'POST', { name: '' })).status, 400);
  assert.equal((await api('/api/bots', 'PATCH', { botId: 'missing', name: 'No' })).status, 404);
  assert.equal((await api('/api/bots', 'PATCH', { botId: first.body.state.bots[0].id, runsOn: 'mac' })).status, 400);
  checks.push('Unsupported local automation, invalid bot, missing bot fail with clear responses');
  const created = await api('/api/bots', 'POST', { name: 'Windows Test Agent' });
  assert.equal(created.status, 200);
  assert.ok(created.body.botId);
  assert.equal((await api('/api/bots', 'POST', { name: 'Windows Test Agent' })).status, 409);
  assert.equal((await api('/api/bots', 'DELETE', { botId: created.body.botId })).status, 200);
  const workspace = await api('/api/workspaces', 'POST', { name: 'Windows Test Workspace' });
  assert.equal(workspace.status, 200);
  assert.equal((await api('/api/workspaces', 'PATCH', { current: 'missing' })).status, 404);
  assert.equal((await api('/api/workspaces', 'PATCH', { id: workspace.body.id, name: 'Renamed Workspace' })).status, 200);
  assert.equal((await api('/api/workspaces', 'DELETE', { id: workspace.body.id })).status, 200);
  checks.push('Bot create/duplicate/delete and workspace create/rename/delete with invalid switching');
  const bot = first.body.state.bots[0];
  assert.equal((await api('/api/bots', 'PATCH', { botId: bot.id, name: 'Windows Persistence Test' })).status, 200);
  assert.equal((await api('/api/state')).body.state.bots.find(b => b.id === bot.id).name, 'Windows Persistence Test');
  const duplicate = spawn(exe, [`--user-data-dir=${profile}`], { env, stdio: 'ignore' });
  await new Promise((resolve, reject) => { duplicate.once('exit', resolve); duplicate.once('error', reject); setTimeout(() => reject(Error('Second instance did not exit')), 15000).unref(); });
  assert.equal((await api('/api/health')).status, 200);
  checks.push('Second launch exits while original coordinator stays healthy');
  await page.screenshot({ path: path.join(evidence, 'windows-installed.png') });
  await close();
  checks.push('Closing native app stops its coordinator');
  page = await launch();
  assert.equal((await api('/api/state')).body.state.bots.find(b => b.id === bot.id).name, 'Windows Persistence Test');
  checks.push('State survives native app shutdown and restart');
  await close();
  page = await launch();
  await page.getByRole('heading', { name: '1. Connect OpenRouter' }).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 1);
  await page.screenshot({ path: path.join(evidence, 'windows-first-run.png') });
  await page.getByLabel('OpenRouter API key', { exact: true }).fill('invalid-windows-test-key');
  await page.getByRole('button', { name: 'Connect OpenRouter', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'did not accept' }).waitFor({ timeout: 30000 });
  assert.equal((await api('/api/desktop-setup')).body.provider, false);
  await page.getByLabel('OpenRouter API key', { exact: true }).fill('');
  checks.push('Fresh install requests the user OpenRouter key; invalid keys are rejected without storage');
  if (process.env.WINDOWS_TEST_OPENROUTER_KEY && process.env.WINDOWS_TEST_ORGO_KEY) {
    await page.getByLabel('OpenRouter API key', { exact: true }).fill(process.env.WINDOWS_TEST_OPENROUTER_KEY);
    await page.getByRole('button', { name: 'Connect OpenRouter', exact: true }).click();
    await page.getByRole('heading', { name: '2. Choose your model' }).waitFor({ timeout: 30000 });
    const models = (await api('/api/models')).body.models;
    const model = models.find(m => m.id === 'z-ai/glm-5.3-flash') || models.find(m => /^(qwen|deepseek|z-ai)\//.test(m.id));
    assert.ok(model, 'Open-source vision/tool models are selectable');
    const select = page.getByRole('combobox', { name: 'Team default model' });
    await select.selectOption(model.id);
    const save = page.getByRole('button', { name: 'Save model', exact: true });
    if (await save.count()) await save.click();
    else await page.getByRole('button', { name: 'Continue with selected model' }).click();
    await page.getByRole('button', { name: 'Use an Orgo API key instead' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Use an Orgo API key instead' }).click();
    await page.getByLabel('Orgo API key', { exact: true }).fill(process.env.WINDOWS_TEST_ORGO_KEY);
    await page.getByRole('button', { name: 'Connect Orgo key', exact: true }).click();
    await page.getByRole('heading', { name: '4. Choose your Orgo computer' }).waitFor({ timeout: 30000 });
    const inventory = await api('/api/computers');
    assert.equal(inventory.status, 200);
    const computer = inventory.body.computers.find(c => c.status === 'running' && c.os === 'linux');
    assert.ok(computer, 'A running Linux computer exists for read-only account selection');
    const current = (await api('/api/state')).body.state.bots.find(b => b.isMain);
    await page.getByRole('combobox', { name: `Computer for ${current.name}` }).selectOption(computer.id);
    await page.getByRole('button', { name: 'Use this computer', exact: true }).click();
    await page.locator('#composer').waitFor({ timeout: 30000 });
    assert.equal((await api('/api/desktop-setup')).body.complete, true);
    assert.equal((await api('/api/models')).body.defaultModel, model.id);
    await checkAuth(false);
    const body = await page.locator('body').innerText();
    assert.equal(/bapi|boppy/i.test(body), false);
    checks.push('Real UI onboarding saves OpenRouter key and open-source model, connects own Orgo account, and selects existing computer without changing it');
    await page.locator('#composer').fill('Windows installation smoke test: reply with exactly WINDOWS_CHAT_OK. Do not start tasks or call tools.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const deadline = Date.now() + 120000;
    let reply;
    while (Date.now() < deadline) {
      const state = (await api('/api/state')).body.state;
      reply = state.messages.find(m => m.role === 'bot' && m.text.includes('WINDOWS_CHAT_OK'));
      if (reply) break;
      await new Promise(r => setTimeout(r, 500));
    }
    assert.ok(reply, 'Live Windows chat returned the expected reply');
    await page.getByText('WINDOWS_CHAT_OK', { exact: true }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(evidence, 'windows-live-chat.png') });
    checks.push('Live OpenRouter chat submitted through Windows UI and rendered the real model response');
    await page.getByRole('button', { name: 'New instance', exact: true }).click();
    await page.getByLabel('New instance name').fill('Independent Windows Team');
    const nextWindow = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Create instance', exact: true }).click();
    const secondPage = await nextWindow;
    await secondPage.waitForURL('http://localhost:3211/**', { timeout: 120000 });
    await secondPage.getByRole('heading', { name: '1. Connect OpenRouter' }).waitFor();
    const secondState = await secondPage.request.get('http://localhost:3211/api/state').then(r => r.json());
    assert.equal(secondState.state.messages.length, 0);
    assert.equal(secondState.state.bots.some(b => b.name === 'Windows Persistence Test'), false);
    const secondSetup = await secondPage.request.get('http://localhost:3211/api/desktop-setup').then(r => r.json());
    assert.equal(secondSetup.provider, false); assert.equal(secondSetup.orgo, false);
    checks.push('New native instance starts its own coordinator, fresh onboarding, independent history, model preferences and vault namespace');
    await close();
    page = await launch();
    await page.locator('#composer').waitFor({ timeout: 30000 });
    assert.equal((await api('/api/desktop-setup')).body.complete, true);
    assert.equal((await api('/api/models')).body.defaultModel, model.id);
    checks.push('Encrypted provider keys, selected model and computer survive installed app restart');
    await close();
  } else {
    skipped.push('Live onboarding, chat and multiple-instance UI require the two temporary test credentials.');
    await close();
  }
  const uninstaller = path.join(installed, 'Uninstall Better Than GrokBot.exe');
  assert.ok(fs.existsSync(uninstaller));
  execFileSync(uninstaller, ['/S'], { env, timeout: 120000 });
  // NSIS uninstallation may delegate to a temporary executable, so wait for its work.
  const deadline = Date.now() + 30000;
  while (fs.existsSync(exe) && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
  assert.equal(fs.existsSync(exe), false);
  assert.ok(fs.existsSync(path.join(version.userData, 'server', '.data', 'state.json')));
  checks.push('Silent uninstall removes app and preserves user state');
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ platform: process.platform, arch: process.arch, ...version, checks, skipped }, null, 2));
  console.log(checks.join('\n'));
}
main().catch(e => { fs.writeFileSync(path.join(evidence, 'failure.txt'), e.stack); console.error(e); process.exitCode = 1; }).finally(async () => {
  if (app) await close().catch(console.error);
  // Preserve logs in the workflow artifact even if launch failed.
  const logs = path.join(profile, 'logs');
  if (fs.existsSync(logs)) fs.cpSync(logs, path.join(evidence, 'logs'), { recursive: true });
});
