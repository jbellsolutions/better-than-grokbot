import { codex } from "@/lib/server/codex";
import { getState } from "@/lib/server/store";
export const dynamic = "force-dynamic";

/** Approval previews remain in the worker connection, not in saved chat or ordinary state. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const pending = codex.waiting.get(id);
  if (!pending || !getState().mac?.approvals.some(a => a.id === id)) return Response.json({ error: "This approval is no longer pending." }, { status: 409 });
  let preview = pending.preview;
  // A coordinator hot reload can retain a request from the preceding client version.
  if (!preview?.command && !preview?.grantRoot && pending.threadId) {
    try {
      const task = getState().sessions.find(s => s.codexThread === pending.threadId);
      const data = await codex.request<{ thread: { turns?: { id: string; items?: Record<string, unknown>[] }[] } }>("thread/read", { threadId: pending.threadId, includeTurns: true }, 5000);
      const type = pending.method === "item/fileChange/requestApproval" ? "fileChange" : "commandExecution";
      const items = data.thread.turns?.find(t => t.id === task?.codexTurn)?.items?.filter(i => i.type === type && (pending.itemId ? i.id === pending.itemId : i.status === "inProgress"));
      if (items?.length === 1) preview = { command: items[0].command, cwd: items[0].cwd, changes: items[0].changes };
    } catch { /* Missing preview stays unavailable; it never counts as an inspected command. */ }
  }
  if (codex.waiting.get(id) !== pending) return Response.json({ error: "This approval was already resolved." }, { status: 409 });
  return Response.json({ preview: preview ?? {} }, { headers: { "Cache-Control": "no-store" } });
}
