import "server-only";
import { randomUUID } from "node:crypto";
import { EventType, type BaseEvent } from "@ag-ui/core";
import type { ChannelPlace, Session } from "@/lib/types";

/**
 * The turn stream: what a bot is doing right now, as AG-UI events (the @ag-ui/core types; no
 * service). A chat turn (lib/server/chat.ts), a task (lib/server/sessions.ts) and a decision on an
 * approval each run as one AG-UI run, threaded by the chat it belongs to. The web chat reads them
 * from /api/chat/<chat>/stream; the Slack renderer (lib/server/slack-render.ts) from onTurnEvent.
 *
 * Events live in memory only, per run, so a page that reconnects mid-answer gets the run replayed
 * and then follows it live. Nothing here is saved: the finished answer is saved once, as the chat's
 * Message (with this run's id, so it replaces the provisional text), never a write per token.
 * A finished run stays a little while for reconnects, then goes.
 */

export type TurnEvent = BaseEvent & Record<string, unknown>;
/** An event, numbered in the order this server made it (the SSE id a reconnect resumes from). */
export type Stamped = { seq: number; runId: string; chatId: string; event: TurnEvent };
export type RunInfo = {
  runId: string;
  chatId: string;
  botId?: string;
  kind: "chat" | "task" | "approval" | "resume";
  /** The task a task run is (or the approval's task, for a decision). */
  sessionId?: string;
  /** Where in Slack, Telegram or Discord the request came from: the reply goes back there. */
  channel?: ChannelPlace;
  /** A task's title, for a status line. */
  title?: string;
  startedAt: number;
  endedAt?: number;
};
type Run = RunInfo & { events: Stamped[]; text?: { id: string; n: number }; texts: number; step?: string; tools: Set<string> };
type Listener = (e: Stamped, run: RunInfo) => void;

/** How long a finished run stays for a reconnect, and how many events a run keeps for one. */
const RETAIN_MS = 2 * 60_000;
const MAX_EVENTS = 20_000;

// One registry per server process, whatever bundle a route was built into (like the store's state).
// `boot` names this process: an event id from before a restart means nothing to it.
const g = globalThis as unknown as { __bopsTurns?: { boot: string; seq: number; runs: Map<string, Run>; listeners: Set<Listener>; tasks: Map<string, string> } };
const box = (g.__bopsTurns ??= { boot: randomUUID().slice(0, 8), seq: 0, runs: new Map<string, Run>(), listeners: new Set<Listener>(), tasks: new Map<string, string>() });

/** An event's id on the wire (SSE `id:`), and back: the seq, or undefined for another process's id. */
export const eventId = (seq: number) => `${box.boot}-${seq}`;
export function seqOf(id: string | null | undefined) {
  const m = id ? /^([0-9a-f]{8})-(\d{1,15})$/.exec(id) : null;
  return m && m[1] === box.boot && Number(m[2]) <= box.seq ? Number(m[2]) : undefined;
}
export const currentSeq = () => box.seq;

function prune(now = Date.now()) {
  for (const [id, r] of box.runs) if (r.endedAt && now - r.endedAt > RETAIN_MS) box.runs.delete(id);
}

/** Each event says which run (and bot, and task) it's from in AG-UI's opaque `metadata`. */
function push(run: Run, event: { type: EventType } & Record<string, unknown>, extra?: Record<string, unknown>) {
  const metadata = { runId: run.runId, kind: run.kind, ...(run.botId ? { botId: run.botId } : {}), ...(run.sessionId ? { sessionId: run.sessionId } : {}), ...extra };
  const stamped: Stamped = { seq: ++box.seq, runId: run.runId, chatId: run.chatId, event: { ...event, timestamp: Date.now(), metadata } as TurnEvent };
  if (run.events.length < MAX_EVENTS) run.events.push(stamped);
  for (const listen of box.listeners) {
    try {
      listen(stamped, run);
    } catch (e) {
      console.warn(`[turn-events] ${(e as Error).message}`);
    }
  }
  return stamped;
}

