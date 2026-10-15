import { slackDelivery } from "@/lib/server/channels";
import { fromCloudTunnel } from "@/lib/server/cloud-tunnel";
import { slackSigned } from "@/lib/server/slack-api";
import { startSlackRenderer } from "@/lib/server/slack-render";

export const dynamic = "force-dynamic";

/**
 * Events from Bops' own Slack app. Signed in with Orgo, Bops Cloud takes them for every user
 * (/hooks/slack), checks Slack's signature (it keeps the secret) and replays the ones for this Mac's
 * bots here over its tunnel, with the token only this server knows (lib/server/cloud-tunnel.ts): that
 * request counts as checked. Self-hosted, the self-hoster's front door (edge/, /hooks/slack) relays
 * them over the tailnet, and Slack's own signature (the app's signing secret: slack-api.ts) is checked here:
 * anything unsigned, stale or forged is refused. The reply goes out at once (Slack wants one within 3
 * seconds); the message is handled after.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!fromCloudTunnel(request) && !(await slackSigned(request, body))) return new Response("stale, unsigned or forged", { status: 401 });
  let payload: { type?: string; challenge?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("not JSON", { status: 400 });
  }
  if (payload?.type === "url_verification") return Response.json({ challenge: typeof payload.challenge === "string" ? payload.challenge : "" });
  // Drawn live even when no Bops window has opened since the server started (startChannels runs on the first state poll).
  startSlackRenderer();
  slackDelivery(payload);
  return new Response("ok");
}
