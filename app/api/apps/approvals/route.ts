import { answerApp, removeAlways } from "@/lib/server/composio";
import { ownerName } from "@/lib/server/store";

/** The user's yes or no to an app action a bot asked about; "always" also stops it asking again where that's offered. */
export async function POST(request: Request) {
  const { id, yes, always } = (await request.json().catch(() => ({}))) as { id?: string; yes?: boolean; always?: boolean };
  if (id) answerApp(id, !!yes, { always: !!always, by: ownerName() });
  return Response.json({ ok: true });
}

/** Stop always allowing an action (?always=<rule id>): the bot asks again next time. */
export async function DELETE(request: Request) {
  const rule = new URL(request.url).searchParams.get("always");
  if (rule) removeAlways(rule);
  return Response.json({ ok: true });
}
