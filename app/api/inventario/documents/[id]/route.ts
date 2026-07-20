// GET: document download (presigned S3 or base64); ?inline=1 serves the same
// content for embedded preview. DELETE: admin only.
import { prisma } from "@/lib/inventario/prisma";
import { requireInv, requireInvAdmin } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";
import { fetchObjectBase64, presignGetUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/** Formats the preview renders as plain text (client fetch + <pre>). */
function isTextLike(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "image/svg+xml"
  );
}

export async function GET(request: Request, { params }: RouteCtx) {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const { id } = await params;
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const doc = await prisma.invDocument.findUnique({ where: { id } });
  if (!doc) return Response.json({ message: "Não encontrado." }, { status: 404 });

  // Previews are not logged: <img>/<iframe>/<video> load on their own when the
  // timeline opens and would flood the access log. Downloads stay logged.
  if (!inline) {
    await logAccess({
      memberId: s.kind === "member" ? s.memberId : null,
      actor: s.kind === "member" ? s.name : "Admin",
      action: "DOC_DOWNLOAD",
      detail: doc.filename,
      request,
    });
  }

  const disposition = inline
    ? "inline"
    : `attachment; filename="${encodeURIComponent(doc.filename)}"`;

  // Text is read by the client with fetch(), so we serve it from our own origin
  // and never depend on bucket CORS. Everything else goes into native elements
  // (<img>, <iframe>, <video>), which follow the redirect and get Range from S3.
  if (doc.s3Key) {
    if (inline && isTextLike(doc.mimeType)) {
      const b64 = await fetchObjectBase64(doc.s3Key);
      if (b64) {
        const buf = Buffer.from(b64, "base64");
        return new Response(new Uint8Array(buf), {
          headers: {
            // text/plain keeps an attached SVG from running script on our origin.
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": "inline",
          },
        });
      }
    }
    const url = presignGetUrl(doc.s3Key, 300);
    if (url) return Response.redirect(url, 302);
  }
  if (doc.data) {
    const buf = Buffer.from(doc.data, "base64");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          inline && isTextLike(doc.mimeType) ? "text/plain; charset=utf-8" : doc.mimeType,
        "Content-Disposition": disposition,
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
