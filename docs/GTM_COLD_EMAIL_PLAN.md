# Go-to-market email team with separate Hermes profiles

Experiment branch: `experiment/gtm-cold-email-profiles`.
Prepared 2026-10-08. This is a setup plan, not an installed or activated agent.

## Recommended shape

The user's latest October 8 direction supersedes the single-specialist design:
create **16 distinct Hermes role/avatar profiles**, each with its own charter,
memory, sessions and scoped skills. They form one email-focused go-to-market team
and can share the existing Orgo computer without 16 always-running model loops.

The [profile pack](gtm-email-profiles/README.md) includes five brand campaign
managers, Overall Email Campaign Manager, Data Agent, List Manager, Custom Email
Writer, independent Editorial, ESP/Deliverability, Instantly Operator, SMTP
Newsletter Operator, Reply Agent, Attio CRM Operator and ClickUp Operator.
List Manager appears once; CRM and ClickUp are separate profiles as requested.

[Shared contracts and handoffs](gtm-email-profiles/TEAM-CONTRACT.md) preserve sole
writers, independent review, separate sender infrastructure, budgets, suppression,
and task/event receipts. Databox is both the repository/service and its agent.
ESP means email service provider; “ESPN” was a typo.

A Hermes profile isolates identity/state; it is not a filesystem sandbox. Browser
profiles hold logins, skills supply procedures, and MCP supplies callable tools.
Avatar presentation is a separate runtime configuration step.

## What was actually found

- The tagged Cloudroom thread `thr_pfz5g6y8bi` is the GrokBot recovery/charter
  thread. Its handoff proposes nine email roles and leaves live GrokBot unchanged.
- On the paired Mac, `~/.hermes/profiles/ai-guy-go-to-market` exists. Its config
  names `data-box` and `browser-box`. This is configuration evidence, not a live
  tool check or proof of which process runs on the go-to-market Orgo computer.
- That profile already contains `instantly-cold-email`,
  `instantly-prospect-pipeline`, `instantly-deliverability-audit`,
  `email-deliverability-audit`, several Instantly reply skills, `verify-leads`,
  `pp-browser-box`, Listmonk, and SMTP skills.
- A separate `cold-email-agent` profile also exists. Its config references an
  Orgo computer. Do not replace or activate it merely because its name matches.
- Bops' default saved team contains no go-to-market bot. Its `ai-guy` instance
  has a Grok Bot coordinator associated with an existing Orgo computer. Bops
  profiles and Hermes profiles are separate systems; changing a Bops role does
  not install a Hermes skill.
- `/repos/data-box/CHARTER.md` and `docs/tools.md` describe plan-first paid pulls
  plus user-configured standing budgets for `enrich` and `job_board`. The bundled
  data-box skill has older provider guidance; reconcile it with the current
  charter and live tool schemas before reusing it.
- The existing `verify-leads` skill is on-demand, counts against a shared
  Reacher cap, and marks accept-all addresses sendable. The recovered GrokBot
  charter holds catch-alls. The new team sourcing/verification workflow
  needs an explicit policy change: keep accept-all/risky addresses on HOLD by
  default and preserve any stricter campaign-specific rule.
- An older local email-platform skill contains an embedded credential. Do not
  copy it into Git, a handoff, or a public skill. Sanitize the experimental copy;
  separately determine whether that credential is still active and needs rotation.

The Mac inventory is a dated observation. It does not certify Orgo connectivity,
current quotas, deliverability, provider credentials, or live sender access.

## ClickUp and Attio are required

The user's October 8 clarification makes both systems part of this specialist's
workflow. Attio is required here even though the earlier reduced GrokBot charter
called it optional. A separate always-running ClickUp or CRM agent is unnecessary;
reuse the existing writer adapters and their current schema mappings.

| Event | ClickUp | Attio |
| --- | --- | --- |
| Campaign intake | Match/create the operating task; record owner, next action, due date and brief link | Link the existing campaign/segment when supported by its actual schema |
| Data pull and verification | Record job progress, counts, cost, evidence link and blockers | Match/upsert qualified contacts and companies with provenance and verification evidence |
| Review, staging and release | Record the exact version, HOLD/review/release state and actual decision | Associate eligible prospects with the campaign and confirmed lifecycle state |
| Actual send or inbound reply | Update campaign milestones and actionable exceptions | Record real touch, channel/account/thread IDs, factual intent and next action |
| Unsubscribe or hard bounce | Record an operational exception only if work is needed | Record suppression/disposition after immediately stopping in the sender system |
| Confirmed booking or won deal | Track internal follow-up; won-client delivery belongs here | Update booking/deal only from confirmed calendar or deal evidence |
| Task completion | Mark done only when execution evidence and required sync receipts exist | Preserve the completed activity and accurate next step |

