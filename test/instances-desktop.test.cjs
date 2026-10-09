const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function desktop() {
  const source = ts.createSourceFile('main.cjs', fs.readFileSync('desktop/main.cjs', 'utf8'), ts.ScriptTarget.Latest, true);
  const statement = source.statements.find(n => n.getText(source).startsWith('ipcMain.handle("instance-select"'));
  const entries = ['default', 'ai-guy', 'revenue-partners'].map((id, i) => ({ id, url: `http://localhost:${3210 + i}` }));
  const windows = new Map();
  const created = [];
  let handler;
  let failure;
  const makeWindow = id => ({ id, draft: `${id} unsent draft`, hidden: false, isDestroyed: () => false, isMinimized: () => false, hide() { this.hidden = true; }, show() { this.hidden = false; }, focus() {}, restore() {} });
  windows.set('default', makeWindow('default'));
  const context = { ipcMain: { handle: (_, h) => { handler = h; } }, readRegistry: () => entries, REPO: '/project', instanceWindows: windows, openingInstances: new Map(),
    verify: async () => { if (failure) throw failure; }, BrowserWindow: { fromWebContents: sender => windows.get(sender.id) },
    createWindow: async id => { created.push(id); windows.set(id, makeWindow(id)); } };
  vm.runInNewContext(statement.getText(source), context);
  const event = id => ({ sender: { id, getURL: () => entries.find(e => e.id === id)?.url + '/' } });
  return { handler, windows, created, event, fail: e => { failure = e; } };
}

test('native switching returns to the same window and draft without restarting either instance', async () => {
  const d = desktop();
  const original = d.windows.get('default');
  await d.handler(d.event('default'), 'ai-guy');
  const ai = d.windows.get('ai-guy');
  assert.equal(original.hidden, true); assert.equal(ai.hidden, false);
  ai.draft = 'A business-specific draft';
  await d.handler(d.event('ai-guy'), 'revenue-partners');
  assert.equal(ai.hidden, true);
  await d.handler(d.event('revenue-partners'), 'ai-guy');
  assert.equal(d.windows.get('ai-guy'), ai);
  assert.equal(ai.draft, 'A business-specific draft');
  await d.handler(d.event('ai-guy'), 'default');
  assert.equal(d.windows.get('default'), original);
  assert.equal(original.hidden, false);
  assert.deepEqual(d.created, ['ai-guy', 'revenue-partners']);
});

test('offline or mismatched native targets leave the current window visible', async () => {
  const d = desktop(); d.fail(new Error('Wrong instance identity'));
  await assert.rejects(d.handler(d.event('default'), 'ai-guy'), /Wrong instance/);
  assert.equal(d.windows.get('default').hidden, false);
  assert.equal(d.created.length, 0);
});

test('native instance selection rejects unknown IDs and external renderer origins', async () => {
  const d = desktop();
  await assert.rejects(d.handler(d.event('default'), 'other'), /Unknown/);
  await assert.rejects(d.handler({ sender: { getURL: () => 'https://external.example/' } }, 'ai-guy'), /Unknown/);
  assert.equal(d.created.length, 0);
});
