// POST { pixKey }: the member registers/updates their own PIX key.
// The admin is also one of the members: the same rules apply to them
// (the key is stored on their member record).
import { prisma } from "@/lib/inventario/prisma";
import { requireInv, getAdminMember } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pixKey = typeof body.pixKey === "string" ? body.pixKey.trim() : "";
  if (pixKey.length < 3 || pixKey.length > 140) {
    return Response.json({ message: "Informe uma chave PIX válida." }, { status: 400 });
  }

  let memberId: string;
  let actor: string;
  if (s.kind === "member") {
    memberId = s.memberId;
    actor = s.name;
  } else {
    const self = await getAdminMember();
    if (!self) {
      return Response.json({ message: "Ficha de membro do admin não encontrada." }, { status: 404 });
    }
    memberId = self.id;
    actor = `${self.name} (admin)`;
  }

  await prisma.invMember.update({ where: { id: memberId }, data: { pixKey } });
  await logAccess({ memberId, actor, action: "PIX_SET", detail: pixKey, request });
  return Response.json({ ok: true, pixKey });
}
