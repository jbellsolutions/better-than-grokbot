import { modelCatalog, modelFor, setModel } from "@/lib/server/models";
import { openRouterOn } from "@/lib/server/openai-client";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = { provider: openRouterOn() ? "OpenRouter" : "OpenAI", configured: openRouterOn(), defaultModel: modelFor("chat"), cloudModel: modelFor("session") };
  try {
    const models = status.configured ? (await modelCatalog()).filter(m => m.tools && m.vision && m.text && !m.id.endsWith(":batch")) : [];
    return Response.json({ ...status, models }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return Response.json({ ...status, models: [], error: (e as Error).message }, { headers: { "Cache-Control": "private, no-store" } }); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || (body.botId !== undefined && typeof body.botId !== "string")) return Response.json({ error: "Choose an agent and model." }, { status: 400 });
  try { await setModel(body.model, body.botId); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); }
}
