# AI Guy and Revenue Partners: independent instances in one Bops app

Prepared October 7, 2026. Branch: `plan/ai-guy-revenue-partners`.
Original status: investigation and proposed implementation plan. Subsequent implementation of
the isolated instance shell is documented in [instance setup](INSTANCE_SETUP.md). The proposed
archive import, Hermes execution bridge and business-record migration remain separate work.

## Recommendation

Keep one maintained Bops codebase and run two independent coordinator instances, selected
from one desktop app: **AI Guy Go To Market** and **Revenue Partners**. Each instance owns
its agents, conversation history, contacts, files, memory, connections and execution state.
Attach each instance to its existing Orgo computer. A picker changes the instance being
viewed; it does not move an agent to another computer or change credentials under a running task.

This reproduces the described GrokBot account-switching behavior. A second copy of the source
code is unnecessary. A second data/runtime instance is intentional. Existing Bops workspaces
are useful teams *inside* an instance, but do not currently provide full account separation.

Confirmed business split: **AI Guy Go To Market owns cold email; Revenue Partners owns
prospecting**, including discovery, enrichment and qualification. Content creation and recording
are outside this plan. The archive also has Revenue Partners email campaigns: interpret the split
as primary responsibility, not a ban on prospecting email.
Other archived campaigns remain unassigned until their business owner is established.

## What was checked

Local source baseline: `8ca62cef6f7bb1b7249df53c35c0cad60eb07bfa`.
Migration archive baseline: `f3f8915cb66f65ee65820e6d70d7070048af68d3`.
Used authenticated GitHub reads and the running app's read-only `/api/computers` endpoint.
The supplied `/plan` URL was unavailable; the repository root and linked analysis were accessible.

| Computer | Orgo ID | Observed inventory | Proposed use |
|---|---|---|---|
| AI Guy Go To Market | `eed51fbb-8f2e-4b78-8d8f-8aa672b11df5` | Running Linux, 2 CPU, 8 GB | AI Guy instance |
| Revenue Partner | `9262e760-6069-4dcf-a96f-6a92321ad352` | Running Linux, 1 CPU, 4 GB | Revenue Partners instance |
| Content Studio Agent | `afdb8c8d-345a-4d52-ad45-e0f60e7ca9ea` | Running Linux, 2 CPU, 8 GB | Current Bops main-agent assignment; preserve |

The inventory also includes AI Guy Operator Co-Founder — Live and a Bops computer. Neither
is a target of this plan. Inventory confirms availability, not installed Hermes versions,
compatible desktop tools, free disk, current jobs, login state or workload capacity. Those still
need a read-only machine audit. No remote shell command or installation was performed.

The current local state contains one Main workspace, four agents (Boppy, Scout, Studio,
Builder), four chats, 36 messages, 14 sessions, no routines and no connected app-account records.
These are snapshot counts, not a backup or proof that jobs are idle. The two target computers
are not assigned in that saved state. No independent second instance is established by this check.

### Existing support and gaps

| Capability | Evidence in this repository | Implication |
|---|---|---|
| Team picker, create/rename teams | `components/app/sidebar.tsx`, `lib/server/workspaces.ts` | Reuse the interaction pattern for an instance picker |
| Chats, tasks, profiles persist | `lib/types.ts`, `lib/server/store.ts`, `lib/server/persist.ts` | Preserve stable IDs; do not reset when switching |
| Existing account computers | `lib/server/existing-computers.ts`, `app/api/computers/route.ts` | Borrow target computers rather than provision copies |
| Workspace memory banks | `lib/server/memory.ts` | Keep business banks separate; sharing is explicit |
| Agent name/role/model settings | `lib/types.ts`, `components/app/bot-panel.tsx` | Create our own identities and instructions |
| Connected accounts and per-agent grants | `lib/server/composio.ts`, `lib/server/vault.ts` | Useful permissions, but account inventory/vault are instance-global |
| Single local state file | `lib/server/persist.ts` | Local sign-in/out does not swap that file |
| Owner profile and provider config | `lib/types.ts`, `lib/server/orgo-auth.ts`, `lib/server/mail.ts` | Global within the current server |
| Global Keychain service | `lib/server/keychain.ts` | Two checkouts would still collide without secret namespacing |
| Shared desktop browser partition | `components/app/panel-tabs.tsx` | `persist:bops-web` must become instance-specific |
| Shared Mac browser/workspace paths and ports | `lib/server/local.ts` | `~/.bops`, Chrome profiles and CDP ports must be instance-specific |
| One desktop port and service | `desktop/main.cjs`, `scripts/enable-service.cjs` | Renaming/copying the app is insufficient |
| Contacts and business queues | No first-class contact entity in `AppState` | Add a business-record store and views/adapters |
| Hermes runtime | No Hermes adapter in the reviewed Bops code | Integration is new work, not an existing switch |

