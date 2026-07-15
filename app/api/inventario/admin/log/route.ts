// Access log: admin only. Last 300 records.
import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin } from "@/lib/inventario/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const rows = await prisma.invAccessLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return Response.json({
    log: rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      detail: r.detail,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
