// Um evento: data em destaque, local (abre no mapa), quem criou, descrição, participar e quem vai
// (amigos primeiro). Quem criou pode apagar; toda a gente pode partilhar.
import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { PaymentSheet } from "../../../../components/PaymentSheet";
import { Button, Card, Empty, Loading, Notice, Page, count, kz } from "../../../../components/ui";
import { API_URL, WEB_URL, api, readToken } from "../../../../lib/api";
import { colors } from "../../../../lib/theme";

const fmt = (value, options) => new Date(value).toLocaleString("pt-PT", options);

// O QR do próprio bilhete (pedido com a sessão; nunca fica em cache partilhada).
const MAX_PER_ORDER = 10;
const ofText = of => (of ? ` · bilhete ${of.position} de ${of.quantity}` : "");

function TicketQr({ eventId, code }) {
  const [headers, setHeaders] = useState(null);
  useEffect(() => { readToken().then(token => setHeaders(token ? { Authorization: `Bearer ${token}` } : {})); }, []);
  if (!headers) return <View style={styles.qr} />;
  return <Image source={{ uri: `${API_URL}/api/events/${eventId}/tickets/mine/qr?code=${encodeURIComponent(code)}`, headers }} style={styles.qr} contentFit="contain" cachePolicy="none" />;
}

