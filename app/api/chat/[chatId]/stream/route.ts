import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { decideInterrupt, resumeFromInput } from "@/lib/server/interrupts";
import { chat, ownerName } from "@/lib/server/store";
import { currentSeq, eventId, onTurnEvent, seqOf, type TurnEvent } from "@/lib/server/turn-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A chat's turn stream, as AG-UI events over SSE (`data: <event>`), from lib/server/turn-events.ts.
 *
 * - GET follows the chat: what's still running, from its start (or, reconnecting with Last-Event-ID,
 *   everything since), then live. The web chat draws text as it's written from this.
 * - POST is an AG-UI run (RunAgentInput): a resume (forwardedProps.command.resume answers an
 *   approval's interrupt) or a new message from the user (its last user message). It answers with
 *   that run's events and ends when the run does.
 *
 * Like every API route, only this Mac's app reaches it (proxy.ts). A CUSTOM heartbeat every 5
 * seconds keeps a quiet stream (a long tool) from being taken for a dead one and dropped.
 */
const HEARTBEAT_MS = 5000;
const HEARTBEAT = { type: EventType.CUSTOM, name: "bops.heartbeat", value: {} };
const HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" };

/** An SSE stream that closes cleanly when the page goes, with the heartbeat. `start` returns its cleanup. */
function sse(request: Request, start: (send: (event: object, id?: string) => void, end: () => void) => (() => void) | void) {
  const encoder = new TextEncoder();
  let dispose = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: object, id?: string) => {
        if (!closed) controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(event)}\n\n`));
      };
      const beat = setInterval(() => send(HEARTBEAT), HEARTBEAT_MS);
      // What `start` set up, undone at the end (it may end before `start` returns).
      const hold: { cleanup?: (() => void) | void } = {};
      const end = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        hold.cleanup?.();
        request.signal.removeEventListener("abort", end);
        try {
          controller.close();
        } catch {}
      };
      dispose = end;
      request.signal.addEventListener("abort", end, { once: true });
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      hold.cleanup = start(send, end);
      if (closed) hold.cleanup?.();
      if (request.signal.aborted) end();
    },
    cancel() {
      dispose();
    },
  });
  return new Response(body, { headers: HEADERS });
}

export async function GET(request: Request, ctx: RouteContext<"/api/chat/[chatId]/stream">) {
  const { chatId } = await ctx.params;
  if (!chat(chatId)) return Response.json({ error: "no such chat" }, { status: 404 });
  const after = seqOf(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after"));
  return sse(request, (send) => onTurnEvent((e) => send(e.event, eventId(e.seq)), { chatId, after }));
}

/** The text of the input's last user message (a string, or text parts). */
function lastUserText(input: unknown) {
  const messages = (input as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return "";
  const m = [...messages].reverse().find((x) => x && typeof x === "object" && (x as { role?: unknown }).role === "user") as { content?: unknown } | undefined;
  if (!m) return "";
  if (typeof m.content === "string") return m.content.trim();
  return Array.isArray(m.content)
    ? m.content.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("\n").trim()
    : "";
}

export async function POST(request: Request, ctx: RouteContext<"/api/chat/[chatId]/stream">) {
  const { chatId } = await ctx.params;
  if (!chat(chatId)) return Response.json({ error: "no such chat" }, { status: 404 });
  const input: unknown = await request.json().catch(() => null);
  const given = (input as { runId?: unknown } | null)?.runId;
  const runId = typeof given === "string" && given.length <= 200 ? given : randomUUID();
  const resume = resumeFromInput(input);
  const text = resume ? "" : lastUserText(input);
  if (!resume && !text) return Response.json({ error: "Send a resume or a user message." }, { status: 400 });
  const from = currentSeq();
  return sse(request, (send, end) => {
    send({ type: EventType.RUN_STARTED, threadId: chatId, runId });
    const finish = (error?: string) => {
      send(error ? { type: EventType.RUN_ERROR, message: error } : { type: EventType.RUN_FINISHED, threadId: chatId, runId });
      end();
    };
    // The runs this request starts in the chat, inside this one run: their content, not their own start and end.
    let decisionDone: (() => void) | undefined;
    const unsubscribe = onTurnEvent((e, run) => {
      if (e.seq <= from) return;
      const t = (e.event as TurnEvent).type;
      if (t === EventType.RUN_STARTED || t === EventType.RUN_FINISHED || t === EventType.RUN_ERROR) {
        if (t !== EventType.RUN_STARTED && run.kind === "resume") decisionDone?.();
        return;
      }
      send(e.event, eventId(e.seq));
    }, { chatId, after: from });
    void (async () => {
      try {
        if (resume) {
          if (resume.invalid) return finish("That approval answer couldn't be read, so nothing was decided.");
          const decision = new Promise<void>((resolve) => (decisionDone = resolve));
          if (!(await decideInterrupt(resume.interruptId, { confirmed: resume.confirmed, always: resume.always, by: resume.by ?? ownerName() })))
            return finish("Nothing is waiting on that approval any more: it was already decided.");
          // The action runs once it's approved; this run ends when it has (or after 5 minutes, still running).
          await Promise.race([decision, new Promise((r) => setTimeout(r, 5 * 60_000))]);
        } else {
          const { handleMessage } = await import("@/lib/server/chat");
          await handleMessage(chatId, text, undefined, undefined, undefined, undefined, undefined, runId);
        }
        finish();
      } catch (e) {
        finish((e as Error).message);
      }
    })();
    return unsubscribe;
  });
}
