// Inventário Familiar: data layer and business rules.
//
// Financial rule: from each gross receita, the lawyer takes 5% (fees);
// the net is split into equal parts among the active heirs. The quinhões
// (shares) are computed and PERSISTED with the entry (inventario_shares),
// preserving history even if the member composition changes later.
import { prisma } from "@/lib/inventario/prisma";

export const LAWYER_PCT = 5;

// ── Access log ──────────────────────────────────────────────────────
export async function logAccess(data: {
  memberId?: string | null;
  actor: string;
  action: string;
  detail?: string | null;
  request?: Request;
}) {
  const ip = data.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = data.request?.headers.get("user-agent")?.slice(0, 250) ?? null;
  await prisma.invAccessLog
    .create({
      data: {
        memberId: data.memberId ?? null,
        actor: data.actor,
        action: data.action,
        detail: data.detail ?? null,
        ip,
        userAgent,
      },
    })
    .catch(() => {}); // logging must never break the main operation
}

// ── Members ─────────────────────────────────────────────────────────
export function serializeMember(m: {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  passwordHash: string | null;
  blocked: boolean;
  pixKey: string | null;
  createdAt: Date;
}) {
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    role: m.role,
    active: m.active,
    hasPassword: Boolean(m.passwordHash), // the hash never leaves the API
    blocked: m.blocked,
    pixKey: m.pixKey,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function listMembers() {
  const rows = await prisma.invMember.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(serializeMember);
}

// ── Receitas + shares + despesas ────────────────────────────────────
/**
 * Split of a receita: the 5% lawyer fee (rounded to the cent) and the
 * month's despesas come out of the gross; the net is divided into equal
 * parts among the heirs; leftover cents go, one by one, to the first ones.
 */
export function computeSplit(grossCents: number, heirsCount: number, expensesCents = 0) {
  const lawyerCents = Math.round((grossCents * LAWYER_PCT) / 100);
  const netCents = grossCents - lawyerCents - expensesCents;
  const base = heirsCount > 0 && netCents > 0 ? Math.floor(netCents / heirsCount) : 0;
  const resto = heirsCount > 0 && netCents > 0 ? netCents - base * heirsCount : 0;
  const heirShares = Array.from({ length: heirsCount }, (_, i) => base + (i < resto ? 1 : 0));
  return { lawyerCents, netCents, heirShares };
}

/** [start, end) of a date's month (UTC); receitas and despesas are matched by month. */
function monthRangeUtc(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

async function activeSplitMembers() {
  const members = await prisma.invMember.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  const heirs = members.filter((m) => m.role === "HEIR");
  const lawyer = members.find((m) => m.role === "LAWYER") ?? null;
  if (heirs.length === 0) throw new Error("Nenhum herdeiro ativo cadastrado.");
  return { heirs, lawyer };
}

export async function createReceita(data: {
  descricao: string;
  grossCents: number;
  receivedAt: Date;
}) {
  const { heirs, lawyer } = await activeSplitMembers();

  return prisma.$transaction(async (tx) => {
    // Pending despesas due in the same month make up the deduction.
    const { start, end } = monthRangeUtc(data.receivedAt);
    const pendentes = await tx.invDespesa.findMany({
      where: { receitaId: null, dueAt: { gte: start, lt: end } },
    });
    const expensesCents = pendentes.reduce((a, d) => a + d.amountCents, 0);

    const { lawyerCents, netCents, heirShares } = computeSplit(
      data.grossCents,
      heirs.length,
      expensesCents,
    );
    if (netCents < 0) {
      throw new Error(
        `As despesas do mês (R$ ${(expensesCents / 100).toFixed(2)}) excedem o líquido da entrada.`,
      );
    }

    const receita = await tx.invReceita.create({ data });
    if (pendentes.length > 0) {
      await tx.invDespesa.updateMany({
        where: { id: { in: pendentes.map((d) => d.id) } },
        data: { receitaId: receita.id },
      });
    }
    const shares = [
      ...heirs.map((h, i) => ({
        receitaId: receita.id,
        memberId: h.id,
        kind: "HEIR_SHARE",
        amountCents: heirShares[i],
      })),
      ...(lawyer
        ? [{ receitaId: receita.id, memberId: lawyer.id, kind: "LAWYER_FEE", amountCents: lawyerCents }]
        : []),
    ];
    await tx.invShare.createMany({ data: shares });
    return receita;
  });
}

/**
 * Recomputes the shares of a receita (despesa added/removed after the entry
 * was created). Blocks if repasses are already linked: money already sent
 * cannot be recalculated.
 */
export async function recomputeReceita(receitaId: string): Promise<void> {
  const repassesCount = await prisma.invRepasse.count({ where: { receitaId } });
  if (repassesCount > 0) {
    throw new Error("Esta entrada já tem repasses registrados. Exclua-os antes de alterar despesas.");
  }
  const receita = await prisma.invReceita.findUnique({
    where: { id: receitaId },
    include: { despesas: true },
  });
  if (!receita) return;

  const { heirs, lawyer } = await activeSplitMembers();
  const expensesCents = receita.despesas.reduce((a, d) => a + d.amountCents, 0);
  const { lawyerCents, netCents, heirShares } = computeSplit(
    receita.grossCents,
    heirs.length,
    expensesCents,
  );
  if (netCents < 0) {
    throw new Error(
      `As despesas (R$ ${(expensesCents / 100).toFixed(2)}) excedem o líquido da entrada "${receita.descricao}".`,
    );
  }

  await prisma.$transaction([
    prisma.invShare.deleteMany({ where: { receitaId } }),
    prisma.invShare.createMany({
      data: [
        ...heirs.map((h, i) => ({
          receitaId,
          memberId: h.id,
          kind: "HEIR_SHARE",
          amountCents: heirShares[i],
        })),
        ...(lawyer
          ? [{ receitaId, memberId: lawyer.id, kind: "LAWYER_FEE", amountCents: lawyerCents }]
          : []),
      ],
    }),
  ]);
}

// ── Despesas ────────────────────────────────────────────────────────
/**
 * Creates the despesa and tries to deduct it right away: it attaches to the
 * most recent receita of the due month that has no repasses yet. Without an
 * eligible receita, it stays pending and rolls into that month's next entry.
 */
export async function createDespesa(data: {
  descricao: string;
  amountCents: number;
  dueAt: Date;
}) {
  const { start, end } = monthRangeUtc(data.dueAt);
  const candidates = await prisma.invReceita.findMany({
    where: { receivedAt: { gte: start, lt: end } },
    include: { _count: { select: { repasses: true } } },
    orderBy: { receivedAt: "desc" },
  });
  const target = candidates.find((c) => c._count.repasses === 0) ?? null;

  const despesa = await prisma.invDespesa.create({
    data: { ...data, receitaId: target?.id ?? null },
  });
  if (target) {
    try {
      await recomputeReceita(target.id);
    } catch (err) {
      await prisma.invDespesa.delete({ where: { id: despesa.id } }).catch(() => {});
      throw err;
    }
  }
  return {
    despesa,
    composedInto: target ? { id: target.id, descricao: target.descricao } : null,
    hasBlockedReceitas: !target && candidates.length > 0,
  };
}

export async function deleteDespesa(id: string): Promise<boolean> {
  const despesa = await prisma.invDespesa.findUnique({ where: { id } });
  if (!despesa) return false;
  if (despesa.receitaId) {
    const repasses = await prisma.invRepasse.count({ where: { receitaId: despesa.receitaId } });
    if (repasses > 0) {
      throw new Error(
        "A entrada onde esta despesa foi descontada já tem repasses. Exclua-os primeiro.",
      );
    }
  }
  await prisma.invDespesa.delete({ where: { id } });
  if (despesa.receitaId) await recomputeReceita(despesa.receitaId);
  return true;
}

export async function listDespesas() {
  const rows = await prisma.invDespesa.findMany({
    include: { receita: { select: { descricao: true } } },
    orderBy: { dueAt: "desc" },
  });
  return rows.map((d) => ({
    id: d.id,
    descricao: d.descricao,
    amountCents: d.amountCents,
    dueAt: d.dueAt.toISOString(),
    receitaId: d.receitaId,
    receitaDescricao: d.receita?.descricao ?? null,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function listReceitas() {
  const rows = await prisma.invReceita.findMany({
    include: {
      shares: { include: { member: { select: { id: true, name: true, role: true, pixKey: true } } } },
      repasses: { select: { id: true, memberId: true, amountCents: true } },
      despesas: { select: { id: true, descricao: true, amountCents: true } },
    },
    orderBy: { receivedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    descricao: r.descricao,
    grossCents: r.grossCents,
    receivedAt: r.receivedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    shares: r.shares.map((s) => ({
      id: s.id,
      memberId: s.memberId,
      memberName: s.member.name,
      memberPix: s.member.pixKey,
      kind: s.kind,
      amountCents: s.amountCents,
    })),
    // Repasses LINKED to this receita (the "related entry" field)
    repasses: r.repasses.map((p) => ({ id: p.id, memberId: p.memberId, amountCents: p.amountCents })),
    // Despesas deducted from this receita
    despesas: r.despesas.map((d) => ({ id: d.id, descricao: d.descricao, amountCents: d.amountCents })),
  }));
}

// ── Repasses ────────────────────────────────────────────────────────
export async function listRepasses() {
  const rows = await prisma.invRepasse.findMany({
    include: {
      member: { select: { id: true, name: true } },
      receita: { select: { id: true, descricao: true } },
    },
    orderBy: { paidAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    memberName: r.member.name,
    receitaId: r.receitaId,
    receitaDescricao: r.receita?.descricao ?? null,
    amountCents: r.amountCents,
    paidAt: r.paidAt.toISOString(),
    nota: r.nota,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Individual extrato ──────────────────────────────────────────────
/** A member's extrato: credits (shares per receita) and repasses received. */
export async function getExtrato(memberId: string) {
  const [member, shares, repasses] = await Promise.all([
    prisma.invMember.findUnique({ where: { id: memberId } }),
    prisma.invShare.findMany({
      where: { memberId },
      include: { receita: true },
      orderBy: { receita: { receivedAt: "desc" } },
    }),
    prisma.invRepasse.findMany({
      where: { memberId },
      include: { receita: { select: { descricao: true } } },
      orderBy: { paidAt: "desc" },
    }),
  ]);
  if (!member) return null;

  const totalCreditos = shares.reduce((acc, s) => acc + s.amountCents, 0);
  const totalRecebido = repasses.reduce((acc, r) => acc + r.amountCents, 0);

  return {
    member: { id: member.id, name: member.name, role: member.role },
    creditos: shares.map((s) => ({
      id: s.id,
      receitaId: s.receitaId,
      descricao: s.receita.descricao,
      receitaGrossCents: s.receita.grossCents,
      kind: s.kind,
      amountCents: s.amountCents,
      receivedAt: s.receita.receivedAt.toISOString(),
    })),
    repasses: repasses.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      paidAt: r.paidAt.toISOString(),
      nota: r.nota,
      receitaDescricao: r.receita?.descricao ?? null,
    })),
    totalCreditosCents: totalCreditos,
    totalRecebidoCents: totalRecebido,
    saldoCents: totalCreditos - totalRecebido,
  };
}

// ── Admin dashboard ─────────────────────────────────────────────────
/** Monthly series of gross income and fees, plus balance per member. */
export async function getSummary() {
  const [receitas, shares, repasses, members, despesas] = await Promise.all([
    prisma.invReceita.findMany({ orderBy: { receivedAt: "asc" } }),
    prisma.invShare.findMany(),
    prisma.invRepasse.findMany(),
    prisma.invMember.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invDespesa.findMany(),
  ]);

  // Month by month aggregation (YYYY-MM): gross, fees, despesas (by due date) and repasses (by payment date).
  const byMonth = new Map<
    string,
    { grossCents: number; feeCents: number; despesasCents: number; paidCents: number }
  >();
  const monthOf = (d: Date) => d.toISOString().slice(0, 7);
  const emptyMonth = () => ({ grossCents: 0, feeCents: 0, despesasCents: 0, paidCents: 0 });
  const feeByReceita = new Map<string, number>();
  for (const s of shares) {
    if (s.kind === "LAWYER_FEE") {
      feeByReceita.set(s.receitaId, (feeByReceita.get(s.receitaId) ?? 0) + s.amountCents);
    }
  }
  for (const r of receitas) {
    const cur = byMonth.get(monthOf(r.receivedAt)) ?? emptyMonth();
    cur.grossCents += r.grossCents;
    cur.feeCents += feeByReceita.get(r.id) ?? 0;
    byMonth.set(monthOf(r.receivedAt), cur);
  }
  for (const d of despesas) {
    const cur = byMonth.get(monthOf(d.dueAt)) ?? emptyMonth();
    cur.despesasCents += d.amountCents;
    byMonth.set(monthOf(d.dueAt), cur);
  }
  for (const r of repasses) {
    const cur = byMonth.get(monthOf(r.paidAt)) ?? emptyMonth();
    cur.paidCents += r.amountCents;
    byMonth.set(monthOf(r.paidAt), cur);
  }

  const creditByMember = new Map<string, number>();
  for (const s of shares) {
    creditByMember.set(s.memberId, (creditByMember.get(s.memberId) ?? 0) + s.amountCents);
  }
  const paidByMember = new Map<string, number>();
  for (const r of repasses) {
    paidByMember.set(r.memberId, (paidByMember.get(r.memberId) ?? 0) + r.amountCents);
  }

  return {
    months: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        grossCents: v.grossCents,
        feeCents: v.feeCents,
        despesasCents: v.despesasCents,
        paidCents: v.paidCents,
      })),
    totals: {
      grossCents: receitas.reduce((acc, r) => acc + r.grossCents, 0),
      feeCents: [...feeByReceita.values()].reduce((acc, v) => acc + v, 0),
      despesasCents: despesas.reduce((acc, d) => acc + d.amountCents, 0),
      paidCents: repasses.reduce((acc, r) => acc + r.amountCents, 0),
    },
    perMember: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      active: m.active,
      creditCents: creditByMember.get(m.id) ?? 0,
      paidCents: paidByMember.get(m.id) ?? 0,
      saldoCents: (creditByMember.get(m.id) ?? 0) - (paidByMember.get(m.id) ?? 0),
    })),
  };
}
