"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRememberedState } from "./use-remembered-state";

const defaults = { sidebar: 340, chat: 440 };
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Own the layout state here so dragging does not rerender chat and live-screen children. */
export function ResizableColumns({ three, children }: { three: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [saved, setSaved] = useRememberedState("bops:column-widths", defaults);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const minSidebar = Math.min(200, width * .24);
  const minChat = Math.min(280, width * .36);
  const minComputer = Math.min(300, width * .4);
  const maxSidebar = Math.max(minSidebar, Math.min(600, width - (three ? minChat + minComputer : minChat)));
  const sidebar = clamp(Number.isFinite(saved?.sidebar) ? saved.sidebar : defaults.sidebar, minSidebar, maxSidebar);
  const maxChat = Math.max(minChat, width - sidebar - minComputer);
  const chat = clamp(Number.isFinite(saved?.chat) ? saved.chat : defaults.chat, minChat, maxChat);
  const change = (column: "sidebar" | "chat", value: number) => setSaved(old => ({ ...old, [column]: clamp(value, column === "sidebar" ? minSidebar : minChat, column === "sidebar" ? maxSidebar : maxChat) }));
  return <div ref={root} className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-white font-sans text-ink antialiased" style={{ "--bops-columns": three ? `${sidebar}px ${chat}px minmax(0,1fr)` : `${sidebar}px minmax(0,1fr)` } as CSSProperties}>
    {children}
    <ResizeHandle column="sidebar" left={sidebar} value={sidebar} min={minSidebar} max={maxSidebar} onChange={change} />
    {three && <ResizeHandle column="chat" left={sidebar + chat} value={chat} min={minChat} max={maxChat} onChange={change} />}
  </div>;
}

function ResizeHandle({ column, left, value, min, max, onChange }: { column: "sidebar" | "chat"; left: number; value: number; min: number; max: number; onChange: (column: "sidebar" | "chat", value: number) => void }) {
  const drag = useRef<{ x: number; value: number; column: "sidebar" | "chat" } | null>(null);
  const restore = useRef<() => void>(() => {});
  const frame = useRef<number | null>(null);
  const pending = useRef<{ column: "sidebar" | "chat"; value: number } | null>(null);
  useEffect(() => () => { restore.current(); if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const finish = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current) { onChange(pending.current.column, pending.current.value); pending.current = null; }
    drag.current = null;
    restore.current();
  };
  return <div
    key={column} role="separator" aria-orientation="vertical" aria-label={column === "sidebar" ? "Resize workspace column" : "Resize chat column"}
    aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)} tabIndex={0}
    title="Drag to resize · arrow keys to adjust · double-click to reset"
    className="group absolute inset-y-0 z-30 w-2 cursor-col-resize touch-none select-none outline-none [-webkit-app-region:no-drag]"
    style={{ left: left - 4 }}
    onDoubleClick={() => onChange(column, defaults[column])}
    onKeyDown={e => {
      const next = e.key === "Home" ? min : e.key === "End" ? max : e.key === "ArrowLeft" ? value - (e.shiftKey ? 50 : 10) : e.key === "ArrowRight" ? value + (e.shiftKey ? 50 : 10) : undefined;
      if (next !== undefined) { e.preventDefault(); onChange(column, next); }
    }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, value, column };
      const cursor = document.body.style.cursor, selection = document.body.style.userSelect;
      document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
      restore.current = () => { document.body.style.cursor = cursor; document.body.style.userSelect = selection; };
    }}
    onPointerMove={e => {
      if (!drag.current) return;
      pending.current = { column, value: drag.current.value + e.clientX - drag.current.x };
      if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (pending.current) { onChange(pending.current.column, pending.current.value); pending.current = null; } });
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
  ><div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-[#B9B9B5] group-focus-visible:w-[3px] group-focus-visible:bg-[#7C8B50]" /></div>;
}
