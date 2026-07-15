// Receitas (income entries): admin only. POST computes and persists the shares
// (5% for the lawyer, net divided among active heirs).
import { requireInvAdmin } from "@/lib/inventario/auth";
import { createReceita, listReceitas, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;
  return Response.json({ receitas: await listReceitas() });
}

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const descricao = typeof body.descricao === "string" ? body.descricao.trim() : "";
  const grossCents = typeof body.grossCents === "number" ? Math.round(body.grossCents) : NaN;
  const receivedAt = typeof body.receivedAt === "string" ? new Date(body.receivedAt) : null;

  if (!descricao || !Number.isFinite(grossCents) || grossCents <= 0 || !receivedAt || isNaN(+receivedAt)) {
    return Response.json({ message: "Informe descrição, valor e data válidos." }, { status: 400 });
  }

  try {
    const receita = await createReceita({ descricao, grossCents, receivedAt });
    await logAccess({
      actor: "Admin",
      action: "RECEITA_CREATE",
      detail: `${descricao}: R$ ${(grossCents / 100).toFixed(2)}`,
      request,
    });
    return Response.json({ ok: true, id: receita.id }, { status: 201 });
  } catch (err) {
    return Response.json(
      { message: err instanceof Error ? err.message : "Erro ao lançar receita." },
      { status: 400 },
    );
  }
}
