import { answer, checkMac, DEFAULT_MAC_RULES, emptyMac } from "@/lib/server/codex";
import { getState, update } from "@/lib/server/store";
import { fromThisMac } from "@/lib/server/owner-email";
import { live } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Answer Codex's question about the user's Mac (use this app once, this session, always, or no). */
export async function POST(request: Request) {
  const { id, decision } = (await request.json()) as { id?: string; decision?: "once" | "session" | "always" | "deny" };
  if (!id || !decision || !["once", "session", "always", "deny"].includes(decision)) return Response.json({ error: "which request, and what answer?" }, { status: 400 });
  try {
    if (!answer(id, decision)) return Response.json({ error: "This request is no longer waiting in this computer." }, { status: 409 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); }
  return Response.json({ ok: true });
}

/** The user's Mac settings: the words that mean a task belongs there, apps no longer always allowed, or a fresh check. */
export async function PATCH(request: Request) {
  const body = (await request.json()) as { rules?: string[]; resetRules?: boolean; removeApp?: string; check?: boolean; enabled?: boolean };
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return Response.json({ error: "Use true or false for Mac access." }, { status: 400 });
    if (body.enabled && process.env.BOPS_DISABLE_MAC === "1") return Response.json({ error: "Mac automation is disabled by this coordinator’s configuration." }, { status: 409 });
    if (!fromThisMac(request)) return Response.json({ error: "Change Mac access from the app on your Mac." }, { status: 403 });
    if (!body.enabled && getState().sessions.some(s => s.runsOn === "mac" && (live(s) || s.codexTurn || s.macPending))) return Response.json({ error: "Stop this computer’s Mac tasks before turning off access." }, { status: 409 });
  }
  update((state) => {
    state.mac ??= emptyMac();
    if (body.enabled !== undefined) { state.mac.accessEnabled = body.enabled; state.mac.ready = false; }
    if (body.rules) state.mac.rules = [...new Set(body.rules.map((r) => r.trim()).filter(Boolean))].slice(0, 40);
    if (body.resetRules) state.mac.rules = [...DEFAULT_MAC_RULES];
    if (body.removeApp) state.mac.alwaysApps = state.mac.alwaysApps.filter((a) => a !== body.removeApp);
  });
  if (body.check || body.enabled !== undefined) await checkMac();
  return Response.json({ ok: true });
}
