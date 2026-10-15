import "server-only";
import { EventType } from "@ag-ui/core";
import type { ChannelLink, ChannelPlace } from "@/lib/types";
import { provisionalText } from "@/lib/turn-text";
import { channelLink, slackIdentityOf, slackPostAs, slackThreadOf } from "./channels";
import { instanceId } from "./instance";
import { approvalIdOf, decideInterrupt, isInterruptId, pendingInterrupt, type ConfirmWrite } from "./interrupts";
import { isOwnSlack, SLACK_API, slackCall, SlackError } from "./slack-api";
import { bot, getState, ownerName } from "./store";
import { onTurnEvent, type RunInfo, type Stamped, type TurnEvent } from "./turn-events";

/**
 * A bot's turn drawn live in Slack, from the turn stream (turn-events.ts) of runs that came from
 * Slack (their ChannelPlace), under the bot's own name and picture:
 *
 * - At once, the thread's status ("is thinking…": assistant.threads.setStatus, or the agent
 *   session's), else a 👀 on the message (an app without those, Composio's).
 * - The answer as it's written: one message, posted with the first words and edited at most every
 *   0.8 seconds (EDIT_MS), with the tools it's using on a line under it. With BOPS_SLACK_STREAM=native,
 *   Slack's own streaming (chat.startStream), tools as task cards.
 * - The saved answer replaces it, in Block Kit: sections, a table as Slack's own table, split where
 *   Slack's limits say. Its message id is noted (slackDrawn), so channels.ts doesn't post it again.
 * - A task (work started from Slack): one status line, edited as it goes; its result comes after
 *   (channels.ts channelResult).
 * - An approval: a card with Allow once / Always allow / Deny. Only the paired person decides, so in a
 *   channel the card goes to their direct message, with a line in the thread; so does a task stuck on
 *   them. The click (slackAction) applies the decision, the card says who decided, and how the action
 *   went is said in the thread.
 */

const EDIT_MS = 800;
const NATIVE_MS = 250;
/** Slack ends a stream after about 5m20s: a new one starts before that. */
const SEAL_MS = 5 * 60_000;
const CURSOR = " ▍";
/** Block Kit: blocks in a message, characters in a section, table rows and cells. */
const MAX_BLOCKS = 50;
const SECTION_MAX = 2900;
const TABLE_ROWS = 100;
const TABLE_COLS = 20;

type Tool = { id: string; label: string; status: "running" | "done" | "failed" | "waiting" };
type Draw = {
  run: RunInfo;
  link: ChannelLink;
  place: ChannelPlace;
  account: string;
  chat: string;
  thread?: string;
  text: string;
  tools: Tool[];
  /** A task's steps and tools, in order. */
  trail: { id?: string; label: string; status: "running" | "done" | "failed" }[];
  progress?: string;
  /** The live message, and what it shows. */
  ts?: string;
  painted?: string;
  lastEdit: number;
  every: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Slack calls for this run, one at a time, in order. */
  chain: Promise<unknown>;
  status?: "assistant" | "session" | "reaction";
  native?: { ts: string; at: number; sent: string; tools: Map<string, string> };
  ended?: "done" | "failed";
};
type Card = { account: string; channel: string; ts: string; args: ConfirmWrite["__copilotkit_interrupt_value__"]["args"] };

const g = globalThis as unknown as {
  __bopsSlackDraw?: { started: boolean; draws: Map<string, Draw>; drawn: Map<string, Promise<boolean>>; cards: Map<string, Card>; ways: Map<string, Draw["status"]> };
};
const box = (g.__bopsSlackDraw ??= { started: false, draws: new Map(), drawn: new Map(), cards: new Map(), ways: new Map() });

/** Whether a saved answer was posted by the renderer (resolves once it's there: false if that failed). */
export const slackDrawn = (messageId: string) => box.drawn.get(messageId);

export function startSlackRenderer() {
  if (box.started) return;
  box.started = true;
  onTurnEvent((e, run) => take(e, run));
}

const native = (d: Draw) => process.env.BOPS_SLACK_STREAM === "native" && isOwnSlack(d.account) && !!d.thread && d.run.kind === "chat";
const who = (d: Draw) => {
  const b = bot(d.link.botId);
  return b ? slackIdentityOf(b, d.account) : {};
};

