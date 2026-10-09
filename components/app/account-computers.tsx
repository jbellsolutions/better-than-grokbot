"use client";
import { useEffect, useState } from "react";
import { sharesComputer, workBot, type AppState, type Bot } from "@/lib/types";
import { post } from "./ui";

type Computer = { id: string; name: string; status: string; os: string; ram: number; cpu: number; workspaceName?: string };

export function AccountComputers({ state, bot, className }: { state: AppState; bot: Bot; className: string }) {
  const [computers, setComputers] = useState<Computer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [changed, setChanged] = useState(false);
  const current = sharesComputer(bot) ? "shared" : bot.computerId ?? "";
  const host = workBot(bot, state.bots);
  const refresh = async () => {
    setLoading(true); setError(undefined);
    try { setComputers(await loadComputers()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let gone = false;
    void loadComputers().then((list) => { if (!gone) setComputers(list); })
      .catch((e: Error) => { if (!gone) setError(e.message); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, []);
  const pick = selected ?? current;
  const save = async () => {
    setBusy(true); setError(undefined); setChanged(false);
    try {
      const r = await post("/api/bots", { botId: bot.id, ...(pick === "shared" ? { computer: "shared" } : { computerId: pick }) }, "PATCH");
      const j = await r.json();
      if (!r.ok) throw Error(j.error ?? "Could not change computer.");
      setSelected(undefined); setChanged(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className={`flex w-full flex-col gap-2.5 rounded-2xl px-4 py-3 ${className}`}>
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-semibold">Orgo computer</span>
      <button onClick={() => void refresh()} disabled={loading || busy} className="text-[12px] underline disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button>
    </div>
    <span className="text-[12px] text-[#6B6B6B]">{sharesComputer(bot) ? `Shares ${host.name}’s computer` : computers.find((c) => c.id === bot.computerId)?.name ?? bot.computerName ?? "Assigned computer"}. Your Better Than GrokBot agents, chats, and model choices stay with this team. The selected computer brings its own files and browser state; other agent systems on it are not imported.</span>
    <label className="flex flex-col gap-1 text-[12px] text-[#6B6B6B]">Choose from your Orgo account
      <select aria-label={`Computer for ${bot.name}`} value={pick} onChange={(e) => { setSelected(e.target.value); setChanged(false); }} disabled={loading || busy} className="w-full rounded-xl bg-white px-3 py-2 text-[13px] text-ink shadow-[0_0_0_1px_#00000015]">
        {!bot.isMain && <option value="shared">Share the main agent’s computer</option>}
        {!current && <option value="">Choose a computer</option>}
        {bot.computerId && !computers.some((c) => c.id === bot.computerId) && <option value={bot.computerId}>{bot.computerName ?? "Current computer"}</option>}
        {computers.map((c) => <option key={c.id} value={c.id} disabled={c.os !== "linux" || c.status !== "running"}>{c.name}{c.workspaceName ? ` · ${c.workspaceName}` : ""} · {c.status} · {c.ram} GB{c.os !== "linux" ? " · Linux required" : ""}</option>)}
      </select>
    </label>
    <span className="text-[12px] leading-4 text-[#6B6B6B]">On first use, Better Than GrokBot installs its browser and screen tools on your selected Linux computer. Other software stays installed. Start stopped computers in Orgo first.</span>
    {pick !== current && <button disabled={busy || !pick} onClick={() => void save()} className="self-start rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">{busy ? "Switching…" : "Use this computer"}</button>}
    {changed && <span role="status" className="text-[12px] text-[#067647]">Computer assignment saved.</span>}
    {error && <span role="alert" className="text-[12px] text-[#B42318]">{error}</span>}
  </div>;
}

async function loadComputers(): Promise<Computer[]> {
  const r = await fetch("/api/computers", { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw Error(j.error ?? "Could not load computers.");
  return j.computers;
}
