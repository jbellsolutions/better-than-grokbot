import { createBot, renameBot, setComputer } from "@/lib/server/bots";
import { deleteBot } from "@/lib/server/remove";
import type { AppLevel, Effort } from "@/lib/types";
import { bot, update } from "@/lib/server/store";

/**
 * Create a bot. It works on the main bot's computer, or (`ownComputer`) on a copy of it made on its first
 * task, when the Orgo plan has room for one; `note` says why when it hasn't.
 */
export async function POST(request: Request) {
  const { name, role, workspaceId, ownComputer } = (await request.json()) as { name?: string; role?: string; workspaceId?: string; ownComputer?: boolean };
  const made = await createBot(name ?? "", role, workspaceId, ownComputer === true);
  if ("error" in made) return Response.json(made, { status: name?.trim() ? 409 : 400 });
  return Response.json(made);
}

/** Give or take access to an account (a null level takes it away), rename the bot, or set how hard it thinks and where it works. */
export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    botId?: string;
    hidden?: boolean;
    /** Access to one of the user's app accounts: read, act, or null for none. */
    access?: { account: string; level: AppLevel | null };
    effort?: Effort;
    runsOn?: "auto" | "cloud" | "mac";
    /** A new name: its email address, phone agents and desktop follow. */
    name?: string;
    role?: string;
    computerId?: string;
    /** Work on the main bot's computer, or its own (see setComputer). */
    computer?: "shared" | "own";
  };
  const b = body.botId ? bot(body.botId) : undefined;
  if (!b) return Response.json({ error: "no such bot" }, { status: 404 });
  if (body.hidden !== undefined && (typeof body.hidden !== "boolean" || b.isMain && body.hidden))
    return Response.json({ error: b.isMain ? "The team lead stays visible." : "Use true or false for profile visibility." }, { status: 400 });
  if (body.role !== undefined && (typeof body.role !== "string" || !body.role.trim() || body.role.trim().length > 500))
    return Response.json({ error: "Describe the agent’s role in 1–500 characters." }, { status: 400 });
  if (body.computerId !== undefined) {
    const r = await (await import("@/lib/server/existing-computers")).assignComputer(b.id, body.computerId);
    if ("error" in r) return Response.json(r, { status: 409 });
  }
  if (body.computer === "shared" || body.computer === "own") {
    const r = await setComputer(b.id, body.computer);
    if ("error" in r) return Response.json(r, { status: 409 });
  }
  if (body.name !== undefined) {
    const r = renameBot(b.id, body.name);
    if ("error" in r) return Response.json(r, { status: 400 });
  }
  update(() => {
    if (body.hidden !== undefined) b.hidden = body.hidden;
    if (body.role !== undefined) b.role = body.role.trim();
    if (body.access) {
      if (body.access.level === "read" || body.access.level === "act") (b.access ??= {})[body.access.account] = body.access.level;
      else if (b.access) delete b.access[body.access.account];
    }
    if (body.effort && ["auto", "low", "medium", "high"].includes(body.effort)) b.effort = body.effort;
    if (body.runsOn && ["auto", "cloud", "mac"].includes(body.runsOn)) b.runsOn = body.runsOn;
  });
  return Response.json({ ok: true });
}

/** Delete a bot, its computer (Bops workspace only), chat, threads and routines. */
export async function DELETE(request: Request) {
  const { botId } = (await request.json().catch(() => ({}))) as { botId?: string };
  if (!botId || !bot(botId)) return Response.json({ error: "no such bot" }, { status: 404 });
  try {
    await deleteBot(botId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
