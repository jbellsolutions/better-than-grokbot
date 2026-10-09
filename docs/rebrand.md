# Better Than GrokBot rename inventory

The independent self-hosted fork is **Better Than GrokBot**. Its public domain is `betterthangrokbot.com`.

| Surface | Result |
| --- | --- |
| Landing page, metadata, install copy, download names | Better Than GrokBot |
| Next.js app title and self-hosted UI messages | Better Than GrokBot |
| Electron window, startup, notifications, application name | Better Than GrokBot |
| Native app build, installer, portable ZIP, release workflow | Better Than GrokBot |
| Source ZIP and Railway website deployment | Better Than GrokBot |
| Checkpoint's optional share ZIP | New ZIP filename |
| Self-hosted bundle ID, launchd services, update services | Retained for compatibility |
| `BOPS_*`, API routes, database schema, computer template and workspace IDs | Retained for compatibility |
| `~/Library/Application Support/Bops Self-Hosted`, logs, backups | Retained; existing state is reused |
| Hosted Bops account plans, official update feed, upstream repository | Original names retained; these describe upstream services |
| License, trademark notice, upstream attribution | Preserved |

The rename was merged into the Mac's newer `experiment/gtm-cold-email-profiles` checkout (`34c0128`) on October 9, 2026, preserving instance switching, build rollback and profile management. The same rename was applied to `/Users/home/Bops Chief Sales Officer` (the live background service source, `0d3b5cd`) and `/Users/home/Bops Revenue Partner` (`a7ffe07`). A fresh production native build installs at `/Applications/Better Than GrokBot.app`. The prior self-hosted app was quit and retained as a fallback; the separate upstream `/Applications/Bops.app` remains available.

Future rebuilds use `npm run app:install` on the Mac. The installer refuses active work. The renamed app retains the self-hosted bundle ID and user data location; macOS may request permissions again for unsigned builds.

Standalone downloads use the existing self-hosted Application Support folder. The rename does not copy or publish the owner's keys, chats, source pointer, computer assignments, or recovery images.

Deployment progress and access-dependent work are recorded in `site/README.md`.
