import { dataPath } from "@/lib/server/instance";
import "server-only";
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { bot, getState, update } from "./store";

export type ModelChoice = { id: string; name: string; vision: boolean; tools: boolean; text: boolean; reasoning: boolean; efforts: string[]; prompt: string; completion: string };
const router = () => process.env.BOPS_SELF_HOSTED === "1" && !!process.env.OPENROUTER_API_KEY;
const file = () => dataPath("models.json");
const cache = globalThis as unknown as { bopsModelCatalog?: { until: number; models: ModelChoice[] }; bopsModelLoading?: Promise<ModelChoice[]> };

export function savedModel(): string | undefined {
  try { return JSON.parse(readFileSync(file(), "utf8")).defaultModel; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
}

/** Agent profiles and model preferences belong to Bops, never to a selected VM. */
export function modelFor(kind: "chat" | "session" | "hard", botId?: string): string {
  if (router()) {
    const own = botId ? bot(botId)?.model : undefined;
    if (own) return own;
    const selected = savedModel();
    if (selected) return selected;
  }
  const fallback = router() ? "z-ai/glm-5.3-flash" : kind === "hard" ? "gpt-6-astra" : "gpt-6.1-sol";
  return process.env[kind === "chat" ? "BOPS_CHAT_MODEL" : kind === "hard" ? "BOPS_HARD_MODEL" : "BOPS_SESSION_MODEL"] || (kind === "chat" ? process.env.BOPS_SAM_MODEL : router() ? process.env.BOPS_CHAT_MODEL : undefined) || fallback;
}

export async function modelCatalog(): Promise<ModelChoice[]> {
  if (cache.bopsModelCatalog && cache.bopsModelCatalog.until > Date.now()) return cache.bopsModelCatalog.models;
  if (cache.bopsModelLoading) return cache.bopsModelLoading;
  const read = async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error("Could not load the OpenRouter model catalog. Try again shortly.");
    const json = await response.json();
    if (!Array.isArray(json.data)) throw Error("OpenRouter returned an invalid model catalog.");
    const models: ModelChoice[] = json.data.map((m: { id: string; name: string; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; supported_parameters?: string[]; reasoning?: { supported_efforts?: string[] }; pricing?: { prompt?: string; completion?: string } }) => ({
      id: m.id, name: m.name, vision: !!m.architecture?.input_modalities?.includes("image"), text: !!m.architecture?.output_modalities?.includes("text"), tools: !!m.supported_parameters?.includes("tools"), reasoning: !!m.supported_parameters?.includes("reasoning"), efforts: m.reasoning?.supported_efforts ?? [], prompt: m.pricing?.prompt ?? "0", completion: m.pricing?.completion ?? "0",
    })).filter((m: ModelChoice) => typeof m.id === "string" && typeof m.name === "string");
    cache.bopsModelCatalog = { until: Date.now() + 3600000, models };
    return models;
  };
  cache.bopsModelLoading = read();
  try { return await cache.bopsModelLoading; }
  finally { cache.bopsModelLoading = undefined; }
}

/** Omit unsupported reasoning rather than excluding otherwise useful models. */
export async function modelReasoning(modelId: string, requested: string = "low") {
  const catalog = await modelCatalog().catch(() => cache.bopsModelCatalog?.models ?? []);
  const m = catalog.find(m => m.id === modelId);
  if (!m?.reasoning) return undefined;
  if (!m.efforts.length || m.efforts.includes(requested)) return { effort: requested };
  const effort = ["minimal", "low", "none"].find(e => m.efforts.includes(e));
  return effort ? { effort } : undefined;
}

export async function setModel(model: unknown, botId?: string) {
  if (!router()) throw Error("Model selection requires self-hosted OpenRouter configuration.");
  const b = botId ? bot(botId) : undefined;
  if (botId && !b) throw Error("No such agent.");
  if (model !== null && (typeof model !== "string" || model.length > 200)) throw Error("Choose a model from the OpenRouter catalog.");
  if (!botId && model === null) throw Error("Choose a team default model.");
  if (model !== null) {
    const choice = (await modelCatalog()).find(m => m.id === model);
    if (!choice || !choice.tools || !choice.vision || !choice.text || choice.id.endsWith(":batch")) throw Error("Choose a model with text responses, image input and tool support for Bops computer work.");
  }
  // Recheck after the async catalog read so work that just started cannot be changed mid-turn.
  const state = getState();
  if (b && bot(botId!) !== b) throw Error("The agent changed. Reload and try again.");
  if (state.sessions.some(s => (!botId || s.botId === botId) && ["starting", "running", "queued"].includes(s.status)) || state.chats.some(c => c.typing.some(id => !botId || id === botId))) throw Error("Wait until this agent's work finishes before changing its model.");
  if (b) update(() => { b.model = model === null ? undefined : model as string; });
  else {
    mkdirSync(dataPath(), { recursive: true, mode: 0o700 });
    writeFileSync(file() + ".tmp", JSON.stringify({ defaultModel: model }), { mode: 0o600 });
    renameSync(file() + ".tmp", file());
  }
}