function take(e: Stamped, run: RunInfo) {
  const ev = e.event as TurnEvent & { delta?: string; toolCallId?: string; toolCallName?: string; content?: string; stepName?: string; name?: string; value?: unknown; result?: { messageId?: string; text?: string }; message?: string; metadata?: { label?: string } };
  let d = box.draws.get(run.runId);
  if (!d) {
    // Only runs from Slack, seen from their start.
    if (ev.type !== EventType.RUN_STARTED || !run.channel) return;
    const link = channelLink(run.channel.linkId);
    if (link?.kind !== "slack" || !link.slack) return;
    d = { run, link, place: run.channel, account: link.slack.accountId, chat: run.channel.chat, thread: slackThreadOf(link, run.channel), text: "", tools: [], trail: [], lastEdit: 0, every: EDIT_MS, chain: Promise.resolve() };
    box.draws.set(run.runId, d);
  }
  const draw = d;
  switch (ev.type) {
    case EventType.RUN_STARTED:
      if (run.kind === "chat" || run.kind === "task") queue(draw, () => showStatus(draw));
      if (run.kind === "task") soon(draw);
      return;
    case EventType.TEXT_MESSAGE_START:
      // A new round of the answer replaces the last, as on the web.
      if (run.kind === "chat") draw.text = "";
      return;
    case EventType.TEXT_MESSAGE_CONTENT:
      draw.text += ev.delta ?? "";
      return soon(draw);
    case EventType.TOOL_CALL_START:
      if (ev.toolCallId && !draw.tools.some((t: Tool) => t.id === ev.toolCallId)) {
        const label = ev.metadata?.label ?? ev.toolCallName ?? "Working";
        draw.tools.push({ id: ev.toolCallId, label, status: "running" });
        draw.trail.push({ id: ev.toolCallId, label, status: "running" });
      }
      return soon(draw);
    case EventType.TOOL_CALL_RESULT: {
      const status = (["done", "failed", "waiting"].includes(ev.content ?? "") ? ev.content : "done") as Tool["status"];
      for (const t of draw.tools) if (t.id === ev.toolCallId) t.status = status;
      for (const t of draw.trail) if (t.id === ev.toolCallId) t.status = status === "failed" ? "failed" : status === "waiting" ? "running" : "done";
      return soon(draw);
    }
    case EventType.STEP_STARTED:
      for (const t of draw.trail) if (!t.id && t.status === "running") t.status = "done";
      if (ev.stepName) draw.trail.push({ label: ev.stepName, status: "running" });
      return soon(draw);
    case EventType.CUSTOM:
      if (ev.name === "on_interrupt") queue(draw, () => postCard(draw, ev.value as ConfirmWrite));
      else if (ev.name === "bops.decision") queue(draw, () => showDecision(ev.value as { interruptId: string; confirmed: boolean; always: boolean; by?: string }));
      else if (ev.name === "bops.progress") {
        draw.progress = String((ev.value as { text?: string })?.text ?? "").slice(0, 300);
        soon(draw);
      } else if (ev.name === "bops.blocked") queue(draw, () => ownerOnly(draw, `${bot(draw.link.botId)?.name ?? "Your bot"} needs you: ${String((ev.value as { blocker?: string })?.blocker ?? "").slice(0, 1500)}`));
      return;
    case EventType.RUN_FINISHED:
      return finish(draw, ev.result);
    case EventType.RUN_ERROR:
      draw.ended = "failed";
      if (draw.timer) clearTimeout(draw.timer);
      queue(draw, async () => {
        if (draw.run.kind === "chat") draw.text = `${provisionalText(draw.text)}\n\n_That didn't finish: ${ev.message ?? "something went wrong"}_`.trim();
        if (draw.run.kind === "chat" || draw.run.kind === "task") await (draw.native ? nativeSend(draw, true) : paint(draw, true));
        await clearStatus(draw);
        box.draws.delete(draw.run.runId);
      });
      return;
  }
}

