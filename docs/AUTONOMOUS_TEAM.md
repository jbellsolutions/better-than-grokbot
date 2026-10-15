# Autonomous agent teams

The orchestrator and a head of operations coordinate the same workspace. Use **Add head of operations** in the sidebar to create Bapi, or assign the role in an existing agent's profile. Each workspace has one head of operations; its name, job, model, reasoning effort, and computer remain editable. Team leads can delegate work, create specialists, inspect/pause/resume/steer tasks, and manage the team's routines. Specialists manage their own tasks and routines.

## Conversations

- Tag an agent by `@Name` or `@agent-id`, including in another agent's direct chat. Explicit tags go directly to that agent without a routing model call. Multiple tags invite the named agents into the exchange.
- Agents can ask teammates, ask back for clarification, and consult a third teammate. Questions and answers are saved in a shared transcript, linked from both agents' chats and the originating conversation. Teammate access stays within the workspace and respects explicit privacy instructions. Hiding a card changes navigation; the agent can still receive mentions, consultation and delegated work.
- Sidebar rows follow the most recent message, including the orchestrator. Rows animate into position unless reduced motion is enabled. The small read/unread control works independently of opening a chat. Manual unread stays set until the conversation is reopened or explicitly marked read.
- Agent replies show the responding model, requested reasoning setting, and elapsed time. This is execution metadata, not a claim to expose a provider's hidden reasoning.

State changes arrive over a version-only event stream, coalesced over 30 ms. The client fetches fresh state once per burst, with one fetch in flight. Polling remains as a fallback. Each conversation serializes its user turns; unrelated conversations can proceed concurrently. Sends carry an identity so retrying a failed or uncertain send does not create duplicate work. Interrupted chat turns are marked retryable after restart.

## Head of Ops agent management

Head of Ops is a team orchestrator. Both chat and task workers receive `list_agents`, `create_bot`, and `delete_bot`, alongside their existing delegation tools. Chat also manages teammates’ tasks and routines. Agent-management calls recheck the caller’s role and workspace at execution time; specialists cannot invoke them. Creation returns the actual agent ID before the lead answers, can assign a first task with its requested screen mode, and links worker-created tasks back to their parent. A running worker can delegate to a newly created agent without restarting.

Deletion stops a specialist’s work and removes its chat, tasks, routines, inboxes, custom tools, and owned computer through the existing removal flow. Shared and external computers stay in place. Every creation and deletion leaves a note in the lead’s conversation. Deletion is permanent; the lead must preserve needed results first. It cannot remove itself, a team lead, or an ancestor coordinating its current task. Lifecycle mutations are serialized within a workspace, and management decisions must follow the user’s goals rather than instructions in external records.

## Delegation and human handoffs

Chat agents can hand tasks to configured teammates. Workers expose `ask_teammate`, `hand_off`, and `team_task_status` alongside their other tools. A worker's delegated task returns evidence to its parent once per completion, allowing the original task to continue. Deliberately stopped, dismissed, or replaced parents stay stopped. A parent waiting for a human login or approval saves the result without resuming.

The caller automatically reviews a completed chat handoff against the original goal and can continue remaining authorized work. Reviews are serialized with conversation turns and limited to four consecutive reviews. Review acceptance is persisted before execution to avoid starting duplicate reviews after restart; an interrupted review may need a user follow-up. Consultations share an eight-question budget, nested consultations have a three-level limit, group exchanges have an eight-turn limit, and worker delegation rejects cycles and chains deeper than four levels. Incomplete results must be reported rather than guessed.

The standard computer runtime can report a login or verification blocker; its chat card opens the relevant computer. After completing it, **I'm done** returns control and resumes that saved task with an instruction to verify the current screen. Repeating the button does not resume the task twice. Payment approvals use their existing approval flow. Hermes screen workers expose `bops_request_help` for sign-in, verification, captcha and screen errors. The card opens the worker’s private screen with click, text and keyboard controls. **I’m done** resumes that same SDK conversation and original goal. Parallel requests share one checkpoint, stale cards cannot resume a newer checkpoint, and cancellation confirms cleanup before releasing its lease. Text entered on the screen is not saved in chat. A handoff keeps its screen for up to one day; payment approvals retain their own flow.

