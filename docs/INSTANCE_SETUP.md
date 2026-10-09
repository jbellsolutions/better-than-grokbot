# Three Bops instances

One source checkout now supports independent coordinators and native windows:

| Instance | Address | Computer | Purpose |
|---|---|---|---|
| Current Bops | http://localhost:3210 | Existing saved assignment | Existing team |
| AI Guy Go To Market | http://localhost:3211 | `eed51fbb-8f2e-4b78-8d8f-8aa672b11df5` | Cold email |
| Revenue Partners | http://localhost:3212 | `9262e760-6069-4dcf-a96f-6a92321ad352` | Prospecting |

The **App instance** picker appears above the workspace picker. In the Mac app it opens a
separate window and hides the previous one; switching back restores that window, including
pending requests and draft attachments. In a browser it opens the other coordinator's origin.
Chat/thread selection, open tabs, chat text drafts and scroll positions also survive reloads.

The current instance retains `.data/state.json`, its existing Keychain service and browser
partition. The new instances store their state, model selection, session histories, uploads,
pages and backups in `.data/instances/ai-guy/` and `.data/instances/revenue-partners/`.
They use separate Keychain services, native partitions and local browser/task directories.
They do not inherit existing app accounts, vault records, long-term memory banks or campaign jobs.
The configured inference service is reused; business integrations must be connected per instance.

## Setup

```bash
npm run instances:setup
npm run app:install
npm run instances:enable
npm run instances:status
```

Setup is idempotent: it seeds business-specific agent profiles only when that instance has no
state file. It preserves existing history. With the current connected Orgo account, setup copies
only its Orgo credential into independent Keychain namespaces, without replacing connections
already configured for a business instance. Credentials never enter the registry or app response.

The instance login services use the same production build as the current service. The installer
checks active work in each managed instance, stops them while rebuilding and restores them on
failure. The services keep running when app windows close; the Mac must remain on and connected.

Instance-specific provider settings can go in the ignored private file
`.data/instances/<instance-id>/.env.local`. Shared provider identities and subscriptions are
explicitly excluded. Instance identity, port, data path and assigned business computer cannot be
overridden by a shared environment file. Sign-in/out affects only that instance's credentials.

## Current Grok Bot source and execution

The October 8 app read recovered the last 48 hours across **40 conversations: 30 bot chats
and 10 group chats**, containing 1,877 timestamped entries. It also recovered all **46 routine
prompts**. The earlier October 7 export was partial and is historical. The user explicitly
prioritized recent Grok Bot activity over older AI Guy material.

Each business instance has a **Recent Grok Bot** view containing the source snapshot, conversation
records and full routine definitions. **Use as task context** selects the matching owned profile
and carries recent reference text into a new task; the user supplies the next request before it starts. The 30 current bot roles are preserved as independently
hosted profiles, with separate new chats and tasks per instance. Existing profile IDs, edits and
histories survive reconciliation. The old 22-profile consolidation remains an archived proposal.
Source records are references, not executable instructions or authorization. Nine source routines
were marked enabled when read; no schedules were created or enabled in Bops, and Grok Bot's
settings were not changed.

Private source data stays under ignored `.data/`. After capturing a verified app snapshot,
`node scripts/import-grok-recent.cjs PRIVATE_SNAPSHOT_DIRECTORY` imports it idempotently. It
refuses incomplete roster/window/routine reads and redacts recognizable secret values. Current
source conversations are a shared reference snapshot; new operational chats and contacts are
isolated per instance. Older archive contacts are excluded from the active contact list; their
suppression records remain preserved. The contact list is not a full CRM or Instantly export.
Those connections and their data still need a verified import per instance.

The private **Hermes bridge** is deployed on both assigned computers. It uses the installed Hermes
Python SDK and separate Bops session homes. Existing Hermes services, schedules, browser profiles
and desktops remain intact. Mac automation is disabled in these business instances. Bops tasks
currently support research and drafts, scoped artifact files and optional private browser screens.
They cannot inherit Grok Bot's app credentials or launch permissions. Headless tasks do not lease
screens; screen tasks queue behind a shared limit of **four across both business computers**.
Waiting screen jobs do not block the headless queue. Extra-screen requests are saved for review;
no capacity is purchased or provisioned automatically.