/** One Slack call after another for a run; a failure is logged, never thrown into the turn. */
function queue(d: Draw, fn: () => Promise<unknown>) {
  d.chain = d.chain.then(fn).catch((e: Error) => {
    if (e instanceof SlackError && e.code === "ratelimited") {
      d.every = Math.min(5000, d.every * 2);
      d.lastEdit = Date.now() + (e.retryAfter ?? 1) * 1000 - d.every;
      if (!d.ended) soon(d);
      return;
    }
    console.warn(`[slack-render] ${d.run.kind} ${d.run.runId.slice(0, 8)}: ${e.message}`);
  });
  return d.chain;
}

/** The next edit, no sooner than EDIT_MS after the last (the first one at once). */
function soon(d: Draw) {
  // A decision's run says how the action went once it's over (decisionResult), nothing live.
  if (d.timer || d.ended || (d.run.kind !== "chat" && d.run.kind !== "task")) return;
  if (native(d)) {
    d.timer = setTimeout(() => ((d.timer = undefined), queue(d, () => nativeSend(d))), d.native ? NATIVE_MS : 0);
    return;
  }
  d.timer = setTimeout(() => ((d.timer = undefined), queue(d, () => paint(d))), Math.max(0, d.lastEdit + d.every - Date.now()));
}

/* ---------------- Status ---------------- */

/** "is thinking…" on the thread at once: Slack's thread status, its agent session's, else a reaction. Which works is remembered per kind of conversation. */
async function showStatus(d: Draw) {
  const where = `${d.account}:${d.chat.startsWith("D") ? "dm" : "channel"}`;
  const known = box.ways.get(where);
  const tries: NonNullable<Draw["status"]>[] = known ? [known] : isOwnSlack(d.account) && d.thread ? ["assistant", "session", "reaction"] : ["reaction"];
  for (const way of tries) {
    try {
      if (way === "assistant")
        await slackCall(d.account, "assistant.threads.setStatus", { channel_id: d.chat, thread_ts: d.thread, status: "is thinking…", loading_messages: ["is thinking…", "is working on it…"], ...who(d) });
      else if (way === "session") await slackCall(d.account, "agents.sessions.setStatus", { channel_id: d.chat, thread_ts: d.thread, status: "processing", ...who(d) });
      else if (d.place.messageId) await slackCall(d.account, "reactions.add", { channel: d.chat, timestamp: d.place.messageId, name: "eyes" });
      d.status = way;
      box.ways.set(where, way);
      return;
    } catch (e) {
      if (!(e instanceof SlackError) || e.code === "ratelimited") throw e;
    }
  }
}

async function clearStatus(d: Draw) {
  const was = d.status;
  d.status = undefined;
  if (was === "assistant" && !d.ts) await slackCall(d.account, "assistant.threads.setStatus", { channel_id: d.chat, thread_ts: d.thread, status: "" }).catch(() => {});
  else if (was === "session") await slackCall(d.account, "agents.sessions.setStatus", { channel_id: d.chat, thread_ts: d.thread, status: "active" }).catch(() => {});
  else if (was === "reaction" && d.place.messageId) await slackCall(d.account, "reactions.remove", { channel: d.chat, timestamp: d.place.messageId, name: "eyes" }).catch(() => {});
}

/* ---------------- The live message (edits) ---------------- */

const toolLine = (tools: Tool[]) =>
  tools
    .slice(-4)
    .map((t) => `${t.label}${{ running: "…", done: " ✓", failed: " · failed", waiting: " · waiting for you" }[t.status]}`)
    .join("  ·  ");

/** What the live message shows now: the answer so far (or the task's line) and the tools under it. */
function liveBody(d: Draw, final = false) {
  const blocks: object[] = [];
  let text: string;
  if (d.run.kind === "task") {
    const head = d.ended === "done" ? `✓ Done: ${d.run.title ?? "the task"}` : d.ended === "failed" ? `Stopped: ${d.run.title ?? "the task"}` : `Working on it: ${d.run.title ?? "a task"}`;
    text = head;
    blocks.push(section(`*${esc(head)}*`));
    const line = d.trail
      .slice(-4)
      .map((t) => `${t.label}${t.status === "failed" ? " · failed" : t.status === "done" || d.ended ? " ✓" : "…"}`)
      .join("  ·  ");
    if (line) blocks.push(context(esc(line)));
    if (d.progress && !d.ended) blocks.push(context(esc(d.progress)));
  } else {
    const said = provisionalText(d.text);
    text = said || toolLine(d.tools) || "…";
    for (const part of split(mrkdwn(said), SECTION_MAX)) blocks.push(section(part));
    if (blocks.length && !final) {
      const last = blocks.at(-1) as { text: { text: string } };
      last.text.text += CURSOR;
    }
  }
  if (d.tools.length && d.run.kind !== "task") blocks.push(context(esc(toolLine(d.tools))));
  return { text: text.slice(0, 300), blocks: blocks.slice(0, MAX_BLOCKS) };
}

