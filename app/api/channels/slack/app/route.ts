import { saveSlackApp } from "@/lib/server/slack-api";

/**
 * The user's own Slack app (slack/manifest.json): its bot token and signing secret, pasted in Bops.
 * They go to this instance's Keychain; the app's workspace shows as a Slack account bots can join.
 */
export async function POST(request: Request) {
  const { token, signingSecret } = (await request.json().catch(() => ({}))) as { token?: string; signingSecret?: string };
  try {
    const account = await saveSlackApp(token ?? "", signingSecret ?? "");
    return Response.json({ account: { id: account.id, name: account.name } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
