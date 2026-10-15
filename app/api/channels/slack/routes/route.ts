import { slackRoutes } from "@/lib/server/channels";
import { ensureSlackAppAccount, learnFrontDoor, slackApp } from "@/lib/server/slack-api";

export const dynamic = "force-dynamic";

/**
 * Where this Bops' bots are in Slack, for the front door on this Mac (edge/), which shares one Slack
 * app between every Bops here and sends each event to the one it's for (lib/server/channels.ts
 * slackRoutes). Only this Mac asks: it isn't one of the tailnet's paths (proxy.ts). x-bops-front-door:
 * the front door's public address, for the bots' pictures in Slack (a header, which a web page's
 * plain request can't carry).
 */
export async function GET(request: Request) {
  learnFrontDoor(request.headers.get("x-bops-front-door"));
  // An app pasted in another Bops on this Mac shows up here too.
  await slackApp();
  await ensureSlackAppAccount().catch(() => {});
  return Response.json(await slackRoutes(), { headers: { "cache-control": "no-store" } });
}
