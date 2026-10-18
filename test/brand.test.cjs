const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');

test('legacy main agent becomes the branded Head of Ops without changing history or machine', () => {
  const { ensureTeamOperations } = load('lib/team-operations.ts');
  const main = { id: 'boppy', name: 'Boppy', isMain: true, computerId: 'machine-1', instructions: 'Our charter', access: { docs: 'read' } };
  const state = { bots: [main, { id: 'bapi', name: 'Bapi', teamRole: 'operations' }], messages: [{ botId: 'boppy', text: 'Saved conversation' }], chats: [{ id: 'bot:boppy' }] };
  ensureTeamOperations(state);
  assert.equal(main.name, 'Better than GrokBot'); assert.equal(main.role, 'Head of Ops · Orchestrator');
  assert.equal(main.computerId, 'machine-1'); assert.equal(main.instructions, 'Our charter'); assert.equal(main.access.docs, 'read');
  assert.equal(state.messages[0].text, 'Saved conversation'); assert.equal(state.chats[0].id, 'bot:boppy');
  assert.equal(state.bots[1].id, 'bapi'); assert.equal(state.bots[1].name, 'Operations Support'); assert.equal(state.bots[1].teamRole, 'specialist');
  const snapshot = JSON.stringify(state); ensureTeamOperations(state); assert.equal(JSON.stringify(state), snapshot);
});

test('custom main names survive and former Ops specialists keep their work and custom instructions', () => {
  const { ensureTeamOperations } = load('lib/team-operations.ts');
  const state = { bots: [{ id: 'main', name: 'My revenue lead', isMain: true }, { id: 'ops', name: 'Custom assistant', teamRole: 'operations', instructions: 'Keep this brief' }] };
  ensureTeamOperations(state); assert.equal(state.bots.length, 2); assert.equal(state.bots[0].name, 'My revenue lead');
  assert.equal(state.bots[1].instructions, 'Keep this brief'); assert.equal(state.bots[1].teamRole, 'specialist');
});

test('agent figures use the fork arrow and never inject supplied colors as SVG markup', () => {
  const { mascotMarkup } = load('lib/mascot.ts');
  for (const id of ['boppy', 'better-than-grokbot-2', 'otto', 'rook', 'penny', 'custom']) {
    const markup = mascotMarkup(id, '#60A5FA'); assert.match(markup, /M11 29 28 12/); assert.doesNotMatch(markup, /headphones|ellipse/);
  }
  assert.doesNotMatch(mascotMarkup('custom', '"><script>alert(1)</script>'), /script/);
});
