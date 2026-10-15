import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppAccount } from "@/lib/types";
import { getSecret, setSecret } from "./keychain";
import { getState, update } from "./store";

/**
 * Slack's Web API, for bots in Slack (channels.ts, slack-render.ts). Two ways in, by the link's account:
 *
 * - The user's own Slack app (slack/manifest.json): its bot token and signing secret, pasted in Bops
 *   (a bot's profile, "Where to find") and kept in the Keychain item every Bops on this Mac shares
 *   ("Bops Slack App": one app for all of them, its events sorted out by the front door, edge/), or
 *   set as BOPS_SLACK_BOT_TOKEN / BOPS_SLACK_SIGNING_SECRET. Its account is "slackapp:<workspace id>".
 *   Bops calls Slack itself: an edit lands in one round trip, and buttons, thread status and
 *   streaming work (they need the app's own token).
 * - A Composio "slackbot" connection: the same methods through Composio's proxy.
 *
 * BOPS_SLACK_API points elsewhere (a stand-in for tests).
 */

export const SLACK_API = () => (process.env.BOPS_SLACK_API || "https://slack.com/api").replace(/\/+$/, "");
export const OWN_SLACK = "slackapp:";
export const isOwnSlack = (accountId?: string) => !!accountId?.startsWith(OWN_SLACK);

/** The Keychain item shared by every Bops on this Mac (each instance has its own vault otherwise). */
export const SLACK_APP_SERVICE = "Bops Slack App";
const TOKEN = "bot-token";
const SECRET = "signing-secret";
/** How often a missing app is looked for again: pasted in another Bops on this Mac, it shows up here too. */
const RECHECK_MS = 10_000;

type Me = { team?: string; team_id: string; user_id?: string; bot_id?: string };
type Creds = { token?: string; secret?: string; loaded?: Promise<void>; at?: number; frontDoor?: string; me?: { token: string; who: Promise<Me | null> } };
const g = globalThis as unknown as { __bopsSlackApp?: Creds };
const creds = (g.__bopsSlackApp ??= {});

/** The app's token and secret: from the environment, else the shared Keychain item (looked for again while missing). */
export async function slackApp() {
  if (creds.loaded && !(creds.token && creds.secret) && Date.now() - (creds.at ?? 0) > RECHECK_MS) creds.loaded = undefined;
  creds.loaded ??= (async () => {
    creds.at = Date.now();
    creds.token = process.env.BOPS_SLACK_BOT_TOKEN || (await getSecret(TOKEN, SLACK_APP_SERVICE)) || undefined;
    creds.secret = process.env.BOPS_SLACK_SIGNING_SECRET || (await getSecret(SECRET, SLACK_APP_SERVICE)) || undefined;
  })();
  await creds.loaded;
  return { token: creds.token, secret: creds.secret };
}

/**
 * Bops' public address for Slack (the bots' pictures): BOPS_PUBLIC_URL, else what the front door on
 * this Mac said it is when it last asked where the bots are (edge/, /api/channels/slack/routes): an
 * instance other than the first doesn't get the shared BOPS_ settings.
 */
export const slackFrontDoor = () => (process.env.BOPS_PUBLIC_URL || creds.frontDoor || "").replace(/\/+$/, "") || undefined;
export function learnFrontDoor(url: string | null) {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && !u.username && !u.password && u.pathname === "/" && !u.search) creds.frontDoor = u.origin;
  } catch {}
}

/** Whether this instance's own Slack app is set up (its signing secret is known), without waiting. */
export const slackAppKnown = () => !!(process.env.BOPS_SLACK_SIGNING_SECRET || creds.secret);

export class SlackError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(`Slack: ${code}`);
  }
}

/** Methods that only read: sent as a GET with the arguments in the query (Slack ignores JSON bodies there). */
const READS = new Set(["auth.test", "conversations.list", "conversations.info", "conversations.replies", "users.info", "bots.info"]);
const query = (args: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) q.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

type Result = { ok?: boolean; error?: string } & Record<string, unknown>;

/** One call with a bot token, straight to Slack. A 429 says how long to wait (retryAfter, seconds). */
export async function slackWithToken<T = Result>(token: string, method: string, args: Record<string, unknown> = {}): Promise<T & { ok: true }> {
  const read = READS.has(method);
  const started = Date.now();
  const res = await fetch(`${SLACK_API()}/${method}${read ? query(args) : ""}`, {
    method: read ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(read ? {} : { "Content-Type": "application/json; charset=utf-8" }) },
    body: read ? undefined : JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) throw new SlackError("ratelimited", Number(res.headers.get("retry-after")) || 1);
  const data = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as Result;
  // How long Slack takes per call (an edit should land well within a second): BOPS_SLACK_TRACE=1.
  if (process.env.BOPS_SLACK_TRACE === "1") console.log(JSON.stringify({ slack: method, ms: Date.now() - started, ok: !!data.ok, ...(data.ok ? {} : { error: data.error }) }));
  if (!data.ok) throw new SlackError(data.error ?? "no_answer");
  return data as T & { ok: true };
}

