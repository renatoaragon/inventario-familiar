import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin, normalizePhone } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data: {
    name?: string;
    phone?: string;
    role?: string;
    active?: boolean;
    blocked?: boolean;
    pixKey?: string | null;
  } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.phone === "string") {
    const phone = normalizePhone(body.phone);
    if (phone.length < 10) return Response.json({ message: "Telefone inválido." }, { status: 400 });
    data.phone = phone;
  }
  if (body.role === "HEIR" || body.role === "LAWYER") data.role = body.role;
  if (typeof body.active === "boolean") data.active = body.active;
  // Unblocks access after a reset (the blocking itself is done by the /reset route).
  if (body.blocked === false) data.blocked = false;
  if (typeof body.pixKey === "string") data.pixKey = body.pixKey.trim() || null;

  const member = await prisma.invMember.update({ where: { id }, data }).catch(() => null);
  if (!member) return Response.json({ message: "Membro não encontrado." }, { status: 404 });

  await logAccess({
    actor: "Admin",
    action: "MEMBER_UPDATE",
    detail: `${member.name}: ${Object.keys(data).join(", ")}`,
    request,
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const member = await prisma.invMember.findUnique({
    where: { id },
    include: { _count: { select: { shares: true, repasses: true } } },
  });
  if (!member) return Response.json({ message: "Membro não encontrado." }, { status: 404 });

  // With financial history, only deactivate (preserves extratos); without history, delete.
  if (member._count.shares > 0 || member._count.repasses > 0) {
    await prisma.invMember.update({ where: { id }, data: { active: false } });
    await logAccess({ actor: "Admin", action: "MEMBER_DEACTIVATE", detail: member.name, request });
    return Response.json({ ok: true, deactivated: true });
  }
  await prisma.invMember.delete({ where: { id } });
  await logAccess({ actor: "Admin", action: "MEMBER_DELETE", detail: member.name, request });
  return Response.json({ ok: true });
}
