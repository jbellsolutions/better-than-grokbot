/** Serialize each conversation while letting unrelated conversations run concurrently. */
const globalQueue = globalThis as unknown as { __bopsTurnQueue?: Map<string, Promise<unknown>> };
const queues = globalQueue.__bopsTurnQueue ??= new Map();

export function queueTurn<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  queues.set(key, next);
  const clean = () => { if (queues.get(key) === next) queues.delete(key); };
  void next.then(clean, clean);
  return next;
}
