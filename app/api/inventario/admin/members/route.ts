// Member management: admin only.
import { prisma } from "@/lib/inventario/prisma";
import { requireInvAdmin, normalizePhone } from "@/lib/inventario/auth";
import { listMembers, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;
  return Response.json({ members: await listMembers() });
}

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  const role = body.role === "LAWYER" ? "LAWYER" : "HEIR";

  if (!name || phone.length < 10) {
    return Response.json({ message: "Informe nome e telefone válidos (com DDD)." }, { status: 400 });
  }
  const dup = await prisma.invMember.findUnique({ where: { phone } });
  if (dup) return Response.json({ message: "Telefone já cadastrado." }, { status: 409 });

  const member = await prisma.invMember.create({ data: { name, phone, role } });
  await logAccess({
    actor: "Admin",
    action: "MEMBER_CREATE",
    detail: `${name} (${role}) ${phone}`,
    request,
  });
  return Response.json({ ok: true, id: member.id }, { status: 201 });
}
