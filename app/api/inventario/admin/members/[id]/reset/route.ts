// POST: password reset by the admin: BLOCKS access immediately, erases the
// password and invalidates all of the member's sessions (sessionEpoch++).
// To unblock: PATCH { blocked: false } + generate a code (first access again).
import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const member = await prisma.invMember.findUnique({ where: { id } });
  if (!member) return Response.json({ message: "Membro não encontrado." }, { status: 404 });

  await prisma.invMember.update({
    where: { id },
    data: { passwordHash: null, blocked: true, sessionEpoch: { increment: 1 } },
  });
  await logAccess({
    memberId: member.id,
    actor: "Admin",
    action: "PASSWORD_RESET",
    detail: `${member.name}: acesso bloqueado até liberar`,
    request,
  });
  return Response.json({ ok: true });
}
