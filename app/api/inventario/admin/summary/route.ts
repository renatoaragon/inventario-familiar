// Admin financial dashboard: monthly series + totals + balance per member.
import { requireInvAdmin } from "@/lib/inventario/auth";
import { getSummary } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;
  return Response.json({ summary: await getSummary() });
}
