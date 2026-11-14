// Pagar no Tchilar (Estrelas, promoções, campanhas): escolher o método, pagar e esperar pela confirmação.
// "start({ method, phone })" é a chamada à API do produto; devolve o que payments.start devolve no servidor.
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";
import { Button, Field, Notice, kz } from "./ui";

const METHOD_INFO = {
  express: ["phone-portrait", "Multicaixa Express", "Aprovas no telemóvel, na app Multicaixa Express."],
  reference: ["keypad", "Pagamento por Referência", "Pagas no ATM, no Multicaixa Express ou no homebanking."],
  card: ["card", "Cartão", "Visa ou Mastercard, numa página segura."]
};

export function PaymentSheet({ visible, title, amount, start, onClose, onPaid }) {
  const [methods, setMethods] = useState(null);
  const [method, setMethod] = useState(null);
  const { user } = useSession();
  const [phone, setPhone] = useState(user?.phone || "");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const poll = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    setPending(null); setError(""); setMessage(""); setMethod(null);
    api("/payments/methods").then(result => { setMethods(result.methods); if (result.methods.length === 1) setMethod(result.methods[0]); })
      .catch(loadError => setError(loadError.message));
    return () => clearInterval(poll.current);
  }, [visible]);

  // Express e Referência: pergunta à API até ficar pago, falhar ou expirar.
  const watch = paymentId => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const { status } = await api(`/payments/${paymentId}`);
        if (status === "paid") { clearInterval(poll.current); setMessage("Pagamento confirmado!"); setTimeout(onPaid, 900); }
        if (status === "failed" || status === "expired") { clearInterval(poll.current); setError(status === "failed" ? "O pagamento foi recusado." : "O pagamento expirou."); }
      } catch { /* tenta outra vez */ }
    }, 4000);
  };

  const pay = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await start({ method: method || undefined, phone: method === "express" ? phone : undefined });
      if (result.activated) { setMessage("Feito! (modo de demonstração, sem cobrança)"); setTimeout(onPaid, 900); return; }
      if (result.checkoutUrl) { await Linking.openURL(result.checkoutUrl); setMessage("Conclui o pagamento na página que abriu. Depois volta à app."); return; }
      setPending(result);
      if (result.paymentId) watch(result.paymentId);
    } catch (payError) {
      setError(payError.message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    try { await api(`/payments/${pending.paymentId}/simulate`, { method: "POST" }); } catch (simError) { setError(simError.message); }
  };

  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text><Text style={styles.amount}>{kz(amount)}</Text></View>
          <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={26} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
          {!pending && <>
            {methods?.length === 0 && <Text style={styles.muted}>Modo de demonstração: o pagamento é ativado sem cobrança.</Text>}
            {methods?.map(key => {
              const [icon, label, hint] = METHOD_INFO[key];
              return <Pressable key={key} style={[styles.method, method === key && styles.methodActive]} onPress={() => setMethod(key)}>
                <Ionicons name={icon} size={22} color={method === key ? colors.primary : colors.text} />
                <View style={{ flex: 1 }}><Text style={styles.methodLabel}>{label}</Text><Text style={styles.muted}>{hint}</Text></View>
                <Ionicons name={method === key ? "radio-button-on" : "radio-button-off"} size={20} color={colors.primary} />
              </Pressable>;
            })}
            {method === "express" && <Field label="Telemóvel do Multicaixa Express" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="9XX XXX XXX" maxLength={12} />}
            <Button label={`Pagar ${kz(amount)}`} onPress={pay} busy={busy} disabled={methods === null || (methods.length > 0 && !method) || (method === "express" && phone.replace(/\D/g, "").length < 9)} />
          </>}

          {pending?.method === "express" && <View style={styles.box}>
            <Ionicons name="phone-portrait" size={36} color={colors.primary} />
            <Text style={styles.boxTitle}>Aprova no telemóvel {pending.phone}</Text>
            <Text style={styles.muted}>Abre a app Multicaixa Express e confirma o pagamento. Esta janela atualiza sozinha.</Text>
          </View>}
          {pending?.method === "reference" && <View style={styles.box}>
            <Text style={styles.boxTitle}>Paga com estes dados</Text>
            {[["Entidade", pending.entity], ["Referência", pending.reference], ["Valor", kz(pending.amount)]].map(([label, value]) =>
              <Pressable key={label} style={styles.refRow} onPress={() => Clipboard.setStringAsync(String(value).replace(" Kz", ""))}>
                <Text style={styles.muted}>{label}</Text><Text style={styles.refValue}>{value}</Text><Ionicons name="copy-outline" size={16} color={colors.muted} />
              </Pressable>)}
            <Text style={styles.muted}>Válida até {new Date(pending.expiresAt).toLocaleString("pt-PT")}. Toca num valor para copiar.</Text>
            {pending.sandbox && <Button label="Simular pagamento (teste)" variant="secondary" small onPress={simulate} />}
          </View>}
          <Notice error={error} message={message} />
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(3,35,58,0.45)" },
  sheet: { maxHeight: "88%", backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 32, gap: 12 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  amount: { color: colors.primary, fontSize: 24, fontWeight: "800", marginTop: 2 },
  muted: { color: colors.muted, fontSize: 13 },
  method: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  methodActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodLabel: { color: colors.text, fontWeight: "800" },
  box: { alignItems: "center", gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.background },
  boxTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  refRow: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", padding: 10, borderRadius: 10, backgroundColor: colors.surface },
  refValue: { flex: 1, textAlign: "right", color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: 1 }
});
