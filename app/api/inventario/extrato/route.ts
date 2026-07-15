// GET: the member's own extrato; the admin can use ?viewAs=<memberId> ("view as").
import { requireInv, resolveViewMember } from "@/lib/inventario/auth";
import { getExtrato, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const view = await resolveViewMember(s, request);
  if (!view) return Response.json({ message: "Membro não indicado." }, { status: 400 });

  const extrato = await getExtrato(view.memberId);
  if (!extrato) return Response.json({ message: "Membro não encontrado." }, { status: 404 });

  await logAccess({
    memberId: view.impersonated ? null : view.memberId,
    actor: view.impersonated ? "Admin" : view.name,
    action: view.impersonated ? "IMPERSONATE" : "EXTRATO_VIEW",
    detail: view.impersonated ? `viu como ${view.name}` : null,
    request,
  });
  return Response.json({ extrato, impersonated: view.impersonated });
}
