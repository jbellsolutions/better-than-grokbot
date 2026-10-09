// Login service: update checks survive closing both Bops and Cloudroom.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw Error('This update scheduler requires macOS.');
const root = path.resolve(__dirname, '..');
const label = 'ai.orgo.bops.selfhosted.updates';
const directory = path.join(os.homedir(), 'Library/LaunchAgents');
const logs = path.join(os.homedir(), 'Library/Logs/Bops');
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(logs, { recursive: true });
const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const plist = path.join(directory, `${label}.plist`);
fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(root, 'scripts/check-updates.cjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>3600</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'updates.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'updates-error.log'))}</string>
</dict></plist>`, { mode: 0o600 });
try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch {}
execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'inherit' });
console.log('Hourly update checks and daily private state snapshots enabled at login.');
