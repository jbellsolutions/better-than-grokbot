"use client";

import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { provisionalText } from "@/lib/turn-text";

/**
 * A chat's turn stream (/api/chat/<chat>/stream, AG-UI events): a bot's answer as it's written and
 * the tools it's using, drawn where its typing dots were. It's provisional: the saved message (from
 * the state, as ever) replaces it, matched by run id. Only these small components re-render per
 * piece of text, once per animation frame at most; the chat's state is untouched by the stream.
 */

type Tool = { id: string; label: string; status: "running" | "done" | "failed" | "waiting" };
export type LiveRun = {
  runId: string;
  kind: string;
  botId?: string;
  /** The text of the run's latest round (an earlier round's text gives way to the next one's). */
  text: string;
  tools: Tool[];
  step?: string;
  finished: boolean;
  messageId?: string;
  error?: string;
};
type Wire = { type: string; timestamp?: number; metadata?: { runId?: string; kind?: string; botId?: string; label?: string }; delta?: string; toolCallId?: string; toolCallName?: string; content?: string; stepName?: string; result?: { messageId?: string }; message?: string };

/** Chunk-to-screen timings, for checking the 150 ms gate in a real browser (window.__bopsStream). */
type Sample = { runId: string; length: number; serverAt?: number; receivedAt: number; paintedAt?: number };
const timings = (): { samples: Sample[] } => {
  const w = window as unknown as { __bopsStream?: { samples: Sample[] } };
  return (w.__bopsStream ??= { samples: [] });
};

const KEEP_MS = 2 * 60_000;
const EMPTY: LiveRun[] = [];

class ChatStream {
  private runs = new Map<string, LiveRun & { endedAt?: number }>();
  private listeners = new Set<() => void>();
  private source?: EventSource;
  private queued = false;
  snapshot: LiveRun[] = EMPTY;

  constructor(private chatId: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.source) {
      // On a dropped connection the browser reconnects by itself, sending Last-Event-ID: the server
      // replays what was missed, never what was already here.
      this.source = new EventSource(`/api/chat/${encodeURIComponent(this.chatId)}/stream`);
      this.source.onmessage = (m) => this.take(JSON.parse(m.data) as Wire);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      this.source?.close();
      this.source = undefined;
      this.runs.clear();
      this.snapshot = EMPTY;
    };
  };

  private take(e: Wire) {
    const runId = e.metadata?.runId;
    if (!runId) return;
    const r = this.runs.get(runId) ?? { runId, kind: e.metadata?.kind ?? "chat", botId: e.metadata?.botId, text: "", tools: [], finished: false };
    this.runs.set(runId, r);
    if (e.type === "TEXT_MESSAGE_START") r.text = "";
    else if (e.type === "TEXT_MESSAGE_CONTENT" && e.delta) {
      r.text += e.delta;
      timings().samples.push({ runId, length: r.text.length, serverAt: e.timestamp, receivedAt: Date.now() });
    } else if (e.type === "TOOL_CALL_START" && e.toolCallId && !r.tools.some((t) => t.id === e.toolCallId))
      r.tools = [...r.tools, { id: e.toolCallId, label: e.metadata?.label ?? e.toolCallName ?? "Working", status: "running" }];
    else if (e.type === "TOOL_CALL_RESULT" && e.toolCallId)
      r.tools = r.tools.map((t) => (t.id === e.toolCallId ? { ...t, status: (["done", "failed", "waiting"].includes(e.content ?? "") ? e.content : "done") as Tool["status"] } : t));
    else if (e.type === "STEP_STARTED") r.step = e.stepName;
    else if (e.type === "RUN_FINISHED") Object.assign(r, { finished: true, messageId: e.result?.messageId, endedAt: Date.now() });
    else if (e.type === "RUN_ERROR") Object.assign(r, { finished: true, error: e.message, endedAt: Date.now() });
    else return;
    this.flushSoon();
  }

  /** At most once a frame (a hidden page has no frames: then a short timer). */
  private flushSoon() {
    if (this.queued) return;
    this.queued = true;
    const flush = () => {
      this.queued = false;
      const now = Date.now();
      for (const [id, r] of this.runs) if (r.endedAt && now - r.endedAt > KEEP_MS) this.runs.delete(id);
      this.snapshot = [...this.runs.values()].map((r) => ({ ...r }));
      for (const l of this.listeners) l();
    };
    if (document.hidden) setTimeout(flush, 50);
    else requestAnimationFrame(flush);
  }
}

const streams = new Map<string, ChatStream>();
const streamOf = (chatId: string) => {
  let s = streams.get(chatId);
  if (!s) streams.set(chatId, (s = new ChatStream(chatId)));
  return s;
};

export function useChatStream(chatId: string) {
  const s = streamOf(chatId);
  return useSyncExternalStore(s.subscribe, () => s.snapshot, () => EMPTY);
}

const CHIP: Record<Tool["status"], string> = { running: "…", done: " ✓", failed: " · failed", waiting: " · waiting for you" };

/**
 * A bot's turn as it happens: its answer so far and its tools, or (until there's something to show)
 * `children`, its typing dots. Gone once the saved answer is in the chat (`saved`). `onGrow` runs
 * whenever it changes.
 */
export function LiveTurn({ chatId, botId, saved, render, onGrow, children }: { chatId: string; botId: string; saved: (runId: string) => boolean; render: (text: string) => ReactNode; onGrow?: () => void; children: ReactNode }) {
  const runs = useChatStream(chatId);
  const run = [...runs].reverse().find((r) => r.kind === "chat" && r.botId === botId && !saved(r.runId) && !r.error);
  const text = run ? provisionalText(run.text) : "";
  // Each change is laid out before the screen updates: the chat can keep it in view in the same frame.
  useLayoutEffect(() => {
    if (run) onGrow?.();
  }, [run, onGrow]);
  // When this text is on screen: the next frame after it's laid out.
  useLayoutEffect(() => {
    if (!run || !text) return;
    const shown = run.text.length;
    requestAnimationFrame(() => {
      const at = Date.now();
      for (const s of timings().samples) if (s.runId === run.runId && !s.paintedAt && s.length <= shown) s.paintedAt = at;
    });
  }, [run, text]);
  if (!run || (!text && !run.tools.length)) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-live-run={run.runId}>
      {text ? <div className="whitespace-pre-wrap rounded-[18px] bg-[#F2F2F0] px-3.5 py-2 text-[14px] leading-5 [overflow-wrap:anywhere]">{render(text)}</div> : children}
      {!!run.tools.length && (
        <div className="flex flex-wrap gap-1 pl-1">
          {run.tools.slice(-4).map((t) => (
            <span key={t.id} className={`rounded-full px-2 py-[3px] text-[11.5px] leading-[14px] shadow-[0_0_0_1px_#E6E6E3] ${t.status === "running" ? "animate-pulse text-[#6B6B6B]" : t.status === "failed" ? "text-[#B42318]" : "text-[#6B6B6B]"}`}>
              {t.label}
              {CHIP[t.status]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
