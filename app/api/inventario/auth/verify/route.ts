// POST { phone, code }: validates the OTP and creates the member session.
import { prisma } from "@/lib/inventario/prisma";
import { normalizePhone, verifyOtp, createMemberSession } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  const code = typeof body.code === "string" ? body.code.replace(/\D+/g, "") : "";
  if (!phone || code.length !== 6) {
    return Response.json({ message: "Dados inválidos." }, { status: 400 });
  }

  const member = await prisma.invMember.findUnique({ where: { phone } });
  if (!member || !member.active) {
    return Response.json({ message: "Este número não está autorizado." }, { status: 403 });
  }
  if (member.blocked) {
    return Response.json(
      { message: "Acesso bloqueado (reset de senha). Fale diretamente com o administrador." },
      { status: 403 },
    );
  }

  const ok = await verifyOtp(member.id, code);
  if (!ok) {
    await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_FAIL", detail: "código", request });
    return Response.json({ message: "Código inválido ou expirado." }, { status: 401 });
  }

  await createMemberSession(member);
  await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_OK", detail: "código OTP", request });
  // No password set → the client forces creating one before entering.
  return Response.json({ ok: true, name: member.name, needPassword: !member.passwordHash });
}
