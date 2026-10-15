import "server-only";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { instanceId, registryPath } from "./instance";

/** The existing three-task Mac limit belongs to the host, not to each independent coordinator. */
export const MAC_CAPACITY = 3;
type Lease = { instance: string; task: string; coordinator: number; worker?: number };
const root = () => join(dirname(registryPath()), "mac-leases");
const path = (slot: number) => join(root(), String(slot));
const read = (slot: number): Lease | undefined => { try { return JSON.parse(readFileSync(join(path(slot), "owner.json"), "utf8")); } catch { return undefined; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; } };

export function claimMac(task: string) {
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  for (let slot = 0; slot < MAC_CAPACITY; slot++) {
    const lease = read(slot);
    if (lease?.instance === instanceId() && lease.task === task && lease.coordinator === process.pid) return slot;
    // A timer or a missing response is never evidence of cancellation. Check both process owners.
    if (lease && !alive(lease.coordinator) && (!lease.worker || !alive(lease.worker))) {
      try {
        mkdirSync(join(path(slot), "reclaiming"));
        const current = read(slot);
        if (current && !alive(current.coordinator) && (!current.worker || !alive(current.worker))) rmSync(path(slot), { recursive: true });
        else rmSync(join(path(slot), "reclaiming"), { recursive: true });
      } catch (e) { if (!["EEXIST", "ENOENT"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e; }
    }
    try {
      mkdirSync(path(slot), { mode: 0o700 });
      writeFileSync(join(path(slot), "owner.json"), JSON.stringify({ instance: instanceId(), task, coordinator: process.pid }), { mode: 0o600 });
      return slot;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  return null;
}

export function bindMacWorker(task: string, worker: number) {
  for (let slot = 0; slot < MAC_CAPACITY; slot++) {
    const lease = read(slot);
    if (lease?.instance === instanceId() && lease.task === task && lease.coordinator === process.pid)
      writeFileSync(join(path(slot), "owner.json"), JSON.stringify({ ...lease, worker }), { mode: 0o600 });
  }
}

export function releaseMac(task: string) {
  for (let slot = 0; slot < MAC_CAPACITY; slot++) {
    const lease = read(slot);
    if (lease?.instance === instanceId() && lease.task === task && lease.coordinator === process.pid) rmSync(path(slot), { recursive: true });
  }
}

/** Startup recovery needs positive evidence that the recorded controller and worker both ended. */
export function endedMacTasks() {
  const ended = new Set<string>();
  for (let slot = 0; slot < MAC_CAPACITY; slot++) {
    const lease = read(slot);
    if (lease?.instance === instanceId() && lease.worker && !alive(lease.coordinator) && !alive(lease.worker)) ended.add(lease.task);
  }
  return ended;
}
