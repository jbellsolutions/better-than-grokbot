const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw Error('Build Windows packages on Windows (the Windows workflow provides a cloud runner).');
process.chdir(root);
// A developer's repo pointer must never make it into a distributable.
fs.rmSync('desktop/repo.json', { force: true });
// Private Mac team charters are source reference data, never part of a downloadable app.
const catalogs = ['lib/business-profiles.json', 'lib/grokbot-current-profiles.json'].filter(file => fs.existsSync(file));
const originals = catalogs.map(file => fs.readFileSync(file));
try {
  catalogs.forEach(file => fs.writeFileSync(file, '[]\n'));
  execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit' });
} finally { catalogs.forEach((file, i) => fs.writeFileSync(file, originals[i])); }
const standalone = path.join(root, '.next/standalone');
if (!fs.existsSync(path.join(standalone, 'server.js'))) throw Error('Missing standalone server.');
// Distribution builds must start from a clean checkout without developer credentials/state.
function scrub(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.name.startsWith('.env') || item.name === '.data') fs.rmSync(file, { recursive: true, force: true });
    else if (item.isDirectory()) scrub(file);
  }
}
scrub(standalone);
require("../scripts/prune-standalone.cjs").prune(standalone);
// These bytes are transferred unchanged to Linux computers. CRLF breaks their shebangs.
function verifyWorkers(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) verifyWorkers(file);
    else {
      const bytes = fs.readFileSync(file);
      if (!bytes.includes(0) && bytes.includes(13)) throw Error(`Linux worker has CRLF line endings: ${file}. Check .gitattributes.`);
    }
  }
}
verifyWorkers(path.join(standalone, 'vm'));
execFileSync(process.execPath, ['node_modules/electron-builder/cli.js', '--config', 'windows/electron-builder.cjs', '--win', '--x64', '--publish', 'never'], { stdio: 'inherit' });
