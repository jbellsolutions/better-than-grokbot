import { createRoutine, deleteRoutine, setRoutineEnabled } from "@/lib/server/routines";
import type { Schedule, Routine } from "@/lib/types";

export async function POST(request: Request) {
  const { botId, title, goal, schedule, where, reminder } = (await request.json()) as { botId?: string; title?: string; goal?: string; schedule?: Schedule; where?: Routine["where"]; reminder?: string };
  if (!botId || !goal || !schedule) return Response.json({ error: "botId, goal and schedule required" }, { status: 400 });
  if (typeof goal !== "string" || title !== undefined && typeof title !== "string" || reminder !== undefined && typeof reminder !== "string") return Response.json({ error: "Use text for the routine's title, goal and reminder." }, { status: 400 });
  if (where !== undefined && !["auto", "mac", "cloud"].includes(where)) return Response.json({ error: "Invalid task location." }, { status: 400 });
  try { return Response.json(createRoutine(botId, title || goal.slice(0, 40), goal, schedule, { where, reminder })); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const { id, enabled } = (await request.json()) as { id?: string; enabled?: boolean };
  if (!id || enabled === undefined) return Response.json({ error: "id and enabled required" }, { status: 400 });
  setRoutineEnabled(id, enabled);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = (await request.json()) as { id?: string };
  if (id) deleteRoutine(id);
  return Response.json({ ok: true });
}
