// Put one setting into .env.local without it showing on screen, in a log or in a chat:
//
//   node scripts/set-key.cjs OPENROUTER_API_KEY          asks for the value (typing and pasting are hidden)
//   printf %s "$VALUE" | node scripts/set-key.cjs NAME    reads it from a pipe
//
// Replaces the setting if .env.local has it, adds it if not, and leaves the file readable by you only.
// Prints the name and length, never the value. Restart the app afterwards to load it.
// BOPS_ENV_FILE=<file> writes another file instead (tests).
const fs = require('node:fs');
const path = require('node:path');

/** .env.local's text with NAME set to value, the rest as it was. */
function withSetting(text, name, value) {
  const line = `${name}=${value}`;
  const at = new RegExp(`^${name}=.*$`, 'm');
  return at.test(text) ? text.replace(at, () => line) : `${text.replace(/\n?$/, text ? '\n' : '')}${line}\n`;
}

function setKey(file, name, value) {
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name ?? '')) throw Error('Give the setting\'s name, like OPENROUTER_API_KEY.');
  if (!value) throw Error('No value given: nothing changed.');
  if (/[\r\n]/.test(value)) throw Error('The value has a line break in it: nothing changed.');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, withSetting(text, name, value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function hidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setEncoding('utf8');
    if (!stdin.isTTY) {
      let data = '';
      stdin.on('data', (d) => (data += d));
      stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    stdin.on('data', function onData(chunk) {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ') value += c;
      }
    });
  });
}

async function main() {
  const name = process.argv[2];
  const file = process.env.BOPS_ENV_FILE ? path.resolve(process.env.BOPS_ENV_FILE) : path.resolve(__dirname, '..', '.env.local');
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name ?? '')) throw Error('Use: node scripts/set-key.cjs NAME (like OPENROUTER_API_KEY)');
  const value = (await hidden(`${name} (hidden, Enter when done): `)).trim();
  setKey(file, name, value);
  console.log(`${name} saved in .env.local (${value.length} characters). Restart the app to load it.`);
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { withSetting, setKey };
