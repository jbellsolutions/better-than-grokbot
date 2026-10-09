"use client";
import { useEffect, useState } from "react";

/** Show the existing desktop without preparing screens, injecting scripts or taking control. */
export function ObservedComputer({ botId, name, hidden }: { botId: string; name: string; hidden?: boolean }) {
  const [screens, setScreens] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/computer?bot=${encodeURIComponent(botId)}`, { cache: "no-store" });
        if (!r.ok) throw new Error("The computer is unavailable");
        const info = await r.json();
        if (!info.computer || info.computer.status !== "running") throw new Error("The computer is not running");
        if (!stop) { setScreens(info.screens); setError(""); }
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    void load();
    const timer = setInterval(() => { if (!hidden) { setTick(Date.now()); void load(); } }, 8000);
    return () => { stop = true; clearInterval(timer); };
  }, [botId, hidden]);
  const screen = screens.includes(selected) ? selected : screens[0];
  return <div className="flex min-h-0 flex-1 flex-col bg-[#F9F9F8] p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><div className="text-sm font-semibold">{name}</div><div className="text-xs text-[#6B6B6B]">Existing computer · viewing only</div></div>
      {screens.length > 1 && <select aria-label="Computer screen" value={screen} onChange={e => setSelected(e.target.value)} className="rounded-lg border border-[#E6E6E3] bg-white px-2 py-1 text-xs">{screens.map(s => <option key={s} value={s}>Screen {s}</option>)}</select>}
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[#E6E6E3] bg-white">
      {error ? <p role="status" className="p-6 text-sm text-[#6B6B6B]">{error}</p> : screen && !hidden ?
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`${name} computer`} className="max-h-full max-w-full object-contain" src={`/api/screen?bot=${encodeURIComponent(botId)}&screen=${encodeURIComponent(screen)}&t=${tick}`} onError={() => setError("Could not load this computer's screen. Retrying shortly.")} /> : <p className="text-sm text-[#6B6B6B]">Connecting to the computer…</p>}
    </div>
    <p className="mt-3 text-xs leading-5 text-[#6B6B6B]">Hermes currently owns this desktop. Bops keeps this instance’s profiles and conversations separate without changing the existing runtime.</p>
  </div>;
}
