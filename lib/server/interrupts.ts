import "server-only";
import type { AppApproval, ChannelPlace, MacApproval } from "@/lib/types";
import { bot, getState, ownerName } from "./store";
import { openRun, startRun, taskRun } from "./turn-events";
import { approvalFields } from "@/lib/turn-text";

/**
 * Approvals as AG-UI interrupts. A bot asking the user before an app action (composio.ts askOwner),
 * an email (mail.ts) or Codex asking on the Mac (codex.ts) puts a CUSTOM "on_interrupt" event in
 * the run that asked, shaped like OpenBot's confirm_write interrupt (MIT, CopilotKit/OpenBot,
 * server/src/delivery/opentag.ts), so any AG-UI client can show it as a card. The answer comes back
 * as a new run carrying forwardedProps.command.resume = { [interruptId]: { confirmed, always?, by } },
 * or as a click on the web card or the Slack card: all of them end in answerApp (or Codex's answer),
 * the one place a decision is applied. The decision then runs as its own run in the same chat, so
 * the web chat and Slack see the action happen and how it ended.
 */

/** An interrupt's id: its approval's UUID without the dashes (32 hex). */
export const interruptIdOf = (approvalId: string) => approvalId.replaceAll("-", "").toLowerCase();
export const approvalIdOf = (interruptId: string) =>
  `${interruptId.slice(0, 8)}-${interruptId.slice(8, 12)}-${interruptId.slice(12, 16)}-${interruptId.slice(16, 20)}-${interruptId.slice(20)}`;
export const isInterruptId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);

export type ConfirmWrite = {
  __opentag_interrupt_id__: string;
  __copilotkit_interrupt_value__: {
    action: "confirm_write";
    args: { action: string; approver: string; effect: "write" | "destructive"; fields: { label: string; value: string }[]; allow_always: boolean };
  };
};

/** The interrupt for an approval: the action, who decides, what it does, up to 10 redacted fields. */
export function confirmWriteInterrupt(i: { approvalId: string; action: string; approver: string; effect: "write" | "destructive"; fields: { label: string; value: string }[]; allowAlways: boolean }): ConfirmWrite {
  return {
    __opentag_interrupt_id__: interruptIdOf(i.approvalId),
    __copilotkit_interrupt_value__: { action: "confirm_write", args: { action: i.action, approver: i.approver, effect: i.effect, fields: i.fields.slice(0, 10), allow_always: i.allowAlways } },
  };
}

const clip = (s: string, max = 300) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

type Pending = { chatId: string; botId?: string; channel?: ChannelPlace; sessionId?: string; title: string; outcome?: Promise<string> };
const g = globalThis as unknown as { __bopsInterrupts?: Map<string, Pending> };
const pending = (g.__bopsInterrupts ??= new Map<string, Pending>());

const chatOf = (a: { chatId?: string; sessionId?: string }) => a.chatId ?? getState().sessions.find((s) => s.id === a.sessionId)?.chatId;
const channelOf = (sessionId?: string) => getState().sessions.find((s) => s.id === sessionId)?.channelBack;

/** Put an approval in the run that asked (its task's, or the chat turn's), or a run of its own. */
function raise(approvalId: string, a: { botId?: string; chatId?: string; sessionId?: string }, title: string, value: ConfirmWrite) {
  const chatId = chatOf(a);
  if (!chatId) return;
  const own = (a.sessionId && taskRun(a.sessionId)) || openRun(chatId, a.botId, "chat");
  const run = own ?? startRun({ chatId, botId: a.botId, kind: "approval", sessionId: a.sessionId, channel: channelOf(a.sessionId) });
  pending.set(approvalId, { chatId, botId: a.botId, channel: run.channel ?? channelOf(a.sessionId), sessionId: a.sessionId, title });
  run.custom("on_interrupt", value);
  if (!own) run.finish();
}

/** The turn stream is a view: a failure in it never stops an approval or a decision. */
function quietly(what: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.warn(`[interrupts] ${what}: ${(e as Error).message}`);
  }
}

export function interruptApp(a: AppApproval) {
  quietly("app approval", () => raiseApp(a));
}
function raiseApp(a: AppApproval) {
  const name = bot(a.botId)?.name ?? "A bot";
  raise(a.id, a, a.title, confirmWriteInterrupt({ approvalId: a.id, action: `${name}: ${a.title}`, approver: ownerName(), effect: a.effect ?? "write", fields: approvalFields(a.detail), allowAlways: !!a.allowAlways }));
}

