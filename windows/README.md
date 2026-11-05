# Better Than GrokBot for Windows

Windows 10/11 x64 preview. The app bundles Node and its server; Node, npm and Git are not required on the downloader's PC.

## Install and connect

1. Download `Better-Than-GrokBot-0.0.7-windows-x64-setup.exe` from the [GitHub release](https://github.com/jbellsolutions/better-than-grokbot/releases/tag/windows-preview-0.0.7).
2. Run the per-user installer. This preview is unsigned; Windows may show its publisher warning.
3. Open **Better Than GrokBot**. Enter your own OpenRouter API key.
4. Select a model from the live catalog. Open-source model families are available when they support text, images and tools. Review the displayed rates; OpenRouter bills usage separately.
5. Sign in to your own Orgo account, or enter your Orgo API key.
6. Select one of your running Linux Orgo computers. Selecting it only saves the assignment. On its first computer task, the app installs its runtime on that computer.
7. Use **New instance** in the sidebar for another independent team. Each instance has separate conversations, model settings, credentials and computer selection. Instances can use the same Orgo account.

The app starts with fresh teams and no keys, imported business charters, personal computers, or saved conversations. It uses OpenRouter and Orgo directly. The hosted proxy and subscription routes from the upstream app are disabled. Local macOS automation remains macOS-only.

## Storage and operation

The default location is `%APPDATA%\Better Than GrokBot`. State is stored under `server\.data`, with separate `server-instance-N` folders for additional instances. Windows DPAPI encrypts keys for the current Windows login, with a separate namespace for every instance. Uninstall preserves saved state.

Keep the app running while using agents. The local coordinators use ports 3210 onward. An unrelated app using a required port produces a startup error rather than sharing its server. Duplicate launches focus the existing window.

## Build and test

Run `npm ci`, `npm run test:windows`, and `npm run app:build:windows` on Windows with Node 24+. The Windows workflow installs the resulting NSIS installer and tests the installed app with Node, npm and Git removed from PATH. Temporary CI credentials enable real onboarding and chat checks; no credentials are bundled.

Native test evidence and the SHA-256 checksum are attached to the release. A fresh live cloud-agent execution requires a designated test computer or spare Orgo capacity; inventory, selection and chat checks alone do not establish that result.
