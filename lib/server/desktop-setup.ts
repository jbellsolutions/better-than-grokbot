import "server-only";
import { getSecret, setSecret } from "./keychain";
import { getState } from "./store";
import { savedModel, setModel } from "./models";
import { loadOrgoKey, orgoKey, orgoOrigin, signIn } from "./orgo-auth";

export async function loadDesktopProvider() {
  if (process.env.BOPS_DISTRIBUTION !== "better-than-grokbot") return;
  const key = await getSecret("openrouter-api-key");
  if (key) process.env.OPENROUTER_API_KEY = key;
}

export async function saveDesktopProvider(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /\s/.test(value.trim())) throw Error("Enter your OpenRouter API key.");
  const key = value.trim();
  let response;
  try { response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }); }
  catch { throw Error("Could not reach OpenRouter. Check your connection and retry."); }
  if (!response.ok) throw Error("OpenRouter did not accept this key. Check it and try again.");
  await setSecret("openrouter-api-key", key);
  process.env.OPENROUTER_API_KEY = key;
}

export async function desktopSetupStatus() {
  if (process.env.BOPS_DISTRIBUTION !== "better-than-grokbot") return { enabled: false, complete: true };
  await loadOrgoKey();
  const provider = !!process.env.OPENROUTER_API_KEY;
  const model = !!savedModel();
  const orgo = !!(orgoKey() || process.env.ORGO_API_KEY);
  const main = getState().bots.find(b => b.isMain);
  const computer = !!main?.computerId;
  return { enabled: true, provider, model, orgo, computer, complete: provider && model && orgo && computer, botId: main?.id };
}

export { setModel };

export async function saveDesktopOrgo(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /\s/.test(value.trim())) throw Error("Enter your Orgo API key.");
  let response;
  try { response = await fetch(`${orgoOrigin()}/api/user/profile`, { headers: { Authorization: `Bearer ${value.trim()}` }, signal: AbortSignal.timeout(10000) }); }
  catch { throw Error("Could not reach Orgo. Check your connection and retry."); }
  if (!response.ok) throw Error("Orgo did not accept this key. Check it and try again.");
  const profile = await response.json();
  if (typeof profile.id !== "string" || !profile.id) throw Error("Orgo could not identify this account.");
  await signIn(value.trim(), { id: profile.id, email: typeof profile.email === "string" ? profile.email : undefined, name: typeof profile.full_name === "string" ? profile.full_name : undefined });
}
