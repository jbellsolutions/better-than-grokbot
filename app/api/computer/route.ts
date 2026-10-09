import { DISPLAYS, sharesComputer } from "@/lib/types";
import { currentPage } from "@/lib/server/local";
import { ensureComputer, ensureScreens, resetComputer } from "@/lib/server/sessions";
import { screenEndpoint, workComputer } from "@/lib/server/screens";
import { orgo } from "@/lib/server/orgo";
import { bot } from "@/lib/server/store";
import { observedScreens } from "@/lib/server/existing-computers";

export const dynamic = "force-dynamic";

/** The Orgo computer a bot works on (its own, or the main bot's it shares): status, size, screens, and what page each screen has open. */
export async function GET(request: Request) {
  const b = bot(new URL(request.url).searchParams.get("bot") ?? "");
  const computerId = b && workComputer(b).computerId;
  if (!b || !computerId) return Response.json({ computer: null });
  try {
    const [computer, screens, pages] = await Promise.all([
      orgo.computer(computerId),
      process.env.BOPS_COMPUTER_OBSERVE_ONLY === "1" ? observedScreens(computerId) : orgo.screens(computerId),
      Promise.all(DISPLAYS.map(async (d) => {
        const ep = screenEndpoint(b, d);
        return [d, ep ? await currentPage(ep).catch(() => null) : null] as const;
      })),
    ]);
    return Response.json({ computer, screens: screens.map((s) => s.display), pages: Object.fromEntries(pages.filter(([, p]) => p)) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * Give a bot its computer (a clone of Sam's, or Sam's own when it shares), or finish setting up one that
 * didn't get there, or bring back the screens of one that's ready.
 */
export async function POST(request: Request) {
  if (process.env.BOPS_COMPUTER_OBSERVE_ONLY === "1") return Response.json({ error: "Hermes owns this computer; Bops is connected for viewing." }, { status: 409 });
  const { botId } = (await request.json()) as { botId?: string };
  const b = botId ? bot(botId) : undefined;
  if (!b) return Response.json({ error: "no such bot" }, { status: 404 });
  const c = workComputer(b);
  if (c.computerStatus !== "ready") void ensureComputer(b.id);
  else if (c.computerId) {
    void ensureScreens(c.computerId).catch(() => {});
    if (!c.externalComputer && c.computerId !== process.env.BOPS_ORGO_COMPUTER_ID) void orgo.growDisk(c.computerId).catch(() => {});
  }
  return Response.json({ ok: true });
}

/** Delete a bot's computer (only ever one in the Bops workspace); it gets a fresh one on its next task. */
export async function DELETE(request: Request) {
  const b = bot(new URL(request.url).searchParams.get("bot") ?? "");
  if (!b) return Response.json({ error: "no such bot" }, { status: 404 });
  // A bot that shares has no computer of its own; deleting the main bot's is done from the main bot.
  if (sharesComputer(b)) return Response.json({ error: `${b.name} works on the main bot's computer, so there's nothing of its own to reset` }, { status: 409 });
  try {
    await resetComputer(b.id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
