import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin } from "@/lib/inventario/auth";
import { deleteDespesa, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const despesa = await prisma.invDespesa.findUnique({ where: { id } });
  if (!despesa) return Response.json({ message: "Não encontrada." }, { status: 404 });

  try {
    await deleteDespesa(id);
  } catch (err) {
    return Response.json(
      { message: err instanceof Error ? err.message : "Erro ao excluir despesa." },
      { status: 400 },
    );
  }
  await logAccess({ actor: "Admin", action: "DESPESA_DELETE", detail: despesa.descricao, request });
  return Response.json({ ok: true });
}
