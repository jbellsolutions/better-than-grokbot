import { desktopSetupStatus, saveDesktopProvider, saveDesktopOrgo, setModel } from "@/lib/server/desktop-setup";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await desktopSetupStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Could not read setup. Restart the app and retry." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (process.env.BOPS_DISTRIBUTION !== "better-than-grokbot") return Response.json({ error: "Desktop setup is unavailable." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || !["provider", "model", "orgo"].includes(body.step)) return Response.json({ error: "Choose a setup step." }, { status: 400 });
  try {
    if (body.step === "provider") await saveDesktopProvider(body.key);
    else if (body.step === "orgo") await saveDesktopOrgo(body.key);
    else await setModel(body.model);
    return Response.json(await desktopSetupStatus());
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