async function paint(d: Draw, final = false) {
  const body = liveBody(d, final);
  const key = JSON.stringify(body.blocks);
  if (!body.blocks.length || key === d.painted) return;
  if (!d.ts) d.ts = await slackPostAs(d.link, { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}), ...body });
  else await slackCall(d.account, "chat.update", { channel: d.chat, ts: d.ts, ...body });
  d.painted = key;
  d.lastEdit = Date.now();
}

/* ---------------- Slack's own streaming ---------------- */

async function nativeSend(d: Draw, last = false) {
  const text = provisionalText(d.text);
  const chunks: object[] = [];
  const sent = d.native?.tools ?? new Map<string, string>();
  for (const t of d.tools) {
    const status = t.status === "failed" ? "error" : t.status === "done" ? "complete" : "in_progress";
    if (sent.get(t.id) !== status) chunks.push({ type: "task_update", id: t.id.slice(0, 60), title: t.label.slice(0, 250), status });
  }
  // A new round of the answer can't unsay what was streamed: that stream ends, and the round gets its own.
  if (d.native && !text.startsWith(d.native.sent)) await stopNative(d);
  if (d.native && Date.now() - d.native.at > SEAL_MS) await stopNative(d);
  const from = d.native?.sent ?? "";
  if (text.length > from.length) chunks.push({ type: "markdown_text", text: text.slice(from.length) });
  if (chunks.length) {
    if (!d.native) {
      const dm = d.chat.startsWith("D");
      const r = await slackCall<{ ts: string }>(d.account, "chat.startStream", {
        channel: d.chat,
        thread_ts: d.thread,
        chunks,
        ...who(d),
        ...(dm ? {} : { recipient_user_id: d.place.from, recipient_team_id: d.link.slack?.teamId }),
      });
      d.native = { ts: r.ts, at: Date.now(), sent: "", tools: sent };
      d.ts = r.ts;
    } else await slackCall(d.account, "chat.appendStream", { channel: d.chat, ts: d.native.ts, chunks });
    d.native!.sent = text.length > from.length ? text : from;
    for (const t of d.tools) sent.set(t.id, t.status === "failed" ? "error" : t.status === "done" ? "complete" : "in_progress");
  }
  if (last) await stopNative(d);
}

async function stopNative(d: Draw, blocks?: object[]) {
  if (!d.native) return;
  const ts = d.native.ts;
  d.native = undefined;
  await slackCall(d.account, "chat.stopStream", { channel: d.chat, ts, ...(blocks?.length ? { blocks } : {}) });
}

/* ---------------- The end of a run ---------------- */

function finish(d: Draw, result?: { messageId?: string; text?: string }) {
  d.ended = d.ended ?? "done";
  if (d.timer) clearTimeout(d.timer);
  d.timer = undefined;
  const id = d.run.kind === "chat" ? result?.messageId : undefined;
  let settle: (ok: boolean) => void = () => {};
  // Noted now, before channels.ts looks at what the turn said (it waits for this).
  if (id) {
    box.drawn.set(id, new Promise<boolean>((r) => (settle = r)));
    if (box.drawn.size > 2000) box.drawn.delete(box.drawn.keys().next().value!);
  }
  let ok = false;
  void queue(d, async () => {
    try {
      if (d.run.kind === "chat") await finalAnswer(d, id);
      else if (d.run.kind === "task") await paint(d, true);
      else if (d.run.kind === "resume") await decisionResult(d, result?.text);
      ok = true;
    } finally {
      await clearStatus(d);
      box.draws.delete(d.run.runId);
    }
  }).then(() => settle(ok));
}

