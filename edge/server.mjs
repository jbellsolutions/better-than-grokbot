import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clickedFor, codeIn, emptyMemory, maybeOurs, remember, routeSlack } from "./slack-route.mjs";

/**
 * Your public front door (on Fly, or on your Mac behind a Cloudflare tunnel). Webhooks from AgentPhone, OpenAI and Bops' Slack app (events, and clicks on its buttons)
 * arrive here and go, byte for byte, to the Bops server on the user's Mac over the tailnet. Bops checks their
 * signatures itself. If the Mac can't be reached (asleep, offline), the sender gets a 503 and
 * retries later.
 *
 * It also keeps connecting apps in Bops' name (no Mac needed for any of these):
 * - /oauth/callback: our own OAuth apps (Slack, Google…) send people back here, and it passes them
 *   straight on to Composio, so the address bar shows bops.bot, not Composio.
 * - /connected: where people land after connecting an app, instead of Composio's page.
 * - /mascot/*.png|jpg, /brand/*.png: the bots' pictures (Slack, Discord and Telegram avatars) and the Bops logo.
 *
 * Run on the Mac itself (behind a Cloudflare tunnel), it can serve every Bops there through one Slack
 * app: BOPS_UPSTREAMS, below.
 */

const UPSTREAM = new URL(process.env.BOPS_UPSTREAM ?? "http://127.0.0.1:3210");
const PORT = Number(process.env.PORT ?? 8080);
/** The address to listen on: everywhere (Fly), or 127.0.0.1 on a Mac behind a tunnel. */
const HOST = process.env.HOST || undefined;
/** This front door's public address (the bots' pictures in Slack are served from it). */
const FRONT = (process.env.BOPS_PUBLIC_URL ?? "").replace(/\/+$/, "");

/**
 * Several Bops on one Mac (instances, each on its own port) sharing one Slack app:
 * BOPS_UPSTREAMS="default=http://127.0.0.1:3210,sales-team=http://127.0.0.1:3211,…". Each of the
 * app's events goes to the one Bops it's for (slack-route.mjs; each says where its bots are), a click
 * on a button to the Bops its value names, and Slack's address check to the first. Without it, all
 * of /hooks/slack goes to BOPS_UPSTREAM, as before.
 */
const UPSTREAMS = new Map(
  (process.env.BOPS_UPSTREAMS ?? "")
    .split(",")
    .map((x) => x.trim().split("="))
    .filter(([id, url]) => /^[a-z0-9-]{1,64}$/.test(id ?? "") && url)
    .map(([id, url]) => [id, new URL(url)]),
);
const SHARED = UPSTREAMS.size > 0;

/** Public path → path on the Bops server (the same two the Mac's Funnel served, and Slack's). */
const ROUTES = {
  "/hooks/agentphone": "/api/phone/agentphone",
  "/hooks/openai": "/api/phone/openai",
  "/hooks/slack": "/api/channels/slack/events",
  "/hooks/slack/events": "/api/channels/slack/events",
  "/hooks/slack/interactivity": "/api/channels/slack/interactivity",
};

/** Where a webhook goes: which Bops server, and the path there. */
function target(pathname) {
  return ROUTES[pathname] ? { upstream: UPSTREAM, path: ROUTES[pathname] } : null;
}

/* ---------------- One Slack app, several Bops ---------------- */

/** Where each Bops' bots are (what it last said), asked again after a few seconds, or sooner when nobody claims an event. */
const tables = new Map();
let asked = 0;
let asking = null;
const memory = emptyMemory();
const FRESH_MS = 3000;
const AGAIN_MS = 1000;

function askAll() {
  asking ??= Promise.all(
    [...UPSTREAMS].map(async ([id, up]) => {
      try {
        const r = await fetch(new URL("/api/channels/slack/routes", up), { signal: AbortSignal.timeout(300), headers: FRONT ? { "x-bops-front-door": FRONT } : {} });
        if (r.ok) tables.set(id, { ...(await r.json()), instance: id });
      } catch {
        // Unreachable for now: what it said last stands (an event for it gets a 503, and Slack tries again).
      }
    }),
  ).finally(() => {
    asked = Date.now();
    asking = null;
  });
  return asking;
}

