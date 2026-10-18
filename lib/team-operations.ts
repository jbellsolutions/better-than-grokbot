import { workspaceOf, type AppState } from "./types";
import { MAIN_AGENT_ROLE, PRODUCT_NAME } from "./brand";

/** One main operator per team; keep all IDs, chats, computer links and custom instructions. */
export function ensureTeamOperations(state: AppState) {
  const teams = new Set(state.bots.filter(b => b.isMain).map(workspaceOf));
  for (const workspaceId of teams) {
    for (const agent of state.bots.filter(b => workspaceOf(b) === workspaceId)) {
      if (agent.isMain) {
        if (["Boppy", "Head of Ops", "Orchestrator", "Better Than GrokBot"].includes(agent.name)) agent.name = PRODUCT_NAME;
        agent.teamRole = "operations";
        if (!agent.role || ["Chief of Staff", "Orchestrator", "Head of Ops"].includes(agent.role)) agent.role = MAIN_AGENT_ROLE;
      } else if (agent.teamRole === "operations") {
        // Earlier builds auto-added a second lead. Preserve its work as an ordinary specialist.
        agent.teamRole = "specialist";
        if (["Bapi", "Head of Ops", "Head of Operations"].includes(agent.name)) {
          let name = "Operations Support";
          for (let n = 2; state.bots.some(b => b !== agent && workspaceOf(b) === workspaceId && b.name === name); n++) name = `Operations Support ${n}`;
          agent.name = name;
          agent.role = "Operations Support";
        }
      }
    }
  }
}
