# Handoff

For whoever maintains Better than GrokBot next. Last updated 2026-10-24.

## What this is

A self-hosted, rebranded fork of [Bops](https://github.com/OrgoAI/bops) (Organic Intelligence, Inc.,
FSL-1.1-ALv2). A Next.js server (the "coordinator") runs on the user's computer at
`127.0.0.1:3210`; the UI is a browser tab, the installable web app, or the Electron shell on a Mac.
Bots think through OpenRouter or OpenAI and work on Orgo cloud computers.

## Where things live

| What | Where |
|---|---|
| Public source (this repo) | `github.com/jbellsolutions/better-than-grokbot`, branch `main` |
| Website and source ZIP | betterthangrokbot.com, from `site/` (`npm run site:package` builds the ZIP) |
| Private working repo | `jbellsolutions/bops-selfhosted` (private). `release/better-than-grokbot` is its newest line; `selfhost/stable` is older. It holds personal and business material (GTM plans, fleet notes) that must not come here. |
| Upstream | `github.com/OrgoAI/bops`. Pull updates by merging into a branch, never straight into `main`. |

Moving work from private to public: export only what's needed, then run gitleaks and a grep for names,
emails, phone numbers and computer IDs before pushing (`scripts/export-public.sh` shows the pattern).

## Checks

```bash
npm ci
npx next typegen && npx tsc --noEmit -p .
npm run test:selfhost
npm run lint
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of these on Linux, scans the whole history for secrets,
and on Windows installs, tests the secrets file, builds and checks that the server answers.

## Platforms, honestly

- **Mac (Apple silicon):** everything. The native app (`npm run app:build`) is unsigned; a signed,
  notarized release needs an Apple Developer ID (see docs/SELF_HOSTING.md → Releasing). The
  `orgo-relay` helper for releases comes from a private upstream repo.
- **Windows and Linux:** run the server and use the browser or the installed web app. Saved logins and
  tokens go in `.data/secrets.json` instead of the Keychain (`lib/server/keychain.ts`, tested in
  `test/secrets-file.test.cjs`, which CI also runs on Windows). Not working there yet: Mac computer
  use (Codex), the login services (`launchctl`), and the Electron build (its packaged-server path uses
  symlinks and macOS paths in `desktop/main.cjs`).
- **Phone:** installs from the browser over Tailscale (`app/manifest.ts`). Below 700px wide the app
  shows one screen at a time: the list, a chat, or the side panel (`phoneScreen` in
  `components/app/bops-app.tsx`). Each screen is a history entry, so the back gesture goes back a
  screen. Connecting an app opens its sign-in page on the computer; the phone gets an "Open sign-in
  page" link in the Vault.

## Next, in order

1. **Phone notifications.** A closed phone app hears nothing from the bots. Web Push needs a service
   worker and push keys; until then, texts (AgentPhone) or Slack reach the phone.
2. **Always-on on Windows and Linux**, like `npm run service:enable` on a Mac: a Task Scheduler task or
   a systemd user unit that runs `npm run serve`.
3. **Windows desktop installer** (optional: the installed web app already gives a window and a
   Start-menu icon): an electron-builder `--win nsis` target, with directory junctions or copies
   instead of symlinks in `packagedServer()`.
4. **Signed Mac release** under this fork's own name, bundle ID and Apple Developer account.

## Rules that keep it trustworthy

- Never commit `.env*` (except `.env.example`), `.data/`, keys, real names, phone numbers or emails.
  Use `alex@example.com` and `+15551234567`-style examples.
- Keep the unofficial-fork notice in the README and the original LICENSE and copyright. Don't use the
  Bops name or logo as this product's brand (TRADEMARK.md).
- Bots create and delete Orgo computers only in their own workspace; keep it that way.
- Port 3210 stays on loopback. Phone access goes through Tailscale with `BOPS_TAILSCALE_USER` set.
