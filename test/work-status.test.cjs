const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./helpers/load-ts.cjs');
const { workStatus, routineStatus } = loadTs('lib/work-status.ts');
const session = patch => ({ id: 'task', botId: 'any-specialist', chatId: 'bot:any-specialist', title: 'Task', goal: 'Goal', sentVia: 'you', host: 'orgo', status: 'done', createdAt: 1, steps: [], replies: [], ...patch });
const user = { id: 'owner-reply', role: 'user', text: 'I have a question', at: 30 };
const bot = { id: 'bot-reply', role: 'bot', text: 'Earlier response', at: 20 };

test('execution labels do not turn queue or startup into working', () => {
  for (const [status, label] of [['queued', 'Queued'], ['starting', 'Starting'], ['running', 'Working']]) {
    const view = workStatus(session({ status, queueReason: 'Private screen busy' }));
    assert.equal(view.label, label);
    assert.equal(view.detail, 'Private screen busy');
    assert.equal(view.attention, false);
  }
  assert.equal(workStatus(session({ status: 'queued', askWhere: true })).label, 'Needs location choice');
  const view = workStatus(session({ status: 'running', waitingOnYou: true }));
  assert.equal(view.label, 'Working');
  assert.equal(view.attentionLabel, 'Waiting for your answer');
});

test('checkpoints survive raw completion and ordinary newer owner replies', () => {
  for (const [blocker, label] of [['sign_in', 'Needs sign-in'], ['two_factor', 'Needs verification'], ['captcha', 'Needs verification'], ['payment', 'Needs approval'], ['error', 'Needs help']]) {
    const view = workStatus(session({ blocker, hermesHelpId: 'checkpoint', waitingOnYou: false, answer: 'Existing answer', replies: [bot, user] }));
    assert.equal(view.label, label);
    assert.equal(view.attention, true);
    assert.equal(view.canStop, true);
    assert.equal(view.canDelete, false);
    assert.equal(view.hasResult, true);
  }
  const view = workStatus(session({ hermesHelpId: 'unknown-checkpoint', blocker: 'legacy-unknown' }));
  assert.equal(view.kind, 'uncertain');
  assert.equal(view.checkpoint, undefined);
  assert.equal(view.attention, true);
  assert.equal(workStatus(session({ status: 'queued', askWhere: true, blocker: 'sign_in' })).kind, 'checkpoint');
});

test('explicit owner-wait flags override conversational heuristics only', () => {
  assert.equal(workStatus(session({ answer: 'Proceed?', waitingOnYou: false })).attention, false);
  assert.equal(workStatus(session({ answer: 'Proceed?' })).attention, true);
  assert.equal(workStatus(session({ answer: 'Proceed?', replies: [bot, user] })).attention, false);
  assert.equal(workStatus(session({ answer: 'Proceed?', waitingOnYou: true, replies: [bot, user] })).kind, 'waiting');
  assert.equal(workStatus(session({ status: 'running', waitingOnYou: false, blocker: 'sign_in' })).attention, true);
});

test('quiet flag precedence suppresses attention but retains raw execution and reservations', () => {
  const contradictory = { status: 'running', dismissed: true, replacedBy: 'new-task', blocker: 'sign_in', hermesHelpId: 'help', hermesTurn: 'turn', screenSlot: 0, askWhere: true, waitingOnYou: true };
  for (const patch of [contradictory, { ...contradictory, replacedBy: undefined }]) {
    const view = workStatus(session(patch));
    assert.equal(view.kind, patch.replacedBy ? 'superseded' : 'dismissed');
    assert.equal(view.attention, false);
    assert.equal(view.execution, 'running');
    assert.match(view.resourceWarning, /Raw execution: running.*reservation may remain/);
    assert.equal(view.canDelete, false);
    assert.equal(view.canStop, true);
  }
  assert.equal(workStatus(session({ dismissed: true })).resourceWarning, '');
});

test('current stop reasons win over stale help without hiding ordinary failures', () => {
  for (const error of ['Stopped by you', 'Stopped: computer reset', 'Paused by QA Lead', 'Paused while you took over']) {
    const view = workStatus(session({ status: 'failed', error, blocker: 'sign_in', hermesHelpId: 'stale' }));
    assert.equal(view.kind, 'stopped');
    assert.equal(view.attention, false);
    assert.match(view.resourceWarning, /reservation may remain/);
  }
  assert.equal(workStatus(session({ status: 'failed', error: 'Computer automation is paused by an unavailable service' })).kind, 'failed');
  assert.equal(workStatus(session({ status: 'failed', error: 'Network unavailable' })).attention, true);
  assert.equal(workStatus(session({ status: 'failed', error: 'Network unavailable', replies: [bot, user] })).attention, false);
});

test('ended work requires actual recorded answer text, not a completion or review flag', () => {
  const empty = workStatus(session({ coordinationReviewed: true }));
  assert.equal(empty.text, 'Task ended · no result recorded');
  assert.equal(empty.review, 'Review claimed · outcome unknown');
  for (const patch of [{ answer: 'Recorded answer' }, { replies: [bot] }]) {
    assert.equal(workStatus(session(patch)).text, 'Task ended · Result available');
  }
  for (const patch of [{ answer: '  ' }, { replies: [user] }, { replies: [{ ...bot, note: 'handoff' }] }]) {
    assert.equal(workStatus(session(patch)).hasResult, false);
  }
  const orphan = workStatus(session({ hermesTurn: 'orphaned-turn', screenSlot: 0 }));
  assert.equal(orphan.canDelete, false);
  assert.equal(orphan.canStop, false); // Existing API requires a live task or checkpoint.
  assert.match(orphan.resourceWarning, /reservation may remain/);
  assert.equal(workStatus(session({})).review, 'Review outcome unknown');
});

test('presentation is independent of computer, agent, visibility and team leadership; never mutates state', () => {
  for (const botId of ['bapi', 'lead', 'hidden-specialist', 'sales-team']) {
    const s = session({ botId, blocker: 'sign_in', runtime: 'hermes', computerId: 'different-computer', replies: [bot, user] });
    const before = JSON.stringify(s);
    assert.equal(workStatus(s).kind, 'checkpoint');
    assert.equal(JSON.stringify(s), before);
  }
});

test('one-off routine dispatch never implies a completed task or delivered reminder', () => {
  const routine = patch => ({ id: 'routine', botId: 'specialist', title: 'One-off', goal: 'Goal', schedule: { kind: 'once', at: 200 }, enabled: false, ...patch });
  assert.equal(routineStatus(routine({}), 100).label, 'Paused');
  assert.equal(routineStatus(routine({}), 100).detail, 'no recorded dispatch');
  assert.equal(routineStatus(routine({ lastRunAt: 0 }), 100).label, 'Triggered');
  assert.equal(routineStatus(routine({ lastRunAt: 0 }), 100).detail, 'outcome unlinked');
  assert.equal(routineStatus(routine({ lastRunAt: 0, reminder: true }), 100).detail, 'delivery unverified');
  assert.equal(routineStatus(routine({ enabled: true, nextRunAt: 200 }), 100).label, 'Scheduled');
  assert.equal(routineStatus(routine({ enabled: true, nextRunAt: 100 }), 100).label, 'Due');
  const r = routine({ enabled: true }); const before = JSON.stringify(r);
  assert.equal(routineStatus(r, 100).detail, 'next run unavailable');
  assert.equal(JSON.stringify(r), before);
  assert.equal(routineStatus(routine({ schedule: { kind: 'daily', time: '09:00' }, lastRunAt: 1 }), 100).label, 'Paused');
});
