// Recibo dentro da app: vê-se com todos os detalhes e guarda-se em PDF no telemóvel (sem abrir o navegador
// nem pedir para entrar outra vez). O PDF é feito no próprio telemóvel a partir dos dados do recibo.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/theme";
import { Button, Notice, dateTime } from "./ui";

// Valores como no site: milhares separados por espaço (7 500 Kz) e até 2 casas decimais.
const kz = value => {
  const amount = Number(value) || 0;
  const [whole, cents] = amount.toFixed(Number.isInteger(amount) ? 0 : 2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}${cents ? `,${cents}` : ""} Kz`;
};

const STATUS = { paid: "Pago", refunded: "Reembolsado", refund_due: "Por reembolsar" };

// Escapa texto para o HTML do PDF (nomes e descrições vêm de quem usa a plataforma).
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);

function linesOf(payment) {
  return payment.lines?.length ? payment.lines : [{ label: payment.description, quantity: 1, unit: payment.amount, total: payment.amount }];
}

export function receiptHtml(payment, issuer) {
  const seller = payment.seller || issuer || {};
  const rows = linesOf(payment).map(line => `<tr><td><small>${esc(payment.kind_label)}</small><br>${esc(line.label)}</td>
    <td class="n">${esc(line.quantity)}</td><td class="n">${esc(kz(line.unit))}</td><td class="n">${esc(kz(line.total))}</td></tr>`).join("");
  const pay = [
    payment.method === "reference" && payment.reference ? `<div><b>Referência</b><br>Entidade ${esc(payment.entity)} · ${esc(payment.reference)}</div>` : "",
    payment.phone ? `<div><b>Telemóvel</b><br>${esc(payment.phone)}</div>` : ""
  ].join("");
  const foot = payment.seller
    ? `Recibo emitido pela plataforma Tchilar (${esc(issuer?.name)}${issuer?.nif ? `, NIF ${esc(issuer.nif)}` : ""}) em nome de <b>${esc(payment.seller.name)}</b>. Comprovativo de pagamento: não substitui a fatura, que deve ser pedida a quem vende.`
    : `Comprovativo de pagamento emitido por ${esc(issuer?.name)}${issuer?.nif ? ` (NIF ${esc(issuer.nif)})` : ""}. Não substitui a fatura.`;
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: -apple-system, Roboto, "Segoe UI", Arial, sans-serif; color: #0B0B0C; margin: 0; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 4px solid #E30613; }
  .brand { font-size: 26px; font-weight: 900; letter-spacing: -.5px; }
  .brand span { color: #E30613; }
  .id { text-align: right; } .id small { display: block; color: #E30613; font-weight: 800; letter-spacing: 2px; font-size: 10px; text-transform: uppercase; }
  .id b { font-size: 18px; }
  .strip { display: flex; border-bottom: 1px solid #E5E5EA; } .strip div { flex: 1; padding: 12px 0; }
  .lab, .strip small, th { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #6E6E73; }
  .strip small { display: block; margin-bottom: 3px; }
  .parties { display: flex; gap: 24px; padding: 20px 0; } .parties div { flex: 1; } .parties b { font-size: 15px; display: block; margin: 4px 0 2px; }
  .muted { color: #6E6E73; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; padding: 8px 0; border-bottom: 1.5px solid #0B0B0C; }
  td { padding: 12px 0; border-bottom: 1px solid #E5E5EA; vertical-align: top; } td small { color: #E30613; font-weight: 700; }
  .n { text-align: right; white-space: nowrap; padding-left: 12px; }
  .totals { margin: 14px 0 0 auto; width: 280px; } .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .grand { background: #0B0B0C; color: #fff; border-radius: 10px; padding: 12px 14px !important; margin-top: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .grand b { font-size: 20px; }
  .pay { display: flex; gap: 30px; margin-top: 18px; }
  .foot { margin-top: 26px; padding-top: 14px; border-top: 1px dashed #C7C7CC; color: #6E6E73; font-size: 11px; line-height: 1.5; }
</style></head><body>
  <div class="head"><div class="brand">tchilar<span>.</span></div><div class="id"><small>Recibo</small><b>${esc(payment.receipt)}</b></div></div>
  <div class="strip"><div><small>Data do pagamento</small><b>${esc(dateTime(payment.paid_at))}</b></div>
    <div><small>Pago com</small><b>${esc(payment.method_label)}</b></div><div><small>Estado</small><b>${esc(STATUS[payment.status] || payment.status_label)}</b></div></div>
  <div class="parties">
    <div><span class="lab">Vendido por</span><b>${esc(seller.name)}</b>${seller.nif ? `<div class="muted">NIF ${esc(seller.nif)}</div>` : ""}${seller.address ? `<div class="muted">${esc(seller.address)}</div>` : ""}</div>
    <div><span class="lab">Cliente</span><b>${esc(payment.customer ? payment.customer.display_name : "Conta apagada")}</b>${payment.customer ? `<div class="muted">@${esc(payment.customer.username)}</div>` : ""}</div>
  </div>
  <table><thead><tr><th>Descrição</th><th class="n">Qtd.</th><th class="n">Preço</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals"><div class="muted"><span>Subtotal</span><span>${esc(kz(payment.amount))}</span></div>
    <div class="grand"><span>Total pago</span><b>${esc(kz(payment.amount))}</b></div></div>
  ${pay ? `<div class="pay">${pay}</div>` : ""}
  <div class="foot">${foot}<br>Dúvidas sobre este pagamento? Indica o número <b>${esc(payment.receipt)}</b> quando contactares a equipa.</div>
</body></html>`;
}

