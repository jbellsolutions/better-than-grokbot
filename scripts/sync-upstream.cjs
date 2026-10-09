// Keep GitHub's upstream branch current using the Mac's existing Git authentication.
// An isolated checkout lets pull/rebase run without touching the live source tree.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const upstream = 'https://github.com/nickvasilescu/bops.git';
const backup = 'https://github.com/jbellsolutions/bops-selfhosted.git';
function syncUpstream(root) {
  const git = (cwd, args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(root, ['remote', 'get-url', 'upstream']) !== upstream || git(root, ['remote', 'get-url', 'origin']) !== backup) throw Error('Unexpected source or backup URL.');
  git(root, ['fetch', '--no-tags', 'upstream', 'main:refs/remotes/upstream/main']);
  const copy = path.join(root, '.data', 'upstream-sync');
  fs.mkdirSync(path.dirname(copy), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(copy)) git(root, ['clone', '--no-checkout', '--no-tags', '--single-branch', '--branch', 'upstream/main', backup, copy]);
  if (git(copy, ['remote', 'get-url', 'origin']) !== backup) throw Error('Unexpected backup URL in sync checkout.');
  git(copy, ['checkout', '--detach', 'refs/remotes/origin/upstream/main']);
  git(copy, ['pull', '--rebase', 'origin', 'upstream/main']);
  git(copy, ['fetch', '--no-tags', upstream, 'main:refs/remotes/upstream/main']);
  const wanted = git(copy, ['rev-parse', 'refs/remotes/upstream/main']);
  if (wanted === git(copy, ['rev-parse', 'HEAD'])) return;
  // A rewritten source history must be reviewed, never force-pushed over a backup.
  git(copy, ['merge-base', '--is-ancestor', 'HEAD', wanted]);
  git(copy, ['push', 'origin', 'refs/remotes/upstream/main:refs/heads/upstream/main']);
}
module.exports = { syncUpstream };