The existing workspace switch changes server-global `state.workspace`. It is not per-window
selection. The app filters chats by team, but thread selection and open tabs need an additional
scope audit. `/api/state` returns the whole instance state with selected fields redacted, rather
than isolating workspaces as separate accounts. Hosted Postgres supports state per Orgo user,
but a process still holds one user's state at a time; it does not solve concurrent local instances.

## Proposed architecture

Use a desktop instance registry with stable IDs, display names, coordinator addresses, expected
instance identity and connection status. The registry contains no provider keys or business data.
Keep the current team available as a legacy/default instance during rollout.

Each instance gets its own coordinator process, durable data directory, secret namespace,
provider clients, caches, mail/event consumers, scheduler and assigned computer. Two windows
may view different instances without changing the other's selection. Inactive instances continue
their enabled work; viewing one does not pause the other. Offline selection displays its status
without submitting work to a different instance.

Prefer a single centrally resolved data root, introduced with a backward-compatible default
to the current `.data`. Source paths for `vm/` and dependencies remain separate from data paths.
Do not implement separation merely by changing process working directories: source-linked
servers currently load both code and data relative to that directory.

Instance-owned resources:

- State, messages, session/tool histories, imported transcripts, uploads, generated pages,
  artifacts, backups, install identity and audit log.
- Contacts, source records, relationship notes, campaigns, queues, charters, approvals,
  suppressions, sender reservations and usage/budget records.
- Owner/business profile, agent role versions, model choices, memory-bank names and policies.
- Keychain accounts, provider configuration, connected SaaS accounts, callbacks/subscriptions,
  email inbox mappings and webhook routing identity.
- Electron storage partitions, Mac browser profiles, local task files, CDP port allocations,
  service labels, log paths, computer assignment and any Hermes profile/session bindings.

Application updates and role/skill *templates* can be shared. Copying a template creates a new
identity; it does not copy chats, browser cookies, secrets or operational authority. Sharing a
contact or memory record between businesses requires an explicit handoff with provenance.

Instance isolation cannot independently isolate the user's whole Mac desktop, system apps or
Codex account. Default business work to its assigned Orgo computer. Serialize any explicitly
requested Mac desktop automation across instances and report its real destination.

## Computer and execution ownership

Attach the AI Guy and Revenue Partner UUIDs explicitly as borrowed computers. Do not rely on
the global `BOPS_ORGO_COMPUTER_ID` across both instances: today's provisioning can give every
new main agent that same pinned computer. Require a selected target for these business instances,
and fail clearly if it is unavailable; never silently clone or fall back to another business's VM.

Existing computer assignment does not import that computer's agents, chats, files or contacts.
It only sets an execution destination. Moreover, first-task setup currently installs Bops tools,
ensures screens and applies desktop appearance. Add a reviewed attachment/preflight path before
using this on an existing GrokBot/Hermes machine. Inventory existing processes, screen/browser
ownership, profiles, directories and jobs; take a private backup; avoid overwriting their runtime.

Use a machine lease shared across all controllers, or designate one controller exclusively.
Today's screen ledger coordinates only tasks inside one Bops process. Two instances or Bops and
Hermes operating one VM would otherwise bypass that protection. API-only work can proceed
independently; screen/browser work must have a single owner at a time.

Keep the first coordinator implementation on the existing always-on Mac service. Both instances
depend on that Mac remaining powered on, online and signed in. Closing the UI is supported;
Mac shutdown is not cloud continuity. A future remote-coordinator deployment is a separate phase,
including authentication and the loss of Mac-only tools. Observe the 4 GB Revenue Partner VM
under the pilot workload before proposing resizing or moving a coordinator onto it.

### Hermes integration

Bops is the interface, history and approval surface. Introduce a runtime adapter contract for
start/continue/stop/status and ordered execution events, with explicit instance, agent, task and
external-session IDs. Preserve the existing Bops executor while auditing actual installed Hermes
versions. Implement a Hermes adapter only against verified supported interfaces.

