// POST { memberId }: generates an access code and returns it ONCE to the admin,
// for manual delivery (personal WhatsApp) while the Cloud API is not configured.
import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin, createOtp } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const memberId = typeof body.memberId === "string" ? body.memberId : "";
  const member = await prisma.invMember.findUnique({ where: { id: memberId } });
  if (!member || !member.active) {
    return Response.json({ message: "Membro não encontrado." }, { status: 404 });
  }

  const code = await createOtp(member.id);
  await logAccess({
    memberId: member.id,
    actor: "Admin",
    action: "CODE_MANUAL",
    detail: `código gerado para ${member.name}`,
    request,
  });
  return Response.json({ ok: true, code, expiresInMin: 10 });
}
