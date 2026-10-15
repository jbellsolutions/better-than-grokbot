import { getVersion, subscribeChanges } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Version notifications keep payloads small. The existing state route owns filtering and setup. */
export function GET(request: Request) {
  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending: ReturnType<typeof setTimeout> | undefined;
      const send = (data: string) => {
        if (!closed) controller.enqueue(encoder.encode(data));
      };
      const unsubscribe = subscribeChanges(() => {
        if (pending || closed) return;
        pending = setTimeout(() => {
          pending = undefined;
          send(`data: ${getVersion()}\n\n`);
        }, 30);
      });
      const heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      dispose = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(pending);
        request.signal.removeEventListener("abort", abort);
      };
      const abort = () => { dispose(); controller.close(); };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) { abort(); return; }
      send(`retry: 2000\ndata: ${getVersion()}\n\n`);
    },
    cancel() { dispose(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
