"use client";

import { useEffect, useRef, useState } from "react";
import type { Bot } from "@/lib/types";
import { post } from "./ui";

export function ManageAgents({ team, computerId }: { team: Bot[]; computerId?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const removable = team.filter(b => !b.isMain);
  const targets = removable.filter(b => selected.includes(b.id));
  const ownedComputers = targets.filter(b => b.computerId && !b.externalComputer && b.computerId !== computerId);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  const remove = async () => {
    setBusy(true); setError("");
    const failed: string[] = [];
    const messages: string[] = [];
    for (const b of targets) {
      try {
        const response = await post("/api/bots", { botId: b.id }, "DELETE");
        if (!response.ok) {
          const body = await response.json();
          throw Error(body.error || "Could not delete agent.");
        }
      } catch (e) {
        failed.push(b.id);
        messages.push(`${b.name}: ${e instanceof Error ? e.message : "Could not delete agent."}`);
      }
    }
    setSelected(failed); setError(messages.join("\n"));
    setBusy(false); setConfirm(false);
    if (!failed.length) setOpen(false);
  };

  return <>
    <button onClick={() => { setSelected([]); setConfirm(false); setError(""); setOpen(true); }} className="mx-1 mb-3 rounded-xl border border-[#E6E6E3] bg-white px-3 py-2 text-left text-xs font-semibold hover:bg-[#EEEEEC]">
      Manage agents
    </button>
    <dialog ref={dialog} aria-labelledby="manage-agents-title" onCancel={e => { if (busy) e.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)} className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl bg-white p-0 text-ink shadow-xl backdrop:bg-black/40">
      <div className="flex max-h-[80vh] flex-col p-5">
        <h2 id="manage-agents-title" className="text-lg font-semibold">{confirm ? `Delete ${targets.length} agent${targets.length === 1 ? "" : "s"}?` : "Manage agents"}</h2>
        {confirm ? <>
          <p className="mt-2 text-sm text-[#6B6B6B]">Their chats, threads, routines, tools and inboxes will be deleted. This cannot be undone.</p>
          <ul className="my-3 overflow-y-auto text-sm">{targets.map(b => <li key={b.id} className="py-1">{b.name}</li>)}</ul>
          {ownedComputers.length > 0
            ? <p className="mb-3 text-sm text-[#B42318]">Their Bops-created computers and files will also be deleted: {ownedComputers.map(b => b.name).join(", ")}.</p>
            : <p className="mb-3 text-sm text-[#6B6B6B]">Shared and externally connected computers stay.</p>}
          <div className="flex justify-end gap-2">
            <button disabled={busy} onClick={() => setConfirm(false)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Back</button>
            <button disabled={busy || !targets.length} onClick={() => void remove()} className="rounded-lg bg-[#B42318] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : `Delete ${targets.length} agent${targets.length === 1 ? "" : "s"}`}</button>
          </div>
        </> : <>
          <p className="mt-2 text-sm text-[#6B6B6B]">Select agents to delete. The team lead stays.</p>
          {removable.length > 0 && <button onClick={() => setSelected(targets.length === removable.length ? [] : removable.map(b => b.id))} className="my-3 self-start text-sm font-medium underline underline-offset-2">{targets.length === removable.length ? "Deselect all" : "Select all"}</button>}
          <div className="my-3 overflow-y-auto">
            {team.map(b => <div key={b.id} className="flex items-center gap-3 border-b border-[#ECECEA] py-3 last:border-0">
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <input type="checkbox" aria-label={`Select ${b.name}`} disabled={b.isMain} checked={selected.includes(b.id) && !b.isMain} onChange={e => setSelected(e.target.checked ? [...selected, b.id] : selected.filter(id => id !== b.id))} className="size-4 shrink-0 accent-[#B42318]" />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{b.name}</span>{b.isMain && <span className="text-xs text-[#6B6B6B]">Team lead · cannot be deleted</span>}{b.hidden && <span className="text-xs text-[#6B6B6B]">Hidden</span>}</span>
              </label>
              {!b.isMain && <button aria-label={`Delete ${b.name}`} onClick={() => { setSelected([b.id]); setConfirm(true); }} className="rounded-lg px-2 py-1 text-sm text-[#B42318] hover:bg-red-50">Delete</button>}
            </div>)}
          </div>
          {error && <p role="alert" className="mb-3 whitespace-pre-line text-sm text-[#B42318]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-sm">Close</button>
            <button disabled={!targets.length} onClick={() => setConfirm(true)} className="rounded-lg bg-[#B42318] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Delete selected{targets.length > 0 ? ` (${targets.length})` : ""}</button>
          </div>
        </>}
      </div>
    </dialog>
  </>;
}
