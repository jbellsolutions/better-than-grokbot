import { dataPath } from "@/lib/server/instance";
import { readFile } from "node:fs/promises";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = JSON.parse(await readFile(dataPath("updates.json"), "utf8"));
    return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ checkedAt: null, sources: [], errors: ["Update checks have not run yet."] }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