async function decide(envelope) {
  const id = envelope.event_id;
  const before = typeof id === "string" && memory.events.get(id);
  // Slack tries an event again when the answer was slow: it goes where the first try went.
  if (before) return { to: before.to, why: "a retry" };
  if (Date.now() - asked > FRESH_MS) await askAll();
  let d = routeSlack(envelope, [...UPSTREAMS.keys()].map((k) => tables.get(k)).filter(Boolean), memory);
  // Nobody's, or a code nobody had a moment ago: maybe a Bops just added a bot or a code. Asked again, once.
  const missed = !d.to ? d.why !== "the app isn't mentioned" : codeIn(envelope) && d.why !== "its pairing code";
  if (missed && Date.now() - asked > AGAIN_MS) {
    await askAll();
    d = routeSlack(envelope, [...UPSTREAMS.keys()].map((k) => tables.get(k)).filter(Boolean), memory);
  }
  return d;
}

const read = (req) =>
  new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) req.destroy(new Error("too big"));
      else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });

/** A Slack request (events or a click), sent to the one Bops it's for, or answered here when it's for none. */
async function slackShared(req, res, url) {
  const started = Date.now();
  const body = await read(req);
  let to = null;
  let why = "";
  let envelope = null;
  try {
    if (url.pathname === "/hooks/slack/interactivity") {
      to = clickedFor(JSON.parse(new URLSearchParams(body.toString("utf8")).get("payload") ?? "null"));
      why = to ? "its button" : "not one of our buttons";
    } else {
      envelope = JSON.parse(body.toString("utf8"));
      if (envelope?.type === "url_verification") {
        to = [...UPSTREAMS.keys()][0];
        why = "address check";
      } else if (!maybeOurs(envelope)) why = "not for any bot";
      else ({ to, why } = await decide(envelope));
    }
  } catch {
    why = "unreadable";
  }
  const upstream = to && UPSTREAMS.get(to);
  if (!upstream) {
    log({ path: url.pathname, status: 200, to: null, why, ms: Date.now() - started });
    return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  }
  const path = url.pathname === "/hooks/slack/interactivity" ? "/api/channels/slack/interactivity" : "/api/channels/slack/events";
  const up = http.request(
    { hostname: upstream.hostname, port: upstream.port, path, method: "POST", headers: { ...req.headers, host: upstream.host, "content-length": String(body.length) }, timeout: 30_000 },
    (r) => {
      // Remembered only once that Bops took it (a forged or stale request is refused there, and changes nothing here).
      if (envelope?.type === "event_callback" && r.statusCode >= 200 && r.statusCode < 300) {
        if (typeof envelope.event_id === "string") {
          memory.events.set(envelope.event_id, { to, at: Date.now() });
          // Kept for 10 minutes (Slack's retries come within a few).
          for (const [k, v] of memory.events) {
            if (Date.now() - v.at < 600_000) break;
            memory.events.delete(k);
          }
        }
        if (!envelope.event?.bot_id) remember(memory, envelope, to);
      }
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
      log({ path: url.pathname, status: r.statusCode, to, why, ms: Date.now() - started });
    },
  );
  up.on("timeout", () => up.destroy(new Error("timed out")));
  up.on("error", (err) => {
    log({ path: url.pathname, status: 503, to, why, ms: Date.now() - started, error: err.message });
    if (!res.headersSent) res.writeHead(503, { "content-type": "text/plain" }).end("Bops is offline");
    else res.destroy();
  });
  up.end(body);
}

const log = (entry) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));