/** The saved answer, in Block Kit, in place of the live message. */
async function finalAnswer(d: Draw, messageId?: string) {
  const m = messageId ? getState().messages.find((x) => x.id === messageId) : undefined;
  const used = d.tools.length ? [context(esc(`Used: ${d.tools.map((t) => t.label).slice(-6).join(" · ")}`))] : [];
  if (!m?.text.trim()) {
    // Nothing said (a tapback was enough): the line of tools stays, if there was one.
    if (d.native) await stopNative(d);
    else if (d.ts) await (d.tools.length ? slackCall(d.account, "chat.update", { channel: d.chat, ts: d.ts, text: "Done", blocks: used }) : slackCall(d.account, "chat.delete", { channel: d.chat, ts: d.ts }));
    return;
  }
  const parts = slackMessages(m.text, m.options);
  const lastPart = parts.at(-1)!;
  if (used.length && lastPart.blocks.length < MAX_BLOCKS) lastPart.blocks.push(...used);
  if (d.native) {
    // Slack already shows the streamed answer: what it can't stream (tables, choices) goes under it.
    await nativeSend(d);
    const extra = parts.flatMap((p) => p.blocks).filter((b) => (b as { type: string }).type !== "section");
    await stopNative(d, extra.slice(0, MAX_BLOCKS));
    return;
  }
  const where = { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}) };
  const [first, ...rest] = parts;
  if (d.ts) {
    try {
      await slackCall(d.account, "chat.update", { channel: d.chat, ts: d.ts, ...first });
    } catch (e) {
      // An edit can't take every block (a table, in places): then it's posted anew and the draft goes.
      if (!(e instanceof SlackError) || !/invalid_blocks|invalid_arguments/.test(e.code)) throw e;
      await slackPostAs(d.link, { ...where, ...first });
      await slackCall(d.account, "chat.delete", { channel: d.chat, ts: d.ts }).catch(() => {});
    }
  } else await slackPostAs(d.link, { ...where, ...first });
  for (const p of rest) await slackPostAs(d.link, { ...where, ...p });
}

/** How an approved (or declined) action went, said in the thread it came from. */
async function decisionResult(d: Draw, outcome?: string) {
  const title = d.tools[0]?.label ?? "it";
  if (!outcome || outcome === "declined") return;
  const text = outcome === "done" ? `✓ Done: ${title}` : `That didn't go through: ${title}${outcome.startsWith("failed: ") ? `. ${outcome.slice(8)}` : ""}`;
  await slackPostAs(d.link, { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}), text, blocks: [section(esc(text))] });
}

/* ---------------- Approvals ---------------- */

const btn = (text: string, action_id: string, interruptId: string, style?: "primary" | "danger") => ({
  type: "button",
  text: { type: "plain_text", text },
  action_id,
  // Which Bops it's for, and the approval: another instance's click is refused (slackAction).
  value: `${instanceId()}:${interruptId}`,
  ...(style ? { style } : {}),
});

function cardBlocks(a: Card["args"], interruptId: string, decided?: { confirmed: boolean; always?: boolean; by?: string }) {
  const effect = a.effect === "destructive" ? "🔴 Can't be undone" : /\b(send|email|post|message|reply|invite|share)/i.test(a.action) ? "🟠 Sends or posts" : "🟡 Changes something";
  const blocks: object[] = [section(`*${esc(a.action).slice(0, 2900)}*`), context(`${effect}  ·  ${esc(a.approver)} decides`)];
  if (a.fields.length) blocks.push({ type: "section", fields: a.fields.slice(0, 10).map((f) => ({ type: "mrkdwn", text: `*${esc(f.label).slice(0, 100)}*\n${esc(f.value).slice(0, 1800)}` })) });
  if (decided) blocks.push(context(decided.confirmed ? `✅ Approved${decided.always ? ", and always from now on," : ""} by ${esc(decided.by ?? ownerName())}` : `🚫 Denied by ${esc(decided.by ?? ownerName())}`));
  else
    blocks.push({
      type: "actions",
      block_id: `bops_approval_${interruptId}`,
      elements: [btn("Allow once", "bops_approve_once", interruptId, "primary"), ...(a.allow_always ? [btn("Always allow", "bops_approve_always", interruptId)] : []), btn("Deny", "bops_deny", interruptId, "danger")],
    });
  return blocks;
}

