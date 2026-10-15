const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const load = require('./helpers/load-ts.cjs');

test('task tools require the owning agent key and stopped tasks cannot invoke them', async () => {
  const task = { id: 'task', botId: 'a', chatId: 'bot:a', status: 'running' };
  const gateway = load('lib/server/tool-gateway.ts', {
    './store': { session: id => id === task.id ? task : undefined, bot: () => ({ appsKey: 'agent-secret' }) },
    './custom-tools': { connectedTools: async () => [{ name: 'custom_records' }] },
    './team-tools': { teamTools: () => [{ name: 'ask_teammate' }] },
  });
  await assert.rejects(gateway.sessionTools('task', 'incorrect'), /No access/);
  await assert.rejects(gateway.sessionTools('missing', 'agent-secret'), /No access/);
  const allowed = await gateway.sessionTools('task', 'agent-secret');
  assert.deepEqual(Array.from(allowed.tools, t => t.name), ['custom_records', 'ask_teammate']);
  task.status = 'failed'; task.error = 'Paused by Bapi';
  await assert.rejects(gateway.sessionTools('task', 'agent-secret'), /stopped/);
});

test('the actual stdio MCP bridge discovers and invokes team tools with its task identity', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    assert.equal(req.headers['x-bops-key'], 'fixture-key'); assert.equal(body.session, 'fixture-task');
    if (body.tool === 'list_team_tools') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ tools: [{ name: 'ask_teammate', description: 'Ask an agent', inputSchema: { type: 'object' } }] }));
    } else if (body.tool === 'ask_teammate') res.end('Penny says: verified.');
    else { res.statusCode = 403; res.end('No accessible tool.'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['vm/apps-mcp.mjs', '--session', 'fixture-task'], { env: { PATH: process.env.PATH, BOPS_URL: `http://127.0.0.1:${server.address().port}`, BOPS_KEY: 'fixture-key' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); server.closeAllConnections(); server.close(); });
  const replies = new Map(), pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => { const m = JSON.parse(line); const resolve = pending.get(m.id); if (resolve) resolve(m); else replies.set(m.id, m); });
  const rpc = (id, method, params) => new Promise(resolve => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const list = await rpc(1, 'tools/list'); assert.ok(list.result.tools.some(t => t.name === 'ask_teammate'));
  const result = await rpc(2, 'tools/call', { name: 'ask_teammate', arguments: { bot_id: 'penny', question: 'Ready?' } });
  assert.equal(result.result.content[0].text, 'Penny says: verified.'); assert.equal(result.result.isError, false);
  const denied = await rpc(3, 'tools/call', { name: 'foreign_tool', arguments: {} }); assert.equal(denied.result.isError, true);
  assert.equal(requests.length, 3);
});
