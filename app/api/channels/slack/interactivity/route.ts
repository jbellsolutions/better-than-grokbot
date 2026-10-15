import { fromCloudTunnel } from "@/lib/server/cloud-tunnel";
import { slackSigned } from "@/lib/server/slack-api";

export const dynamic = "force-dynamic";

/**
 * Clicks on the Slack app's buttons (an approval card's Allow once, Always allow, Deny), relayed by
 * the front door (edge/, /hooks/slack/<instance>/interactivity) like its events. Slack's signature is
 * checked over the raw form body; the click is applied after the answer (Slack wants one within 3
 * seconds): lib/server/slack-render.ts slackAction, which lets only the person paired decide.
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!fromCloudTunnel(request) && !(await slackSigned(request, body))) return new Response("stale, unsigned or forged", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(new URLSearchParams(body).get("payload") ?? "");
  } catch {
    return new Response("no payload", { status: 400 });
  }
  const { slackAction, startSlackRenderer } = await import("@/lib/server/slack-render");
  startSlackRenderer();
  void slackAction(payload as Parameters<typeof slackAction>[0]).catch((e: Error) => console.warn(`[slack] a click: ${e.message}`));
  return new Response(null, { status: 200 });
}
