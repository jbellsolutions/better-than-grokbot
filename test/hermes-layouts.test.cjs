const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const load = require('./helpers/load-ts.cjs');

test('Hermes bridge runs on both installed SDK layouts and fails when neither exists', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-hermes-layouts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sdkPaths = ['/usr/local/lib/hermes-agent', '/home/hermes/.hermes/hermes-agent'];
  const env = { ...process.env, BOPS_BUSINESS_RUNTIME: 'hermes', BOPS_COMPUTER_OBSERVE_ONLY: '1', BOPS_ORGO_COMPUTER_ID: 'owned-computer' };
  const orgo = load('lib/server/orgo.ts', {
    './instance': { instanceId: () => 'chief-sales-officer' },
    './orgo-auth': { loadOrgoKey: async () => 'fixture-key', orgoOrigin: () => 'https://fixture.invalid' },
    './usage': {},
  }, {
    process: { env },
    fetch: async (url, options) => {
      assert.equal(url, 'https://fixture.invalid/api/computers/owned-computer/bash');
      assert.equal(options.headers.Authorization, 'Bearer fixture-key');
      let { command } = JSON.parse(options.body);
      sdkPaths.forEach((sdk, i) => { command = command.replaceAll(sdk, root + '/sdk' + i); });
      const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
      return Response.json({ output: result.stdout, exit_code: result.status });
    },
  }).orgo;
  const request = { action: 'status', turn: 'turn', input: "literal $(touch unexpected); ' quotation" };
  for (const [i, name] of ['python3', 'python'].entries()) {
    const interpreter = path.join(root, 'sdk' + i, 'venv', 'bin', name);
    fs.mkdirSync(path.dirname(interpreter), { recursive: true });
    fs.writeFileSync(interpreter, '#!/bin/sh\nprintf \'BOPS_HERMES={"status":"done","answer":"%s"}\\n\' "$2"\n', { mode: 0o700 });
    const response = await orgo.hermes(request);
    assert.equal(response.status, 'done');
    assert.deepEqual(JSON.parse(Buffer.from(response.answer, 'base64').toString()), request);
    fs.rmSync(interpreter);
  }
  await assert.rejects(orgo.hermes(request), /bridge is unavailable/);
});
