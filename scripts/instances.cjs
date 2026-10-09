// Three coordinators share code, never mutable state. No VM setup or campaign activation here.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const { definitions, registryFile, readRegistry, instanceEnv, verify } = require('../desktop/instances.cjs');
const root = path.resolve(__dirname, '..');
const label = id => `ai.orgo.bops.selfhosted.${id}`;
const plist = id => path.join(os.homedir(), 'Library/LaunchAgents', `${label(id)}.plist`);

function initialize(projectRoot = root) {
  const entries = definitions.map(d => ({ ...d, url: `http://localhost:${d.port}` }));
  fs.mkdirSync(path.join(projectRoot, '.data'), { recursive: true, mode: 0o700 });
  if (fs.existsSync(registryFile(projectRoot))) readRegistry(projectRoot);
  else fs.writeFileSync(registryFile(projectRoot), JSON.stringify(entries, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const e of entries.filter(e => e.id !== 'default')) {
    const dir = path.join(projectRoot, '.data', 'instances', e.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, 'state.json');
    if (fs.existsSync(target)) continue;
    const at = Date.now();
    const roles = e.id === 'ai-guy'
      ? [['ops', 'AI Guy', 'Coordinate cold email from approved charters. Keep campaigns paused until explicit release.'], ['writer', 'Writer', 'Draft evidence-backed cold email. Never upload or send.'], ['editorial', 'Editorial', 'Independently review claims, evidence and copy.'], ['deliverability', 'Deliverability', 'Review verification, suppression and sender health.'], ['replies', 'Replies', 'Triage cold-email replies and draft responses.']]
      : [['ops', 'Revenue Partners', 'Coordinate prospecting, qualification and partner research. Keep outreach paused until explicit release.'], ['prospector', 'Prospector', 'Research buying signals and match qualified prospects to approved offers.'], ['data', 'Data', 'Resolve contact identity and source provenance. No paid pulls without an approved budget.'], ['list-manager', 'List Manager', 'Maintain dedupe, source lists and suppression records.'], ['crm', 'CRM', 'Prepare CRM updates from actual completed touches.'], ['dream', 'Dream Partners', 'Research Dream partners and prepare briefs only. The owner writes all messages.']];
    const bots = roles.map(([id, name, role], i) => ({ id, name, role, color: ['#0A0A0A', '#60A5FA', '#A78BFA', '#2EC4B6', '#FF9F43', '#E9FF3B'][i], isMain: i === 0, workspaceId: 'ws_main', runsOn: 'cloud', computer: i === 0 ? 'own' : 'shared', computerStatus: i === 0 ? 'ready' : 'none', ...(i === 0 ? { computerId: e.computerId, computerName: e.name, externalComputer: true } : {}) }));
    const state = { bots, chats: bots.map(b => ({ id: `bot:${b.id}`, kind: 'bot', botIds: [b.id], createdAt: at, typing: [], workspaceId: 'ws_main' })), messages: [], sessions: [], routines: [], host: 'orgo', owner: { name: '' }, workspaces: [{ id: 'ws_main', name: e.purpose, createdAt: at }], workspace: 'ws_main' };
    fs.writeFileSync(target, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  }
  return entries;
}

function connectOrgo() {
  // This user selected computers from the same connected Orgo account. Copy only that credential,
  // into independent namespaces. Preserve any connection already configured for either instance.
  let key;
  try { key = execFileSync('security', ['find-generic-password', '-s', 'Bops Vault', '-a', 'orgo-api-key', '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/\n$/, ''); } catch { return; }
  for (const e of definitions.filter(e => e.id !== 'default')) {
    const service = `Bops Vault ${e.id}`;
    try { execFileSync('security', ['find-generic-password', '-s', service, '-a', 'orgo-api-key'], { stdio: 'ignore' }); continue; } catch {}
    execFileSync('security', ['-i'], { input: `add-generic-password -s "${service}" -a "orgo-api-key" -X ${Buffer.from(key).toString('hex')}\n`, stdio: ['pipe', 'ignore', 'pipe'] });
  }
}

function enableServices() {
  if (process.platform !== 'darwin') throw Error('The instance login services require macOS.');
  if (!fs.existsSync(path.join(root, '.next/BUILD_ID'))) throw Error('Build the application first.');
  for (const e of readRegistry(root).filter(e => e.id !== 'default')) {
    const logs = path.join(root, '.data', 'instances', e.id, 'logs'); fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
    const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const args = ['/usr/bin/caffeinate', '-i', '-s', fs.realpathSync(process.execPath), path.join(root, 'scripts/instances.cjs'), 'serve', e.id];
    fs.mkdirSync(path.dirname(plist(e.id)), { recursive: true });
    fs.writeFileSync(plist(e.id), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label(e.id)}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>StandardOutPath</key><string>${xml(path.join(logs, 'server.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(logs, 'error.log'))}</string></dict></plist>`, { mode: 0o600 });
    try { execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist(e.id)], { stdio: 'pipe' }); }
    catch { execFileSync('/bin/launchctl', ['kickstart', `gui/${process.getuid()}/${label(e.id)}`], { stdio: 'pipe' }); }
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'setup') { initialize(); connectOrgo(); console.log('Three instance data stores are ready. Existing state was preserved.'); }
  else if (command === 'enable') enableServices();
  else if (command === 'serve') {
    const entry = readRegistry(root).find(e => e.id === process.argv[3] && e.id !== 'default');
    if (!entry) throw Error('Unknown instance');
    const env = instanceEnv(root, entry);
    const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--port', String(entry.port), '--hostname', '127.0.0.1'], { cwd: root, env: { ...env, NEXT_MANUAL_SIG_HANDLE: 'true' }, stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('exit', code => process.exit(code ?? 1));
  } else if (command === 'status') {
    for (const entry of readRegistry(root)) {
      try { await verify(entry); console.log(`${entry.name}: ready — ${entry.url}`); }
      catch (e) { console.log(`${entry.name}: ${e.message}`); process.exitCode = 1; }
    }
  } else throw Error('Use setup, enable, serve INSTANCE, or status');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { initialize, label, plist };
