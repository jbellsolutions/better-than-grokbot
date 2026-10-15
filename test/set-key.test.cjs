const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withSetting, setKey } = require('../scripts/set-key.cjs');

test('a setting is replaced in place or added, and the rest of .env.local is kept', () => {
  const text = '# comment\nBOPS_SELF_HOSTED=1\nOPENROUTER_API_KEY=\nORGO_API_KEY=old\n';
  assert.equal(withSetting(text, 'OPENROUTER_API_KEY', 'or-$1&x'), '# comment\nBOPS_SELF_HOSTED=1\nOPENROUTER_API_KEY=or-$1&x\nORGO_API_KEY=old\n');
  assert.equal(withSetting('A=1', 'B', '2'), 'A=1\nB=2\n');
  assert.equal(withSetting('', 'B', '2'), 'B=2\n');
  assert.equal(withSetting('MY_ORGO_API_KEY=x\n', 'ORGO_API_KEY', 'y'), 'MY_ORGO_API_KEY=x\nORGO_API_KEY=y\n');
});

test('the file stays private, bad names and multi-line values change nothing, and the value is never printed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-set-key-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(file, 'A=1\n', { mode: 0o644 });
  setKey(file, 'OPENROUTER_API_KEY', 'secret-value');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => setKey(file, 'bad name', 'x'), /name/);
  assert.throws(() => setKey(file, 'B', 'one\ntwo'), /line break/);
  assert.throws(() => setKey(file, 'B', ''), /No value/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'A=1\nOPENROUTER_API_KEY=secret-value\n');
  const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/set-key.cjs'), 'TEST_ONLY_KEY'], { input: 'piped-secret\n', cwd: dir, encoding: 'utf8', env: { ...process.env, BOPS_ENV_FILE: file } });
  assert.doesNotMatch(out, /piped-secret/);
  assert.match(out, /TEST_ONLY_KEY saved in \.env\.local \(12 characters\)/);
  assert.match(fs.readFileSync(file, 'utf8'), /^TEST_ONLY_KEY=piped-secret$/m);
});
