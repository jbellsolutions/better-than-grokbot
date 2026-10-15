const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = require('./helpers/load-ts.cjs');

function setup(t, fetchMock) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bops-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, BOPS_SELF_HOSTED: '1', FIXTURE_TOOL_TOKEN: 'private-tool-token-fixture' };
  const api = load('lib/server/custom-tools.ts', { './instance': { dataPath: (...parts) => path.join(root, ...parts) }, './store': { bot: id => ['a', 'b'].includes(id) ? { id } : undefined } }, { process: { env, cwd: process.cwd }, ...(fetchMock ? { fetch: fetchMock } : {}) });
  return { api, root, env };
}
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

test('CLI tools receive JSON on stdin with fixed argv, are scoped to one agent, and respect revocation', async t => {
  const { api, root } = setup(t);
  const fixture = path.join(root, 'tool.cjs');
  fs.writeFileSync(fixture, "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const args=JSON.parse(input);process.stdout.write(JSON.stringify({value:args.text,secret:process.env.FIXTURE_TOOL_TOKEN??null,argv:process.argv.slice(2)}));});");
  const c = api.saveTool('a', { kind: 'cli', name: 'echo', description: 'Echo a value', command: process.execPath, args: [fixture, 'fixed'], inputSchema: schema });
  assert.equal(fs.statSync(path.join(root, 'tool-connections.json')).mode & 0o777, 0o600);
  assert.equal((await api.connectedTools('b')).length, 0);
  const [tool] = await api.connectedTools('a');
  const injection = '$(touch /tmp/never-execute-this) `id`';
  const result = JSON.parse(await tool.run({ text: injection }));
  assert.equal(result.value, injection); assert.equal(result.secret, null); assert.deepEqual(result.argv, ['fixed']);
  api.deleteTool('a', c.id); await assert.rejects(tool.run({ text: 'after revocation' }), /removed or changed/);
});

test('API tools use the configured endpoint and server token without storing its value', async t => {
  const requests = [];
  const { api, root, env } = setup(t, async (url, options) => { requests.push({ url, options }); return Response.json({ ok: true }); });
  api.saveTool('a', { kind: 'api', name: 'crm', description: 'Search CRM', url: 'https://crm.example/tools', tokenEnv: 'FIXTURE_TOOL_TOKEN', inputSchema: schema });
  const [tool] = await api.connectedTools('a');
  assert.equal(await tool.run({ text: 'Jordan' }), '{"ok":true}');
  assert.equal(requests[0].url, 'https://crm.example/tools'); assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${env.FIXTURE_TOOL_TOKEN}`);
  assert.equal(fs.readFileSync(path.join(root, 'tool-connections.json'), 'utf8').includes(env.FIXTURE_TOOL_TOKEN), false);
  assert.throws(() => api.saveTool('b', { kind: 'api', name: 'bad', description: 'bad', url: 'http://remote.example/tools', inputSchema: schema }), /HTTPS/);
  assert.throws(() => api.saveTool('b', { kind: 'api', name: 'bad', description: 'bad', url: 'https://user:password@example.com/tools', inputSchema: schema }), /credentials/);
});

test('MCP negotiates a session, discovers paginated tools, and consumes an SSE reply without waiting for stream close', async t => {
  const methods = [];
  const { api } = setup(t, async (_url, options) => {
    const request = JSON.parse(options.body); methods.push(request.method);
    if (request.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-11-25' } }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
    assert.equal(options.headers['Mcp-Session-Id'], 'fixture-session'); assert.equal(options.headers['MCP-Protocol-Version'], '2025-11-25');
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'tools/list') return Response.json({ id: request.id, result: request.params.cursor ? { tools: [{ name: 'second', description: 'Second page', inputSchema: schema }] } : { tools: [{ name: 'lookup', description: 'Read a record', inputSchema: schema }], nextCursor: 'page2' } });
    assert.equal(request.method, 'tools/call'); assert.equal(request.params.name, 'lookup');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: request.id, result: { content: [{ type: 'text', text: request.params.arguments.text }] } })}\n\n`)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  api.saveTool('a', { kind: 'mcp', name: 'records', description: 'Record tools', url: 'https://mcp.example/mcp' });
  const catalog = await api.connectedTools('a'); assert.equal(catalog.length, 2);
  const [tool] = catalog;
  assert.equal(JSON.parse(await tool.run({ text: 'result' })).content[0].text, 'result');
  await api.connectedTools('a');
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call']);
});

test('an unavailable MCP connection reports failure without taking down an agent’s other tools', async t => {
  const { api } = setup(t, async () => { throw Error('server offline'); });
  api.saveTool('a', { kind: 'mcp', name: 'offline', description: 'Offline service', url: 'https://offline.example/mcp' });
  api.saveTool('a', { kind: 'api', name: 'available', description: 'Other API', url: 'https://other.example/tools', inputSchema: schema });
  const tools = await api.connectedTools('a');
  assert.equal(tools.length, 2); await assert.rejects(tools[0].run({}), /server offline/); assert.equal(tools[1].name, 'custom_available');
});

test('deleting an agent revokes all of its tools without changing a teammate’s connections', async t => {
  const { api } = setup(t, async () => Response.json({ ok: true }));
  for (const id of ['a', 'b']) api.saveTool(id, { kind: 'api', name: 'crm', description: 'Search CRM', url: 'https://crm.example/tools', inputSchema: schema });
  const [oldTool] = await api.connectedTools('a');
  api.deleteAgentTools('a');
  assert.equal(api.toolConnections('a').length, 0); assert.equal(api.toolConnections('b').length, 1);
  await assert.rejects(oldTool.run({ text: 'after deletion' }), /removed or changed/);
  assert.equal((await api.connectedTools('a')).length, 0);
});
