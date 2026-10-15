import { bot } from "@/lib/server/store";
import { toolConnections, saveTool, deleteTool, connectedTools } from "@/lib/server/custom-tools";
import type { ToolConnection } from "@/lib/tool-connections";

export function GET(request: Request) {
  const botId = new URL(request.url).searchParams.get("botId") ?? "";
  if (!bot(botId)) return Response.json({ error: "No such agent." }, { status: 404 });
  return Response.json({ selfHosted: process.env.BOPS_SELF_HOSTED === "1", connections: process.env.BOPS_SELF_HOSTED === "1" ? toolConnections(botId) : [] });
}
export async function POST(request: Request) {
  try {
    const { botId, connection, test } = await request.json() as { botId: string; connection: Partial<ToolConnection>; test?: boolean };
    if (!bot(botId)) return Response.json({ error: "No such agent." }, { status: 404 });
    if (test) return Response.json({ tools: (await connectedTools(botId)).map(t => ({ name: t.name, description: t.description })) });
    return Response.json(saveTool(botId, connection));
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  try {
    const { botId, id } = await request.json();
    deleteTool(botId, id);
    return Response.json({ ok: true });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