/** The person paired's direct message with the app (opened if it isn't known yet). */
async function ownerDm(d: Draw) {
  if (d.link.slack?.dm) return d.link.slack.dm;
  if (!d.link.owner) return undefined;
  const r = await slackCall<{ channel?: { id?: string } }>(d.account, "conversations.open", { users: d.link.owner }).catch(() => null);
  return r?.channel?.id;
}

/** Where only the paired person should see it: here in a direct message; else in theirs, with a line in the thread. */
async function ownerPlace(d: Draw, pointer: string) {
  if (d.chat.startsWith("D")) return { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}) };
  const dm = await ownerDm(d);
  if (!dm) return { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}) };
  await slackPostAs(d.link, { channel: d.chat, ...(d.thread ? { thread_ts: d.thread } : {}), text: pointer, blocks: [context(esc(pointer))] });
  return { channel: dm };
}

async function postCard(d: Draw, v: ConfirmWrite) {
  const interruptId = v?.__opentag_interrupt_id__;
  const args = v?.__copilotkit_interrupt_value__?.args;
  if (!isInterruptId(interruptId) || !args) return;
  // The live message settles first, so the card comes after what the bot said.
  if (d.ts && !d.native) await paint(d);
  const where = await ownerPlace(d, `Waiting for ${ownerName()}'s OK (asked in a direct message).`);
  const ts = await slackPostAs(d.link, { ...where, text: `Approve? ${args.action}`.slice(0, 300), blocks: cardBlocks(args, interruptId) });
  box.cards.set(interruptId, { account: d.account, channel: where.channel, ts, args });
}

async function showDecision(v: { interruptId: string; confirmed: boolean; always: boolean; by?: string }) {
  const card = box.cards.get(v.interruptId);
  if (!card) return;
  box.cards.delete(v.interruptId);
  await slackCall(card.account, "chat.update", { channel: card.channel, ts: card.ts, text: v.confirmed ? "Approved" : "Denied", blocks: cardBlocks(card.args, v.interruptId, v) });
}

async function ownerOnly(d: Draw, text: string) {
  const where = await ownerPlace(d, `${bot(d.link.botId)?.name ?? "The bot"} asked ${ownerName()} something directly.`);
  await slackPostAs(d.link, { ...where, text: text.slice(0, 300), blocks: [section(esc(text).slice(0, SECTION_MAX))] });
}

type ActionPayload = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  response_url?: string;
  message?: { blocks?: object[] };
  actions?: { action_id?: string; value?: string }[];
};

/** Slack's response_url (hooks.slack.com, or the stand-in Slack in tests): an ephemeral reply or the card replaced. */
async function respond(url: string | undefined, body: object) {
  if (!url) return;
  try {
    const host = new URL(url).host;
    if (host !== "hooks.slack.com" && host !== new URL(SLACK_API()).host) return;
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  } catch {}
}

/**
 * A click on an approval card (the interactivity route). Only the person paired with a bot in that
 * workspace decides; anyone else is told so, privately. A click meant for another Bops instance, or
 * on an approval already decided, changes nothing.
 */
export async function slackAction(p: ActionPayload) {
  const action = p.actions?.[0];
  const kind = /^bops_(approve_once|approve_always|deny)$/.exec(action?.action_id ?? "")?.[1];
  if (p.type !== "block_actions" || !action || !kind) return;
  const [instance, interruptId] = String(action.value ?? "").split(":");
  const say = (text: string) => respond(p.response_url, { response_type: "ephemeral", replace_original: false, text });
  if (instance !== instanceId() || !isInterruptId(interruptId)) return say("That button belongs to another Bops, so nothing was decided.");
  const links = (getState().channels ?? []).filter((l) => l.kind === "slack" && (!p.team?.id || !l.slack?.teamId || l.slack.teamId === p.team.id));
  const asked = pendingInterrupt(approvalIdOf(interruptId))?.channel;
  const link = asked ? channelLink(asked.linkId) : undefined;
  const owner = !!p.user?.id && (link ? link.owner === p.user.id : links.some((l) => l.owner === p.user!.id));
  if (!owner) return say(`Only ${ownerName()} can decide this.`);
  const confirmed = kind !== "deny";
  const always = kind === "approve_always";
  const decision = { confirmed, always, by: ownerName() };
  if (!(await decideInterrupt(interruptId, decision))) return say("That was already decided.");
  // The card says who decided (the renderer does it when it posted the card; after a restart, from here).
  if (!box.cards.has(interruptId) && p.message?.blocks)
    await respond(p.response_url, {
      replace_original: true,
      text: confirmed ? "Approved" : "Denied",
      blocks: [...p.message.blocks.filter((b) => (b as { type?: string }).type !== "actions"), context(confirmed ? `✅ Approved by ${esc(decision.by)}` : `🚫 Denied by ${esc(decision.by)}`)],
    });
}