// Faz o PDF no telemóvel e abre o menu de partilha (Guardar em Ficheiros/Drive, WhatsApp, email…).
export async function saveReceiptPdf(payment, issuer) {
  const Print = await import("expo-print");
  const Sharing = await import("expo-sharing");
  const { File, Paths } = await import("expo-file-system");
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(payment, issuer) });
  const target = new File(Paths.cache, `Recibo-${payment.receipt}.pdf`);
  if (target.exists) target.delete();
  new File(uri).move(target);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Este telemóvel não deixa guardar ficheiros a partir da app.");
  await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `Recibo ${payment.receipt}` });
}

export function ReceiptModal({ payment, onClose }) {
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDetail(null); setNotice({});
    if (payment) api(`/payments/${payment.kind}/${payment.id}/receipt`).then(setDetail).catch(error => setNotice({ error: error.message }));
  }, [payment]);
  if (!payment) return null;
  const full = detail?.payment || payment;
  const issuer = detail?.issuer;
  const seller = full.seller || issuer;
  const save = async () => {
    setBusy(true); setNotice({});
    try { await saveReceiptPdf(full, issuer); } catch (error) { setNotice({ error: error.message || "Não foi possível criar o PDF." }); }
    setBusy(false);
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.bar}>
        <Text style={styles.barTitle}>Recibo</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar"><Ionicons name="close" size={26} color={colors.text} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={styles.paper}>
          <View style={styles.head}>
            <Text style={styles.brand}>tchilar<Text style={{ color: colors.accent }}>.</Text></Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.kicker}>RECIBO</Text>
              <Text style={styles.number}>{full.receipt}</Text>
            </View>
          </View>
          <View style={styles.strip}>
            <Info label="Data" value={dateTime(full.paid_at)} />
            <Info label="Pago com" value={full.method_label} />
            <Info label="Estado" value={STATUS[full.status] || full.status_label} tone={full.status === "paid" ? "#157A3B" : colors.accent} />
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>VENDIDO POR</Text>
            {seller ? <>
              <Text style={styles.party}>{seller.name}</Text>
              {seller.nif ? <Text style={styles.muted}>NIF {seller.nif}</Text> : null}
              {seller.address ? <Text style={styles.muted}>{seller.address}</Text> : null}
            </> : <Text style={styles.muted}>A carregar…</Text>}
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>CLIENTE</Text>
            <Text style={styles.party}>{full.customer ? full.customer.display_name : "Conta apagada"}</Text>
            {full.customer ? <Text style={styles.muted}>@{full.customer.username}</Text> : null}
          </View>
          <View style={[styles.section, { gap: 10 }]}>
            {linesOf(full).map((line, index) => <View key={index} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kind}>{full.kind_label}</Text>
                <Text style={styles.lineTitle}>{line.label}</Text>
                <Text style={styles.muted}>{line.quantity} × {kz(line.unit)}</Text>
              </View>
              <Text style={styles.lineTotal}>{kz(line.total)}</Text>
            </View>)}
          </View>
          <View style={styles.grand}>
            <Text style={styles.grandLabel}>Total pago</Text>
            <Text style={styles.grandValue}>{kz(full.amount)}</Text>
          </View>
          {(full.method === "reference" && full.reference) || full.phone ? <View style={[styles.section, { borderTopWidth: 0 }]}>
            {full.method === "reference" && full.reference ? <Text style={styles.muted}>Referência: Entidade {full.entity} · {full.reference}</Text> : null}
            {full.phone ? <Text style={styles.muted}>Telemóvel {full.phone}</Text> : null}
          </View> : null}
          <Text style={styles.foot}>
            {full.seller
              ? `Recibo emitido pela plataforma Tchilar${issuer ? ` (${issuer.name}${issuer.nif ? `, NIF ${issuer.nif}` : ""})` : ""} em nome de ${full.seller.name}. Não substitui a fatura, que deve ser pedida a quem vende.`
              : `Comprovativo de pagamento${issuer ? ` emitido por ${issuer.name}${issuer.nif ? ` (NIF ${issuer.nif})` : ""}` : ""}. Não substitui a fatura.`}
          </Text>
        </View>
        <Notice {...notice} />
        <Button icon="download" label="Guardar PDF ou partilhar" busy={busy} disabled={!detail} onPress={save} />
        <Text style={[styles.muted, { textAlign: "center" }]}>Escolhe «Guardar em Ficheiros», Drive, WhatsApp ou email.</Text>
      </ScrollView>
    </View>
  </Modal>;
}

