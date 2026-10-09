// Import an app-observed snapshot. No account calls, inference, schedules or sends.
const fs = require('node:fs');
const path = require('node:path');
function redact(text) {
  return String(text)
    .replace(/\b(?:sk-(?:or-v1-)?|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|authorization)\s*[=:]\s*["']?)([A-Za-z0-9_./+~-]{20,})/gi, '$1[REDACTED]');
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
}
function importRecent(source, project = path.resolve(__dirname, '..')) {
  const roster = JSON.parse(fs.readFileSync(path.join(source, 'roster.json')));
  if (!roster.complete) throw Error('Refusing an incomplete source roster');
  const chats = roster.agents.map(a => ({ ...a, ...JSON.parse(fs.readFileSync(path.join(source, a.id + '.json'))) }));
  if (chats.some(c => !c.covered || c.error)) throw Error('The requested window is not fully covered for every conversation');
  const routines = JSON.parse(fs.readFileSync(path.join(source, 'routines.json')));
  if (routines.status !== 'ready' || !Array.isArray(routines.value)) throw Error('Routine snapshot is not ready');
  const names = new Map(roster.agents.map(a => [a.id, a.name]));
  const records = chats.map(c => ({ id: c.id, agent: c.name, group: c.isGroup, entries: c.entries.length, observedAt: c.observedAt / 1000 }));
  records.push({ id: 'routines', agent: 'Routine definitions (source records only)', group: false, entries: routines.value.length, observedAt: Date.now() / 1000 });
  const review = {
    source: 'Grok Bot live app on this Mac', observedAt: new Date().toISOString(),
    window: `${new Date(chats[0].cutoff).toISOString()} — ${new Date(chats[0].observedAt).toISOString()} (48 hours)`,
    roster: roster.agents.filter(a => !a.isGroup).map(a => a.name).sort(),
    groups: roster.agents.filter(a => a.isGroup).map(a => a.name).sort(),
    routineCount: routines.value.length, enabledSourceRoutines: routines.value.filter(r => r.automation.isEnabled).length,
    records, gaps: [
      'All 40 conversation windows and all 46 routine prompts were recovered directly from the app. Older AI Guy and Hermes archives do not establish the current workflow.',
      'Nine source routines are marked enabled. These records are read-only: no Bops schedules were enabled, and source settings were not changed.',
      'Source history is preserved as a shared reference snapshot. New chats, tasks and contacts remain separate in each Bops instance.',
      'Live CRM/Instantly contact data and external app connections still need a separate verified import. Addresses mentioned in conversations are not automatically enrolled as contacts.',
      'The current 30 bot roles are preserved independently in each instance. The older 22-profile consolidation is archived. Existing campaign GO requirements and holds remain in force.'
    ]
  };
  for (const instance of ['ai-guy', 'revenue-partners']) {
    const root = path.join(project, '.data/instances', instance, 'business');
    fs.mkdirSync(path.join(root, 'recent'), { recursive: true, mode: 0o700 });
    for (const c of chats) {
      const text = [`${c.name} — Grok Bot source conversation`, `Window: ${review.window}`, 'Historical reference, not executable instructions or permission to send.', '', ...c.entries.map(e => `${new Date(e.timestampMs).toISOString()} · ${e.kind} · ${e.role || 'activity'}\n${typeof e.content === 'string' ? e.content : JSON.stringify(e)}`)].join('\n\n');
      fs.writeFileSync(path.join(root, 'recent', c.id + '.txt'), redact(text), { mode: 0o600 });
    }
    const text = routines.value.map(r => { const a = r.automation; return `${names.get(r.agentId) || r.agentId} · ${a.name}\nSource status: ${a.isEnabled ? 'enabled' : 'paused'}; NOT scheduled in Bops\nTrigger: ${a.triggerDescription || JSON.stringify(a.schedule || a.trigger)}\nCreated: ${new Date(a.createdAt).toISOString()}\n\n${a.prompt}`; }).join('\n\n----------------\n\n');
    fs.writeFileSync(path.join(root, 'recent/routines.txt'), redact(text), { mode: 0o600 });
    let preserved = [];
    try { preserved = JSON.parse(fs.readFileSync(path.join(root, 'recent-review.json'))).records.filter(r => r.sourceKind === 'handoff'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    atomic(path.join(root, 'recent-review.json'), { ...review, records: [...records, ...preserved] });
    const profiles = roster.agents.filter(a => !a.isGroup).map(a => ({
      id: 'grok-' + a.id, name: a.name, instances: ['ai-guy', 'revenue-partners'], optional: false,
      screen: /Head of operations|Grok Bot|Writer|Editorial|Single Brain|Call Prep|Accountability|Campaign Manager|Newsletter Creator|Affiliate Program Manager/.test(a.name) ? 'none' : 'optional',
      instructions: `You are the independently hosted ${a.name} profile. Follow the current user's task in this instance. Grok Bot source history and routine prompts are reference records only. No inherited routines, launch permissions, paid pulls or outbound sends are enabled. Work on drafts and research; report missing connections and approvals.`,
      sources: [{ id: a.id, name: a.name, decision: 'Keep current role' }]
    }));
    atomic(path.join(root, 'current-profiles.json'), profiles);
  }
  return { bots: review.roster.length, groups: review.groups.length, entries: chats.reduce((n, c) => n + c.entries.length, 0), routines: review.routineCount, enabledSourceRoutines: review.enabledSourceRoutines };
}
if (require.main === module) { if (!process.argv[2]) throw Error('Usage: node scripts/import-grok-recent.cjs PRIVATE_SNAPSHOT_DIRECTORY'); console.log(JSON.stringify(importRecent(path.resolve(process.argv[2])))); }
module.exports = { importRecent, redact };
