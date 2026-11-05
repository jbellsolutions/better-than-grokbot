"use client";

import { useEffect, useState } from "react";

type Entry = { id: string; name: string; purpose: string; url: string; status: string };
declare global {
  interface Window {
    bopsInstances?: { select: (id: string) => Promise<void>; create?: (name: string) => Promise<string>; id: string };
  }
}

/** Native instances keep independent windows; browser instances navigate to independent origins. */
export function InstancePicker() {
  const [info, setInfo] = useState<{ current: { id: string; name: string }; instances: Entry[]; observeOnly?: boolean } | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch("/api/instances", { cache: "no-store" });
        if (!r.ok) throw new Error("Instance connections are unavailable");
        const data = await r.json();
        if (!stopped) setInfo(data);
      } catch { if (!stopped) setError("Could not check instance connections."); }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  if (!info?.instances.length) return null;
  return <div className="mx-1 mb-3 rounded-xl border border-[#E6E6E3] bg-white p-2.5">
    <label htmlFor="bops-instance" className="mb-1 block text-[11px] font-medium text-[#6B6B6B]">App instance</label>
    <select id="bops-instance" aria-label="App instance" value={info.current.id} disabled={busy} className="w-full bg-transparent text-[13px] font-semibold outline-none" onChange={async event => {
      const entry = info.instances.find(e => e.id === event.target.value);
      if (!entry || entry.id === info.current.id) return;
      setBusy(true); setError("");
      try {
        // Check again immediately before switching. Never send the user to a different server.
        const r = await fetch("/api/instances", { cache: "no-store" });
        if (!r.ok) throw new Error("Could not verify this instance");
        const data = await r.json();
        if (!window.bopsInstances && data.instances.find((e: Entry) => e.id === entry.id)?.status !== "ready") throw new Error(`${entry.name} is unavailable. Your current instance is unchanged.`);
        if (window.bopsInstances) await window.bopsInstances.select(entry.id);
        else window.location.assign(entry.url);
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      {info.instances.map(e => <option key={e.id} value={e.id}>{e.name}{e.status === "ready" ? "" : ` · ${e.status}`}</option>)}
    </select>
    <div className="mt-1 text-[11px] text-[#6B6B6B]">{info.instances.find(e => e.id === info.current.id)?.purpose}</div>
    {info.observeOnly && <p className="mt-2 text-[11px] leading-4 text-[#6B6B6B]">Existing desktop stays view-only. Business desk runs isolated Hermes tasks with up to four shared screens.</p>}
    {window.bopsInstances?.create && (creating ? <form className="mt-2 flex flex-col gap-2" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try { await window.bopsInstances?.create?.(name); setName(""); setCreating(false); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><input aria-label="New instance name" placeholder="Instance name" value={name} maxLength={60} onChange={e => setName(e.target.value)} className="w-full rounded border p-1 text-xs" required /><button disabled={busy} className="text-xs underline">Create instance</button><button type="button" onClick={() => setCreating(false)} className="text-xs">Cancel</button></form> : <button onClick={() => setCreating(true)} className="mt-2 text-xs underline">New instance</button>)}
    {error && <p role="alert" className="mt-2 text-[11px] text-red-700">{error}</p>}
  </div>;
}
