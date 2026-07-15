// POST { password }: creates/sets the authenticated member's password (post-OTP).
import { prisma } from "@/lib/inventario/prisma";
import { requireInv, hashPassword } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const s = await requireInv();
  if (s instanceof Response) return s;
  if (s.kind !== "member") {
    return Response.json({ message: "Apenas membros definem senha." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return Response.json({ message: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  await prisma.invMember.update({
    where: { id: s.memberId },
    data: { passwordHash: await hashPassword(password) },
  });
  await logAccess({ memberId: s.memberId, actor: s.name, action: "PASSWORD_SET", request });
  return Response.json({ ok: true });
}
