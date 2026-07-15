// POST { phone, password }: regular login (after the password has been created).
import { prisma } from "@/lib/inventario/prisma";
import { normalizePhone, verifyPassword, createMemberSession } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || !password) {
    return Response.json({ message: "Dados inválidos." }, { status: 400 });
  }

  const member = await prisma.invMember.findUnique({ where: { phone } });
  if (!member || !member.active) {
    return Response.json({ message: "Este número não está autorizado." }, { status: 403 });
  }
  if (member.blocked) {
    await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_BLOCKED", request });
    return Response.json(
      { message: "Acesso bloqueado (reset de senha). Fale diretamente com o administrador." },
      { status: 403 },
    );
  }
  if (!member.passwordHash || !(await verifyPassword(password, member.passwordHash))) {
    await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_FAIL", detail: "senha incorreta", request });
    return Response.json({ message: "Senha incorreta." }, { status: 401 });
  }

  await createMemberSession(member);
  await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_OK", detail: "senha", request });
  return Response.json({ ok: true, name: member.name });
}
