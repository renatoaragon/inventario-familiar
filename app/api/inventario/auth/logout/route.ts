import { clearMemberSession, getInvSession } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const s = await getInvSession();
  if (s?.kind === "member") {
    await logAccess({ memberId: s.memberId, actor: s.name, action: "LOGOUT", request });
  }
  await clearMemberSession();
  return Response.json({ ok: true });
}
