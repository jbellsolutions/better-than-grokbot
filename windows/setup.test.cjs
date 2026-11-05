const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = require('../test/helpers/load-ts.cjs');
const { createInstance, readRegistry } = require('../desktop/instances.cjs');

function setup(fetchImpl) {
  const env = { BOPS_DISTRIBUTION: 'better-than-grokbot' };
  const saved = new Map(); const state = { bots: [{ id: 'lead', isMain: true }] };
  let key = null, model;
  const api = load('lib/server/desktop-setup.ts', {
    './keychain': { getSecret: async account => saved.get(account), setSecret: async (account, value) => saved.set(account, value) },
    './store': { getState: () => state }, './models': { savedModel: () => model, setModel: async m => { model = m; } },
    './orgo-auth': { loadOrgoKey: async () => key, orgoKey: () => key, orgoOrigin: () => 'https://www.orgo.ai', signIn: async k => { key = k; } },
  }, { process: { env }, fetch: fetchImpl });
  return { api, saved, env, state, setModel: value => { model = value; } };
}
test('setup verifies credentials before storing them and never returns a secret', async () => {
  const s = setup(async url => Response.json(url.includes('openrouter') ? { data: {} } : { id: 'test-user' }));
  assert.equal((await s.api.desktopSetupStatus()).complete, false);
  await s.api.saveDesktopProvider('test-openrouter-key');
  assert.equal(s.saved.get('openrouter-api-key'), 'test-openrouter-key');
  assert.equal(s.env.OPENROUTER_API_KEY, 'test-openrouter-key');
  s.setModel('test/vision'); await s.api.saveDesktopOrgo('test-orgo-key');
  assert.equal((await s.api.desktopSetupStatus()).complete, false);
  s.state.bots[0].computerId = 'chosen-computer';
  const status = await s.api.desktopSetupStatus();
  assert.equal(status.complete, true);
  assert.equal(JSON.stringify(status).includes('test-openrouter-key'), false);
  assert.equal(JSON.stringify(status).includes('test-orgo-key'), false);
  delete s.env.OPENROUTER_API_KEY; await s.api.loadDesktopProvider();
  assert.equal(s.env.OPENROUTER_API_KEY, 'test-openrouter-key');
});
test('bad keys and failed providers leave setup and credentials unchanged', async () => {
  for (const fetchImpl of [async () => new Response('', { status: 401 }), async () => { throw Error('upstream detail containing secret'); }]) {
    const s = setup(fetchImpl);
    for (const key of ['', 'has spaces', null, 'invalid-key']) {
      await assert.rejects(s.api.saveDesktopProvider(key));
      await assert.rejects(s.api.saveDesktopOrgo(key));
    }
    assert.equal(s.saved.size, 0); assert.equal(s.env.OPENROUTER_API_KEY, undefined);
  }
});
test('download starts with a generic instance and new instances persist without personal machine bindings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grokbot-instance-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(readRegistry(root).length, 1);
  const first = createInstance(root, 'Research'); const second = createInstance(root, 'Writing');
  assert.notEqual(first.id, second.id); assert.notEqual(first.port, second.port);
  assert.equal(first.computerId, undefined);
  assert.equal(readRegistry(root)[1].name, 'Research');
  assert.throws(() => createInstance(root, ''), /Name/);
});
test('distribution refuses the hosted cloud transport even when an Orgo key is present', async () => {
  let called = false;
  const cloud = load('lib/server/cloud.ts', {
    './orgo-auth': { orgoKey: () => 'own-orgo-key' }, './persist': { onPostgres: () => false }, './store': {},
  }, { process: { env: { BOPS_DISTRIBUTION: 'better-than-grokbot' } }, fetch: async () => { called = true; throw Error('unexpected network'); } });
  assert.equal(cloud.cloudOn(), false);
  await assert.rejects(cloud.cloudFetch('/v1/session'), /own provider/);
  assert.equal(called, false);
});