Prospect records stay in Attio. ClickUp receives operating tasks and artifact/CRM
links, not a task for every prospect or a copied lead database. Match existing
records before creating new ones; preserve unrelated fields and existing owners.
Read actual workspace/list IDs, statuses, custom fields, and Attio attributes
before writing. Do not use historical IDs or ClickUp as a substitute CRM.

Use one durable event ID for each update, with separate per-destination receipts
and readbacks. Batch related updates; do not repeatedly poll or post unchanged
status. Retry only the failed destination. After an ambiguous write timeout,
reconcile the record/event before retrying so duplicate tasks, notes, and deals
are not created. A local “sync pending” entry is not a successful external update.

If either connection fails, queue its update with the event, next retry, and
specific blocker; expose the pending count on the operating task/report. CRM or
ClickUp downtime never delays an unsubscribe or stop-on-reply action. Preserve
existing single-writer ownership so the new team and old routines cannot
both update the same record independently.

## Experiment steps

1. **Locate the running agent and team destination.** Confirm the Hermes version, active profile/home,
   gateway/process owner, and Orgo computer used by the existing go-to-market
   agent. Inspect its own CLI help rather than assuming current website flags
   exist in the installed version. Inventory MCP tool names, credential names,
   external skill directories, browser sessions, cron jobs, and inbound events.
   Use the tagged GrokBot Analyzed project as the profile/charter inventory,
   including its ops and CRM role specifications and October 8 recovery pack.
   Verify ClickUp and Attio connections, writer ownership, and current schemas.
2. **Stage isolated role profiles.** Export a private restore checkpoint and
   audit existing profile names to avoid duplicates. Use the 16 sourced charters
   and shared contract to generate version-supported Hermes profile definitions
   in an isolated lab namespace. Assign each its own home, memory and avatar
   entry; reuse curated skills from the confirmed go-to-market runtime. Never
   wholesale clone credentials into all profiles. Keep jobs, incoming webhooks,
   messaging consumers and sends inactive. Verify each profile's effective tools
   and credentials, and serialize shared browser work.
3. **Reuse and reconcile skills.** Inspect the source profile's configured shared
   skill library. Reuse its current sourcing, browser, Instantly, delivery, and
   SMTP procedures; reconcile stale local copies. Use each role charter
   to route work to the appropriate procedures. Sanitize credentials in copied skill
   text. Keep credentials in supported secret storage, referenced by name.
4. **Prove data access.** Read Databox status and its live tool schemas. Confirm
   configured sources, cost attribution, remaining budget, and job export shape.
   First process an existing approved export or synthetic fixture. For fresh
   paid pulls, prepare a specific priced plan and run it only under the user's
   applicable approval. Respect existing standing enrichment budgets without
   raising them. Record source and job IDs through qualification and dedupe.
5. **Prove verification and delivery checks.** Confirm the verifier's actual
   credential, quota, helper path, and verdict schema. Reuse recent trustworthy
   verification evidence; verify newly sourced raw addresses under the selected
   workflow. Separate deliverable, accept-all/risky, invalid, and unknown results.
   Record infrastructure health separately: a mailbox verdict does not prove
   inbox placement. Missing complaint/bounce signals remain UNKNOWN.
6. **Stage one small campaign.** Start with an existing approved offer and a
   synthetic or already approved sample batch. Produce the brief, deduped eligible
   list, exact rendered copy, delivery findings, and platform readback. For the
   first experiment, review these locally before making live platform drafts or
   uploads. Keep launch and send routines inactive throughout setup.
7. **Prove replies and SMTP.** Read real inboxes without sending; replay recorded
   reply events offline. Confirm account/thread/message dedupe, stop-on-reply,
   immediate unsubscribe suppression, and escalation rules. Validate the actual
   SMTP Reply-To mailbox through its inbound connector: SMTP alone is outbound.
   Draft one Listmonk campaign using its separate sender pool. Check unknown-send
   recovery so a timeout cannot cause a duplicate reply or campaign send.
