import { handleMessage } from "@/lib/server/chat";
import { after } from "next/server";
import { uploadPath } from "@/lib/server/uploads";
import { deleteMessage } from "@/lib/server/remove";
import { chat, react } from "@/lib/server/store";
import type { Tapback } from "@/lib/types";

/** The user texts a bot or a group. Replies, threads and hand-offs happen in the background. */
export async function POST(request: Request, ctx: RouteContext<"/api/chats/[chatId]/messages">) {
  const { chatId } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid message" }, { status: 400 });
  const { text, replyTo, images, requestId } = body as { text?: string; replyTo?: string; images?: { id: string; type: string; w?: number; h?: number }[]; requestId?: string };
  if (!chat(chatId)) return Response.json({ error: "no such chat" }, { status: 404 });
  if (text !== undefined && (typeof text !== "string" || text.length > 50000)) return Response.json({ error: "message must be text, at most 50,000 characters" }, { status: 400 });
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId))) return Response.json({ error: "invalid message identity" }, { status: 400 });
  if (replyTo !== undefined && typeof replyTo !== "string") return Response.json({ error: "invalid reply" }, { status: 400 });
  if (images !== undefined && (!Array.isArray(images) || images.some(i => !i || typeof i.id !== "string" || typeof i.type !== "string"))) return Response.json({ error: "invalid attachments" }, { status: 400 });
  const pics = (images ?? []).filter((i) => uploadPath(i.id)).slice(0, 10);
  if (!text?.trim() && !pics.length) return Response.json({ error: "empty message" }, { status: 400 });
  // Persist acceptance immediately and keep the work attached to the server request lifecycle.
  const work = handleMessage(chatId, text?.trim() ?? "", replyTo, pics, undefined, undefined, undefined, requestId);
  after(async () => { await work; });
  return Response.json({ ok: true });
}

/** Delete one message. */
export async function DELETE(request: Request) {
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id) return Response.json({ error: "which message?" }, { status: 400 });
  deleteMessage(id);
  return Response.json({ ok: true });
}

/** The user's tapback on a message: set it, change it, or (null) take it back. */
export async function PATCH(request: Request) {
  const { id, reaction } = (await request.json().catch(() => ({}))) as { id?: string; reaction?: { type?: Tapback; emoji?: string } | null };
  if (!id) return Response.json({ error: "which message?" }, { status: 400 });
  react(id, "owner", reaction ?? null);
  return Response.json({ ok: true });
}
