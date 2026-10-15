"use client";

import { useId, useRef, useState, useEffect } from "react";
import type { Bot } from "@/lib/types";
import { sharesComputer } from "@/lib/types";
import { post } from "./ui";

/** One confirmation, shared by the sidebar and profile. Native dialogs manage focus and Escape. */
export function DeleteAgentDialog({ bot: b, computerId, onClose }: { bot: Bot; computerId?: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const remove = async () => {
    setBusy(true); setError("");
    try {
      const res = await post("/api/bots", { botId: b.id }, "DELETE");
      if (!res.ok) throw Error((await res.json()).error || "Could not delete this agent.");
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete this agent."); }
    finally { setBusy(false); }
  };
  const keepsComputer = sharesComputer(b) || b.externalComputer || b.computerId === computerId;
  return <dialog ref={dialog} aria-labelledby={title} onCancel={e => { if (busy) e.preventDefault(); else onClose(); }} className="m-auto w-[min(420px,calc(100vw-32px))] rounded-2xl bg-white p-5 text-ink shadow-xl backdrop:bg-black/40">
    <h2 id={title} className="text-lg font-semibold">Delete {b.name}?</h2>
    <p className="mt-2 text-sm leading-5 text-[#6B6B6B]">Its chat, threads, routines, tools and inboxes will be deleted. This cannot be undone.</p>
    <p className="mt-2 text-sm leading-5 text-[#6B6B6B]">{keepsComputer ? "The computer it works on stays." : "Its own computer and files will also be deleted."}</p>
    {b.catalogId && <p className="mt-2 text-xs leading-4 text-[#6B6B6B]">Imported source records stay in the archive.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[#B42318]">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button autoFocus disabled={busy} onClick={onClose} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Cancel</button>
      <button disabled={busy} onClick={() => void remove()} className="rounded-lg bg-[#B42318] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : `Delete ${b.name}`}</button>
    </div>
  </dialog>;
}

export function AgentCardActions({ bot, name, unread, computerId, canMoveUp, canMoveDown, moving, onMove, onRead, onVisibility }: {
  bot?: Bot; name: string; unread: boolean; computerId?: string | null;
  canMoveUp: boolean; canMoveDown: boolean; moving: boolean;
  onMove: (direction: -1 | 1) => void; onRead: () => void; onVisibility: () => Promise<void>;
}) {
  const id = useId(), menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => menu.current?.hidePopover();
  const item = "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#F3F3F1] disabled:opacity-40";
  return <>
    <button aria-label={`Actions for ${name}`} title={`Actions for ${name}`} popoverTarget={id} onClick={e => {
      const r = e.currentTarget.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)), top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 260)) });
    }} className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg bg-[#F9F9F8] text-[#6B6B6B] hover:bg-white hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.5" fill="currentColor" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="13" cy="8" r="1.5" fill="currentColor" /></svg>
    </button>
    <div id={id} ref={menu} popover="auto" aria-label={`Actions for ${name}`} style={position} className="fixed m-0 w-[190px] rounded-xl border border-[#E6E6E3] bg-white p-1 text-ink shadow-lg">
      <button className={item} disabled={moving || !canMoveUp} onClick={() => { close(); onMove(-1); }}>Move up</button>
      <button className={item} disabled={moving || !canMoveDown} onClick={() => { close(); onMove(1); }}>Move down</button>
      <button className={item} onClick={() => { close(); onRead(); }}>Mark {unread ? "read" : "unread"}</button>
      {bot && <>
        <div className="mx-2 my-1 border-t border-[#ECECEA]" />
        <button className={item} disabled={busy || bot.isMain} title={bot.isMain ? "The team lead stays visible" : undefined} onClick={async () => { setBusy(true); try { await onVisibility(); close(); } finally { setBusy(false); } }}>{bot.hidden ? "Show card" : "Hide card"}</button>
        <button className={`${item} text-[#B42318]`} disabled={bot.isMain || bot.teamRole === "operations"} title={bot.isMain ? "The team lead cannot be deleted" : bot.teamRole === "operations" ? "Assign another Head of Operations before deleting this agent" : undefined} onClick={() => { close(); setDeleting(true); }}>Delete agent…</button>
      </>}
    </div>
    {deleting && bot && <DeleteAgentDialog bot={bot} computerId={computerId} onClose={() => setDeleting(false)} />}
  </>;
}
