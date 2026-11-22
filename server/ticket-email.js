// Email do bilhete (desenho aprovado: design/emails/bilhete.html). Tabelas e estilos em cada elemento, 600 px,
// para ficar igual no Gmail, Outlook e no telemóvel. Vai sempre com uma versão em texto simples.
// Tudo o que vem de pessoas (nome do evento, local, nomes) é escapado antes de entrar no HTML.

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const kz = value => {
  const [whole, cents] = (Math.round(Number(value || 0) * 100) / 100).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${cents === "00" ? "" : `,${cents}`} Kz`;
};
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "";
// O código em dois blocos de 4 lê-se melhor à porta (K7M2 Q9XR).
const spacedCode = code => String(code || "").replace(/(.{4})(?=.)/g, "$1 ");

function whenParts(startsAt) {
  const date = new Date(startsAt);
  const day = date.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Luanda" });
  const time = date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" });
  return { day: day.charAt(0).toUpperCase() + day.slice(1), time };
}

const label = text => `<p style="margin:0 0 2px;font-size:12px;color:#8E8E93;">${text}</p>`;
const strong = text => `<p style="margin:0;font-size:15px;font-weight:700;color:#111;">${text}</p>`;
const plain = text => `<p style="margin:0;font-size:15px;color:#111;">${text}</p>`;

/**
 * @param {{ eventName: string, startsAt: string|Date, location?: string, place?: string, organizer: string, buyerName: string,
 *   code: string, amountKz: number, method: string, receipt: string, ticketUrl: string, qrUrl: string, logoUrl: string,
 *   company: { name: string, nif?: string|null, address?: string|null } }} data
 */
function buildTicketEmail(data) {
  const { day, time } = whenParts(data.startsAt);
  const name = firstName(data.buyerName);
  const location = String(data.location || "").trim();
  const company = [data.company.name, data.company.nif ? `NIF ${data.company.nif}` : null, data.company.address || null].filter(Boolean);
  const subject = `O teu bilhete para ${data.eventName}`;
  const e = escapeHtml;

  const text = [
    `${name ? `Olá ${name}, j` : "J"}á tens lugar em «${data.eventName}».`,
    "",
    `Quando: ${day}, ${time}`,
    location ? `Onde: ${location}` : null,
    `Organiza: ${data.organizer}`,
    `Nome no bilhete: ${data.buyerName}`,
    "",
    `Código do bilhete: ${data.code}`,
    `Mostra o QR à entrada (no Tchilar): ${data.ticketUrl}`,
    "Cada bilhete só entra uma vez. Não partilhes o QR.",
    "",
    `Pagamento: ${kz(data.amountKz)} · ${data.method} · Recibo ${data.receipt}`,
    "Se o evento for cancelado, devolvemos-te o valor.",
    "",
    company.join(" · ")
  ].filter(line => line !== null).join("\n");

  const html = `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F2F4;">
<div style="display:none;max-height:0;overflow:hidden;">O teu bilhete para ${e(data.eventName)} está pronto. Mostra o QR à entrada.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F4;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <tr><td style="padding:0 4px 20px;"><img src="${e(data.logoUrl)}" width="132" alt="Tchilar" style="display:block;width:132px;height:auto;border:0;"></td></tr>
  <tr><td style="background:#FFFFFF;border-radius:20px;padding:32px 32px 8px;">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#E30613;">Bilhete confirmado</p>
    <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;font-weight:800;color:#111;">${name ? `Olá ${e(name)}, já tens lugar.` : "Já tens lugar."}</h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.55;color:#3C3C43;">O pagamento foi recebido. Guarda este email ou abre o bilhete no Tchilar e mostra o QR à entrada.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #111;border-radius:16px;">
      <tr><td style="padding:22px 22px 18px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8E8E93;">Evento</p>
        <p style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:800;color:#111;">${e(data.eventName)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="50%" valign="top" style="padding:0 12px 12px 0;">${label("Quando")}${strong(e(day))}${plain(e(time))}</td>
            <td width="50%" valign="top" style="padding:0 0 12px;">${label("Onde")}${location ? strong(e(location)) : plain("A anunciar")}</td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:0 12px 0 0;">${label("Organiza")}${strong(e(data.organizer))}</td>
            <td width="50%" valign="top">${label("Nome no bilhete")}${strong(e(data.buyerName))}</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 22px;"><div style="border-top:2px dashed #D1D1D6;height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
      <tr><td align="center" style="padding:22px 22px 24px;">
        <img src="${e(data.qrUrl)}" width="200" height="200" alt="QR do bilhete" style="display:block;width:200px;height:200px;border:0;">
        <p style="margin:14px 0 2px;font-size:12px;color:#8E8E93;">Código do bilhete</p>
        <p style="margin:0;font-family:Menlo,Consolas,'Courier New',monospace;font-size:26px;font-weight:800;letter-spacing:.18em;color:#111;">${e(spacedCode(data.code))}</p>
        <p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:#8E8E93;">Cada bilhete só entra uma vez. Não partilhes o QR.</p>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="background:#E30613;border-radius:999px;">
      <a href="${e(data.ticketUrl)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;">Ver o bilhete no Tchilar</a>
    </td></tr></table>
    <p style="margin:0 0 24px;font-size:13px;color:#8E8E93;">No telemóvel, o bilhete também está na app, na página do evento.</p>
  </td></tr>
  <tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:20px;"><tr><td style="padding:22px 32px;">
      <p style="margin:0 0 12px;font-size:15px;font-weight:800;color:#111;">Pagamento</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;color:#3C3C43;">
        <tr><td style="padding:4px 0;">1 bilhete</td><td align="right" style="padding:4px 0;color:#111;">${kz(data.amountKz)}</td></tr>
        <tr><td style="padding:4px 0;">Método</td><td align="right" style="padding:4px 0;color:#111;">${e(data.method)}</td></tr>
        <tr><td style="padding:4px 0;">Recibo</td><td align="right" style="padding:4px 0;color:#111;">${e(data.receipt)}</td></tr>
        <tr><td colspan="2" style="padding:8px 0 0;"><div style="border-top:1px solid #E5E5EA;height:0;line-height:0;font-size:0;">&nbsp;</div></td></tr>
        <tr><td style="padding:10px 0 0;font-weight:800;color:#111;">Total pago</td><td align="right" style="padding:10px 0 0;font-size:18px;font-weight:800;color:#111;">${kz(data.amountKz)}</td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#8E8E93;">Se o evento for cancelado, devolvemos-te o valor. O recibo completo está em Definições → Pagamentos.</p>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:24px 8px 8px;font-size:12px;line-height:1.6;color:#8E8E93;">
    Recebeste este email porque compraste um bilhete no Tchilar. É um email automático: não respondas.<br>
    Dúvidas: Centro de ajuda no Tchilar.<br>
    ${company.map(e).join(" · ")}
  </td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, text, html };
}

module.exports = { buildTicketEmail, escapeHtml, spacedCode };
