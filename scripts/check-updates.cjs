// Read-only update monitor. No provider credentials and no automatic installation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = process.env.BOPS_PROJECT_DIR || path.resolve(__dirname, '..');
const file = path.join(root, '.data', 'updates.json');
const repo = 'https://api.github.com/repos/nickvasilescu/bops';
async function json(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Bops-Self-Hosted-Update-Check', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
async function main() {
  let before = { sources: [] };
  try { before = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const sources = [...before.sources];
  const notices = [];
  const errors = [];
  // Sync source refs using an isolated checkout. Never merge into the live tree,
  // build, run upstream scripts, or change the installed app in this hourly job.
  try {
    require('./sync-upstream.cjs').syncUpstream(root);
  } catch { errors.push('Upstream source sync failed; the running app was left unchanged.'); }
  const feeds = [
    { id: 'paid', label: 'Official Bops app', load: async () => {
      const r = await json('https://bops.bot/download/latest.json');
      if (!/^\d+\.\d+\.\d+$/.test(r.version)) throw Error('Invalid app version');
      return { version: r.version, fingerprint: `${r.version}:${r.released || ''}`, url: 'https://bops.bot', notes: Array.isArray(r.notes) ? r.notes.filter(n => typeof n === 'string').slice(0, 10) : [] };
    } },
    { id: 'source', label: 'Open-source repository', load: async () => {
      const r = await json(`${repo}/commits/main`);
      if (!/^[a-f0-9]{40}$/.test(r.sha)) throw Error('Invalid commit');
      return { version: r.sha.slice(0, 7), fingerprint: r.sha, url: `https://github.com/nickvasilescu/bops/commit/${r.sha}`, notes: [r.commit.message.split('\n')[0]] };
    } },
    { id: 'release', label: 'GitHub release', load: async () => {
      const r = await json(`${repo}/releases/latest`);
      if (typeof r.tag_name !== 'string') throw Error('Invalid release');
      return { version: r.tag_name, fingerprint: `${r.id}:${r.updated_at}`, url: `https://github.com/nickvasilescu/bops/releases/tag/${encodeURIComponent(r.tag_name)}`, notes: [] };
    } },
  ];
  for (const feed of feeds) {
    try {
      const next = await feed.load();
      const old = sources.find(s => s.id === feed.id);
      const changed = old && old.fingerprint !== next.fingerprint;
      const record = { id: feed.id, label: feed.label, ...next, changedAt: changed ? Date.now() : old?.changedAt, checkedAt: Date.now() };
      if (old) sources.splice(sources.indexOf(old), 1, record); else sources.push(record);
      if (changed) notices.push(`${feed.label}: ${next.version}`);
    } catch (e) { errors.push(`${feed.label}: ${e.message}`); }
  }
  write(file, { checkedAt: Date.now(), sources, errors });
  // One private snapshot a day; includes state/history, never dotenv credentials.
  const backups = path.join(os.homedir(), 'Library', 'Application Support', 'Bops Self-Hosted', 'backups');
  const day = new Date().toISOString().slice(0, 10);
  const snapshot = path.join(backups, `state-${day}`);
  if (!fs.existsSync(snapshot)) {
    fs.mkdirSync(snapshot, { recursive: true, mode: 0o700 });
    for (const name of ['state.json', 'openrouter', 'models.json']) {
      const from = path.join(root, '.data', name);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(snapshot, name), { recursive: true });
    }
    const secure = p => { const st = fs.statSync(p); fs.chmodSync(p, st.isDirectory() ? 0o700 : 0o600); if (st.isDirectory()) for (const n of fs.readdirSync(p)) secure(path.join(p,n)); };
    secure(snapshot);
  }
  if (notices.length) {
    console.log(`Bops updates available:\n${notices.join('\n')}\nReview in Bops Settings → Updates. Nothing was installed.`);
    if (process.platform === 'darwin' && !process.env.BOPS_NO_NOTIFY) {
      try { execFileSync('/usr/bin/osascript', ['-e', 'on run argv\ndisplay notification (item 1 of argv) with title "Bops updates available"\nend run', notices.join(' · ')], { timeout: 10000, stdio: 'ignore' }); }
      catch { console.error('macOS notification unavailable; update details remain in Bops Settings.'); }
    }
  }
  if (errors.length) console.error(errors.join('\n'));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
