import { replyToSession, returnControl, resumeBusinessSessions } from "@/lib/server/sessions";
import { resumeHermesHandoff } from "@/lib/server/business-runtime";
import { watchInstead } from "@/lib/server/watches";
import { session, getState, patchSession } from "@/lib/server/store";
import { live } from "@/lib/types";

/** The user replies inside a thread; the bot takes it as its next turn. */
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[sessionId]/reply">) {
  const { sessionId } = await ctx.params;
  const { text, handoff, helpId } = (await request.json()) as { text?: string; handoff?: boolean; helpId?: string };
  const task = session(sessionId);
  if (!task) return Response.json({ error: "no such thread" }, { status: 404 });
  if (!live(task) && (task.codexTurn || task.macPending)) return Response.json({ error: "This Mac turn still needs confirmed cleanup. Stop it or wait for its final status before retrying." }, { status: 409 });
  if (handoff === true) {
    if (task.blocker === "payment") return Response.json({ error: "Review the payment on its approval card." }, { status: 409 });
    if (!task.blocker) return Response.json({ ok: true });
    if (task.runtime === "hermes") {
      if (!helpId || helpId !== task.hermesHelpId) return Response.json({ error: "This handoff changed. Open the current card before returning control." }, { status: 409 });
      try {
        if (await resumeHermesHandoff(sessionId, helpId)) resumeBusinessSessions();
        return Response.json({ ok: true });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); }
    }
    patchSession(sessionId, { blocker: undefined, waitingOnYou: false });
    if (getState().takeover?.sessionId === sessionId) returnControl();
    else replyToSession(sessionId, "The user says the login or check is done. Inspect the current screen, verify it succeeded, and continue the original task.", "You completed the login or check");
    return Response.json({ ok: true });
  }
  if (!text?.trim()) return Response.json({ error: "empty reply" }, { status: 400 });
  // "Keep an eye on this" becomes a watch on the thread's screen instead of the thread checking itself.
  const watch = await watchInstead(sessionId, text.trim()).catch(() => null);
  if (!watch) replyToSession(sessionId, text.trim());
  return Response.json({ ok: true, watch });
}