/**
 * One Web API call ("chat.postMessage") for a Slack link's account. Throws SlackError with Slack's
 * error code ("missing_scope", "ratelimited") when Slack says no.
 */
export async function slackCall<T = Result>(accountId: string, method: string, args: Record<string, unknown> = {}): Promise<T & { ok: true }> {
  if (isOwnSlack(accountId)) {
    const { token } = await slackApp();
    if (!token) throw new SlackError("not_authed");
    return slackWithToken<T>(token, method, args);
  }
  const { composio } = await import("./composio");
  const read = READS.has(method);
  const r = (await composio().tools.proxyExecute({
    endpoint: `/${method}`,
    method: read ? "GET" : "POST",
    connectedAccountId: accountId,
    ...(read
      ? { parameters: Object.entries(args).map(([name, value]) => ({ in: "query" as const, name, value: typeof value === "string" ? value : JSON.stringify(value) })) }
      : { body: args }),
  })) as unknown as { data?: Result; status?: number };
  if (r.status === 429) throw new SlackError("ratelimited", 1);
  if (!r.data?.ok) throw new SlackError(r.data?.error ?? "no_answer");
  return r.data as T & { ok: true };
}

/**
 * Whether a request is Slack's: its signature (v0, over the raw body) with the app's signing
 * secret, made within 5 minutes. Events and button clicks both check it.
 */
export async function slackSigned(request: Request, body: string) {
  const { secret } = await slackApp();
  const ts = request.headers.get("x-slack-request-timestamp") ?? "";
  const sig = request.headers.get("x-slack-signature") ?? "";
  if (!secret || !/^\d{1,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The app's own account in Bops, for its workspace (what auth.test said). */
function accountFor(who: { team?: string; team_id: string }): AppAccount {
  return { id: `${OWN_SLACK}${who.team_id}`, app: "slackbot", appName: "Slack", name: who.team, label: "Bops app", status: "active", at: Date.now() };
}

/**
 * The user pasted their Slack app's bot token and signing secret: checked with Slack (it must be a
 * bot's token), kept in the Keychain, and the app's workspace shows as a Slack account bots can join.
 */
export async function saveSlackApp(token: string, secret: string) {
  token = token.trim();
  secret = secret.trim();
  if (!/^xoxb-[A-Za-z0-9-]{20,}$/.test(token)) throw new Error("That isn't a bot token: it starts with xoxb- (OAuth & Permissions → Bot User OAuth Token).");
  if (!/^[0-9A-Za-z]{20,64}$/.test(secret)) throw new Error("That isn't a signing secret: letters and digits (Basic Information → App Credentials → Signing Secret).");
  const who = await slackWithToken<{ team?: string; team_id: string; user_id?: string; bot_id?: string }>(token, "auth.test").catch((e: Error) => {
    throw new Error(`Slack didn't take that token (${e instanceof SlackError ? e.code : e.message}).`);
  });
  if (!who.bot_id) throw new Error("That token is a person's, not the app's bot token (xoxb-).");
  await setSecret(TOKEN, token, SLACK_APP_SERVICE);
  await setSecret(SECRET, secret, SLACK_APP_SERVICE);
  Object.assign(creds, { token: process.env.BOPS_SLACK_BOT_TOKEN || token, secret: process.env.BOPS_SLACK_SIGNING_SECRET || secret, loaded: Promise.resolve(), at: Date.now() });
  const account = accountFor(who);
  update((s) => {
    s.slackAppOff = undefined;
    const had = s.accounts?.find((a) => a.id === account.id);
    if (had) Object.assign(had, { name: account.name, status: "active" });
    else (s.accounts ??= []).push(account);
  });
  return account;
}

/** At start: an app set up in the environment shows as its account (once auth.test says which workspace). */
export async function ensureSlackAppAccount() {
  const { token } = await slackApp();
  if (!token || getState().slackAppOff || getState().accounts?.some((a) => isOwnSlack(a.id) && a.status === "active")) return;
  const who = await slackMe();
  if (!who?.bot_id) return;
  const account = accountFor(who);
  update((s) => {
    if (!s.accounts?.some((a) => a.id === account.id)) (s.accounts ??= []).push(account);
  });
}

/** Who the app is in Slack (auth.test, asked once per token): its bot user, its bot id, its workspace. */
export async function slackMe(): Promise<Me | null> {
  const { token } = await slackApp();
  if (!token) return null;
  if (creds.me?.token !== token) {
    const who = slackWithToken<Me>(token, "auth.test").catch(() => null);
    creds.me = { token, who };
    // A failed answer (Slack unreachable for a moment) is asked again next time.
    void who.then((w) => {
      if (!w && creds.me?.who === who) creds.me = undefined;
    });
  }
  return creds.me.who;
}
