import { checkMailNow, ensureInbox, mailOn, startMail, mailStatus, setupDomain, verifyDomain } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

/** Email for bots (lib/server/mail.ts): whether it's on, and bops.bot's DNS records and status. */
export async function GET() {
  return Response.json(await mailStatus().catch((e: Error) => ({ on: true, error: e.message })));
}

/** { action: "setup" } adds bops.bot to AgentMail (DNS records come back); { action: "verify" } checks the DNS again; { action: "check" } looks for new email now. */
export async function POST(request: Request) {
  const { action, botId } = (await request.json().catch(() => ({}))) as { action?: string; botId?: string };
  try {
    if (action === "inbox" && botId) {
      if (!mailOn()) return Response.json({ error: "Connect AgentMail first to create an inbox." }, { status: 400 });
      const email = await ensureInbox(botId);
      if (!email) return Response.json({ error: "No inbox could be created for this agent." }, { status: 400 });
      startMail();
      return Response.json({ email });
    }
    if (action === "setup") return Response.json(await setupDomain());
    if (action === "verify") return Response.json(await verifyDomain());
    if (action === "check") return Response.json((await checkMailNow(), await mailStatus()));
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