function Info({ label, value, tone }) {
  return <View style={{ flex: 1, gap: 3 }}>
    <Text style={styles.label}>{label.toUpperCase()}</Text>
    <Text style={[styles.infoValue, tone && { color: tone }]}>{value}</Text>
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  barTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  paper: { backgroundColor: colors.surface, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottomWidth: 4, borderBottomColor: colors.accent },
  brand: { fontSize: 26, fontWeight: "900", color: colors.text, letterSpacing: -0.5 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.6, color: colors.accent },
  number: { fontSize: 16, fontWeight: "800", color: colors.text, fontVariant: ["tabular-nums"] },
  strip: { flexDirection: "row", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, color: colors.muted },
  infoValue: { fontSize: 13, fontWeight: "700", color: colors.text },
  section: { paddingHorizontal: 16, paddingVertical: 14, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.line },
  party: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 4 },
  muted: { fontSize: 13, color: colors.muted },
  line: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  kind: { fontSize: 11, fontWeight: "700", color: colors.accent },
  lineTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  lineTotal: { fontSize: 15, fontWeight: "800", color: colors.text, fontVariant: ["tabular-nums"] },
  grand: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", margin: 16, padding: 14, borderRadius: 12, backgroundColor: colors.primary },
  grandLabel: { fontSize: 14, fontWeight: "700", color: colors.surface },
  grandValue: { fontSize: 22, fontWeight: "900", color: colors.surface, fontVariant: ["tabular-nums"] },
  foot: { padding: 16, paddingTop: 4, fontSize: 12, lineHeight: 17, color: colors.muted }
});
