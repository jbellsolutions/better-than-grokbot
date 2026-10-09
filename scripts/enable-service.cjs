// Recreate the coordinator login service with this Mac's current paths after a restore.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  if (process.platform !== 'darwin') throw Error('This background service requires macOS.');
  if (!fs.existsSync(path.join(root, '.next/BUILD_ID'))) throw Error('Run npm run app:build before enabling the service.');
  let responding = false, state;
  try {
    const r = await fetch('http://127.0.0.1:3210/api/state', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw Error('Could not verify the process on port 3210.');
    responding = true;
    ({ state } = await r.json());
  } catch (e) { if (e.message === 'Could not verify the process on port 3210.') throw e; }
  if (state?.sessions.some(s => ['starting', 'running', 'queued'].includes(s.status)) || state?.chats.some(c => c.typing?.length)) throw Error('Wait until active work finishes.');
  if (responding && !fs.existsSync(path.join(root, '.data/service.json'))) throw Error('Close the standalone Bops server before enabling the login service.');
  const label = 'ai.orgo.bops.selfhosted.server';
  const agentDir = path.join(os.homedir(), 'Library/LaunchAgents');
  const logs = path.join(os.homedir(), 'Library/Logs/Bops');
  fs.mkdirSync(agentDir, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  const node = fs.realpathSync(process.execPath);
  const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const strings = a => a.map(v => `<string>${xml(v)}</string>`).join('');
  const plist = path.join(agentDir, `${label}.plist`);
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${strings(['/usr/bin/caffeinate', '-i', '-s', node, path.join(root,'node_modules/next/dist/bin/next'), 'start', '--port', '3210', '--hostname', '127.0.0.1'])}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
<key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>NEXT_MANUAL_SIG_HANDLE</key><string>true</string><key>PATH</key><string>${xml([path.dirname(node),path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(':'))}</string></dict>
<key>StandardOutPath</key><string>${xml(path.join(logs,'background.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs,'background-error.log'))}</string>
</dict></plist>`, { mode: 0o600 });
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch {}
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'inherit' });
  let marker = { label };
  try { marker = { ...JSON.parse(fs.readFileSync(path.join(root,'.data/service.json'),'utf8')), label }; } catch {}
  fs.mkdirSync(path.join(root,'.data'), { recursive: true });
  fs.writeFileSync(path.join(root,'.data/service.json'), JSON.stringify(marker), { mode: 0o600 });
  console.log('Bops coordinator login service enabled. Configure private Tailscale HTTPS separately.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
