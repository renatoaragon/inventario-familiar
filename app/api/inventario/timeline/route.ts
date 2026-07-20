// Estate timeline: every member reads; only the admin writes.
import { requireInv, requireInvAdmin } from "@/lib/inventario/auth";
import { createTimelineEntry, isTimelineKind, listTimeline, logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireInv();
  if (s instanceof Response) return s;

  return Response.json({ timeline: await listTimeline() });
}

export async function POST(request: Request) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const texto = typeof body.body === "string" ? body.body.trim() : "";
  const kind = isTimelineKind(body.kind) ? body.kind : "MARCO";
  // OFFICIAL date of the event, picked by the admin: recording a July 1st fact
  // today keeps the milestone on July 1st. It never falls back to "now".
  const occurredAt = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;

  if (!title || !occurredAt || isNaN(+occurredAt)) {
    return Response.json({ message: "Informe título e data do ocorrido." }, { status: 400 });
  }

  const entry = await createTimelineEntry({
    title,
    body: texto || null,
    kind,
    occurredAt,
    createdByName: "Admin",
  });
  await logAccess({
    actor: "Admin",
    action: "TIMELINE_CREATE",
    detail: `${title} (${occurredAt.toISOString().slice(0, 10)})`,
    request,
  });
  return Response.json({ ok: true, id: entry.id }, { status: 201 });
}
