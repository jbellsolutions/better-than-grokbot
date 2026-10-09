import { orgo } from "@/lib/server/orgo";
export const dynamic = "force-dynamic";

/** Read-only, sanitized inventory from the authenticated account. */
export async function GET() {
  try { return Response.json({ computers: await orgo.computers() }); }
  catch { return Response.json({ computers: [], error: "Could not load your Orgo computers. Check your Orgo connection." }, { status: 502 }); }
}