export function interruptMac(a: MacApproval) {
  quietly("Mac approval", () => raiseMac(a));
}
function raiseMac(a: MacApproval) {
  const name = (a.botId && bot(a.botId)?.name) || "A bot";
  const title = a.kind === "app" && a.app ? `Use ${a.app} on your Mac` : a.message;
  raise(a.id, a, title, confirmWriteInterrupt({ approvalId: a.id, action: `${name}: ${clip(title, 160)}`, approver: ownerName(), effect: a.kind === "command" ? "destructive" : "write", fields: a.kind === "app" ? [{ label: "App", value: a.app ?? "" }] : [{ label: "Request", value: clip(a.message) }], allowAlways: a.kind === "app" }));
}

/** What the approved action came to, once it ran (so its decision run can say how it ended). */
export function noteOutcome(approvalId: string, outcome: Promise<string>) {
  const p = pending.get(approvalId);
  if (p) p.outcome = outcome;
}

export const pendingInterrupt = (approvalId: string) => pending.get(approvalId);

/**
 * A decision was applied (answerApp, Codex's answer): it runs as its own run in the chat, so the
 * web chat and Slack see what was decided, by whom, and how the action went.
 */
export function decided(approvalId: string, d: { confirmed: boolean; always?: boolean; by?: string }) {
  quietly("decision", () => runDecision(approvalId, d));
}
function runDecision(approvalId: string, d: { confirmed: boolean; always?: boolean; by?: string }) {
  const p = pending.get(approvalId);
  if (!p) return;
  pending.delete(approvalId);
  const run = startRun({ chatId: p.chatId, botId: p.botId, kind: "resume", sessionId: p.sessionId, channel: p.channel });
  const interruptId = interruptIdOf(approvalId);
  run.custom("bops.decision", { interruptId, confirmed: d.confirmed, always: !!d.always, by: d.by, title: p.title });
  if (!d.confirmed) return run.finish({ text: "declined" });
  const tool = `${interruptId}:action`;
  run.tool(tool, "approved_action", p.title);
  if (!p.outcome) {
    run.toolDone(tool, "done");
    return run.finish({ text: "done" });
  }
  void p.outcome.then(
    (out) => {
      const failed = /^(Failed|Tool failed|Not approved)/.test(out) || /\bdidn'?t go\b/i.test(out);
      run.toolDone(tool, failed ? "failed" : "done");
      run.finish({ text: failed ? `failed: ${clip(out.replace(/^Failed:\s*/, ""), 200)}` : "done" });
    },
    (e: Error) => {
      run.toolDone(tool, "failed");
      run.finish({ text: `failed: ${clip(e.message, 200)}` });
    },
  );
}

/**
 * An AG-UI resume (forwardedProps.command.resume), as OpenBot's resumeFromInput reads it: exactly one
 * interrupt id and its answer. Null when the input isn't a resume.
 */
export function resumeFromInput(input: unknown) {
  const props = (input as { forwardedProps?: unknown } | null)?.forwardedProps;
  const command = props && typeof props === "object" ? (props as { command?: unknown }).command : undefined;
  if (!command || typeof command !== "object" || !("resume" in command)) return null;
  const resume = (command as { resume?: unknown }).resume;
  const entries = resume && typeof resume === "object" ? Object.entries(resume) : [];
  if (entries.length !== 1) return { invalid: true as const };
  const [interruptId, value] = entries[0];
  const v = value as { confirmed?: unknown; always?: unknown; by?: unknown } | null;
  if (!isInterruptId(interruptId) || !v || typeof v.confirmed !== "boolean" || (v.always !== undefined && typeof v.always !== "boolean") || (v.by !== undefined && (typeof v.by !== "string" || v.by.length > 512)))
    return { invalid: true as const };
  return { invalid: false as const, interruptId, confirmed: v.confirmed, always: v.always === true, by: v.by as string | undefined };
}

/**
 * Apply a decision on an interrupt: an app approval (answerApp) or one of Codex's (its answer).
 * Returns false when nothing is waiting under that id (already decided, or not this server's).
 */
export async function decideInterrupt(interruptId: string, d: { confirmed: boolean; always?: boolean; by?: string }) {
  const state = getState();
  const app = state.appApprovals?.find((a) => interruptIdOf(a.id) === interruptId);
  if (app) {
    const { answerApp } = await import("./composio");
    return answerApp(app.id, d.confirmed, { always: d.always, by: d.by });
  }
  const mac = state.mac?.approvals.find((a) => interruptIdOf(a.id) === interruptId);
  if (mac) {
    const { answer } = await import("./codex");
    return answer(mac.id, !d.confirmed ? "deny" : d.always && mac.kind === "app" ? "always" : "once", d.by);
  }
  return false;
}
