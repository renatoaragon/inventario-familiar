// Estate despesas: admin only. Deducted from the income entry of the same
// month as the due date (auto-composed at entry time or recomputed immediately).
import { requireInvAdmin } from "@/lib/inventario/auth";
import { createDespesa, listDespesas, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;
  return Response.json({ despesas: await listDespesas() });
}

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const descricao = typeof body.descricao === "string" ? body.descricao.trim() : "";
  const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : NaN;
  const dueAt = typeof body.dueAt === "string" ? new Date(body.dueAt) : null;

  if (!descricao || !Number.isFinite(amountCents) || amountCents <= 0 || !dueAt || isNaN(+dueAt)) {
    return Response.json({ message: "Informe descrição, valor e vencimento válidos." }, { status: 400 });
  }

  try {
    const result = await createDespesa({ descricao, amountCents, dueAt });
    await logAccess({
      actor: "Admin",
      action: "DESPESA_CREATE",
      detail: `${descricao}: R$ ${(amountCents / 100).toFixed(2)}${
        result.composedInto ? ` (descontada em "${result.composedInto.descricao}")` : " (pendente)"
      }`,
      request,
    });
    return Response.json(
      {
        ok: true,
        id: result.despesa.id,
        composedInto: result.composedInto,
        message: result.composedInto
          ? `Despesa descontada na entrada "${result.composedInto.descricao}". Divisão recalculada.`
          : result.hasBlockedReceitas
            ? "Despesa registrada como pendente: a(s) entrada(s) deste mês já têm repasses feitos."
            : "Despesa registrada. Será descontada na próxima entrada deste mês.",
      },
      { status: 201 },
    );
  } catch (err) {
    return Response.json(
      { message: err instanceof Error ? err.message : "Erro ao lançar despesa." },
      { status: 400 },
    );
  }
}