For any task, one runtime owns execution and one scheduler owns its recurring job. No simultaneous
Bops and Hermes runs of the same routine. Persist external session mappings and event sequence
numbers so reconnect/replay does not create duplicate tasks, messages or sends. Surface runtime
availability honestly. Preserve historical conversations as history; continuing one starts or
resumes a supported new-runtime session with selected relevant context and a link to the source.

## Our profiles and the initial business split

Use the archive's 32-to-22 reconciliation as a starting catalog, not a requirement to run 22
permanent agents. Retain the source-role mapping even when several sources become one profile.
Each editable profile specifies name, purpose, business, instructions, tools/account permissions,
execution runtime, model, skills and instruction version. Existing tasks retain their original
instruction version; future tasks use the saved revision.

| Instance | Proposed starting roles | Records it owns |
|---|---|---|
| AI Guy | Ops, AI Guy campaign owner, Data, List Manager, Writer, independent Editorial, Deliverability, Instantly, Replies, CRM | Cold-email charters, contact lists, verification, copy, campaign approvals, sending assets, replies and conversation history |
| Revenue Partners | Ops, Lead Radar consumer, Revenue Prospector, Data, List Manager, Writer, independent Editorial, Deliverability, Instantly, Replies, CRM | Intent evidence, contacts, verified lists, partner charters, campaign artifacts and CRM outcomes |

Dream Partners can be added to Revenue Partners as briefs-only work. Add newsletters, LinkedIn,
affiliate and other campaign roles only when their owner and pilot scope are clear. Shared role
definitions produce separate per-instance identities and grants. Sharing a provider's credential
does not justify sharing its full account inventory with both businesses.

AgentMail bot correspondence is distinct from Instantly campaign delivery. Preserve existing
Instantly mailboxes, campaigns and sender identities through reviewed adapters. A new Bops inbox
does not replace or migrate them. Writer and Editorial remain independent responsibilities.

## Importing the GrokBot history and business state

Use the sanitized private archive as evidence. Keep raw/recovered business data outside this
source repository. Record an import manifest containing source repository commit, checksums,
source computer/account, original IDs, target instance, record counts, coverage and exclusions.

1. Inventory profiles, transcripts/conversation blobs, files, charters, routines, lists and
   suppression data. Establish the business owner of each record; unresolved items stay in a
   private staging archive, rather than defaulting to AI Guy.
2. Import recovered chats read-only with original author, timestamp, source thread and source
   agent ID. Preserve group-room history even if the new workflow replaces rooms with queues.
   Support browsing/search and explicit continuation; never imply old tool sessions still run.
3. Adapt reviewed prompts into our profile format. Retain many-to-one source mappings, conflicting
   instructions and missing inputs for review. Extract curated, dated facts into separate memory
   banks; do not load all historical messages into every prompt.
4. Normalize contact identity, provenance, linked conversations, source lists, verification,
   campaign membership, unsubscribe/suppression status and actual completed touches. Deduplicate
   within a business without losing original IDs. Read current SaaS state separately: backup data
   is historical, not a current campaign snapshot.
5. Index computer files by instance and source path. Use selective copies or
   references; a VM filesystem dump is not an application data model. Show import gaps and broken
   artifact references rather than inventing absent records.
6. Import routines disabled with one scheduler owner and timezone. Reconnect accounts through
   supported auth flows. Make imports idempotent using instance + source + original record ID
   and checksum; reruns produce a report rather than duplicate contacts or conversations.

The archive documents missing/partial October 5–7 chats and 18 missing routine prompts. Its
database export includes a Lead Radar database with zero contact rows; that does not mean the
business has no contacts. Locate actual warehouse/SaaS/list sources before promising full coverage.
No claim of “everything migrated” is valid until coverage is measured against those sources.

Preserve the archive's existing fleet pause, campaign-specific first-launch decisions, Dream
briefs-only policy, Outflo replies-only policy, sole writers, suppression and deliverability holds.
Source contacts and source mailboxes alone do not authorize a send. The first pilot remains
read-only/draft, with versioned artifacts and explicit execution authority in the adapters.

If the same contact exists in both businesses, retain separate business histories. Before outbound
execution, define narrowly scoped cross-business dedupe/suppression and sender-asset reservations.
An explicit coordination service may exchange identity keys and blocks without sharing private
conversation notes. Until that is defined, keep outbound pilots in draft mode.

## Implementation sequence and acceptance gates

### 1. Audit and checkpoint

Read-only audit of both chosen VMs, installed Hermes, current jobs, source data locations, shared
SaaS assets and scheduler ownership. Confirm record ownership within the established cold-email
and prospecting split.
Take private backups of the current Bops data and destination runtime before adaptation.

