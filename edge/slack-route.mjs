import { createHash } from "node:crypto";

/**
 * Which Bops on this Mac a Slack event is for, when they all share one Slack app (server.mjs). Each
 * Bops says where its bots are (GET /api/channels/slack/routes: lib/server/channels.ts slackRoutes),
 * and every event goes to exactly one of them, or to none: never two, so nothing is answered twice.
 *
 * In order:
 * 1. Another app's bot posting: only to the Bops whose thread it's in (that bot is part of the thread now).
 * 2. A pairing code (the message is the code and nothing else): the Bops whose code it is.
 * 3. A reply in a thread: the Bops that started it (its bot answers there).
 * 4. A direct message: the Bops with the bot named in it, when only one has a bot by that name (every
 *    team has a "Bapi", so that one never decides); else the one they last wrote to; else one of
 *    theirs (paired with them), in the order the Bops are listed; else the first.
 * 5. A channel: only when the app is @mentioned. The Bops with bots in that channel; of several, the
 *    one with the bot named in it, else the first listed.
 *
 * `tables`: what each Bops said, in the order they're listed (BOPS_UPSTREAMS). `memory`: what this
 * front door sent where (threads it sent the first message of, people's last direct message), in case
 * a Bops hasn't said so yet. Returns the Bops' id (or null) and why, for the log.
 */
export function routeSlack(envelope, tables, memory = emptyMemory()) {
  const e = envelope?.event;
  if (envelope?.type !== "event_callback" || !e || e.type !== "message" || typeof e.channel !== "string" || typeof e.ts !== "string") return { to: null, why: "not a message" };
  const teams = teamsOf(envelope);
  const here = tables.filter((t) => t?.app && t.teams?.some((x) => teams.includes(x)));
  if (!here.length) return { to: null, why: "no Bops in this workspace" };
  const direct = e.channel_type === "im" || e.channel.startsWith("D");
  const thread = e.thread_ts && e.thread_ts !== e.ts ? e.thread_ts : undefined;
  const owner = (key) => here.find((t) => t.threads?.includes(key))?.instance ?? (here.some((t) => t.instance === memory.threads.get(key)) ? memory.threads.get(key) : undefined);

  if (e.bot_id) {
    const to = owner(`${e.channel}:${thread ?? e.ts}`);
    return to ? { to, why: "another bot in its thread" } : { to: null, why: "a bot, not in a thread of ours" };
  }
  if (e.subtype && e.subtype !== "file_share" && e.subtype !== "thread_broadcast") return { to: null, why: `subtype ${e.subtype}` };
  const text = typeof e.text === "string" ? e.text : "";
  const code = codeIn(envelope);
  if (code) {
    const hash = createHash("sha256").update(code).digest("hex");
    const coded = here.find((t) => t.codes?.includes(hash));
    if (coded) return { to: coded.instance, why: "its pairing code" };
  }
  if (thread) {
    const to = owner(`${e.channel}:${thread}`);
    if (to) return { to, why: "its thread" };
  }
  if (direct) {
    const named = namedIn(here, text);
    if (named) return { to: named, why: "named" };
    const last = lastTalked(here, e.user, memory);
    if (last) return { to: last, why: "they last wrote to it" };
    const theirs = here.find((t) => t.owners?.includes(e.user));
    return { to: (theirs ?? here[0]).instance, why: theirs ? "paired with them" : "the first" };
  }
  if (!here.some((t) => t.app.user && text.includes(`<@${t.app.user}>`))) return { to: null, why: "the app isn't mentioned" };
  const in_ = here.filter((t) => t.channels?.includes(e.channel));
  if (!in_.length) return { to: null, why: "no bot in this channel" };
  if (in_.length === 1) return { to: in_[0].instance, why: "its channel" };
  return { to: namedIn(in_, text) ?? in_[0].instance, why: namedIn(in_, text) ? "named, of the channel's" : "the channel's first" };
}

/** The pairing code a message is, if it's one and nothing else (a mention of the app allowed). */
export function codeIn(envelope) {
  const t = String(envelope?.event?.text ?? "").replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "").replace(/\s+/g, "");
  return /^\d{4,10}$/.test(t) ? t : null;
}

export const emptyMemory = () => ({ threads: new Map(), talked: new Map(), events: new Map() });

/** The Bops of the one bot named in the text (the longest name wins: "Head of Sales" over "Sales"); none if two Bops have it. */
function namedIn(tables, text) {
  let best = 0;
  let found = new Set();
  for (const t of tables)
    for (const n of t.names ?? []) {
      const name = String(n.name ?? "");
      if (!name || !new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text)) continue;
      if (name.length > best) {
        best = name.length;
        found = new Set([t.instance]);
      } else if (name.length === best) found.add(t.instance);
    }
  return found.size === 1 ? [...found][0] : null;
}

/** The Bops they last wrote to directly: this front door's memory, else what each Bops said. */
function lastTalked(tables, user, memory) {
  let to = null;
  let at = 0;
  const mine = memory.talked.get(user);
  if (mine && tables.some((t) => t.instance === mine.to)) {
    to = mine.to;
    at = mine.at;
  }
  for (const t of tables) {
    const when = Number(t.talked?.[user] ?? 0);
    if (when > at) {
      to = t.instance;
      at = when;
    }
  }
  return to;
}

/** The workspaces an event belongs to (lib/server/channels.ts slackTeams). */
export function teamsOf(envelope) {
  const through = Array.isArray(envelope.authorizations) ? envelope.authorizations.map((a) => a?.team_id) : [];
  return [...new Set([envelope.team_id, ...through].filter((t) => typeof t === "string" && /^[A-Z0-9]{2,40}$/.test(t)))];
}

/**
 * Whether an event can be for any Bops at all, without asking them: the app gets every message in its
 * channels, and a channel message that @mentions nobody, outside a thread, never is.
 */
export function maybeOurs(envelope) {
  const e = envelope?.event;
  if (envelope?.type !== "event_callback" || !e || e.type !== "message" || typeof e.channel !== "string") return false;
  if (e.channel_type === "im" || e.channel.startsWith("D")) return !e.bot_id;
  if (e.thread_ts && e.thread_ts !== e.ts) return true;
  return !e.bot_id && typeof e.text === "string" && e.text.includes("<@");
}

/** Remember where a message went: its thread (a first message), and the person's last direct message. */
export function remember(memory, envelope, to, now = Date.now()) {
  const e = envelope.event;
  if (!e.thread_ts || e.thread_ts === e.ts) memory.threads.set(`${e.channel}:${e.ts}`, to);
  if (e.channel_type === "im" || e.channel.startsWith("D")) memory.talked.set(e.user, { to, at: now });
  // Bounded: the oldest go first.
  for (const m of [memory.threads, memory.talked]) while (m.size > 5000) m.delete(m.keys().next().value);
}

/** The Bops a click on one of the app's buttons is for: its value starts with that Bops' id ("sales-team:<approval>"). */
export function clickedFor(payload) {
  const value = payload?.actions?.[0]?.value;
  const m = typeof value === "string" && /^([a-z0-9-]{1,64}):/.exec(value);
  return m ? m[1] : null;
}
