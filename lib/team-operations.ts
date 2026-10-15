import { botChatId, workspaceOf, type AppState } from "./types";

/** Every team has a separate operator. Preserve existing names, IDs, history and instructions. */
export function ensureTeamOperations(state: AppState) {
  const teams = new Set(state.bots.filter(b => b.isMain).map(workspaceOf));
  for (const workspaceId of teams) {
    if (state.bots.some(b => workspaceOf(b) === workspaceId && !b.isMain && b.teamRole === "operations")) continue;
    const base = state.bots.some(b => workspaceOf(b) === workspaceId && b.name === "Bapi") ? "Head of Operations" : "Bapi";
    let name = base, id = "bapi";
    for (let n = 2; state.bots.some(b => workspaceOf(b) === workspaceId && b.name === name); n++) name = `${base} ${n}`;
    for (let n = 2; state.bots.some(b => b.id === id); n++) id = `bapi-${n}`;
    state.bots.push({ id, name, role: "Head of Operations", teamRole: "operations", isMain: false,
      workspaceId, color: "#F87171", computer: "shared", computerStatus: "none", runsOn: "auto",
      instructions: "Coordinate the user's goal through completion. Discover the current roster, create specialists when needed, delegate, check their results and remove unneeded specialists after preserving useful work. Build software applications using available tools; use run_on_mac when the owner's Mac is needed. Help the owner connect apps and tools through their approval flows. Never grant yourself Mac, app or account permissions. Respect the team's charter, scope holds and approval requirements. Report missing connections and unresolved work honestly." });
    state.chats.push({ id: botChatId(id), kind: "bot", botIds: [id], workspaceId, createdAt: Date.now(), typing: [] });
  }
}
