# Install Better Than GrokBot with Claude Code or Codex

Paste this repository's link into Claude Code or Codex and say:

> **Install Better Than GrokBot on this computer. Follow INSTALL.md.**

Your coding agent installs and starts the app, asks you for your keys one at a time, and then asks
about your agents: bring your own charters, get help writing them, or start with the default team
(a lead plus a Head of Operations) and grow from there. It starts as a blank canvas: no agents,
data or accounts but yours.

You need a Mac (Apple silicon for the optional native app), Node.js 24 or newer, Git, an
OpenRouter or OpenAI API key, and an Orgo API key (orgo.ai, for the bots' computers; a self-hosted
install opens only with one). Everything else is optional and can be added later.

---

## Instructions for the installing agent

Work through these steps in order. Ask one question at a time and wait for the answer. Never print,
log or commit a key, and never invent one or use an account that isn't the user's. Don't buy
anything, and don't change system tools without asking first.

### 1. Check the computer

- `node --version` must be 24 or newer; `git --version` must work. If either is missing, explain
  how to install it (nodejs.org, or `brew install node git`) and ask before installing anything.
- Note free disk space: dependencies and a build take a few GB.

### 2. Get the code and install it

- Clone into a new folder (`better-than-grokbot`), or reuse a checkout of this repository that is
  already there. Never overwrite another app, an existing `.env.local` or an existing `.data/`.
- From its root: `npm ci`.
- If `.env.local` doesn't exist: `cp .env.example .env.local && chmod 600 .env.local`.
  Keep `BOPS_SELF_HOSTED=1` in it.

### 3. Ask for the keys, one at a time

For each key below, tell the user what it does, where to get it and whether it's required, then ask
for it. Offer two ways to put it in:

- **Private (recommended):** the user runs this in their own terminal, which hides what they paste:
  `node scripts/set-key.cjs <NAME>`
- **Through you:** they paste it in the chat and you write it with
  `printf %s '<value>' | node scripts/set-key.cjs <NAME>`. Tell them the key is then in this chat's
  history, and to rotate it later if that matters to them.

Never echo a key back. Skip any optional key the user doesn't want now; it can be added later the same
way (restart the app to load it).

| Setting | What it's for | Where to get it | Needed? |
|---|---|---|---|
| `OPENROUTER_API_KEY` | The bots' thinking (chat and tasks), any model on OpenRouter | openrouter.ai → Keys | One of these two is **required** |
| `OPENAI_API_KEY` | Same, through OpenAI directly; also live voice calls | platform.openai.com → API keys | (see above) |
| `ORGO_API_KEY` | Each bot's own cloud computer (browser, desktop, four screens). Without it the app shows "Sign in with Orgo" instead of opening | orgo.ai → API keys | **Required** |
| `COMPOSIO_API_KEY` | Gmail, Calendar, Slack, Notion, HubSpot and ~1,000 more apps | composio.dev → API keys | Optional |
| `HONCHO_API_KEY` | Long-term memory across conversations | honcho.dev | Optional |
| `AGENTMAIL_API_KEY` | An email inbox for every bot | agentmail.to | Optional |
| `TYPESAFE_API_KEY` | Small, fast judgment calls | typesafe | Optional |
| `AGENTPHONE_API_KEY` | Texts and calls to a bot's phone number (also needs a public address, README → Texts and calls) | agentphone.to | Optional |

With OpenRouter, also set the models (they must support tools and images), for example:
`BOPS_CHAT_MODEL`, `BOPS_SESSION_MODEL` and `BOPS_HARD_MODEL` = `z-ai/glm-5.3-flash`. The user can
change them later in **Settings → Models**. Mention that providers bill their usage separately.

### 4. Build and start

```bash
npm run build
npx next start --port 3210 --hostname 127.0.0.1
```

Run the server in the background and keep it running. Next prints a warning that `next start`
doesn't suit `output: standalone`; it is expected here and the app runs normally. If port 3210 is taken, check what is there
(`curl -s http://127.0.0.1:3210/api/health`) before starting a second copy. When
`curl -s http://127.0.0.1:3210/api/health` answers `{"bops":true,…}`, open http://localhost:3210
for the user. For development, `npm run dev -- --port 3210` works too.

### 5. Who the bots work for

Ask the user's name and one or two lines about them and their business, then save it (the same as
**Settings → You**; every bot reads it):

```bash
curl -s -X POST http://127.0.0.1:3210/api/owner -H 'content-type: application/json' \
  -d '{"name":"<their name>","about":"<a line or two about them and their business>"}'
```

### 6. Ask about charters

A charter is what an agent is for: its job, what it may do on its own, and what it must ask first.
Ask:

> **Do you have charters for the agents you want? You can paste them, I can help you write them, or
> we can start with the default team and add agents later.**