const COMPOSIO_CALLBACK = "https://backend.composio.dev/api/v3/toolkits/auth/callback";
// A path, not a URL's (which would keep "%20" for a space in the folder's name).
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** After connecting an app: Bops' own page, in the app's look. */
function connectedPage(url) {
  const ok = url.searchParams.get("status") !== "failed";
  const app = esc((url.searchParams.get("app") ?? "").slice(0, 60));
  const title = ok ? (app ? `${app} is connected` : "Connected") : app ? `${app} didn't connect` : "That didn't connect";
  const line = ok ? "Your bots can use it now. You can close this tab and go back to Bops." : "Nothing was saved. Go back to Bops and try again.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Bops</title><link rel="icon" href="/brand/bops-512.png"><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FDFFF6;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;color:#0A0A0A}
main{display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px;text-align:center;max-width:420px}
img{width:88px;height:88px;border-radius:24px;box-shadow:0 0 0 1px #0000000F,0 18px 40px -18px #28320066}
h1{margin:6px 0 0;font-size:24px;line-height:30px;letter-spacing:-.01em}
p{margin:0;color:#6B6B6B;font-size:15px}
.mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${ok ? "#12B76A" : "#F04438"};color:#fff;font-size:13px;font-weight:700;vertical-align:-3px;margin-right:8px}
</style></head><body><main><img src="/brand/bops-512.png" alt="Bops"><h1><span class="mark">${ok ? "&#10003;" : "!"}</span>${title}</h1><p>${line}</p></main><script>${ok ? "setTimeout(()=>window.close(),2500)" : ""}</script></body></html>`;
}

/** The bots' pictures (PNG for Slack and Discord, JPEG for Telegram) and the Bops logo: fixed files, cached for a day. */
function asset(pathname, res) {
  const m = /^\/(mascot|brand)\/([A-Za-z0-9-]+\.(png|jpg))$/.exec(pathname);
  const file = m && `${PUBLIC}${m[1]}/${m[2]}`;
  if (!file || !existsSync(file)) return false;
  res.writeHead(200, { "content-type": m[3] === "jpg" ? "image/jpeg" : "image/png", "cache-control": "public, max-age=86400" }).end(readFileSync(file));
  return true;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://edge");
    if (url.pathname === "/health") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      // Straight on to Composio with everything the provider sent (a 302: the browser follows it, never this server).
      log({ path: url.pathname, status: 302 });
      return void res.writeHead(302, { location: `${COMPOSIO_CALLBACK}${url.search}`, "cache-control": "no-store" }).end();
    }
    if (req.method === "GET" && url.pathname === "/connected")
      return void res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(connectedPage(url));
    if (req.method === "GET" && asset(url.pathname, res)) return;
    if (SHARED && req.method === "POST" && /^\/hooks\/slack(\/events|\/interactivity)?$/.test(url.pathname))
      return void slackShared(req, res, url).catch((err) => {
        log({ path: url.pathname, status: 500, error: err.message });
        if (!res.headersSent) res.writeHead(500).end();
      });
    const to = target(url.pathname);
    if (!to || req.method !== "POST") return void res.writeHead(404).end();

    const started = Date.now();
    const headers = { ...req.headers, host: to.upstream.host };
    const up = http.request(
      { hostname: to.upstream.hostname, port: to.upstream.port, path: to.path + url.search, method: "POST", headers, timeout: 30_000 },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
        log({ path: url.pathname, status: r.statusCode, ms: Date.now() - started });
      },
    );
    up.on("timeout", () => up.destroy(new Error("timed out")));
    up.on("error", (err) => {
      log({ path: url.pathname, status: 503, ms: Date.now() - started, error: err.message });
      if (!res.headersSent) res.writeHead(503, { "content-type": "text/plain" }).end("Bops is offline");
      else res.destroy();
    });
    req.pipe(up);
  })
  .listen(PORT, HOST, () => log({ listening: PORT, host: HOST ?? "*", upstream: UPSTREAM.origin, instances: [...UPSTREAMS.keys()] }));