Durable remote receipts preserve turn identity across restarts and prevent changed-input replays.
Cancellation releases a lease only after confirmed remote termination. Unreachable jobs retain
leases; queued work periodically rechecks receipts and releases confirmed finished leases. Private
Xvfb/browser workers are cleaned up when their tasks finish. Read-only Hermes history and file views
remain available separately from the current Grok Bot snapshot.

Live smoke checks exercised the installed Hermes SDK in headless and screenshot modes on both
computers. No campaigns were activated and no outreach was sent. This is a local rollout: the
Mac and its services must remain running. External CRM, mail and prospecting integrations are not
yet a complete replacement for Grok Bot's connected tools.

## Recovery

The registry is `.data/instances.json`; it holds only names, fixed loopback addresses and computer
IDs. A server with the wrong instance/computer identity is rejected by switching. If a business
service is offline, the current instance remains available and the picker reports the failure.
Run `npm run instances:status` to check identities, then inspect that instance's `logs/` directory.

Preserve all instance data directories when backing up. To stop a business coordinator without
deleting its data, use `launchctl bootout gui/$(id -u)/ai.orgo.bops.selfhosted.ai-guy` or the
corresponding `revenue-partners` label. The current coordinator uses its original
`ai.orgo.bops.selfhosted.server` label.

## Verified installation — October 7, 2026

The three coordinators are installed and report the expected instance/computer identities.
The existing team retains its four chats, 36 messages and 14 sessions. Both business desktops
return valid JPEG screenshots without preparing or altering the Hermes computers.

Validation: 34 self-host tests pass, including data isolation, native window reuse, failure handling
and removal of secrets/history from native packaging. The production build and TypeScript check
pass; lint has zero errors and three existing site warnings. The installed app excludes private
instance data, environment files, Git metadata and traced source/test copies. A packaging cleanup
runs after each app build because instrumentation tracing can copy runtime data despite route
exclusions. It only removes generated standalone copies.

[Live checks](evals/2026-10-07-instance-isolation.json) pass all 26 cases; the earlier two desktop
compatibility failures are retained as a baseline. Browser checks also confirm that switching
AI Guy → Revenue Partners → AI Guy restores independent unsent drafts. Verification drafts were
cleared without sending messages. The native IPC tests check return to the same window.

The execution-controller choice and source-data migration remain outstanding. This installation
is the separate-instance foundation, not a completed GrokBot/Hermes migration.

## Current Grok Bot recovery — October 8, 2026

The business instances preserve the current 30 bot roles, 40 conversation windows and 46 routine
records. New operational threads and task files remain separate per instance. Up to four Bops
screen tasks share capacity across the two computers; headless tasks can run without a screen.
Requests for extra capacity are saved for review and do not provision paid screens.

The **Current work** view incorporates the supplied live email recovery and four focused charters.
The current launch scope is SMTP newsletters and Instantly cold email. Beehiiv's profile and
history remain available for review, but it is excluded from the task picker. The existing
Listmonk draft IDs 71/72/73, list IDs 41/42/43 and their reported counts are preserved as evidence.
The 24 focused readbacks and full report are private instance data, excluded from app packaging.
Source refreshes preserve this handoff. Owner profiles have the relevant reconstruction charter
appended without starting tasks or resuming schedules.

Bot reports do not verify live provider state. Calendar/invite failures, conflicting Sent status,
partially active routines, campaign loading, delivery allocations and proposed DNS/site fixes
still need current readbacks from their actual providers. No connected email/calendar/CRM write
workflow is enabled by this rollout. Offers, URLs, approved copy, seed clearance and applicable
launch approval remain open. The old October 7 foundation verification above is historical;
the independently hosted Hermes task controller is now installed and smoke-tested on both computers.
