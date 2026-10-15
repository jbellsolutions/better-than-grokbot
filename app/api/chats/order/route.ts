import { workspaceOf } from "@/lib/types";
import { getState, update } from "@/lib/server/store";

/** Save a team's manual card order, or return it to recent activity. */
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const state = getState();
  const workspace = state.workspaces?.find(w => w.id === body?.workspaceId);
  if (!workspace) return Response.json({ error: "No such team." }, { status: 404 });
  const chats = state.chats.filter(c => (c.workspaceId ?? workspaceOf(state.bots.find(b => b.id === c.botIds[0]))) === workspace.id);
  const ids = new Set(chats.map(c => c.id));
  const order: unknown = body?.chatIds;
  if (order !== null && (!Array.isArray(order) || order.some(id => typeof id !== "string" || !ids.has(id)) || new Set(order).size !== order.length))
    return Response.json({ error: "Use unique conversation IDs from this team." }, { status: 400 });
  update(() => {
    if (order === null) delete workspace.chatOrder;
    else workspace.chatOrder = [...order as string[], ...chats.filter(c => !(order as string[]).includes(c.id)).map(c => c.id)];
  });
  return Response.json({ ok: true });
}
