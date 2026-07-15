// Inventário Familiar: access code delivery via WhatsApp.
//
// Uses Meta's WhatsApp Cloud API via fetch (no SDK, same philosophy as the
// rest of the project). In Meta's development mode, up to 5 recipient
// numbers can be verified without business approval, which is exactly the
// size of this portal.
//
// Env:
//   WHATSAPP_TOKEN            : access token (Meta app > WhatsApp > API Setup)
//   WHATSAPP_PHONE_NUMBER_ID  : sender phone number id
//   WHATSAPP_OTP_TEMPLATE     : authentication template name (default: codigo_acesso)
//
// Without these envs, isWhatsAppConfigured() = false and the admin sends the
// code manually (the "Gerar código" button in the dashboard).

const GRAPH = "https://graph.facebook.com/v20.0";

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Sends the OTP as an authentication template (with a copy-code button). */
export async function sendOtpWhatsApp(phone: string, code: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error("WhatsApp não configurado (WHATSAPP_* ausentes).");
  const template = process.env.WHATSAPP_OTP_TEMPLATE ?? "codigo_acesso";

  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: template,
        language: { code: "pt_BR" },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }],
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WhatsApp ${res.status}: ${detail.slice(0, 300)}`);
  }
}