Gate: exact destination identities, coverage manifest, compatibility findings and a reviewed
attachment plan; existing Content Studio state remains recoverable.

### 2. Isolated coordinator instances

Centralize data roots and instance IDs; namespace secrets, browser sessions, local task paths,
ports, service labels and logs. Add identity-bearing health/state responses. Update desktop and
service launching for multiple endpoints; migrate the current `.data` only through a checked,
backed-up operation with legacy behavior supported. Each instance must refuse mismatched identity.

Gate: two instances can use identical agent names without sharing state, cookies or credentials;
both survive restart and retain histories. A failed start cannot attach to a different instance.

### 3. Instance picker and history restoration

Build selection on top of the registry, separately from workspace selection. Scope polling,
versions, in-flight requests, chat/thread/tab selection, draft text and notifications by instance.
Capture the originating instance for every mutation; discard stale responses after a switch.
Remember each instance's last conversation, task, tabs and scroll position. Create a rendered
preview for UI review during this implementation phase.

Gate: A → B → A restores the same conversation and draft; a slow response, task completion or
pending approval from A cannot appear in or mutate B. Independent windows remain independent.

### 4. Borrowed computer attachment and runtime adapters

Implement compatibility preflight and exclusive machine ownership. Attach reviewed targets;
exercise existing Bops execution with a harmless pilot. Add version-verified Hermes mapping and
event ingestion where warranted. Expose computer files and runtime status through scoped views.

Gate: task destination is verifiable; unavailable machines block clearly; attachment preserves
existing files/jobs and does not reset, resize or replace a borrowed VM. Replayed runtime events
are deduplicated; stop/continue obey actual runtime capabilities.

### 5. Importer, profiles and contacts

Dry-run source mappings first; implement private archive import, conversation search/continuation,
versioned profile editing and contact views backed by scoped records/adapters. Preserve external
CRM as the write authority rather than creating competing write paths. Keep business tables and
bulk contact/transcript data out of the frequently polled `AppState` payload; use scoped pagination.
Choose storage using existing dependencies after inspecting real dataset sizes.

Gate: counts/checksums and sampled author/timestamp mappings match source; reimport is harmless;
missing records are visible; contacts, chats and profile context stay with the correct business.

### 6. Replay, shadow and reviewed cutover

Replay the archive's 30 cold contacts, 30 intent records, 10 Dream subjects and 20 reply threads.
Then shadow one charter and the intent queue for five days, with Dream briefs read-only. Measure
quality, provider/model/VM costs, recoverability and capacity. Test restarts, offline switching,
duplicate callbacks, suppressions, approval scope and failed partial imports. Reuse relevant
self-host checks and typecheck/lint for implementation; add meaningful isolation/replay tests.

Gate: reviewed evidence and rollback, followed by the owner's applicable launch decisions.
Rollback freezes new execution, retains the new histories, and restores prior assignments/config
from checkpoints without re-enabling the old paused fleet or replaying outbound actions.

## Decisions remaining before implementation

- Choose whether the first business pilot uses existing Bops execution or requires Hermes
  immediately, after the installed-runtime audit. The shell should support either direction.
- Identify the authoritative contact stores and ownership of overlapping campaign/mail assets.
- Confirm local always-on coordination for the first release versus a separate remote-host phase.

These choices do not block the completed source investigation. They do block assumptions about
the runtime adapter implementation and live data cutover. No new package
dependency is selected by this plan. This checkout uses FSL-1.1-ALv2 with a competing-service
restriction; review intended distribution separately before offering it as a commercial service.

## References

- [Archive README and recovery scope](https://github.com/jbellsolutions/grokbot-hermes-migration)
- [Migration plan](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/analysis/hermes-migration-plan.md)
- [32-to-22 reconciliation](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/analysis/deep-dive-32-to-22-reconciliation.md)
- [Agent mapping](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/analysis/agent-mapping.csv)
- [Room mapping](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/analysis/room-mapping.csv)
- [Gap audit](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/analysis/gap-audit-2026-10-07.md)
- [Chat coverage](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/provenance/chat-coverage.json)
- [Database export coverage](https://github.com/jbellsolutions/grokbot-hermes-migration/blob/main/provenance/database-exports.json)

Verification for this planning change: inspected existing code and saved-state metadata, queried
live computer inventory read-only, read the private archive's design/mapping/coverage documents,
and checked the documentation diff. Runtime setup and end-to-end switching were not tested;
they are proposed work, not completed behavior.
