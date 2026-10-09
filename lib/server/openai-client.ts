import { modelReasoning } from "./models";
import OpenAI, { type ClientOptions } from "openai";
import { cloudProxy } from "./cloud";

/** OpenRouter is used only in explicit self-hosted mode. Mac Codex keeps its own sign-in. */
export const openRouterOn = () => process.env.BOPS_SELF_HOSTED === "1" && !!process.env.OPENROUTER_API_KEY;

/**
 * An OpenAI client that finds its key when it makes a call, not when its module loads. Signed in
 * with Orgo, calls go through Bops Cloud (lib/server/cloud.ts) on the user's Orgo key. The base URL
 * is read per call too, so a sign-in or sign-out applies at once, and the live call sideband
 * (phone.ts), which builds its WebSocket address from the client's, goes through the cloud as well.
 * Self-hosting, it's OPENAI_API_KEY: the Mac app ships with no keys, and a client made with
 * `new OpenAI()` throws on import without one, which takes down every route that imports it.
 */
export function openaiClient(opts: Omit<ClientOptions, "apiKey"> = {}) {
  const client = new OpenAI({
    ...opts,
    apiKey: async () => {
      const via = cloudProxy("openai");
      if (via) return via.key;
      const key = openRouterOn() ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
      if (!key) throw new OpenAI.OpenAIError(process.env.BOPS_SELF_HOSTED === "1" ? "No OpenAI key is set: add OPENAI_API_KEY to .env.local." : "Sign in with Orgo first.");
      return key;
    },
  });
  let direct = client.baseURL;
  Object.defineProperty(client, "baseURL", {
    get: () => {
      const via = cloudProxy("openai");
      return via ? `${via.url}/v1` : openRouterOn() ? "https://openrouter.ai/api/v1" : direct;
    },
    set: (url: string) => void (direct = url),
    configurable: true,
  });
  // OpenRouter does not retain response state. Callers must replay tool history themselves.
  const create = client.responses.create.bind(client.responses);
  client.responses.create = (async (body: Parameters<typeof create>[0], options?: Parameters<typeof create>[1]) => {
    if (!openRouterOn()) return create(body, options);
    const reasoning = await modelReasoning(body.model ?? "", body.reasoning?.effort ?? "low");
    const next = { ...body, store: false };
    if (reasoning) next.reasoning = reasoning as typeof next.reasoning;
    else delete next.reasoning;
    return create(next, options);
  }) as typeof client.responses.create;
  return client;
}