/** One run's events as they're made: text in pieces, tools around their work, steps, and how it ended. */
export class TurnRun {
  constructor(private run: Run) {}
  get runId() { return this.run.runId; }
  get chatId() { return this.run.chatId; }
  get channel() { return this.run.channel; }
  get ended() { return !!this.run.endedAt; }

  /** A piece of the answer. The first piece of a round opens a text message; endText closes it. */
  text(delta: string) {
    if (!delta || this.ended) return;
    if (!this.run.text) {
      const id = `${this.run.runId}:t${++this.run.texts}`;
      this.run.text = { id, n: 0 };
      push(this.run, { type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" });
    }
    this.run.text.n += delta.length;
    push(this.run, { type: EventType.TEXT_MESSAGE_CONTENT, messageId: this.run.text.id, delta });
  }
  endText() {
    if (!this.run.text) return;
    push(this.run, { type: EventType.TEXT_MESSAGE_END, messageId: this.run.text.id });
    this.run.text = undefined;
  }
  /** A tool starts. Only its name and a plain label go out, never its arguments. */
  tool(toolCallId: string, toolCallName: string, label: string) {
    if (this.ended || this.run.tools.has(toolCallId)) return;
    this.endText();
    this.run.tools.add(toolCallId);
    push(this.run, { type: EventType.TOOL_CALL_START, toolCallId, toolCallName }, { label });
  }
  /** A tool ended: "done", "failed" or "waiting" (for the user's approval). */
  toolDone(toolCallId: string, status: "done" | "failed" | "waiting") {
    if (!this.run.tools.delete(toolCallId)) return;
    push(this.run, { type: EventType.TOOL_CALL_END, toolCallId });
    push(this.run, { type: EventType.TOOL_CALL_RESULT, messageId: `${toolCallId}:result`, toolCallId, content: status, role: "tool" });
  }
  /** What a task is doing now ("searching"), as a step: the one before it ends. */
  step(stepName: string) {
    if (this.ended || stepName === this.run.step) return;
    if (this.run.step) push(this.run, { type: EventType.STEP_FINISHED, stepName: this.run.step });
    this.run.step = stepName;
    push(this.run, { type: EventType.STEP_STARTED, stepName });
  }
  custom(name: string, value: unknown) {
    if (!this.ended) push(this.run, { type: EventType.CUSTOM, name, value });
  }
  private close() {
    this.endText();
    for (const id of [...this.run.tools]) this.toolDone(id, "failed");
    if (this.run.step) push(this.run, { type: EventType.STEP_FINISHED, stepName: this.run.step });
    this.run.step = undefined;
  }
  /** The run is over. `messageId`: the saved Message that replaces its provisional text, if any. */
  finish(result: { messageId?: string; text?: string } = {}) {
    if (this.ended) return;
    this.close();
    push(this.run, { type: EventType.RUN_FINISHED, threadId: this.run.chatId, runId: this.run.runId, result });
    this.run.endedAt = Date.now();
    if (this.run.sessionId && box.tasks.get(this.run.sessionId) === this.run.runId) box.tasks.delete(this.run.sessionId);
    prune();
  }
  fail(message: string) {
    if (this.ended) return;
    this.close();
    push(this.run, { type: EventType.RUN_ERROR, message });
    this.run.endedAt = Date.now();
    if (this.run.sessionId && box.tasks.get(this.run.sessionId) === this.run.runId) box.tasks.delete(this.run.sessionId);
    prune();
  }
}

export function startRun(info: Omit<RunInfo, "runId" | "startedAt"> & { runId?: string }) {
  prune();
  const run: Run = { ...info, runId: info.runId ?? randomUUID(), startedAt: Date.now(), events: [], texts: 0, tools: new Set() };
  box.runs.set(run.runId, run);
  push(run, { type: EventType.RUN_STARTED, threadId: run.chatId, runId: run.runId });
  return new TurnRun(run);
}

/** A run that's still going, by id. */
export function liveRun(runId: string) {
  const r = box.runs.get(runId);
  return r && !r.endedAt ? new TurnRun(r) : undefined;
}

/** The newest unfinished run in a chat (for a bot, if given). */
export function openRun(chatId: string, botId?: string, kind?: RunInfo["kind"]) {
  const r = [...box.runs.values()].reverse().find((x) => !x.endedAt && x.chatId === chatId && (!botId || x.botId === botId) && (!kind || x.kind === kind));
  return r ? new TurnRun(r) : undefined;
}

export const runInfo = (runId: string): RunInfo | undefined => box.runs.get(runId);

/**
 * Every event from now on (the Slack renderer), or a chat's: first what it missed, then live. With
 * `after` (the last event id a reconnecting page saw), the events since; without, the runs still
 * going, from their start (a finished run's answer is already in the chat).
 */
export function onTurnEvent(listener: Listener, opts?: { chatId: string; after?: number }) {
  if (opts) {
    const runs = [...box.runs.values()].filter((r) => r.chatId === opts.chatId && (opts.after !== undefined || !r.endedAt));
    const missed = runs.flatMap((r) => r.events.filter((e) => e.seq > (opts.after ?? 0)).map((e) => [e, r] as const)).sort((a, b) => a[0].seq - b[0].seq);
    for (const [e, r] of missed) listener(e, r);
  }
  const live: Listener = opts ? (e, r) => e.chatId === opts.chatId && listener(e, r) : listener;
  box.listeners.add(live);
  return () => void box.listeners.delete(live);
}

/* ---------------- Tasks ---------------- */

/** A task's current run, if it's running. */
export function taskRun(sessionId: string) {
  const id = box.tasks.get(sessionId);
  return id ? liveRun(id) : undefined;
}

/**
 * A task changed (store.patchSession): when it starts working its run starts, its activity is the
 * current step, and when it ends (done, failed, stopped, or waiting on the user) its run ends.
 */
export function noteSession(s: Session, before: { status: Session["status"]; activity?: string; blocker?: Session["blocker"] }) {
  try {
    sessionChanged(s, before);
  } catch (e) {
    console.warn(`[turn-events] ${(e as Error).message}`);
  }
}
function sessionChanged(s: Session, before: { status: Session["status"]; activity?: string; blocker?: Session["blocker"] }) {
  const working = s.status === "starting" || s.status === "running";
  let run = taskRun(s.id);
  if (working && !run) {
    run = startRun({ chatId: s.chatId, botId: s.botId, kind: "task", sessionId: s.id, channel: s.channelBack, title: s.title });
    box.tasks.set(s.id, run.runId);
  }
  if (!run) return;
  if (working && s.activity && s.activity !== before.activity) run.step(s.activity);
  if (s.blocker && s.blocker !== before.blocker) run.custom("bops.blocked", { sessionId: s.id, blocker: s.blocker });
  if (s.status === before.status || working || s.status === "queued") return;
  if (s.status === "failed") run.fail(s.error ?? "The task failed.");
  else run.finish({ text: s.answer });
}

/** A task step (sessions.ts step()): a tool it used, as a finished tool call; other steps as text it's working through. */
export function noteTaskStep(sessionId: string, kind: string, detail: string) {
  const run = taskRun(sessionId);
  if (!run) return;
  try {
    taskStep(run, sessionId, kind, detail);
  } catch (e) {
    console.warn(`[turn-events] ${(e as Error).message}`);
  }
}
function taskStep(run: TurnRun, sessionId: string, kind: string, detail: string) {
  if (kind === "text") return run.custom("bops.progress", { sessionId, text: detail.slice(0, 500) });
  const id = `${sessionId}:${randomUUID().slice(0, 8)}`;
  run.tool(id, kind, kind === "setup" ? detail : detail.replace(/\s*·\s*/g, ": ").slice(0, 120));
  run.toolDone(id, "done");
}
