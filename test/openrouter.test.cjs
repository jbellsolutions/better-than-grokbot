const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const loadInstance = require('./helpers/instance.cjs');

test('a textual null from model routing cannot schedule an unintended Mac follow-up', () => {
  const source = ts.createSourceFile('sessions.ts', fs.readFileSync('lib/server/sessions.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'startSession');
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const state = { host: 'orgo', sessions: [] };
  const context = { exports: {}, process: { env: {} }, getState: () => state, update: fn => fn(state), id: () => 'setup-check',
    botChatId: id => `bot:${id}`, sameJob: () => undefined, retireCopies: () => {}, route: () => {}, pump: () => {} };
  vm.runInNewContext(code, context);
  for (const thenOnMac of [null, undefined, '', 'null', ' NULL ', 'undefined', 'none']) {
    const session = context.exports.startSession({ botId: 'boppy', goal: 'Read example.org in the cloud', thenOnMac });
    assert.equal(session.thenOnMac, undefined);
  }
  const requested = context.exports.startSession({ botId: 'boppy', goal: 'Research online', thenOnMac: ' Open my Notes ' });
  assert.equal(requested.thenOnMac, 'Open my Notes');
});

function load(file, modules, env = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: (id) => {
    if (id === './instance' || id === '@/lib/server/instance') return loadInstance({ env, cwd: () => '/test' });
    if (id === 'server-only') return {};
    if (id in modules) return modules[id];
    return require(id);
  }, process: { env, cwd: () => '/test' }, Buffer, AbortSignal, console, setTimeout, clearTimeout });
  return exports;
}

function runner(streams) {
  let saved;
  const requests = [], remoteCalls = [], tokens = [];
  const api = { chat: { completions: { create: async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)));
    const chunks = streams.shift();
    assert.ok(chunks, 'unexpected inference request');
    return (async function* () { yield* chunks; })();
  } } } };
  const mod = load('lib/server/openrouter-agent.ts', {
    './openai-client': { openaiClient: () => api },
    './models': { modelFor: () => 'qwen/test', modelReasoning: async () => ({ effort: 'low' }) },
    './orgo': { orgo: { bash: async (_id, command) => {
      const r = JSON.parse(Buffer.from(/'([^']+)'$/.exec(command)[1], 'base64').toString());
      remoteCalls.push(r);
      const result = r.method === 'list'
        ? { tools: [{ name: r.backend === 'screen' ? 'screenshot' : 'browser_navigate', inputSchema: { type: 'object' } }, { name: 'claim_screen', inputSchema: {} }] }
        : { content: [{ type: 'text', text: 'Page loaded' }, { type: 'image', mimeType: 'image/png', data: 'test-image' }] };
      return { exit_code: 0, output: 'BOPS_RESULT=' + JSON.stringify(result) };
    } } },
    './usage': { recordTokens: (...args) => tokens.push(args) },
    'node:fs/promises': {
      readFile: async () => { if (!saved) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return saved; },
      writeFile: async (_path, data) => { saved = data; }, mkdir: async () => {}, rename: async () => {},
    },
  }, { BOPS_SESSION_MODEL: 'qwen/test' });
  const options = { sessionId: 'session1', botId: 'boppy', computerId: 'cloud1', display: 100, instructions: 'Read only', input: 'Read example.com', signal: new AbortController().signal, activity: () => {}, step: () => {} };
  return { ...mod, options, requests, remoteCalls, tokens, history: () => JSON.parse(saved) };
}

test('cloud tool calls execute on the assigned computer and replay results before completion', async () => {
  const r = runner([
    [{ model: 'qwen/test', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'screen__screenshot', arguments: '{"screen":4}' } }] }, finish_reason: 'tool_calls' }] }],
    [{ model: 'qwen/test', choices: [{ delta: { content: 'Example Domain.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } }],
  ]);
  assert.equal(await r.runOpenRouter(r.options), 'Example Domain.');
  assert.deepEqual(r.remoteCalls.at(-1).arguments, {});
  assert.equal(r.remoteCalls.at(-1).display, 100);
  assert.ok(r.requests[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'call1'));
  assert.ok(r.requests[1].messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')));
  assert.ok(!r.requests[0].tools.some(t => t.function.name.includes('claim_screen')));
  assert.equal(r.tokens[0][2].input_tokens, 20);
});

test('a later user reply retains the completed cloud conversation', async () => {
  const answer = text => [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }];
  const r = runner([answer('First answer'), answer('Follow-up answer')]);
  await r.runOpenRouter(r.options);
  assert.equal(await r.runOpenRouter({ ...r.options, input: 'Follow up' }), 'Follow-up answer');
  assert.ok(r.requests[1].messages.some(m => m.role === 'assistant' && m.content === 'First answer'));
  assert.equal(r.history().filter(m => m.role === 'system').length, 1);
});

test('cancelled tasks issue no tools or inference requests', async () => {
  const r = runner([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(r.runOpenRouter({ ...r.options, signal: controller.signal }));
  assert.equal(r.remoteCalls.length, 0);
  assert.equal(r.requests.length, 0);
});

test('truncated output is a failed task, not a successful result', async () => {
  const r = runner([[{ choices: [{ delta: { content: 'unfinished' }, finish_reason: 'length' }] }]]);
  await assert.rejects(r.runOpenRouter(r.options), /output limit/);
});

test('OpenRouter routing is explicit and disables server-side response storage', async () => {
  const requests = [];
  class FakeOpenAI {
    constructor(options) {
      this.options = options;
      this.baseURL = 'https://api.openai.com/v1';
      this.responses = { create: (body) => { requests.push(body); return Promise.resolve({}); } };
    }
  }
  const env = { BOPS_SELF_HOSTED: '1', OPENROUTER_API_KEY: 'fake-test-key', OPENAI_API_KEY: 'fake-openai-key' };
  const m = load('lib/server/openai-client.ts', { openai: { default: FakeOpenAI }, './cloud': { cloudProxy: () => null }, './models': { modelReasoning: async () => ({ effort: 'low' }) } }, env);
  const client = m.openaiClient();
  assert.equal(client.baseURL, 'https://openrouter.ai/api/v1');
  assert.equal(await client.options.apiKey(), 'fake-test-key');
  await client.responses.create({ model: 'qwen/test', store: true });
  assert.equal(requests[0].store, false);
  env.BOPS_SELF_HOSTED = '0';
  assert.equal(client.baseURL, 'https://api.openai.com/v1');
  assert.equal(await client.options.apiKey(), 'fake-openai-key');
});

test('OpenRouter tasks invoke connected app actions through the server approval gateway', async () => {
  const r = runner([
    [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'app1', function: { name: 'use_app', arguments: '{"action":"GMAIL_FETCH_EMAILS","arguments":{}}' } }] }, finish_reason: 'tool_calls' }] }],
    [{ choices: [{ delta: { content: 'Read the approved account.' }, finish_reason: 'stop' }] }],
  ]);
  const gateway = [];
  const appTools = [{ name: 'use_app', description: 'Approved app action', parameters: { type: 'object' }, run: async args => { gateway.push(args); return 'Gateway result'; } }];
  await r.runOpenRouter({ ...r.options, appTools });
  assert.equal(gateway[0].action, 'GMAIL_FETCH_EMAILS');
  assert.equal(r.remoteCalls.filter(c => c.method === 'call').length, 0);
  assert.ok(r.requests[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'app1' && m.content === 'Gateway result'));
});
