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
  const receita = await prisma.invReceita.findUnique({ where: { id } });
  if (!receita) return Response.json({ message: "Não encontrada." }, { status: 404 });

  await prisma.invReceita.delete({ where: { id } }); // shares are removed by cascade
  await logAccess({ actor: "Admin", action: "RECEITA_DELETE", detail: receita.descricao, request });
  return Response.json({ ok: true });
}