// Quem organiza: números dos bilhetes e validar à entrada (código do bilhete; o QR abre o site, que também valida).
function OrganizerTickets({ eventId }) {
  const [data, setData] = useState(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/events/${eventId}/tickets`).then(setData).catch(() => {}), [eventId]);
  useEffect(() => { load(); }, [load]);
  const checkIn = async () => {
    setBusy(true); setResult(null);
    try {
      const response = await api(`/events/${eventId}/check-in`, { method: "POST", body: { code } });
      setResult({ ok: true, text: `Pode entrar: ${response.person.display_name} (@${response.person.username})${ofText(response.of)}` });
      setCode(""); load();
    } catch (checkError) { setResult({ ok: false, text: checkError.message }); } finally { setBusy(false); }
  };
  return <Card title="Bilhetes à entrada" subtitle="Abre o leitor e aponta a câmara para o QR de cada pessoa. Também podes escrever o código.">
    <Button label="Ler bilhetes à entrada" icon="scan" onPress={() => router.push(`/checkin/${eventId}`)} />
    {data && <Text style={styles.rowText}>{data.sold}{data.total ? ` de ${data.total}` : ""} vendidos · {data.checked_in} já entraram · {kz(data.gross_kz)} em vendas · {kz(data.net_kz)} para ti (85%)</Text>}
    <TextInput value={code} onChangeText={value => setCode(value.toUpperCase())} placeholder="Código do bilhete" placeholderTextColor={colors.muted}
      autoCapitalize="characters" autoCorrect={false} maxLength={16} style={styles.codeInput} />
    <Button label={busy ? "A validar..." : "Validar bilhete"} icon="checkmark-circle" onPress={checkIn} busy={busy} disabled={code.trim().length < 6} />
    {result && <Text style={[styles.checkResult, { backgroundColor: result.ok ? "rgba(52,199,89,0.18)" : "rgba(227,6,19,0.14)" }]}>{result.text}</Text>}
    {data?.tickets.slice(0, 50).map(ticket => <View key={ticket.id} style={styles.row}>
      <Avatar user={ticket} size={28} />
      <Text style={[styles.rowText, { flex: 1 }]} numberOfLines={1}>{ticket.display_name}{ticket.quantity > 1 ? ` · ${ticket.quantity} bilhetes` : ""}</Text>
      <Text style={{ color: ticket.checked_in === ticket.quantity ? "#30B350" : colors.muted, fontWeight: "700", fontSize: 12 }}>
        {ticket.quantity > 1 ? `Entraram ${ticket.checked_in}/${ticket.quantity}` : ticket.checked_in ? "Entrou" : "Por entrar"}</Text>
    </View>)}
  </Card>;
}

export default function EventScreen() {
  const { id, checkin } = useLocalSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const load = useCallback(() => api(`/events/${id}`).then(setData).catch(loadError => setError(loadError.message)), [id]);
  useEffect(() => { load(); }, [load]);
  // Link do QR lido com a câmara normal (…/events/12?checkin=CÓDIGO): quem organiza valida logo aqui.
  const checked = useRef(null);
  useEffect(() => {
    if (!checkin || !data?.event || checked.current === checkin) return;
    checked.current = checkin;
    if (!data.event.is_creator) { Alert.alert("Bilhete", "Só quem organiza o evento pode validar bilhetes."); return; }
    api(`/events/${data.event.id}/check-in`, { method: "POST", body: { code: checkin } })
      .then(response => { Vibration.vibrate(90); Alert.alert("Pode entrar ✅", `${response.person.display_name} (@${response.person.username})${ofText(response.of)}`); })
      .catch(checkError => { Vibration.vibrate([0, 220, 120, 220]); Alert.alert("Não entra ❌", checkError.message); });
  }, [checkin, data]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;
  const { event, attendees } = data;
  const starts = new Date(event.starts_at);
  const past = starts < new Date();

  const paid = event.ticket_price_kz > 0;
  const soldOut = paid && event.tickets_total && event.tickets_sold >= event.tickets_total;
  const left = event.tickets_total ? Math.max(0, event.tickets_total - event.tickets_sold) : Infinity;
  const maxQuantity = Math.max(1, Math.min(MAX_PER_ORDER, left));
  const mine = event.my_tickets || [];
  const buy = () => setPaying(true);
  const rsvp = async () => {
    setBusy(true);
    try { await api(`/events/${event.id}/rsvp`, { method: "POST" }); await load(); } catch (rsvpError) { Alert.alert("Eventos", rsvpError.message); } finally { setBusy(false); }
  };
  const openMap = () => {
    const query = encodeURIComponent(event.location);
    Linking.openURL(Platform.OS === "ios" ? `maps:0,0?q=${query}` : `geo:0,0?q=${query}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`));
  };
  const remove = () => Alert.alert("Apagar evento?", `Quem ia participar deixa de o ver.${event.tickets_sold ? ` O dinheiro dos ${event.tickets_sold} bilhetes vendidos é devolvido a quem comprou.` : ""}`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Apagar", style: "destructive", onPress: async () => {
      try { await api(`/events/${event.id}`, { method: "DELETE" }); router.back(); } catch (deleteError) { Alert.alert("Eventos", deleteError.message); }
    } }
  ]);

  return <Page>
    <Stack.Screen options={{ title: "Evento" }} />
    <View style={styles.hero}>
      <View style={styles.date}>
        <Text style={styles.month}>{fmt(starts, { month: "short" }).replace(".", "").toUpperCase()}</Text>
        <Text style={styles.day}>{starts.getDate()}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title}>{event.name}</Text>
        <Text style={styles.when}>{fmt(starts, { weekday: "long", day: "numeric", month: "long" })} · {fmt(starts, { hour: "2-digit", minute: "2-digit" })}</Text>
        {past && <Text style={styles.past}>Já aconteceu</Text>}
      </View>
    </View>

    <Card>
      {Boolean(event.location) && <Pressable style={styles.row} onPress={openMap}>
        <Ionicons name="location" size={20} color="#F06A2A" />
        <Text style={[styles.rowText, { flex: 1 }]}>{event.location}</Text>
        <Text style={styles.link}>Mapa ›</Text>
      </Pressable>}
      <Pressable style={styles.row} onPress={() => router.push(`/u/${event.creator_username}`)}>
        <Avatar user={{ display_name: event.creator_name, avatar_url: event.creator_avatar }} size={28} />
        <Text style={styles.rowText}>Organizado por <Text style={{ fontWeight: "800" }}>{event.creator_name}</Text></Text>
      </Pressable>
      <View style={styles.row}>
        <Ionicons name="people" size={20} color="#30B350" />
        <Text style={styles.rowText}>{count(event.attendee_count)} {event.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</Text>
      </View>
      {paid && <View style={styles.row}>
        <Ionicons name="ticket" size={20} color="#C58A00" />
        <Text style={styles.rowText}>Bilhete: <Text style={{ fontWeight: "800" }}>{kz(event.ticket_price_kz)}</Text>
          {event.tickets_total ? ` · ${count(left)} por vender` : ""}</Text>
      </View>}
      {!past && !event.is_creator && (paid
        ? (soldOut ? <Button label="Esgotado" icon="ticket" disabled onPress={() => {}} /> : <>
          <View style={styles.qtyRow}>
            <Text style={styles.rowText}>Quantos bilhetes?</Text>
            <View style={styles.qty}>
              <Pressable style={styles.qtyButton} disabled={quantity <= 1} onPress={() => setQuantity(value => Math.max(1, value - 1))} accessibilityLabel="Menos um bilhete">
                <Ionicons name="remove" size={20} color={quantity <= 1 ? colors.muted : colors.text} /></Pressable>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <Pressable style={styles.qtyButton} disabled={quantity >= maxQuantity} onPress={() => setQuantity(value => Math.min(maxQuantity, value + 1))} accessibilityLabel="Mais um bilhete">
                <Ionicons name="add" size={20} color={quantity >= maxQuantity ? colors.muted : colors.text} /></Pressable>
            </View>
          </View>
          <Button label={`${mine.length ? "Comprar mais" : "Comprar"} ${quantity === 1 ? "bilhete" : `${quantity} bilhetes`} · ${kz(event.ticket_price_kz * quantity)}`} icon="ticket" busy={busy} onPress={buy} />
        </>)
        : <Button label={event.is_attending ? "Vou ✓ (toca para sair)" : "Participar"} variant={event.is_attending ? "secondary" : "primary"} icon={event.is_attending ? undefined : "calendar"} busy={busy} onPress={rsvp} />)}
      <Button variant="secondary" label="Partilhar" icon="share-outline" onPress={() => Share.share({ message: `${event.name} · ${fmt(starts, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}${event.location ? ` · ${event.location}` : ""}\n${WEB_URL}/events` }).catch(() => {})} />
    </Card>

    {mine.length > 0 && <Card title={mine.length === 1 ? "O teu bilhete" : `Os teus ${mine.length} bilhetes`}
      subtitle={mine.length === 1 ? "Mostra este QR à entrada. Cada bilhete só entra uma vez." : "Cada pessoa entra com o seu QR. Desliza para ver todos; também estão no teu email."}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={mine.length > 1} contentContainerStyle={{ gap: 16 }}>
        {mine.map((ticket, index) => <View key={ticket.code} style={styles.ticketSlide}>
          {mine.length > 1 && <Text style={styles.ticketNumber}>Bilhete {index + 1} de {mine.length}</Text>}
          <TicketQr eventId={event.id} code={ticket.code} />
          <Text selectable style={styles.ticketCode}>{ticket.code}</Text>
          <Text style={{ color: ticket.checked_in_at ? "#30B350" : colors.muted, fontWeight: "700" }}>{ticket.checked_in_at ? "Já entrou" : "Por entrar"}</Text>
        </View>)}
      </ScrollView>
    </Card>}
    {event.is_creator && paid && <OrganizerTickets eventId={event.id} />}

    {Boolean(event.description) && <Card title="Sobre o evento"><Text style={styles.body}>{event.description}</Text></Card>}

    <Card title={`Quem vai (${count(event.attendee_count)})`}>
      {attendees.length === 0 ? <Empty text="Ainda ninguém confirmou." icon="people-outline" />
        : <View style={styles.people}>{attendees.map(person => <Pressable key={person.id} style={styles.person} onPress={() => router.push(`/u/${person.username}`)}>
          <Avatar user={person} size={52} />
          <Text style={styles.personName} numberOfLines={2}>{person.display_name}</Text>
          {person.is_friend && <Text style={styles.friend}>Amigo</Text>}
        </Pressable>)}</View>}
    </Card>

    {event.is_creator && <Button variant="ghost" label="Apagar evento" onPress={remove} />}
    <PaymentSheet visible={paying} title={`${quantity === 1 ? "Bilhete" : `${quantity} bilhetes`} «${event.name}»`} amount={event.ticket_price_kz * quantity} purpose="event_ticket"
      start={choice => api(`/events/${event.id}/tickets`, { method: "POST", body: { ...choice, quantity } })}
      onClose={() => { setPaying(false); load(); }} onPaid={() => { setPaying(false); load(); }} />
  </Page>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", gap: 14, alignItems: "center", padding: 16, borderRadius: 18, backgroundColor: colors.surface },
  date: { width: 64, height: 70, borderRadius: 16, backgroundColor: "#F06A2A", alignItems: "center", justifyContent: "center" },
  month: { color: "#fff", fontSize: 12, fontWeight: "800" },
  day: { color: "#fff", fontSize: 28, fontWeight: "800", lineHeight: 32 },
  title: { color: colors.text, fontSize: 21, fontWeight: "800" },
  when: { color: colors.muted, textTransform: "capitalize" },
  past: { color: colors.danger, fontWeight: "700", fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { color: colors.text, fontSize: 15 },
  link: { color: colors.text, fontWeight: "800" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  people: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  person: { width: 72, alignItems: "center", gap: 4 },
  personName: { color: colors.text, fontSize: 12, textAlign: "center" },
  friend: { color: "#30B350", fontSize: 11, fontWeight: "700" },
  qr: { width: 220, height: 220, borderRadius: 12, backgroundColor: "#fff" },
  qtyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  qty: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 999 },
  qtyButton: { width: 42, height: 40, alignItems: "center", justifyContent: "center" },
  qtyValue: { minWidth: 28, textAlign: "center", color: colors.text, fontSize: 17, fontWeight: "800" },
  ticketSlide: { width: 260, alignItems: "center", gap: 8 },
  ticketNumber: { color: "#E30613", fontWeight: "800", fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  ticketCode: { color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 3, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  codeInput: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 18, fontWeight: "800", letterSpacing: 2, color: colors.text },
  checkResult: { padding: 10, borderRadius: 12, color: colors.text, fontWeight: "700", overflow: "hidden" }
});
