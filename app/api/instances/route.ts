import { readFile } from "node:fs/promises";
import { instanceInfo, registryPath } from "@/lib/server/instance";
import { validateRegistry } from "@/desktop/instances.cjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const current = instanceInfo();
  let entries: { id: string; name: string; url: string; purpose: string; computerId?: string; port: number }[];
  try {
    entries = JSON.parse(await readFile(registryPath(), "utf8"));
    validateRegistry(entries);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return Response.json({ error: "The instance registry could not be read." }, { status: 503 });
    return Response.json({ current, instances: [] });
  }
  const instances = await Promise.all(entries.map(async e => {
    try {
      const response = await fetch(`${e.url}/api/health`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
      const health = await response.json();
      const ready = response.ok && health.bops && health.instance?.id === e.id && (!e.computerId || health.instance?.computerId === e.computerId);
      return { ...e, status: ready ? "ready" : "mismatch" };
    } catch { return { ...e, status: "offline" }; }
  }));
  return Response.json({ current, instances, observeOnly: process.env.BOPS_COMPUTER_OBSERVE_ONLY === "1" }, { headers: { "Cache-Control": "no-store" } });
}
