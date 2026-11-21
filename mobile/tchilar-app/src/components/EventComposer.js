// Criar evento na app (igual ao site): nome, dia e hora no calendário do Tchilar, local, detalhes e imagem;
// por baixo, o cartaz do evento tal como as pessoas o vão ver. Serve para eventos gerais, de páginas e de grupos
// (endpoint "/events" ou "/groups/:id/events"). Com imagem, vai em multipart (campo "image").
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, mediaUri, upload } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";
import { DateTimeField, formatDateTime, localDateTime } from "./DateTimeField";
import { Button, Chips, Field, Notice } from "./ui";

const RED = "#E30613";
const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Cartaz de um evento: capa (imagem ou cor lisa com o calendário), data em destaque, nome, hora, local.
export function EventPoster({ event, image, host, going, onGoing, onPress, compact = false }) {
  const day = event.starts_at || event.startsAt ? new Date(event.starts_at || event.startsAt) : null;
  const when = event.startsAt ? formatDateTime(event.startsAt) : day ? formatDateTime(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T${String(day.getHours()).padStart(2, "0")}:${String(day.getMinutes()).padStart(2, "0")}`) : "";
  const cover = image || (event.image_url ? mediaUri(event.image_url) : null);
  const Wrapper = onPress ? Pressable : View;
  return <Wrapper style={styles.poster} onPress={onPress}>
    <View style={[styles.cover, compact && { aspectRatio: 2 }]}>
      {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="calendar-outline" size={30} color="rgba(255,255,255,0.85)" />}
      <View style={styles.dateTile}>
        <Text style={styles.dateDay}>{day ? day.getDate() : "--"}</Text>
        <Text style={styles.dateMonth}>{day ? SHORT_MONTHS[day.getMonth()] : "mês"}</Text>
      </View>
    </View>
    <View style={styles.posterBody}>
      <Text style={[styles.posterName, !event.name && styles.placeholder]} numberOfLines={2}>{event.name || "Nome do evento"}</Text>
      <View style={styles.line}><Ionicons name="time-outline" size={14} color={RED} /><Text style={[styles.when, !when && styles.placeholder]}>{when || "Dia e hora"}</Text></View>
      <View style={styles.line}><Ionicons name="location-outline" size={14} color={colors.muted} /><Text style={[styles.muted, !event.location && styles.placeholder]} numberOfLines={1}>{event.location || "Local"}</Text></View>
      {event.description && !compact ? <Text style={styles.desc} numberOfLines={3}>{event.description}</Text> : null}
      <View style={styles.foot}>
        <Text style={styles.small} numberOfLines={1}>{host}</Text>
        <Pressable style={[styles.going, going && styles.goingOn]} onPress={onGoing} disabled={!onGoing} accessibilityRole="button" accessibilityState={{ selected: Boolean(going) }}>
          <Ionicons name={going ? "checkmark" : "add"} size={14} color={going ? "#fff" : colors.text} />
          <Text style={[styles.goingText, going && { color: "#fff" }]}>Vou</Text>
        </Pressable>
      </View>
    </View>
  </Wrapper>;
}

export function EventComposer({ endpoint = "/events", pageId, pageName, groupName, onCreated, onCancel }) {
  const { user } = useSession();
  const [form, setForm] = useState({ name: "", startsAt: "", location: "", description: "" });
  // Entrada: grátis ("Vou") ou bilhete pago com dinheiro (quem organiza fica com 85%). Os eventos de grupos são sempre grátis.
  const [ticket, setTicket] = useState({ paid: "free", price: "2000", total: "" });
  const paid = !groupName && ticket.paid === "paid";
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Tchilar", "Permite o acesso às fotos nas definições do telemóvel.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [16, 9] });
    if (!result.canceled) setImage(result.assets[0]);
  };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const fields = { name: form.name.trim(), description: form.description, location: form.location, startsAt: new Date(form.startsAt).toISOString(),
        ...(pageId ? { pageId: Number(pageId) } : {}),
        ...(paid ? { ticketPriceKz: Number(ticket.price) || 0, ...(ticket.total ? { ticketsTotal: Number(ticket.total) } : {}) } : {}) };
      const result = image ? await upload(endpoint, fields, image, "image") : await api(endpoint, { method: "POST", body: fields });
      onCreated?.(result);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };
  const host = groupName ? `Evento do grupo ${groupName}` : `Organizado por ${pageName || user?.display_name || "ti"}`;
  return <View style={{ gap: 14 }}>
    <Text style={styles.intro}>{groupName ? `Só os membros de ${groupName} o veem. Avisamos todos os membros quando o criares.`
      : pageName ? `Aparece na página ${pageName} e na lista de eventos do Tchilar.` : "Aparece na lista de eventos do Tchilar. As pessoas confirmam que vão."}</Text>
    <Field label={`Nome do evento · ${form.name.length}/120`} value={form.name} onChangeText={set("name")} maxLength={120} placeholder={groupName ? "Encontro de sábado" : "Feira de artesanato no Benfica"} />
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Quando</Text>
      <DateTimeField value={form.startsAt} onChange={set("startsAt")} min={localDateTime(5)} label="Dia e hora do evento" />
    </View>
    <Field label="Onde (opcional)" value={form.location} onChangeText={set("location")} maxLength={160} placeholder="Mercado do Benfica, Luanda" />
    <Field label={`Detalhes · ${form.description.length}/2000`} value={form.description} onChangeText={set("description")} multiline maxLength={2000} placeholder="O que vai acontecer e o que as pessoas devem levar." />
    {!groupName && <View style={{ gap: 6 }}>
      <Text style={styles.label}>Entrada</Text>
      <Chips value={ticket.paid} onChange={value => setTicket(current => ({ ...current, paid: value }))}
        options={[["free", "Grátis («Vou»)"], ["paid", "Bilhete pago"]]} />
      {paid && <>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Preço (Kz)" value={ticket.price} keyboardType="number-pad" maxLength={7}
            onChangeText={value => setTicket(current => ({ ...current, price: value.replace(/\D/g, "") }))} /></View>
          <View style={{ flex: 1 }}><Field label="Bilhetes (vazio = sem limite)" value={ticket.total} keyboardType="number-pad" maxLength={6}
            onChangeText={value => setTicket(current => ({ ...current, total: value.replace(/\D/g, "") }))} /></View>
        </View>
        <Text style={styles.small}>Pagam por Express, Referência, PayPay ou PayPal. Ficas com 85% ({Math.round(Number(ticket.price || 0) * 0.85).toLocaleString("pt-PT")} Kz por bilhete) e o Tchilar com 15%; o dinheiro fica disponível 1 dia depois do evento. Cada bilhete tem um QR para a entrada; se cancelares antes, devolvemos a quem comprou.</Text>
      </>}
    </View>}
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Imagem do evento (opcional)</Text>
      {image ? <View style={styles.chosen}>
        <Image source={{ uri: image.uri }} style={styles.thumb} contentFit="cover" />
        <View style={{ flex: 1 }}><Text style={styles.chosenName} numberOfLines={1}>{image.fileName || "Imagem escolhida"}</Text>
          <Text style={styles.small}>{image.width} × {image.height}</Text></View>
        <Pressable onPress={pickImage} style={styles.smallBtn}><Text style={styles.smallBtnText}>Trocar</Text></Pressable>
        <Pressable onPress={() => setImage(null)} style={styles.iconBtn} accessibilityLabel="Remover imagem"><Ionicons name="trash-outline" size={17} color={colors.text} /></Pressable>
      </View> : <Pressable style={styles.drop} onPress={pickImage} accessibilityRole="button">
        <View style={styles.dropIcon}><Ionicons name="image-outline" size={20} color="#fff" /></View>
        <View style={{ flex: 1 }}><Text style={styles.chosenName}>Escolher imagem</Text><Text style={styles.small}>Na horizontal fica melhor</Text></View>
        <View style={styles.dropCta}><Ionicons name="add" size={14} color={colors.surface} /><Text style={{ color: colors.surface, fontWeight: "800", fontSize: 13 }}>Escolher</Text></View>
      </Pressable>}
    </View>
    <Text style={styles.label}>Assim vão ver o teu evento</Text>
    <EventPoster event={form} image={image?.uri} host={host} going />
    <Notice error={error} />
    <Button label={busy ? "A criar..." : "Criar evento"} icon="calendar" onPress={create} busy={busy} disabled={!form.name.trim() || !form.startsAt || (paid && !(Number(ticket.price) >= 100))} />
    {onCancel && <Button variant="ghost" label="Cancelar" onPress={onCancel} />}
  </View>;
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.text, fontSize: 14, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  small: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  placeholder: { opacity: 0.55 },
  poster: { overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cover: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", backgroundColor: "#141416" },
  dateTile: { position: "absolute", left: 14, bottom: -24, width: 56, paddingVertical: 6, alignItems: "center", borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  dateDay: { color: colors.text, fontSize: 22, fontWeight: "800", lineHeight: 26 },
  dateMonth: { color: RED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  posterBody: { gap: 6, padding: 14, paddingTop: 32 },
  posterName: { color: colors.text, fontSize: 18, fontWeight: "800" },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  when: { color: RED, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  desc: { color: colors.text, fontSize: 13, lineHeight: 19 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  going: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: colors.text },
  goingOn: { borderColor: RED, backgroundColor: RED },
  goingText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  chosen: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  thumb: { width: 76, height: 48, borderRadius: 8 },
  chosenName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.background },
  smallBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.background },
  drop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  dropIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#141416" },
  dropCta: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.text }
});