- **They have charters:** for each one, confirm the agent's name, and condense its charter into a
  role of at most 500 characters: its job, what it may do on its own and what needs approval. That
  role is what the agent reads in every conversation. Create it:

  ```bash
  curl -s -X POST http://127.0.0.1:3210/api/bots -H 'content-type: application/json' \
    -d '{"name":"<Name>","role":"<role, up to 500 characters>"}'
  ```

  Save each full charter as `charters/<name>.md` in the checkout (that folder is git-ignored) so the
  user keeps the long version.
- **They want help:** interview them, one question at a time: what the business does, what work
  they want off their plate, and which jobs that makes (a writer, a researcher, a bookkeeper…). For
  each job, draft a charter (job, tools, what it may do alone, what needs their OK), show it, revise
  it until they approve, then create the agent as above.
- **They want to start simple:** do nothing. Every new team already has a lead (Boppy) and a Head of
  Operations (Bapi), who can create and remove specialists as the work needs them. Tell the user they
  can ask Bapi in the chat for any agent they want.

List the team to confirm: `curl -s http://127.0.0.1:3210/api/state | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).state.bots.map(b=>b.name+': '+b.role).join('\n')))"`

### 7. First check

With the user's permission (it uses their model provider), send a short message to the lead in the
app and confirm a reply comes back. Ask before running a harmless read-only
computer task (the bot's computer starts on first use). Report plainly what works and what is still missing.

### 8. Optional next steps (only if the user wants them)

- **Keep it running** when the terminal closes and after restarts: `npm run service:enable`
  (README → Self-host it).
- **Native Mac app:** `npm run app:build` (README).
- **Slack (beta):** below.
- **Texts and calls:** README → Texts and calls.

## Startup checklist

- [ ] The app opens at http://localhost:3210.
- [ ] A model provider key and an Orgo key are set, and a chat reply comes back.
- [ ] Your name and business are set.
- [ ] Your agents exist: your charters, or the default lead and Head of Operations.
- [ ] For cloud computer work: a read-only computer check passes.
- [ ] You know which actions the bots will ask you to approve (sending, posting, paying, deleting).

---

## Slack (beta)

Your bots can answer in Slack under their own names and pictures, through **your own** Slack app.
One app serves every Better Than GrokBot team on your Mac. They answer in direct messages, in
threads they started, and in channels only when the app is @mentioned, and they stay out of threads
that another bot is already answering.

Slack has to reach your Mac, so you need a public https address that forwards only Slack's paths to
it: the small front door in `edge/`, behind a Cloudflare tunnel.

1. **A public address.** Either:
   - **A domain on Cloudflare (stays the same):** `brew install cloudflared`, `cloudflared tunnel login`,
     then `node scripts/front-door.cjs tunnel bops-hooks.<your-domain>` and
     `node scripts/front-door.cjs enable bops-hooks.<your-domain>`. This runs the front door on
     127.0.0.1:3290 and the tunnel as login services; only Slack's paths are passed through.
   - **No domain (to try it; the address changes on every restart):** run the front door,
     `PORT=3290 HOST=127.0.0.1 BOPS_UPSTREAM=http://127.0.0.1:3210 node edge/server.mjs`, and in another
     terminal `cloudflared tunnel --url http://127.0.0.1:3290`, which prints a `https://….trycloudflare.com` address.
2. Save that address: `node scripts/set-key.cjs BOPS_PUBLIC_URL` (like `https://bops-hooks.example.com`,
   no trailing slash), and restart the app.
3. Print your app's manifest: `node slack/setup.mjs manifest --no-events`.
4. At **api.slack.com/apps → Create New App → From a manifest**, choose your workspace and paste it.
   Then **Install to Workspace** and allow it (the user does this; it's their workspace).
5. In Better Than GrokBot, open a bot's profile → **Where to find** → **Slack**, and paste the app's
   **Bot User OAuth Token** (`xoxb-…`) and **Signing Secret** (Basic Information).
6. Back in the Slack app's **Event Subscriptions**: turn events on, set the request URL to
   `<your address>/hooks/slack` (it should show Verified), and add the bot events
   `message.im`, `message.channels`, `message.groups`, `message.mpim` and `app_mention`. Save, and
   reinstall if Slack asks.
7. DM the bot, or invite it to a channel and @mention it.

To stop: `node scripts/front-door.cjs disable` (or stop the two commands from step 1). To disconnect
Slack from one team, remove it under **Where to find → Slack**.

## Streaming (beta)

Replies stream into the chat as they're written, and tool steps show as they run. Nothing to set up.

---

The software is free under FSL-1.1-ALv2 (see LICENSE). Model, computer and integration providers bill
you separately. Setup time, cost and reliability depend on your accounts and providers.
