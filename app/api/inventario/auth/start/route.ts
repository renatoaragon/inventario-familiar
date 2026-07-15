// POST { phone }: first login step. Tells the client which auth mode applies:
//   unauthorized → phone not registered (explicit message, admin's rule)
//   blocked      → access blocked by a password reset (contact the admin)
//   password     → already has a password: ask for it
//   otp          → first access (or cleared post-reset): generates an OTP and sends it via WhatsApp
import { prisma } from "@/lib/inventario/prisma";
import { normalizePhone, createOtp, recentOtpCount } from "@/lib/inventario/auth";
import { isWhatsAppConfigured, sendOtpWhatsApp } from "@/lib/inventario/whatsapp";
import { logAccess } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  if (phone.length < 10) {
    return Response.json({ message: "Telefone inválido." }, { status: 400 });
  }

  const member = await prisma.invMember.findUnique({ where: { phone } });
  if (!member || !member.active) {
    await logAccess({ actor: phone, action: "CODE_DENIED", detail: "número não autorizado", request });
    return Response.json({
      mode: "unauthorized",
      message: "Este número não está autorizado a acessar o portal.",
    });
  }

  if (member.blocked) {
    await logAccess({ memberId: member.id, actor: member.name, action: "LOGIN_BLOCKED", request });
    return Response.json({
      mode: "blocked",
      message: "Seu acesso está bloqueado (reset de senha). Fale diretamente com o administrador.",
    });
  }

  if (member.passwordHash) {
    return Response.json({ mode: "password", message: "Informe sua senha." });
  }

  // First access (or cleared post-reset): OTP
  if ((await recentOtpCount(member.id)) >= 3) {
    await logAccess({ memberId: member.id, actor: member.name, action: "CODE_RATE_LIMIT", request });
    return Response.json({
      mode: "otp",
      whatsapp: isWhatsAppConfigured(),
      message: "Muitos códigos pedidos. Aguarde alguns minutos ou use o último código recebido.",
    });
  }

  const code = await createOtp(member.id);
  let sent = false;
  if (isWhatsAppConfigured()) {
    try {
      await sendOtpWhatsApp(member.phone, code);
      sent = true;
    } catch (err) {
      await logAccess({
        memberId: member.id,
        actor: member.name,
        action: "CODE_SEND_ERROR",
        detail: err instanceof Error ? err.message.slice(0, 200) : "erro",
        request,
      });
    }
  }
  await logAccess({
    memberId: member.id,
    actor: member.name,
    action: sent ? "CODE_SENT" : "CODE_CREATED",
    detail: sent ? "via WhatsApp" : "aguarda envio manual pelo admin",
    request,
  });
  return Response.json({
    mode: "otp",
    whatsapp: sent,
    message: sent
      ? "Código enviado no seu WhatsApp."
      : "Código gerado. Peça ao administrador para lhe enviar o código de acesso.",
  });
}
