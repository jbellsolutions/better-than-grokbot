import "server-only";
import { leadsTeam } from "@/lib/conversations";
import { workspaceOf } from "@/lib/types";
import { bot, getState, addMessage, patchSession, session } from "./store";
import { createBot } from "./bots";
import { deleteBot } from "./remove";
import { startSession } from "./sessions";
import { queueTurn } from "./turn-queue";
import type { ConnectedTool } from "./custom-tools";

/** Chat and task workers share the same lifecycle permissions, checked again on every call. */
export function agentManagementTools(botId: string, chatId: string, parentId?: string): ConnectedTool[] {
  const self = bot(botId);
  if (!self || !leadsTeam(self)) return [];
  const workspace = workspaceOf(self);
  const leader = () => {
    const current = bot(botId);
    if (!current || !leadsTeam(current) || workspaceOf(current) !== workspace) throw Error("Only a team orchestrator or head of operations can manage agents in this workspace.");
    return current;
  };
  return [
    { name: "list_agents", description: "Read the current team roster, including newly created and hidden agents, before assigning or removing an agent. IDs remain stable when agents are renamed.", parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        leader();
        return JSON.stringify(getState().bots.filter(b => workspaceOf(b) === workspace).map(b => ({ id: b.id, name: b.name, role: b.role, teamRole: b.isMain ? "orchestrator" : b.teamRole ?? "specialist", hidden: !!b.hidden })));
      } },
    { name: "create_bot", description: "Create a specialist agent with its own visible chat in your team. Optionally assign a first task. Use own_computer only when requested or separate logins are needed. New agents are specialists, never additional orchestrators.", parameters: { type: "object", properties: {
        name: { type: "string" }, role: { type: "string" }, own_computer: { type: ["boolean", "null"] },
        title: { type: ["string", "null"] }, goal: { type: ["string", "null"] }, task_mode: { type: ["string", "null"], enum: ["headless", "screen", null] },
      }, required: ["name", "role"], additionalProperties: false },
      run: args => queueTurn(`agent-management:${workspace}`, async () => {
        const current = leader();
        if (typeof args.name !== "string" || !args.name.trim() || args.name.trim().length > 40 || typeof args.role !== "string" || !args.role.trim()) throw Error("Provide a name up to 40 characters and a specialist role.");
        if (args.own_computer != null && typeof args.own_computer !== "boolean") throw Error("own_computer must be a boolean.");
        for (const field of ["title", "goal"]) if (args[field] != null && typeof args[field] !== "string") throw Error(`${field} must be text.`);
        if (args.task_mode != null && !["headless", "screen"].includes(String(args.task_mode))) throw Error("Invalid task mode.");
        if (parentId && typeof args.goal === "string" && args.goal.trim()) {
          const ancestors = new Set<string>();
          let parent = session(parentId);
          while (parent && !ancestors.has(parent.id)) { ancestors.add(parent.id); parent = parent.delegatedFrom ? session(parent.delegatedFrom) : undefined; }
          if (parent || ancestors.size >= 4) throw Error("Delegation cannot exceed four levels.");
        }
        const made = await createBot(args.name, args.role, workspace, args.own_computer === true);
        if ("error" in made) throw Error(made.error);
        addMessage({ chatId, role: "system", text: `${current.name} added ${args.name} (${args.role}) to the team` });
        let taskId: string | undefined;
        if (typeof args.goal === "string" && args.goal.trim()) {
          const task = startSession({ botId: made.botId, goal: args.goal, title: typeof args.title === "string" && args.title.trim() ? args.title : args.goal.slice(0, 40), chatId, sentVia: botId, taskMode: (args.task_mode ?? undefined) as "headless" | "screen" | undefined });
          taskId = task.id;
          if (parentId) patchSession(task.id, { delegatedFrom: parentId });
          addMessage({ chatId: made.chatId, role: "system", text: `${current.name} assigned the first task`, sessionIds: [task.id] });
          addMessage({ chatId, role: "system", text: `${current.name} assigned ${args.name}: ${task.title}`, sessionIds: [task.id] });
        }
        return JSON.stringify({ ...made, name: args.name, role: args.role, taskId });
      }) },
    { name: "delete_bot", description: "Remove an unneeded specialist from your team. Stops its tasks and removes its chat, routines, tools, inboxes and owned computer. This is permanent; preserve needed results first. You cannot delete yourself, an orchestrator, or a parent coordinating your current task.", parameters: { type: "object", properties: { bot_id: { type: "string", description: "The exact agent ID from list_agents." }, reason: { type: "string", description: "Why this agent is no longer needed for the user's goal." } }, required: ["bot_id", "reason"], additionalProperties: false },
      run: args => queueTurn(`agent-management:${workspace}`, async () => {
        const current = leader();
        const target = typeof args.bot_id === "string" ? bot(args.bot_id) : undefined;
        if (!target || workspaceOf(target) !== workspace) throw Error("No agent with that ID in your workspace.");
        if (target.id === botId || leadsTeam(target)) throw Error("Cannot delete yourself or a team orchestrator. Only specialists can be removed.");
        let parent = parentId && session(parentId);
        const seen = new Set<string>();
        while (parent && !seen.has(parent.id)) {
          seen.add(parent.id);
          if (parent.botId === target.id) throw Error("Cannot delete an agent coordinating your current task.");
          parent = parent.delegatedFrom ? session(parent.delegatedFrom) : undefined;
        }
        if (typeof args.reason !== "string" || !args.reason.trim()) throw Error("Explain why this specialist is no longer needed.");
        await deleteBot(target.id);
        addMessage({ chatId, role: "system", text: `${current.name} removed ${target.name}: ${args.reason}` });
        return JSON.stringify({ deleted: true, botId: target.id, name: target.name });
      }) },
  ];
}