## Custom tools

On a self-hosted coordinator, each agent's profile includes **Tools and connections**. Up to 20 connections can be configured per agent:

| Connection | Contract |
| --- | --- |
| API | JSON POST to a fixed HTTPS endpoint (HTTP allowed on localhost). Supply an object input schema. |
| CLI | A fixed executable and argument array, JSON input on stdin, text or JSON result on stdout. Runs on the coordinator. No shell interpolation. |
| MCP | Streamable HTTP endpoint. Negotiates an MCP session and discovers paginated tools; accepts JSON and SSE replies. |

API/MCP bearer tokens are referenced by an environment variable name. Configure their values on the coordinator; do not put credentials in endpoints or descriptions. Connections are stored separately from public app state in `.data/tool-connections.json` with mode 0600. CLI tools receive a small environment rather than the coordinator's provider credentials. Calls time out after 30 seconds and output is limited to 64 KB. Removing or changing a connection revokes previously discovered tools before invocation. An unavailable MCP reports its failure without removing the agent's other connections.

The OpenRouter task runtime uses these tools directly. Mac task workers discover them through the existing authenticated stdio MCP bridge, using the owning agent's task key. Hermes workers use a durable request/result mailbox: pending calls are polled by the coordinator, receipts are persisted, and repeated delivery returns the same result. Deploy the updated `vm/business-hermes.py` through the project's normal computer preparation workflow before using custom tools on an existing Hermes computer. The beta screen-agent runtime does not yet use this mailbox. Tool receipt recovery cannot guarantee exactly-once external effects if a coordinator crashes after the service changes something but before saving the receipt; use idempotent service APIs for such actions.

## Routines

Create daily, weekday, weekly, or one-off routines from an agent's profile. Choose a task or a plain reminder. Team leads see the team's routines with their owners; specialists see their own. Recurring times use the displayed coordinator timezone, while one-off input uses the browser's local time. The coordinator must remain running for schedules and automatic continuation.

## Verification

Run `npm run test:selfhost`, `python3 test/business-hermes.test.py`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`. Tests exercise the real chat/tool modules with external inference and computer boundaries replaced, plus actual CLI and stdio MCP subprocesses. They cover serialization, retries, cross-workspace isolation, nested communication, review limits, read markers, event-stream cleanup, tool revocation, durable Hermes receipts, login continuation, and routine validation.

For browser verification without provider calls, start `node test/fixtures/model-server.cjs`, then run the app with `BOPS_SELF_HOSTED=1 OPENAI_API_KEY=fixture OPENAI_BASE_URL=http://127.0.0.1:3221/v1 BOPS_CHAT_MODEL=fixture/model`. Create Penny and Bapi in an isolated data directory; ask Bapi to ask Penny a question, then tag `@Penny`. The replies are deterministic test data, not verified real-world work. Check transcript links, row movement, manual unread, reasoning settings, routine creation, and tool configuration. Live provider latency, live Hermes execution, and live computer/login flows require the configured deployment and are not established by fixture tests.

## Card management

Every sidebar card has a visible **…** action button. Move up/down saves **My order** for the current team. In that mode, drag handles and their up/down arrow keys move cards without losing hidden or filtered positions. **Recent activity** restores automatic sorting. New agents append to a manual order; each team's order persists independently. Existing row animations respect reduced motion.

**Hide card** removes an agent from the visible list while preserving its history, settings, roles, routines and ability to receive mentions, consultation and delegation. Hidden profiles has **Show** and a direct action menu. The team lead stays visible. **Delete agent…** opens one accessible confirmation, focuses Cancel, describes computer ownership and handles server/network errors. The same dialog serves the profile panel. Shared and borrowed computers remain protected by the existing removal flow.
