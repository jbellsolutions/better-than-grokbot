// Safely rebuild the dedicated self-hosted app and restore its managed service on failure.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { readRegistry } = require('../desktop/instances.cjs');
const label = `gui/${process.getuid()}/ai.orgo.bops.selfhosted.server`;
const plist = path.join(os.homedir(), 'Library/LaunchAgents/ai.orgo.bops.selfhosted.server.plist');
function run(cmd, args, options = {}) { return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...options }); }
async function main() {
  if (process.platform !== 'darwin') throw Error('Install the native app on macOS.');
  let managed = fs.existsSync(path.join(root, '.data/service.json'));
  const stoppedServices = [];
  const extraServices = readRegistry(root).filter(e => e.id !== 'default').map(e => ({ ...e, label: `ai.orgo.bops.selfhosted.${e.id}`, plist: path.join(os.homedir(), 'Library/LaunchAgents', `ai.orgo.bops.selfhosted.${e.id}.plist`) })).filter(e => {
    if (!fs.existsSync(e.plist)) return false;
    const directory = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :WorkingDirectory', e.plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return fs.realpathSync(directory) === fs.realpathSync(root);
  });
  try {
    const response = await fetch('http://127.0.0.1:3210/api/state', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('Could not verify whether tasks are active.');
    const { state } = await response.json();
    if (state.sessions.some(s => ['starting', 'running', 'queued'].includes(s.status)) || state.chats.some(c => c.typing?.length)) throw Error('Wait until all Better Than GrokBot tasks and chat replies finish before rebuilding.');
  } catch (e) {
    if (e.message?.startsWith('Wait until') || e.message?.startsWith('Could not verify')) throw e;
    if (managed) throw Error('The managed service is unavailable. Recover it before installing.');
  }
  for (const service of extraServices) {
    const response = await fetch(`${service.url}/api/state`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error(`Could not verify active work in ${service.name}.`);
    const { state, instance } = await response.json();
    if (instance?.id !== service.id) throw Error(`The wrong server is using ${service.name}'s port.`);
    if (state.sessions.some(s => ['starting', 'running', 'queued'].includes(s.status)) || state.chats.some(c => c.typing?.length)) throw Error(`Wait until all work in ${service.name} finishes before rebuilding.`);
  }
  if (managed) {
    const directory = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :WorkingDirectory', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    managed = fs.realpathSync(directory) === fs.realpathSync(root);
  }
  // Keep generated rollback artifacts outside Next's source-tracing root.
  const rollbackDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-build-rollback-'));
  const rollbackBuild = path.join(rollbackDirectory, '.next');
  if (fs.existsSync(rollbackBuild)) throw Error('A previous build recovery folder needs review.');
  fs.cpSync(path.join(root, '.next'), rollbackBuild, { recursive: true, verbatimSymlinks: true });
  let built = false, restored = false;
  try {
    for (const service of extraServices) { run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${service.label}`]); stoppedServices.push(service); }
    if (managed) { run('/bin/launchctl', ['bootout', label]); stoppedServices.push({ plist }); }
    run('npm', ['run', 'app:build']);
    built = true;
  } catch (e) {
    fs.rmSync(path.join(root, '.next'), { recursive: true, force: true });
    fs.renameSync(rollbackBuild, path.join(root, '.next'));
    restored = true;
    throw e;
  } finally {
    if (built || restored) fs.rmSync(rollbackDirectory, { recursive: true, force: true });
    else console.error(`Build recovery preserved: ${rollbackDirectory}`);
    for (const service of stoppedServices) run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, service.plist]);
  }
  const target = '/Applications/Better Than GrokBot.app';
  if (fs.existsSync(target)) {
    const id = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(target, 'Contents/Info.plist')], { stdio: 'pipe' }).toString().trim();
    if (id !== 'ai.orgo.bops.selfhosted') throw Error('The install target is not the self-hosted app.');
    run('/usr/bin/osascript', ['-e', 'tell application "Better Than GrokBot" to quit']);
  }
  const staged = `/Applications/.Better-Than-GrokBot-${process.pid}.app`;
  const previous = `/Applications/.Better-Than-GrokBot-previous-${process.pid}.app`;
  run('/usr/bin/ditto', [path.join(root, 'dist-desktop/mac-arm64/Better Than GrokBot.app'), staged]);
  const existed = fs.existsSync(target);
  try {
    if (existed) fs.renameSync(target, previous);
    fs.renameSync(staged, target);
  } catch (e) {
    if (existed && fs.existsSync(previous) && !fs.existsSync(target)) fs.renameSync(previous, target);
    throw e;
  }
  if (existed) fs.rmSync(previous, { recursive: true });
  run('/usr/bin/open', [target]);
  console.log('Better Than GrokBot installed. The original Bops.app is preserved.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
