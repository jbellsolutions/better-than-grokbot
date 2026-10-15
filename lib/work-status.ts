import { live, type Blocker, type Routine, type Session } from "./types";

const checkpointLabels: Record<Blocker, string> = {
  sign_in: "Needs sign-in", two_factor: "Needs verification", captcha: "Needs verification",
  payment: "Needs approval", error: "Needs help",
};

/** Presentation only. These flags never cancel a worker or release a screen. */
export function workStatus(s: Session) {
  const executing = live(s);
  const occupied = !!s.hermesTurn || s.screenSlot !== undefined || !!s.codexTurn || !!s.macPending;
  const hasResult = !!s.answer?.trim() || s.replies.some(r => r.role === "bot" && !r.note && !!r.text.trim());
  const stopped = s.status === "failed" && /^(?:Stopped by you\b|Stopped:|Paused by\b|Paused while you took over\b)/i.test(s.error ?? "");
  const checkpoint = s.blocker && Object.hasOwn(checkpointLabels, s.blocker) ? s.blocker : undefined;
  const lastUser = s.replies.findLast(r => r.role === "user");
  const lastBot = s.replies.findLast(r => r.role === "bot");
  const answered = !!lastUser && (!lastBot || lastUser.at > lastBot.at);
  const quiet = !!s.replacedBy || !!s.dismissed || stopped;
  let kind: "superseded" | "dismissed" | "stopped" | "checkpoint" | "uncertain" | "location" | "queued" | "starting" | "running" | "waiting" | "failed" | "ended";
  let label: string;
  let attention = false;
  if (s.replacedBy) { kind = "superseded"; label = "Superseded"; }
  else if (s.dismissed) { kind = "dismissed"; label = "Dismissed"; }
  else if (stopped) { kind = "stopped"; label = "Stopped"; }
  else if (checkpoint) { kind = "checkpoint"; label = checkpointLabels[checkpoint]; attention = true; }
  else if (s.hermesHelpId) { kind = "uncertain"; label = "Checkpoint uncertain"; attention = true; }
  else if (s.askWhere && executing) { kind = "location"; label = "Needs location choice"; attention = true; }
  else if (executing) {
    kind = s.status as "queued" | "starting" | "running";
    label = { queued: "Queued", starting: "Starting", running: "Working" }[kind];
    attention = s.waitingOnYou === true;
  } else if (s.status === "done") {
    // Explicit owner-wait metadata wins. Legacy punctuation inference is only conversational.
    attention = s.waitingOnYou ?? (!answered && (s.answer ?? "").trim().endsWith("?"));
    kind = attention ? "waiting" : "ended";
    label = attention ? "Waiting for your answer" : "Task ended";
  } else { kind = "failed"; label = "Failed"; attention = !!s.error && !answered; }
  const detail = kind === "ended" ? hasResult ? "Result available" : "no result recorded"
    : executing && s.queueReason ? s.queueReason : "";
  const attentionLabel = attention && executing && !["checkpoint", "uncertain", "location"].includes(kind) ? "Waiting for your answer" : "";
  const resourceWarning = (quiet && (executing || occupied || s.hermesHelpId)) || (!executing && occupied && !s.hermesHelpId)
    ? `Raw execution: ${s.status}${occupied || s.hermesHelpId ? " · computer reservation may remain" : ""}` : "";
  return {
    kind, label, detail, attention, attentionLabel, checkpoint, hasResult,
    text: [label, detail, attentionLabel].filter(Boolean).join(" · "),
    execution: s.status, resourceWarning,
    // Match the existing Stop endpoint. An orphaned turn without help cannot be stopped here.
    canStop: executing || !!s.hermesHelpId || !!s.codexTurn || !!s.macPending,
    canDelete: !executing && !occupied && !s.hermesHelpId,
    review: s.coordinationReviewed ? "Review claimed · outcome unknown" : "Review outcome unknown",
  };
}

/** Dispatch metadata is not a recorded task result or verified reminder delivery. */
export function routineStatus(r: Routine, now = Date.now()) {
  if (!r.enabled) {
    if (r.schedule.kind !== "once") return { label: "Paused", detail: "" };
    if (r.lastRunAt === undefined) return { label: "Paused", detail: "no recorded dispatch" };
    return r.reminder ? { label: "Reminder triggered", detail: "delivery unverified" }
      : { label: "Triggered", detail: "outcome unlinked" };
  }
  return { label: r.nextRunAt !== undefined && r.nextRunAt <= now ? "Due" : "Scheduled", detail: r.nextRunAt === undefined ? "next run unavailable" : "" };
}
