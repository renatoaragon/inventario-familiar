// Repasses (payouts made to members): admin only.
import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin } from "@/lib/inventario/auth";
import { listRepasses, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;
  return Response.json({ repasses: await listRepasses() });
}

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : NaN;
  const paidAt = typeof body.paidAt === "string" ? new Date(body.paidAt) : null;
  const nota = typeof body.nota === "string" && body.nota.trim() ? body.nota.trim() : null;
  const receitaId = typeof body.receitaId === "string" && body.receitaId ? body.receitaId : null;

  if (!memberId || !Number.isFinite(amountCents) || amountCents <= 0 || !paidAt || isNaN(+paidAt)) {
    return Response.json({ message: "Informe membro, valor e data válidos." }, { status: 400 });
  }
  const member = await prisma.invMember.findUnique({ where: { id: memberId } });
  if (!member) return Response.json({ message: "Membro não encontrado." }, { status: 404 });

  const repasse = await prisma.invRepasse.create({
    data: { memberId, amountCents, paidAt, nota, receitaId },
  });
  await logAccess({
    actor: "Admin",
    action: "REPASSE_CREATE",
    detail: `${member.name}: R$ ${(amountCents / 100).toFixed(2)}`,
    request,
  });
  return Response.json({ ok: true, id: repasse.id }, { status: 201 });
}
