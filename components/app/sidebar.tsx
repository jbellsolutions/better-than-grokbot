"use client";

import { InstancePicker } from "./instance-picker";
import { AgentCardActions } from "./agent-card-actions";
import { ManageAgents } from "./manage-agents";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DISPLAYS, live, workspaceOf, type AppState, type Chat, type Session, type Watch } from "@/lib/types";
import { conversationIndex, conversationUnread, moveConversation, orderConversations } from "@/lib/conversations";
import { initialsOf, signOutOfOrgo } from "./account";
import { KeyIcon } from "./screen-cards";
import { useSetupNeedsYou } from "./setup";
import { WATCH, WatchEye, watchName } from "./watch-overlay";
import { ago, ChatAvatar, chatInWorkspace, chatName, currentWorkspace, needsYou, post, RoundButton, StatusIcon, teamOf, useNow } from "./ui";
import { workStatus } from "@/lib/work-status";

/**
 * The sidebar for one workspace (switch at the top). The list: one row per conversation (Sam pinned, then by latest activity), each with its
 * last message and a dot when there's something you haven't read, like iMessage. Work lives in one
 * place: the Threads list below (and each thread's chip in its chat) shows what's running and what
 * needs you, so the chat rows don't repeat it.
 */
export function Sidebar({
  state,
  chatId,
  onOpenChat,
  onOpenThread,
  onCompose,
  onSettings,
  onAccount,
  onSetup,
  onVault,
  onBusiness,
  onOpenWatch,
}: {
  state: AppState;
  chatId: string;
  onOpenChat: (chatId: string) => void;
  onOpenThread: (session: Session) => void;
  onCompose: () => void;
  onSettings: () => void;
  onAccount: () => void;
  /** The setup screen: what this Mac gives Bops (setup.tsx). */
  onSetup: () => void;
  onVault: () => void;
  onBusiness: () => void;
  /** Show a watched screen or Mac window. */
  onOpenWatch: (watch: Watch) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const q = query?.trim().toLowerCase();
  // The "5m" next to each chat stays current.
  useNow(30_000);

  const index = useMemo(() => conversationIndex(state.messages), [state.messages]);
  const lastMessage = (c: Chat) => index.get(c.id)?.last;
  const ws = currentWorkspace(state);
  const team = teamOf(state);
  const savedOrder = state.workspaces?.find(w => w.id === ws)?.chatOrder;
  const [pendingOrder, setPendingOrder] = useState<{ workspace: string; ids: string[] | null } | null>(null);
  const [orderError, setOrderError] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const savingOrder = useRef(false);
  const order = pendingOrder?.workspace === ws ? pendingOrder.ids ?? undefined : savedOrder;
  const orderedChats = orderConversations(state.chats.filter(c => chatInWorkspace(state, c)), index, order);
  const saveOrder = async (ids: string[] | null) => {
    if (savingOrder.current) return;
    savingOrder.current = true; setOrderError(""); setPendingOrder({ workspace: ws, ids });
    try {
      const r = await post("/api/chats/order", { workspaceId: ws, chatIds: ids }, "PUT");
      if (!r.ok) throw Error((await r.json()).error || "Could not save the card order.");
    } catch (e) { setOrderError((e as Error).message); }
    finally { savingOrder.current = false; setPendingOrder(null); }
  };
  const move = (from: string, to: string) => {
    if (from !== to && orderedChats.some(c => c.id === from) && orderedChats.some(c => c.id === to))
      void saveOrder(moveConversation(orderedChats.map(c => c.id), from, to));
    setDragged(null); setDropTarget(null);
  };
  const hidden = team.filter(b => b.hidden && !b.isMain);
  const [visibilityError, setVisibilityError] = useState("");
  const setVisibility = async (botId: string, hidden: boolean) => {
    setVisibilityError("");
    try { const r = await post("/api/bots", { botId, hidden }, "PATCH"); if (!r.ok) throw Error((await r.json()).error || "Could not update the card."); }
    catch (e) { setVisibilityError((e as Error).message); }
  };
  const chats = orderedChats
    .filter(c => c.kind !== "bot" || !state.bots.find(b => b.id === c.botIds[0])?.hidden)
    .filter((c) => !q || chatName(c, state.bots).toLowerCase().includes(q) || state.messages.some((m) => m.chatId === c.id && m.text.toLowerCase().includes(q)));

  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.querySelectorAll<HTMLElement>("[data-chat]") ?? []) {
      const id = row.dataset.chat!;
      const top = row.offsetTop;
      const before = positions.current.get(id);
      next.set(id, top);
      if (before !== undefined && before !== top && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "ease-out" });
    }
    positions.current = next;
  });

  const threads = [...state.sessions]
    .filter((s) => workspaceOf(state.bots.find((b) => b.id === s.botId)) === ws && state.bots.some((b) => b.id === s.botId) && !s.replacedBy)
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .sort((a, b) => Number(live(b) || needsYou(b)) - Number(live(a) || needsYou(a)) || (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
    .slice(0, 6);

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-[#ECECEA] bg-[#F9F9F8] px-2.5 pb-3 pt-3.5">
      <InstancePicker />
      <ManageAgents key={ws} team={team} computerId={state.instance?.computerId} />
      {state.instance?.id !== "default" && state.instance && <button onClick={onBusiness} className="mx-1 mb-3 rounded-xl border border-[#E6E6E3] bg-white px-3 py-2 text-left text-xs font-semibold">Business desk · profiles, queue, contacts & history</button>}
      <div className="flex items-center justify-between pb-3 pl-2.5 pr-2">
        {query === null ? (
          <WorkspaceSwitcher state={state} />
        ) : (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery(null)}
            // Clicking away from an empty search closes it (not when the click is on the search button, which toggles it).
            onBlur={(e) => !query.trim() && e.relatedTarget?.getAttribute("aria-label") !== "Search" && setQuery(null)}
            placeholder="Search bots, chats, threads"
            className="mr-2 h-[34px] min-w-0 flex-1 rounded-full bg-white px-3.5 text-[13px] shadow-[0_0_0_1px_#E6E6E3] outline-none placeholder:text-[#9A9A98]"
          />
        )}
        <div className="flex gap-2">
          <RoundButton label="Search" active={query !== null} onClick={() => setQuery(query === null ? "" : null)}>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="#0A0A0A" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" />
          </RoundButton>
          <RoundButton label="New chat or bot" onClick={onCompose}>
            <path d="M8 3v10M3 8h10" fill="none" stroke="#0A0A0A" strokeWidth="1.6" strokeLinecap="round" />
          </RoundButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mb-1 flex items-center justify-between px-2.5 text-xs text-[#6B6B6B]">
          <span>Agent cards</span>
          <select aria-label="Card order" value={order ? "manual" : "recent"} disabled={pendingOrder !== null} onChange={e => void saveOrder(e.target.value === "manual" ? orderedChats.map(c => c.id) : null)} className="rounded-lg border border-[#E6E6E3] bg-white px-2 py-1 text-xs">
            <option value="recent">Recent activity</option><option value="manual">My order</option>
          </select>
        </div>
        {order && <p className="px-2.5 pb-2 text-[11px] text-[#9A9A98]">Drag a handle or use the card menu to move.</p>}
        {(orderError || visibilityError) && <p role="alert" className="px-2.5 py-2 text-xs text-[#B42318]">{orderError || visibilityError}</p>}
        <div ref={list} className="relative flex flex-col gap-0.5">
          {chats.map((c, position) => {
            const unread = conversationUnread(c, index.get(c.id)?.incomingAt);
            const solo = c.kind === "bot" ? state.bots.find(b => b.id === c.botIds[0]) : undefined;
            const name = chatName(c, state.bots);
            return <div key={c.id} data-chat={c.id} onDragOver={e => { if (dragged && !savingOrder.current) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(c.id); } }} onDrop={e => { e.preventDefault(); const from = e.dataTransfer.getData("application/x-bops-chat"); if (dragged === from) move(from, c.id); }} className={`group/chat relative rounded-[14px] ${dropTarget === c.id && dragged !== c.id ? "ring-2 ring-inset ring-[#9A9A98]" : ""} ${dragged === c.id ? "opacity-50" : ""}`}>
              {order && <button aria-label={`Drag ${name} to reorder`} title="Drag to reorder, or use the up and down arrow keys" draggable={!pendingOrder} onDragStart={e => { e.dataTransfer.setData("application/x-bops-chat", c.id); e.dataTransfer.effectAllowed = "move"; setDragged(c.id); }} onDragEnd={() => { setDragged(null); setDropTarget(null); }} onKeyDown={e => {
                const neighbor = e.key === "ArrowUp" ? chats[position - 1] : e.key === "ArrowDown" ? chats[position + 1] : undefined;
                if (["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); if (neighbor) move(c.id, neighbor.id); }
              }} className="absolute left-0 top-4 z-10 flex h-8 w-3 cursor-grab items-center justify-center text-[#9A9A98] active:cursor-grabbing">
                <svg width="6" height="16" viewBox="0 0 6 16" aria-hidden="true">{[3, 8, 13].flatMap(y => [1, 5].map(x => <circle key={`${x}:${y}`} cx={x} cy={y} r="0.8" fill="currentColor" />))}</svg>
              </button>}
              <ChatRow chat={c} state={state} selected={c.id === chatId} unread={unread} onClick={() => onOpenChat(c.id)} last={lastMessage(c)} />
              <AgentCardActions bot={solo} name={name} unread={unread} computerId={state.instance?.computerId} canMoveUp={position > 0} canMoveDown={position < chats.length - 1} moving={pendingOrder !== null} onMove={direction => move(c.id, chats[position + direction].id)} onRead={() => void post(`/api/chats/${encodeURIComponent(c.id)}/read`, { unread: !unread })} onVisibility={() => solo ? setVisibility(solo.id, true) : Promise.resolve()} />
            </div>;
          })}
        </div>


        {hidden.length > 0 && <details className="mx-2 mt-3 text-xs text-[#6B6B6B]">
          <summary className="cursor-pointer py-2">Hidden profiles ({hidden.length})</summary>
          {hidden.map(b => <div key={b.id} className="relative flex min-w-0 items-center gap-2 py-2 pr-9">
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => { const c = state.chats.find(c => c.kind === "bot" && c.botIds[0] === b.id); if (c) onOpenChat(c.id); }}>{b.name}</button>
            <button aria-label={`Show ${b.name}`} className="shrink-0 underline" onClick={() => void setVisibility(b.id, false)}>Show</button>
            <AgentCardActions bot={b} name={b.name} unread={false} computerId={state.instance?.computerId} canMoveUp={false} canMoveDown={false} moving={false} onMove={() => {}} onRead={() => void post(`/api/chats/${encodeURIComponent(state.chats.find(c => c.kind === "bot" && c.botIds[0] === b.id)?.id ?? "")}/read`, { unread: true })} onVisibility={() => setVisibility(b.id, false)} />
          </div>)}
        </details>}

        {!q && <Watching state={state} onOpen={onOpenWatch} />}

        {threads.length > 0 && (
          <div className="flex flex-col pt-4">
            <div className="px-2.5 pb-1.5 text-[13px] font-medium leading-4 text-[#9A9A98]">Threads</div>
            {threads.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenThread(s)}
                className="group/thread flex min-h-[46px] items-center gap-2 rounded-[10px] px-2.5 py-1 text-left hover:bg-black/[0.03]"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[14px] leading-[18px] ${live(s) || needsYou(s) ? "text-ink" : "text-[#6B6B6B]"}`}>{s.title}</span>
                  <span className="truncate text-[11px] leading-4 text-[#6B6B6B]" title={workStatus(s).text}>{workStatus(s).text}</span>
                </span>
                <StatusIcon session={s} />
                {workStatus(s).canDelete && <DeleteX label={`Delete ${s.title}`} onDelete={() => void post(`/api/sessions/${s.id}`, {}, "DELETE")} className="group-hover/thread:opacity-100" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 p-1 pt-3">
        <YouMenu state={state} onAccount={onAccount} onSettings={onSettings} onSetup={onSetup} />
        <button
          onClick={onCompose}
          className="flex h-10 flex-1 items-center justify-center rounded-full bg-white text-[14px] font-medium shadow-[0_0_0_1px_#E6E6E3] hover:bg-[#FCFCFB]"
        >
          + New bot
        </button>
        <button
          onClick={onVault}
          title="Vault: your apps and logins, and which bots can use them"
          aria-label="Vault"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-[0_0_0_1px_#E6E6E3] hover:bg-[#FCFCFB]"
        >
          <KeyIcon />
        </button>
      </div>
    </aside>
  );
}

/** Something on this Mac still needs you (setup.tsx): a small amber dot with an exclamation mark. */
function NeedsYouDot({ className = "" }: { className?: string }) {
  return (
    <span className={`flex size-4 shrink-0 items-center justify-center rounded-full bg-[#E59A0B] ${className}`}>
      <svg width="8" height="8" viewBox="0 0 8 8">
        <path d="M4 1.3v3.1" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="4" cy="6.3" r="0.85" fill="#FFFFFF" />
      </svg>
    </span>
  );
}

/**
 * You, at the bottom of the sidebar: your initials, and a menu with your Orgo account (plan and
 * usage), Settings, this Mac's permissions, and signing out. While something on this Mac still needs
 * you (and you haven't skipped it on the setup screen), a badge on your initials opens that screen
 * and the menu item carries the same mark.
 */
function YouMenu({ state, onAccount, onSettings, onSetup }: { state: AppState; onAccount: () => void; onSettings: () => void; onSetup: () => void }) {
  const [open, setOpen] = useState(false);
  const needsYou = useSetupNeedsYou(state);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const user = state.account?.user;
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const item = "flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] font-medium hover:bg-black/[0.04]";
  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        title={user ? `${user.name ?? user.email ?? "Your account"}: account and settings` : "Account and settings"}
        className={`flex size-10 items-center justify-center rounded-full text-[13px] font-semibold ${open ? "bg-ink text-highlighter" : "bg-[#EEEEEC] text-[#6B6B6B] hover:bg-[#E6E6E3]"}`}
      >
        {initialsOf(state)}
      </button>
      {needsYou && (
        <button
          onClick={() => {
            setOpen(false);
            onSetup();
          }}
          title="Something on this Mac needs you"
          aria-label="Something on this Mac needs you"
          className="absolute -bottom-0.5 -left-0.5 rounded-full shadow-[0_0_0_2px_#F9F9F8]"
        >
          <NeedsYouDot />
        </button>
      )}
      {open && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 flex w-[248px] flex-col rounded-[14px] bg-white p-1.5 shadow-[0_0_0_1px_#E6E6E3,0_12px_32px_rgba(0,0,0,0.12)]">
          <div className="flex flex-col gap-0.5 px-2.5 pb-2 pt-1.5">
            <span className="truncate text-[14px] font-semibold leading-[18px]">{user?.name || state.owner?.name || "You"}</span>
            <span className="truncate text-[12px] leading-4 text-[#9A9A98]">{user ? (user.email ?? "Signed in with Orgo") : "Not signed in"}</span>
          </div>
          <div className="mx-2 mb-1 h-px bg-[#ECECEA]" />
          <button onClick={pick(onAccount)} className={item}>
            <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0">
              <circle cx="8" cy="5.5" r="2.8" fill="none" stroke="#0A0A0A" strokeWidth="1.4" />
              <path d="M2.8 13.5c.8-2.6 2.8-3.9 5.2-3.9s4.4 1.3 5.2 3.9" fill="none" stroke="#0A0A0A" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Account and usage
          </button>
          <button onClick={pick(onSettings)} className={item}>
            <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0">
              <path d="M3 4.5h10M3 8h10M3 11.5h10" fill="none" stroke="#0A0A0A" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="6" cy="4.5" r="1.6" fill="#fff" stroke="#0A0A0A" strokeWidth="1.3" />
              <circle cx="10.5" cy="8" r="1.6" fill="#fff" stroke="#0A0A0A" strokeWidth="1.3" />
              <circle cx="5" cy="11.5" r="1.6" fill="#fff" stroke="#0A0A0A" strokeWidth="1.3" />
            </svg>
            Settings
          </button>
          <button onClick={pick(onSetup)} className={item}>
            <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0">
              <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.4" fill="none" stroke="#0A0A0A" strokeWidth="1.4" />
              <path d="M5.8 13.6h4.4" fill="none" stroke="#0A0A0A" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="flex-1">Permissions on this Mac</span>
            {needsYou && <NeedsYouDot />}
          </button>
          {user && (
            <>
              <div className="mx-2 my-1 h-px bg-[#ECECEA]" />
              <button onClick={pick(() => void signOutOfOrgo())} className={`${item} text-[#6B6B6B] hover:text-[#B42318]`}>
                <span className="w-[15px] shrink-0" />
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat: c, state, selected, unread, onClick, last }: { chat: Chat; state: AppState; selected: boolean; unread: boolean; onClick: () => void; last?: AppState["messages"][number] }) {
  const members = state.bots.filter((b) => c.botIds.includes(b.id));
  const solo = c.kind === "bot" ? members[0] : undefined;
  const typing = c.typing.length > 0;
  const preview = typing
    ? "typing…"
    : last
      ? last.role === "user"
        ? `You: ${last.text}`
        : c.kind === "group" && last.botId
          ? `${state.bots.find((b) => b.id === last.botId)?.name}: ${last.text}`
          : last.text
      : solo
        ? solo.isMain
          ? "Your Head of Ops orchestrator. Give it a project charter."
          : `${solo.role}. Say hi.`
        : `${members.map((m) => m.name).join(", ")} and you`;

  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-[14px] py-2.5 pl-3.5 pr-9 text-left ${selected ? "bg-[#EEEEEC]" : "hover:bg-black/[0.03]"}`}>
      <ChatAvatar chat={c} bots={state.bots} size={36} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[18px]">{c.title ?? (solo ? solo.name : members.map((m) => m.name).join(", "))}</span>
        </div>
        {solo && (solo.isMain || solo.teamRole === "operations") && <span className="text-[10px] font-medium leading-3 text-[#9A9A98]">{solo.isMain ? "Orchestrator" : "Head of ops"}</span>}
        <div className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] leading-[17px] ${unread ? "font-medium text-ink" : typing ? "text-[#6B6B6B] italic" : "text-[#6B6B6B]"}`}>{preview}</span>
          <span className="shrink-0 text-[11px] leading-4 text-[#9A9A98]">{last ? ago(last.at) : ""}</span>
          {unread && <span data-tip="Unread" className="size-[9px] shrink-0 rounded-full bg-highlighter shadow-[0_0_0_1.5px_#0A0A0A]" />}
        </div>
      </div>
    </button>
  );
}

/** A small × that shows on hover and deletes, without opening what it sits on. */
export function DeleteX({ label, onDelete, className = "" }: { label: string; onDelete: () => void; className?: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className={`flex size-5 shrink-0 items-center justify-center rounded-md text-[#9A9A98] opacity-0 hover:bg-black/[0.06] hover:text-[#B42318] ${className}`}
    >
      <svg width="9" height="9" viewBox="0 0 12 12">
        <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * The workspace name, in place of a "Messages" title. Click it to switch workspaces, rename this
 * one, or start a new one. Each workspace is its own team: its own main bot, bots, chats and threads.
 */
function WorkspaceSwitcher({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<null | { id?: string; name: string }>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const workspaces = state.workspaces ?? [];
  const current = workspaces.find((w) => w.id === currentWorkspace(state));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(null);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    setNaming(null);
    setDeleting(null);
  };
  const save = async () => {
    const name = naming?.name.trim();
    if (!name) return;
    if (naming?.id) await post("/api/workspaces", { id: naming.id, name }, "PATCH");
    else await post("/api/workspaces", { name });
    close();
  };
  const count = (id: string) => state.bots.filter((b) => workspaceOf(b) === id).length;

  return (
    <div ref={box} className="relative min-w-0">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="Switch workspace"
        className="-ml-1.5 flex min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-0.5 hover:bg-black/[0.04]"
      >
        <span className="truncate text-[22px] font-semibold leading-7 tracking-[-0.02em]">{current?.name ?? "Main"}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="#6B6B6B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 flex w-[248px] flex-col rounded-[14px] bg-white p-1.5 shadow-[0_0_0_1px_#E6E6E3,0_12px_32px_rgba(0,0,0,0.12)]">
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-[#9A9A98]">Workspaces</div>
          {workspaces.map((w) =>
            naming?.id === w.id ? (
              <NameInput key={w.id} value={naming.name} onChange={(name) => setNaming({ id: w.id, name })} onSave={save} onCancel={() => setNaming(null)} />
            ) : (
              <div key={w.id} className="group/ws flex items-center rounded-[10px] hover:bg-black/[0.04]">
                <button
                  onClick={() => {
                    if (w.id !== current?.id) void post("/api/workspaces", { current: w.id }, "PATCH");
                    close();
                  }}
                  className="flex h-9 min-w-0 flex-1 items-center gap-2 pl-2.5 text-left"
                >
                  <span className="flex size-[18px] shrink-0 items-center justify-center">
                    {w.id === current?.id && (
                      <svg width="12" height="12" viewBox="0 0 12 12">
                        <path d="M2.5 6.5l2.3 2.2L9.5 3.5" fill="none" stroke="#0A0A0A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{w.name}</span>
                  <span className="shrink-0 text-[12px] text-[#9A9A98]">
                    {count(w.id)} bot{count(w.id) === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  onClick={() => setNaming({ id: w.id, name: w.name })}
                  title={`Rename ${w.name}`}
                  aria-label={`Rename ${w.name}`}
                  className="mx-1 flex size-7 shrink-0 items-center justify-center rounded-md text-[#9A9A98] opacity-0 hover:bg-black/[0.06] hover:text-ink group-hover/ws:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16">
                    <path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12 3 13z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </button>
                {workspaces.length > 1 &&
                  (deleting === w.id ? (
                    <button
                      onClick={() => {
                        void post("/api/workspaces", { id: w.id }, "DELETE");
                        setDeleting(null);
                      }}
                      title={`Delete ${w.name}, its bots and their computers`}
                      className="mr-1 h-7 shrink-0 rounded-md bg-[#B42318] px-2 text-[12px] font-medium text-white"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      onClick={() => setDeleting(w.id)}
                      title={`Delete ${w.name}`}
                      aria-label={`Delete ${w.name}`}
                      className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-[#9A9A98] opacity-0 hover:bg-black/[0.06] hover:text-[#B42318] group-hover/ws:opacity-100"
                    >
                      <svg width="9" height="9" viewBox="0 0 12 12">
                        <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  ))}
              </div>
            ),
          )}
          <div className="mx-2 my-1 h-px bg-[#ECECEA]" />
          {naming && !naming.id ? (
            <NameInput value={naming.name} placeholder="Name the workspace" onChange={(name) => setNaming({ name })} onSave={save} onCancel={() => setNaming(null)} />
          ) : (
            <button onClick={() => setNaming({ name: "" })} className="flex h-9 items-center gap-2 rounded-[10px] pl-2.5 text-left text-[14px] font-medium hover:bg-black/[0.04]">
              <span className="flex size-[18px] items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 16 16">
                  <path d="M8 3v10M3 8h10" fill="none" stroke="#0A0A0A" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              New workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Everything the team is watching, in one place: what (a conversation, a mailbox, a site), and
 * whether it's live, paused (not showing right now) or has news. Click to see it; × stops it.
 */
function Watching({ state, onOpen }: { state: AppState; onOpen: (w: Watch) => void }) {
  const team = new Set(teamOf(state).map((b) => b.id));
  const list = (state.watches ?? []).filter((w) => team.has(w.botId)).sort((a, b) => Number(!!b.alert) - Number(!!a.alert) || b.since - a.since);
  if (!list.length) return null;
  return (
    <div className="flex flex-col pt-4">
      <div className="px-2.5 pb-1.5 text-[13px] font-medium leading-4 text-[#9A9A98]">Watching</div>
      {list.map((w) => {
        const where = w.mac ? w.mac.app : `${state.bots.find((b) => b.id === w.botId)?.name ?? "Bot"}'s screen ${DISPLAYS.indexOf(w.display) + 1}`;
        return (
          <button
            key={w.id}
            onClick={() => onOpen(w)}
            title={`${w.lookFor}${w.away ? " · paused: it isn't showing right now" : ""}`}
            className="group/watch flex h-[34px] items-center gap-2 rounded-[10px] px-2.5 text-left hover:bg-black/[0.03]"
          >
            <span className={w.away ? "text-[#C9C9C6]" : ""} style={w.away ? undefined : { color: WATCH }}>
              <WatchEye size={14} blink={!w.away && !w.alert} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] leading-[18px]">
              <span className={w.away ? "text-[#6B6B6B]" : "text-ink"}>{watchName(w)}</span>
              <span className="text-[#9A9A98]"> · {where}</span>
            </span>
            {w.alert ? (
              <span className="shrink-0 rounded-full bg-highlighter px-1.5 py-px text-[11px] font-semibold leading-4 text-ink shadow-[0_0_0_1px_#0000001F]">New</span>
            ) : (
              w.away && <span className="shrink-0 text-[12px] text-[#9A9A98] group-hover/watch:hidden">Paused</span>
            )}
            <DeleteX label={`Stop watching ${watchName(w)}`} onDelete={() => void post(`/api/watches?id=${encodeURIComponent(w.id)}`, {}, "DELETE")} className="group-hover/watch:opacity-100" />
          </button>
        );
      })}
    </div>
  );
}

function NameInput({ value, placeholder, onChange, onSave, onCancel }: { value: string; placeholder?: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="flex items-center gap-1.5 p-1"
    >
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        className="h-8 min-w-0 flex-1 rounded-[8px] bg-[#F4F4F2] px-2.5 text-[14px] outline-none placeholder:text-[#9A9A98] focus:shadow-[0_0_0_1.5px_#0A0A0A]"
      />
      <button type="submit" disabled={!value.trim()} className="h-8 shrink-0 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-white disabled:opacity-30">
        {placeholder ? "Create" : "Save"}
      </button>
    </form>
  );
}
