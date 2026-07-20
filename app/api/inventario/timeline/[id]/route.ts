// PATCH: edit a milestone. DELETE: drop it (attachments survive as standalone
// documents, FK ON DELETE SET NULL). Both admin only.
import { requireInvAdmin } from "@/lib/inventario/auth";
import {
  deleteTimelineEntry,
  isTimelineKind,
  logAccess,
  updateTimelineEntry,
} from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const texto = typeof body.body === "string" ? body.body.trim() : "";
  const kind = isTimelineKind(body.kind) ? body.kind : "MARCO";
  const occurredAt = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;

  if (!title || !occurredAt || isNaN(+occurredAt)) {
    return Response.json({ message: "Informe título e data do ocorrido." }, { status: 400 });
  }

  try {
    await updateTimelineEntry(id, { title, body: texto || null, kind, occurredAt });
  } catch {
    return Response.json({ message: "Registro não encontrado." }, { status: 404 });
  }
  await logAccess({
    actor: "Admin",
    action: "TIMELINE_UPDATE",
    detail: `${title} (${occurredAt.toISOString().slice(0, 10)})`,
    request,
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const entry = await deleteTimelineEntry(id);
  if (!entry) return Response.json({ message: "Não encontrado." }, { status: 404 });

  await logAccess({ actor: "Admin", action: "TIMELINE_DELETE", detail: entry.title, request });
  return Response.json({ ok: true });
}
