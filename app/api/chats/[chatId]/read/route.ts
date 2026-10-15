import { chat, update } from "@/lib/server/store";

/** Mark a chat read, which clears its unread dot. */
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[chatId]/read">) {
  const { chatId } = await ctx.params;
  const c = chat(chatId);
  if (!c) return Response.json({ error: "no such chat" }, { status: 404 });
  const { unread, through } = await request.json().catch(() => ({})) as { unread?: boolean; through?: number };
  if (unread !== undefined && typeof unread !== "boolean") return Response.json({ error: "unread must be true or false" }, { status: 400 });
  if (through !== undefined && (!Number.isFinite(through) || through < 0)) return Response.json({ error: "invalid read position" }, { status: 400 });
  update(() => {
    c.unread = unread === true;
    if (!c.unread) c.readAt = Math.max(c.readAt ?? 0, Math.min(through ?? Date.now(), Date.now()));
  });
  return Response.json({ ok: true });
}