8. **Prove ClickUp and Attio synchronization.** Read the intended workspace,
   operating list, CRM objects and current mappings. Replay offline events for
   intake, verification, HOLD, reply, unsubscribe, booking and completion.
   Validate duplicate-event and partial-failure recovery, including a successful
   Attio write followed by a failed ClickUp write. Stage a concrete sandbox/test
   write set before live writes; verify receipts and readbacks. Never mark a
   booking from a link click or Interested from an uncertain reply.
9. **Review and migrate.** Present the exact campaign version, sender allocation,
   limits, stop conditions, costs, reply playbook, and remaining blockers. Preserve
   an existing applicable authorization rather than asking again. First-time
   launches and uncovered sends need their specific release. After acceptance,
   merge the reviewed files and install them into the confirmed runtime. Disable
   overlapping old routines before enabling the replacement. Keep backups and
   restore instructions; free GrokBot for creative work only after the handoff
   proves that email operations and replies are covered.

A Git merge moves tracked files. It does not move browser cookies, secret values,
Hermes memory databases, Orgo files, or SaaS state. Those need a separate private
deployment/restore step.

## Shared state and operating rules

Keep raw leads and returned contact cards outside Git in the agent's private
workspace, with retention rules. Maintain a campaign registry, a cross-channel
suppression ledger, and a reply/send ledger. Preserve provider IDs rather than
recreating campaigns during migration.

The lifecycle is: brief → sourced → qualified/deduped → verification evidence →
eligible → reviewed copy → delivery clearance → staged/read back → released →
monitoring/replies. Each transition records its inputs and evidence. Changed
copy, lists, sender allocation, or settings invalidates the relevant clearance.

Each profile should load only the skills needed for its assigned stage. It should use
provider events and cached health snapshots rather than several duplicate
pollers. Serializing browser work avoids collisions on browser-box's shared lane.
Retain exact historical suppression and stop conditions; old volume targets are
not current capacity. Configure thresholds from current lane policies before
release; do not invent a universal bounce limit or automatic ramp.

Writer and Editorial are separate profiles, preserving the original independent
review requirement. Editorial approves the exact rendered artifact; platform
operators execute it and report actual outcomes. Profile separation alone does
not enforce access: queue/adapters must enforce writer and release boundaries.

## Acceptance evidence

- All 16 test profiles survive restart with their own state and no active inherited
  delivery routines or duplicate messaging consumers.
- Live read-only checks demonstrate Databox, browser, verifier, Instantly,
  Listmonk, ClickUp, Attio, and the actual reply inbox routes. Unavailable capabilities are
  reported individually, not hidden behind an overall success claim.
- A sample batch retains provenance and verification through dedupe. Invalid,
  unknown, risky, suppressed, or already-conversing contacts are handled by the
  recorded policy and excluded where required.
- Campaign readbacks match the exact reviewed version, sender pool, schedule,
  unsubscribe route, and limits. Instantly and SMTP exposure is deduped.
- Replayed duplicate replies, unsubscribes, and ambiguous send timeouts produce
  no duplicate sends and update suppression correctly.
- ClickUp reflects operating progress and blockers; Attio reflects qualified
  prospects and actual sales events. Duplicate/partial-failure replays produce
  one update per event and destination, with verified receipts or visible pending
  work. No prospect list is copied into ClickUp.
- A private restore checkpoint works; only sanitized configuration, procedures,
  and schemas enter this branch.

## References

- [Hermes profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)
- [Hermes browser automation](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser)
- [Instantly API](https://developer.instantly.ai/)
- [Bops computer and agent separation](../README.md#choose-models-independently-of-computers)
- Current profile/role inventory: the tagged GrokBot Analyzed project at
  `/Users/home/Desktop/GrokBot Analyzed`; specifically
  `github-package/analysis/profile-specs/ops/ROLE.md`,
  `github-package/analysis/profile-specs/crm/ROLE.md`, and the October 8
  `Launch Charters 2026-10-08` recovery/charter packs. These are design and
  recovery evidence, not proof that adapters are installed and authenticated.
- Local source evidence from the earlier cloud inspection: `/repos/data-box/CHARTER.md`,
  `/repos/data-box/docs/tools.md`, the inspected Mac Hermes profile, and the
  GrokBot charter pack saved under `Launch Charters 2026-10-08` on the Mac.