/* ---------------- Block Kit ---------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: text || " " } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text: text.slice(0, 2900) || " " }] });

/** Markdown as Slack's mrkdwn: bold, links, headings, bullets, strikethrough (code stays as it is). */
export function mrkdwn(md: string) {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) =>
      i % 2
        ? part
        : esc(part)
            .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
            .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
            .replace(/\*\*(.+?)\*\*/g, "*$1*")
            .replace(/__(.+?)__/g, "*$1*")
            .replace(/~~(.+?)~~/g, "~$1~")
            .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>"),
    )
    .join("");
}

/** Text in pieces under `max`, at paragraph or line breaks. */
function split(text: string, max: number) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf("\n\n", max), rest.lastIndexOf("\n", max));
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const cell = (s: string) => {
  const t = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
  return /^-?\d+([.,]\d+)?$/.test(t) && t.length < 16 ? { type: "raw_text", text: t } : { type: "raw_text", text: t.slice(0, 500) || " " };
};

/** A markdown table ("| a | b |", "|---|---|", rows) as Slack's table blocks (100 rows each, the header repeated). */
function tableBlocks(lines: string[]) {
  const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").slice(0, TABLE_COLS).map(cell));
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const full = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => ({ type: "raw_text", text: " " }))]);
  const [head, ...body] = full;
  const out: object[] = [];
  for (let i = 0; i < Math.max(1, body.length); i += TABLE_ROWS - 1) out.push({ type: "table", rows: [head, ...body.slice(i, i + TABLE_ROWS - 1)] });
  return out;
}

/**
 * A saved answer as Slack messages: text as sections, each markdown table as Slack's own table (one
 * per message), the bot's choices ("Options:") as a line under it. Split at Slack's limits.
 */
export function slackMessages(text: string, options?: string[]) {
  const pieces: ({ kind: "text"; text: string } | { kind: "table"; lines: string[] })[] = [];
  let buf: string[] = [];
  let table: string[] = [];
  const flushText = () => buf.length && (pieces.push({ kind: "text", text: buf.join("\n") }), (buf = []));
  const flushTable = () => table.length && (pieces.push({ kind: "table", lines: table }), (table = []));
  // A "table" without its |---| line is just text.
  const unTable = () => {
    if (!table.length || table.some((l) => /^\s*\|?\s*:?-{2,}/.test(l))) return;
    buf.push(...table);
    table = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushText();
      table.push(line);
    } else {
      unTable();
      flushTable();
      buf.push(line);
    }
  }
  unTable();
  flushTable();
  flushText();

  const messages: { text: string; blocks: object[] }[] = [];
  let cur: object[] = [];
  let hasTable = false;
  const close = () => {
    if (cur.length) messages.push({ text: "", blocks: cur });
    cur = [];
    hasTable = false;
  };
  for (const p of pieces) {
    if (p.kind === "table") {
      for (const t of tableBlocks(p.lines)) {
        if (hasTable || cur.length >= MAX_BLOCKS) close();
        cur.push(t);
        hasTable = true;
      }
    } else
      for (const part of split(mrkdwn(p.text), SECTION_MAX)) {
        if (cur.length >= MAX_BLOCKS) close();
        cur.push(section(part));
      }
  }
  if (options?.length) {
    if (cur.length >= MAX_BLOCKS) close();
    cur.push(context(esc(`Reply with: ${options.join("  ·  ")}`)));
  }
  close();
  if (!messages.length) messages.push({ text: "", blocks: [section(" ")] });
  // The notification text: the start of the answer, in plain words.
  const plain = text.replace(/\s+/g, " ").trim().slice(0, 300) || "…";
  for (const m of messages) m.text = plain;
  return messages;
}
