import { appCall } from "@/lib/server/composio";
import { sessionTools } from "@/lib/server/tool-gateway";
import { addMessage, bot, stateEpoch } from "@/lib/server/store";

/**
 * A thread uses one of the user's apps. Called by the bot's screen tools over the tailnet, or by Codex
 * on the Mac; the thread's bot secret (x-bops-key) proves which bot it is. Waits while the user approves.
 */
export async function POST(request: Request) {
  const { session, tool, args } = (await request.json().catch(() => ({}))) as { session?: string; tool?: string; args?: Record<string, unknown> };
  try {
    if (tool === "list_team_tools" || tool?.startsWith("custom_") || ["ask_teammate", "hand_off", "team_task_status"].includes(tool ?? "")) {
      const epoch = stateEpoch();
      const { task, tools } = await sessionTools(session ?? "", request.headers.get("x-bops-key") ?? "");
      if (stateEpoch() !== epoch) throw Error("The workspace session changed.");
      if (tool === "list_team_tools") return Response.json({ tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })) });
      const selected = tools.find(t => t.name === tool);
      if (!selected) return new Response("No accessible tool with that name.", { status: 403 });
      const result = await selected.run(args ?? {}, request.signal);
      if (stateEpoch() !== epoch) throw Error("The workspace session changed.");
      addMessage({ chatId: task.chatId, role: "system", text: `${bot(task.botId)?.name ?? task.botId} called ${tool}`, toolCall: { name: tool!, status: "done" } });
      return new Response(result);
    }
    const r = await appCall(session ?? "", request.headers.get("x-bops-key") ?? "", tool ?? "", args ?? {});
    return new Response(r.text, { status: r.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (e) {
    return new Response(`Failed: ${(e as Error).message}`, { status: 400 });
  }
}
