// Runtime data is read from the instance directory, never bundled into the app.
// Next's instrumentation trace can include the checkout despite route exclusions.
const fs = require('node:fs');
const path = require('node:path');
function prune(dir) {
  for (const required of ['server.js', 'package.json', '.next', 'node_modules']) {
    if (!fs.existsSync(path.join(dir, required))) throw Error(`Not a standalone build: missing ${required}`);
  }
  const allowed = new Set(['server.js', 'package.json', '.next', 'node_modules', 'public', 'vm', 'LICENSE']);
  for (const name of fs.readdirSync(dir)) {
    if (!allowed.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}
if (require.main === module) prune(path.join(__dirname, '../.next/standalone'));
module.exports = { prune };
