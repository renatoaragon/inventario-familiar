// Estate documents: all members see everything; uploads in any format.
import { prisma } from "@/lib/inventario/prisma";
import { requireInv } from "@/lib/inventario/auth";
import { logAccess } from "@/lib/inventario/repo";
import { isS3Configured, uploadToS3 } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB via S3; 8 MB fallback base64

// Keys live under their own prefix; the IAM user needs s3:PutObject and
// s3:GetObject on inventario/* inside the configured bucket.
function buildKey(docId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `inventario/${docId}/${safe}`;
}

/**
 * Resolves the optional "timelineId" field of an upload. Since only the admin
 * writes to the timeline, only the admin may attach to it — otherwise a member
 * would be editing admin content. Returns the id, null when absent, or the
 * Response the caller must return.
 */
async function resolveTimelineId(
  raw: FormDataEntryValue | null | undefined,
  isAdmin: boolean,
): Promise<string | null | Response> {
  const timelineId = typeof raw === "string" && raw ? raw : null;
  if (!timelineId) return null;
  if (!isAdmin) {
    return Response.json({ message: "Só o admin anexa na linha do tempo." }, { status: 403 });
  }
  const exists = await prisma.invTimeline.findUnique({
    where: { id: timelineId },
    select: { id: true },
  });
  if (!exists) return Response.json({ message: "Marco não encontrado." }, { status: 404 });
  return timelineId;
}

export async function GET() {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const rows = await prisma.invDocument.findMany({
    select: {
      id: true, filename: true, mimeType: true, size: true,
      uploadedByName: true, timelineId: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({
    documents: rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
  });
}

export async function POST(request: Request) {
  const s = await requireInv();
  if (s instanceof Response) return s;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ message: "Arquivo ausente." }, { status: 400 });
  }

  const timelineId = await resolveTimelineId(form?.get("timelineId"), s.kind === "admin");
  if (timelineId instanceof Response) return timelineId;

  const s3 = isS3Configured();
  const limit = s3 ? MAX_BYTES : 8 * 1024 * 1024;
  if (file.size > limit) {
    return Response.json(
      { message: `Arquivo grande demais (máx. ${s3 ? "50" : "8"} MB).` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const filename = file.name || "documento";
  const uploader =
    s.kind === "admin"
      ? { uploadedById: null, uploadedByName: "Admin" }
      : { uploadedById: s.memberId, uploadedByName: s.name };

  // Upload first, persist after: no orphan record if S3 fails.
  let stored: { s3Key: string } | { data: string };
  if (s3) {
    const key = buildKey(crypto.randomUUID(), filename);
    try {
      await uploadToS3({ key, body: buf, contentType: mimeType });
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 200) : "erro desconhecido";
      await logAccess({
        memberId: s.kind === "member" ? s.memberId : null,
        actor: uploader.uploadedByName,
        action: "DOC_UPLOAD_ERROR",
        detail: `${filename}: ${detail}`,
        request,
      });
      return Response.json({ message: `Falha no S3: ${detail}` }, { status: 502 });
    }
    stored = { s3Key: key };
  } else {
    stored = { data: buf.toString("base64") };
  }
  const doc = await prisma.invDocument.create({
    data: { filename, mimeType, size: buf.length, timelineId, ...uploader, ...stored },
  });

  await logAccess({
    memberId: s.kind === "member" ? s.memberId : null,
    actor: uploader.uploadedByName,
    action: "DOC_UPLOAD",
    detail: `${filename} (${buf.length} bytes)`,
    request,
  });
  return Response.json({ ok: true, id: doc.id }, { status: 201 });
}
