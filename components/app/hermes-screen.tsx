"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@/lib/types";

/** The owner's temporary access to the same private screen the paused Hermes task owns. */
export function HermesScreen({ session: s, name, onClose }: { session: Session; name: string; onClose: () => void }) {
  const [tick, setTick] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const refresh = () => { clearTimeout(timer.current); setTick(t => t + 1); };
  const schedule = (delay: number) => { clearTimeout(timer.current); timer.current = setTimeout(refresh, delay); };
  const send = async (input: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "screen-input", sessionId: s.id, helpId: s.hermesHelpId, input }) });
      const data = await r.json();
      if (!r.ok || !data.accepted) throw Error(data.error || "Could not control this screen");
      refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/sessions/${s.id}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handoff: true, helpId: s.hermesHelpId }) });
      if (!r.ok) throw Error((await r.json()).error || "Could not return control");
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const button = "rounded-full border border-[#D9D9D6] bg-white px-3 py-2 text-sm disabled:opacity-50";
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={`Help ${name}`}>
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col gap-3 overflow-auto rounded-2xl bg-[#F7F7F6] p-4 text-ink">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Help {name}</h2><p className="text-sm">{s.answer}</p></div><button className={button} onClick={onClose}>Close</button></div>
        <p className="text-sm text-[#6B6B6B]">Click the screen, then type below. Your agent stays paused until you return control.</p>
        <Image width={1280} height={900} unoptimized src={`/api/business?snapshot=${s.id}&t=${tick}`} alt={`${name}'s paused computer`} className={`w-full rounded-lg border ${busy ? "pointer-events-none opacity-80" : "cursor-crosshair"}`} onLoad={() => schedule(2000)} onError={() => { setError("Could not load the screen. Close and reopen it, or check the computer connection."); schedule(5000); }} onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          void send({ action: "click", x: Math.min(1279, Math.max(0, Math.floor((e.clientX - rect.left) * 1280 / rect.width))), y: Math.min(899, Math.max(0, Math.floor((e.clientY - rect.top) * 900 / rect.height))) });
        }} />
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!text || busy) return; const value = text; setText(""); void send({ action: "type", text: value }); }}>
          <input className="min-w-40 flex-1 rounded-lg border bg-white px-3 py-2" type="password" autoComplete="off" spellCheck={false} value={text} maxLength={10000} onChange={e => setText(e.target.value)} aria-label="Text to type on the computer" placeholder="Type on the computer" />
          <button disabled={busy || !text} className={button}>Type text</button>
          {[["Tab", "Tab"], ["Enter", "Return"], ["Select all", "ctrl+a"], ["Page down", "Page_Down"], ["Page up", "Page_Up"]].map(([label, key]) => <button key={key} type="button" disabled={busy} className={button} onClick={() => void send({ action: "key", key })}>{label}</button>)}
        </form>
        {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
        <div className="flex justify-end"><button disabled={busy || !s.hermesHelpId || !s.blocker} onClick={() => void resume()} className="rounded-full bg-ink px-4 py-2 font-semibold text-white disabled:opacity-50">I’m done · Continue</button></div>
      </div>
    </div>, document.body,
  );
}
