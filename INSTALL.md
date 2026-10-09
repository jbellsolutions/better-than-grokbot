# Install Better Than GrokBot with Claude Code or Codex

Give your coding agent this repository link:

**https://github.com/jbellsolutions/better-than-grokbot**

Say: **“Install Better Than GrokBot on this computer. Follow INSTALL.md, start the local app, and walk me through the startup checklist.”**

The agent handles checkout, dependencies, environment setup and starting the app. You supply your own accounts and decide what the agents can access. Aim for about 30 minutes with prerequisites and keys ready; setup time varies.

## Instructions for the installing agent

1. Read this file, README.md and AGENTS.md. Use a new folder named `Better-Than-GrokBot`, or reuse a verified existing checkout. Do not overwrite another app, existing environment files or saved state. Inspect the operating system and Node version first; Node.js 24+ and Git are required. Explain and obtain authorization before changing system tools on the user's computer.
2. Clone this public repository, or use the free source ZIP linked in README.md. Run `npm ci` from its root. No paid software subscription is required. Do not buy cloud resources or subscriptions as part of installation.
3. If `.env.local` does not exist, copy `.env.example` to it and protect it with `chmod 600 .env.local` on macOS/Linux. Keep `BOPS_SELF_HOSTED=1`. Use existing authorized credentials when available. Otherwise collect missing credentials using the coding agent's secure credential workflow. Do not print, commit or include keys in screenshots or logs.
4. Configure the user's OpenRouter or supported OpenAI provider. For OpenRouter, set `OPENROUTER_API_KEY` and tool/image-capable `BOPS_CHAT_MODEL`, `BOPS_SESSION_MODEL` and `BOPS_HARD_MODEL` choices. Explain listed model rates and that provider usage is billed separately. Never invent a key or silently substitute someone else's account.
5. Cloud computer work requires the user's Orgo account and `ORGO_API_KEY`, plus a running desktop. Prefer an existing authorized computer; do not delete, reset or resize it. Follow README.md for workspace/template and computer selection. If the account or desktop is not ready, report that cloud tasks remain unconfigured rather than claiming a complete setup.
6. Start the browser coordinator with `npm run dev -- --port 3210`, listening locally. If that port is occupied, verify the existing service before starting a second copy. Keep the server running, verify HTTP 200 at http://localhost:3210, and open the app for the user. This path does not require building the optional native relay helper.
7. Walk through the startup checklist below. Verify a minimal chat reply after permission to incur provider usage. For a computer check, use a harmless read-only task with approval. Report what works and what is still missing. Do not promise readiness until the required accounts and checks pass.

## Startup checklist

- [ ] Local workspace opens at http://localhost:3210.
- [ ] Your provider account and model choices are connected.
- [ ] Your name, business context and agent roles are configured.
- [ ] For cloud work: a running Orgo desktop is connected and a read-only check passes.
- [ ] For Mac work: Codex is signed in and macOS computer-use permissions are ready.
- [ ] Approval boundaries are agreed before sending messages or changing external systems.
- [ ] A first small task returns a result you can verify.

Keep the coordinator running while using it. The optional Apple silicon native build and background services have additional setup; see README.md. The upstream relay helper currently requires access to a private upstream repository, so do not block the browser installation on it or claim an unsigned native installer is ready for every Mac.

The software is free under FSL-1.1-ALv2. Model, compute and integration bills are separate. There is no guarantee of a particular setup time, total saving or reliability advantage.
