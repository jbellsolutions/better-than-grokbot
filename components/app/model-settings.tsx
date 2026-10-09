"use client";
import { useEffect, useState } from "react";
import type { Bot } from "@/lib/types";

type Choice = { id: string; name: string; prompt: string; completion: string };
type Status = { provider: string; configured: boolean; defaultModel: string; cloudModel: string; models: Choice[]; error?: string };

export function ModelSettings({ bot, className = "" }: { bot?: Bot; className?: string }) {
  const [info, setInfo] = useState<Status>();
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const load = async () => {
    try { const r = await fetch("/api/models", { cache: "no-store" }); if (!r.ok) throw Error("Could not load model settings."); const j = await r.json(); setInfo(j); setError(j.error); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { let stopped = false; void fetch("/api/models", { cache: "no-store" }).then(r => { if (!r.ok) throw Error("Could not load model settings."); return r.json(); }).then(j => { if (!stopped) { setInfo(j); setError(j.error); } }).catch(e => { if (!stopped) setError(e.message); }); return () => { stopped = true; }; }, []);
  const current = bot ? bot.model ?? "" : info?.defaultModel ?? "";
  const pick = selected ?? current;
  const choice = info?.models.find(m => m.id === (pick || info.defaultModel));
  const options = info?.models.filter(m => !filter || `${m.id} ${m.name}`.toLowerCase().includes(filter.toLowerCase()) || m.id === pick) ?? [];
  const save = async () => {
    setBusy(true); setError(undefined); setSaved(false);
    try {
      const r = await fetch("/api/models", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: pick || null, ...(bot ? { botId: bot.id } : {}) }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error ?? "Could not save model.");
      await load(); setSelected(undefined); setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const price = (value: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(Number(value) * 1000000);
  return <div className={`flex w-full flex-col gap-2.5 rounded-2xl p-4 ${className}`}>
    <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{bot ? `${bot.name}’s model` : "Models and OpenRouter"}</span><button onClick={() => void load()} disabled={busy} className="text-[12px] underline">Refresh</button></div>
    <span className="text-[12px] leading-4 text-[#6B6B6B]">{info ? `${info.provider} · ${info.configured ? "key configured securely" : "OpenRouter key not configured"}` : "Checking connection…"}</span>
    {info?.configured && <>
      <input aria-label={bot ? `Find model for ${bot.name}` : "Find team model"} placeholder="Search models, e.g. GLM or Grok" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl bg-white px-3 py-2 text-[13px] text-ink shadow-[0_0_0_1px_#00000015]" />
      <label className="flex flex-col gap-1 text-[12px] text-[#6B6B6B]">{bot ? "Chat and cloud task model" : "Team default for chat and cloud tasks"}
        <select aria-label={bot ? `Model for ${bot.name}` : "Team default model"} value={pick} disabled={busy || !info.models.length} onChange={e => { setSelected(e.target.value); setSaved(false); }} className="rounded-xl bg-white px-3 py-2 text-[13px] text-ink shadow-[0_0_0_1px_#00000015]">
          {bot && <option value="">Use team default · {info.defaultModel}</option>}
          {pick && !info.models.some(m => m.id === pick) && <option value={pick}>{pick} · current selection</option>}
          {options.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
        </select>
      </label>
      {choice && <span className="text-[12px] text-[#6B6B6B]">Listed rate per 1M tokens: {price(choice.prompt)} input · {price(choice.completion)} output. OpenRouter bills usage separately.</span>}
      <span className="text-[12px] leading-4 text-[#6B6B6B]">{bot ? "This choice stays with the agent when you switch computers. Choosing the team default follows future team model changes." : "Agents using the team default follow this choice. Individual agent overrides keep their own model."} Mac tasks continue to use signed-in Codex.</span>
      {pick !== current && <button disabled={busy} onClick={() => void save()} className="self-start rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white">{busy ? "Saving…" : "Save model"}</button>}
    </>}
    {!bot && <span className="text-[12px] leading-4 text-[#6B6B6B]">The key stays on the server in private settings; it is never sent to this page. <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline">Manage keys</a> · <a href="https://openrouter.ai/activity" target="_blank" rel="noreferrer" className="underline">View usage</a></span>}
    {saved && <span role="status" className="text-[12px] text-[#067647]">Model saved. Your next chat or cloud task uses this selection.</span>}
    {error && <span role="alert" className="text-[12px] text-[#B42318]">{error}</span>}
  </div>;
}
