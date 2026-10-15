#!/usr/bin/env node
/**
 * Bops' own Slack app, so Slack shows "Bops" (and each bot under its own name and picture) instead of
 * Composio's shared app, with approval buttons, thread status and live answers. Run from the repo root.
 *
 * Its public address is BOPS_PUBLIC_URL (required: your own https address), the front door (edge/) that
 * passes Slack's events and button clicks to Bops. One app serves every Bops on a Mac: the front door
 * there (BOPS_UPSTREAMS) sends each event to the one it's for, and its credentials, pasted in any of
 * them, are kept where all of them read them (the "Bops Slack App" Keychain item).
 *
 *   node slack/setup.mjs manifest [--name "Bops"] [--no-events]
 *     Prints the manifest with this front door's addresses filled in, for api.slack.com/apps → Create
 *     New App → From a manifest. Then: Install to Workspace (Slack asks you to allow it), and paste the
 *     app's Bot User OAuth Token and Signing Secret into Bops (a bot's profile → Where to find → Slack).
 *     Last, in the app's Event Subscriptions, verify the request URL (Bops must be running and
 *     reachable through the front door). --no-events leaves events out of the new app: Slack checks
 *     the events URL as the app is made, which Bops can only answer once it has the app's signing
 *     secret; turn them on after pasting it (Event Subscriptions, the URL and bot events printed).
 *
 *   SLACK_CONFIG_TOKEN=xoxe.xoxp-… node slack/setup.mjs create [--name …] [--env <file>] [--direct]
 *     The same app through Slack's App Manifest API, its credentials saved to --env (default
 *     .env.local) as BOPS_SLACK_*. Without --direct it also makes a Composio Slackbot auth config with
 *     them (redirect through the front door), so connecting Slack in Bops shows "Bops". The config
 *     token comes from api.slack.com/apps → "Your App Configuration Tokens" → Generate Token.
 *
 *   SLACK_CONFIG_TOKEN=xoxe.xoxp-… node slack/setup.mjs events [--env <file>]
 *     Turns on the app's events and buttons, sent to the front door. Slack checks the events URL on the
 *     spot, so Bops must be running and reachable, with the app's signing secret.
 *
 * Nothing secret is printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const step = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : undefined;
};
const ENV = flag("env") ?? ".env.local";
const readEnv = () =>
  existsSync(ENV)
    ? Object.fromEntries(
        readFileSync(ENV, "utf8")
          .split("\n")
          .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
          .filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
      )
    : {};
const env = readEnv();
const get = (k) => process.env[k] || env[k];
const save = (vars) => {
  let text = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(ENV, text, { mode: 0o600 });
};

const PUBLIC = (get("BOPS_PUBLIC_URL") || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(PUBLIC)) {
  console.error("Set BOPS_PUBLIC_URL to your front door's public https address first, like https://bops-hooks.example.com (in .env.local, or the environment). INSTALL.md, Slack, shows how to get one.");
  process.exit(1);
}
const HOOK = `${PUBLIC}/hooks/slack`;
const EVENTS = ["app_mention", "message.channels", "message.groups", "message.im", "message.mpim"];

/** The manifest for this front door: its OAuth return, events and buttons. */
function manifestFor({ events }) {
  const m = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  const name = flag("name");
  if (name) {
    m.display_information.name = name.slice(0, 35);
    m.features.bot_user.display_name = name.slice(0, 80);
  }
  m.oauth_config.redirect_urls = [`${PUBLIC}/oauth/callback`];
  m.settings.interactivity = { is_enabled: true, request_url: `${HOOK}/interactivity` };
  if (events) m.settings.event_subscriptions = { request_url: HOOK, bot_events: EVENTS };
  return m;
}

async function slack(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error}${j.errors ? ` ${JSON.stringify(j.errors)}` : ""}`);
  return j;
}

if (step === "manifest") {
  const later = args.includes("--no-events");
  console.log(JSON.stringify(manifestFor({ events: !later }), null, 2));
  if (later) console.error(`Events, once the signing secret is in Bops: request URL ${HOOK}, bot events ${EVENTS.join(", ")}.`);
} else if (step === "create") {
  const config = get("SLACK_CONFIG_TOKEN");
  if (!config) throw new Error("Set SLACK_CONFIG_TOKEN (api.slack.com/apps → Your App Configuration Tokens)");
  const manifest = manifestFor({ events: false });
  let appId = get("BOPS_SLACK_APP_ID");
  if (!appId) {
    const made = await slack("apps.manifest.create", config, { manifest: JSON.stringify(manifest) });
    appId = made.app_id;
    const creds = {
      BOPS_SLACK_APP_ID: made.app_id,
      BOPS_SLACK_CLIENT_ID: made.credentials.client_id,
      BOPS_SLACK_CLIENT_SECRET: made.credentials.client_secret,
      BOPS_SLACK_SIGNING_SECRET: made.credentials.signing_secret,
      BOPS_SLACK_VERIFICATION_TOKEN: made.credentials.verification_token,
    };
    save(creds);
    Object.assign(env, creds);
    console.log(`Slack app made: ${appId} (https://api.slack.com/apps/${appId}), its credentials saved to ${ENV}.`);
  } else console.log(`Slack app already made: ${appId}`);

  if (!args.includes("--direct")) {
    const { Composio } = await import("@composio/core");
    const cx = new Composio({ apiKey: get("COMPOSIO_API_KEY") });
    const { items } = await cx.authConfigs.list({ toolkit: "slackbot" });
    let ac = items.find((a) => !a.isComposioManaged && a.status === "ENABLED");
    if (!ac) {
      ac = await cx.authConfigs.create("slackbot", {
        type: "use_custom_auth",
        authScheme: "OAUTH2",
        name: "Bops Slack app",
        credentials: {
          client_id: get("BOPS_SLACK_CLIENT_ID"),
          client_secret: get("BOPS_SLACK_CLIENT_SECRET"),
          oauth_redirect_uri: `${PUBLIC}/oauth/callback`,
          scopes: manifest.oauth_config.scopes.bot.join(","),
          verification_token: get("BOPS_SLACK_VERIFICATION_TOKEN"),
        },
      });
      console.log(`Composio auth config made: ${ac.id}`);
    } else console.log(`Composio auth config already made: ${ac.id}`);
    save({ BOPS_SLACK_AUTH_CONFIG: ac.id });
  } else console.log(`Next: Install to Workspace at https://api.slack.com/apps/${appId}/install-on-team, then paste the Bot User OAuth Token into Bops.`);
  console.log(`Then run the "events" step (Bops running), and upload the app icon at https://api.slack.com/apps/${appId}/general (edge/public/brand/bops-1024.png).`);
} else if (step === "events") {
  const config = get("SLACK_CONFIG_TOKEN");
  if (!config) throw new Error("Set SLACK_CONFIG_TOKEN");
  await slack("apps.manifest.update", config, { app_id: get("BOPS_SLACK_APP_ID"), manifest: JSON.stringify(manifestFor({ events: true })) });
  console.log(`Events on, sent to ${HOOK}; buttons to ${HOOK}/interactivity. Slack checked the URL.`);
} else {
  console.log("Usage: node slack/setup.mjs manifest | create | events   [--name …] [--env <file>] [--direct]   (see the top of this file)");
}
