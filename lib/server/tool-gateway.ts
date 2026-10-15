import "server-only";
import { timingSafeEqual } from "node:crypto";
import { bot, session } from "./store";
import { connectedTools } from "./custom-tools";
import { teamTools } from "./team-tools";

export async function sessionTools(sessionId: string, key: string) {
  const task = session(sessionId);
  const owner = task && bot(task.botId);
  const expected = Buffer.from(owner?.appsKey ?? "");
  const provided = Buffer.from(key);
  if (!task || !owner || !expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw Error("No access to this task’s tools.");
  if (task.dismissed || task.replacedBy || task.status === "failed" && /stopped|paused/i.test(task.error ?? "")) throw Error("This task is stopped.");
  return { task, tools: [...await connectedTools(owner.id), ...teamTools(owner.id, task.chatId, task.id)] };
}
