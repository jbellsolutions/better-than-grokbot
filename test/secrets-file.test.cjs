const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');

/**
 * Off a Mac there's no Keychain, so saved logins and tokens go in .data/secrets.json
 * (lib/server/keychain.ts): every save kept, readable only by this user, and a damaged file is never
 * written over.
 */

const on = (platform, dataDir) =>
  load('lib/server/keychain.ts', {}, {
    process: Object.create(process, { platform: { value: platform }, env: { value: { ...process.env, BOPS_DATA_DIR: dataDir, BOPS_INSTANCE_ID: '' } } }),
  });

test('off a Mac, secrets are kept in a private file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-secrets-'));
  const keys = on('linux', dir);
  assert.equal(keys.secretStore(), 'file');
  assert.equal(await keys.getSecret('nothing yet'), null);

  // Saves made at the same time all land.
  await Promise.all([keys.setSecret('a', 'one'), keys.setSecret('b', 'two'), keys.setSecret('shared', 'three', 'Bops Slack App')]);
  assert.equal(await keys.getSecret('a'), 'one');
  assert.equal(await keys.getSecret('b'), 'two');
  assert.equal(await keys.getSecret('shared', 'Bops Slack App'), 'three');
  assert.equal(await keys.getSecret('shared'), null, 'each service has its own secrets');

  await keys.setSecret('a', 'changed');
  assert.equal(await keys.getSecret('a'), 'changed');
  await keys.deleteSecret('b');
  await keys.deleteSecret('never saved');
  assert.equal(await keys.getSecret('b'), null);

  const file = path.join(dir, 'secrets.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 'Bops Vault': { a: 'changed' }, 'Bops Slack App': { shared: 'three' } });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only this user can read it');
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('a damaged secrets file is never written over', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-secrets-'));
  const file = path.join(dir, 'secrets.json');
  fs.writeFileSync(file, '{ not json');
  const keys = on('linux', dir);
  await assert.rejects(keys.setSecret('a', 'one'));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  assert.equal(await keys.getSecret('a'), null);
  // The failed save doesn't block the next one once the file is fixed.
  fs.writeFileSync(file, '{}');
  await keys.setSecret('a', 'one');
  assert.equal(await keys.getSecret('a'), 'one');
});

test('on a Mac, secrets stay in the Keychain', () => {
  assert.equal(on('darwin', os.tmpdir()).secretStore(), 'keychain');
});
