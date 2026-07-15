import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const repasse = await prisma.invRepasse.findUnique({
    where: { id },
    include: { member: { select: { name: true } } },
  });
  if (!repasse) return Response.json({ message: "Não encontrado." }, { status: 404 });

  await prisma.invRepasse.delete({ where: { id } });
  await logAccess({
    actor: "Admin",
    action: "REPASSE_DELETE",
    detail: `${repasse.member.name}: R$ ${(repasse.amountCents / 100).toFixed(2)}`,
    request,
  });
  return Response.json({ ok: true });
}
