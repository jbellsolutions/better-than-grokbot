import { startSession, stopSession } from "@/lib/server/sessions";
import { getState } from "@/lib/server/store";
import { live } from "@/lib/types";

/** Start a thread directly on a bot, bypassing chat (used for testing). */
export async function POST(request: Request) {
  const { botId, goal, title, taskMode, where } = (await request.json()) as { botId?: string; goal?: string; title?: string; taskMode?: "headless" | "screen"; where?: "auto" | "mac" | "cloud" };
  if (!botId || !goal?.trim()) return Response.json({ error: "botId and goal required" }, { status: 400 });
  if (taskMode && !["headless", "screen"].includes(taskMode)) return Response.json({ error: "Invalid task mode" }, { status: 400 });
  if (where && !["auto", "mac", "cloud"].includes(where)) return Response.json({ error: "Invalid task location" }, { status: 400 });
  return Response.json(startSession({ botId, goal: goal.trim(), title, taskMode, where }));
}

/** Stop one thread, every live thread of a bot, or everything. */
export async function DELETE(request: Request) {
  const { sessionId, botId } = (await request.json().catch(() => ({}))) as { sessionId?: string; botId?: string };
  const ids = sessionId
    ? [sessionId]
    : getState()
        .sessions.filter((s) => (live(s) || !!s.hermesHelpId || !!s.codexTurn || !!s.macPending) && (!botId || s.botId === botId))
        .map((s) => s.id);
  ids.forEach((x) => stopSession(x));
  return Response.json({ stopped: ids.length });
}
