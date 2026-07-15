// GET: document download (presigned S3 or base64). DELETE: admin only.
import { prisma } from "@/lib/inventario/prisma";
import { requireInv, requireInvAdmin } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";
import { presignGetUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteCtx) {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const { id } = await params;
  const doc = await prisma.invDocument.findUnique({ where: { id } });
  if (!doc) return Response.json({ message: "Não encontrado." }, { status: 404 });

  await logAccess({
    memberId: s.kind === "member" ? s.memberId : null,
    actor: s.kind === "member" ? s.name : "Admin",
    action: "DOC_DOWNLOAD",
    detail: doc.filename,
    request,
  });

  if (doc.s3Key) {
    const url = presignGetUrl(doc.s3Key, 300);
    if (url) return Response.redirect(url, 302);
  }
  if (doc.data) {
    const buf = Buffer.from(doc.data, "base64");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.filename)}"`,
      },
    });
  }
  return Response.json({ message: "Conteúdo indisponível." }, { status: 410 });
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const s = await requireInvAdmin();
  if (s instanceof Response) return s;

  const { id } = await params;
  const doc = await prisma.invDocument.findUnique({ where: { id } });
  if (!doc) return Response.json({ message: "Não encontrado." }, { status: 404 });

  await prisma.invDocument.delete({ where: { id } });
  await logAccess({ actor: "Admin", action: "DOC_DELETE", detail: doc.filename, request });
  return Response.json({ ok: true });
}
