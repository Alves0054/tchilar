// Eventos como agenda (igual ao site): agrupados por dia (hora de Luanda), cartaz pequeno, hora, local, preço
// ("Grátis" ou em Kz) e quem vai, com filtros rápidos: Tudo, Hoje, Fim de semana, Grátis, Com bilhete, Vou.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { api, mediaUri } from "../../../lib/api";
import { colors } from "../../../lib/theme";

const LUANDA = "Africa/Luanda";
const dayKey = value => new Date(value).toLocaleDateString("en-CA", { timeZone: LUANDA });
const timeOf = value => new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LUANDA });
const kz = value => `${String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kz`;
const isWeekend = value => ["Fri", "Sat", "Sun"].includes(new Date(value).toLocaleDateString("en-GB", { weekday: "short", timeZone: LUANDA }));
const FILTERS = [
  ["all", "Tudo", () => true],
  ["today", "Hoje", item => dayKey(item.starts_at) === dayKey(Date.now())],
  ["weekend", "Fim de semana", item => isWeekend(item.starts_at) && new Date(item.starts_at) - Date.now() < 7 * 86400000],
  ["free", "Grátis", item => !(item.ticket_price_kz > 0)],
  ["paid", "Com bilhete", item => item.ticket_price_kz > 0],
  ["going", "Vou", item => item.is_attending || item.my_tickets?.length > 0]
];
const TONES = [["#FDE7E8", "#B4000F"], ["#FFF1D6", "#8A5A00"], ["#E3F1FF", "#0B5CAD"], ["#E5F6EA", "#156B33"]];

function sectionsOf(items) {
  const today = dayKey(Date.now());
  const tomorrow = dayKey(Date.now() + 86400000);
  const groups = new Map();
  for (const item of [...items].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))) {
    const key = dayKey(item.starts_at);
    if (!groups.has(key)) {
      const date = new Date(`${key}T12:00:00`);
      groups.set(key, {
        key, day: date.getDate(),
        label: `${date.toLocaleDateString("pt-PT", { weekday: "long" })} · ${date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}`,
        badge: key === today ? "Hoje" : key === tomorrow ? "Amanhã" : "", data: []
      });
    }
    groups.get(key).data.push(item);
  }
  return [...groups.values()];
}

function AgendaItem({ event, onRsvp }) {
  const paid = event.ticket_price_kz > 0;
  const mine = event.my_tickets?.length || 0;
  const left = paid && event.tickets_total ? Math.max(0, event.tickets_total - event.tickets_sold) : null;
  const [tone, ink] = TONES[event.id % TONES.length];
  const letter = (event.name.match(/[\p{L}\p{N}]/u) || ["•"])[0].toUpperCase();
  const host = event.page_name || event.creator_name;
  return <Pressable style={styles.item} onPress={() => router.push(`/event/${event.id}`)} accessibilityRole="button">
    {event.image_url
      ? <Image source={{ uri: mediaUri(event.image_url) }} style={styles.poster} contentFit="cover" transition={150} />
      : <View style={[styles.poster, styles.blank, { backgroundColor: tone }]}><Text style={[styles.letter, { color: ink }]}>{letter}</Text></View>}
    <View style={styles.body}>
      <Text style={styles.when} numberOfLines={1}><Text style={styles.time}>{timeOf(event.starts_at)}</Text>{event.location ? ` · ${event.location}` : ""}</Text>
      <Text style={styles.name} numberOfLines={2}>{event.name}</Text>
      {host ? <Text style={styles.host} numberOfLines={1}>por <Text style={{ color: colors.text, fontWeight: "700" }}>{host}</Text></Text> : null}
      <View style={styles.facts}>
        <Text style={[styles.price, !paid && styles.free]}>{paid ? kz(event.ticket_price_kz) : "Grátis"}</Text>
        <Text style={styles.fact}>{event.attendee_count} {event.attendee_count === 1 ? "vai" : "vão"}</Text>
        {left !== null && left <= 50 && <Text style={styles.left}>{left ? `Últimos ${left}` : "Esgotado"}</Text>}
      </View>
    </View>
    {paid
      ? <View style={[styles.action, mine ? styles.actionOn : null]}><Text style={[styles.actionText, mine ? styles.actionTextOn : null]}>{mine ? (mine === 1 ? "Bilhete" : `${mine} bilhetes`) : "Comprar"}</Text></View>
      : <Pressable onPress={() => onRsvp(event)} hitSlop={8} style={[styles.action, event.is_attending && styles.actionOn]} accessibilityRole="button">
        {event.is_attending && <Ionicons name="checkmark" size={14} color={colors.text} />}
        <Text style={[styles.actionText, event.is_attending && styles.actionTextOn]}>Vou</Text>
      </Pressable>}
  </Pressable>;
}

export default function Events() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems((await api("/events")).events); setError(""); } catch (loadError) { setError(loadError.message); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const sections = useMemo(() => sectionsOf((items || []).filter(FILTERS.find(([key]) => key === filter)[2])), [items, filter]);

  const rsvp = async event => {
    try {
      const result = await api(`/events/${event.id}/rsvp`, { method: "POST" });
      setItems(list => list.map(item => item.id === event.id
        ? { ...item, is_attending: result.attending, attendee_count: item.attendee_count + (result.attending ? 1 : -1) } : item));
    } catch (rsvpError) { Alert.alert("Eventos", rsvpError.message); }
  };

  const header = <View style={styles.head}>
    <Text style={styles.kicker}>AGENDA</Text>
    <Text style={styles.title}>Eventos</Text>
    <Text style={styles.subtitle}>Concertos, feiras, aulas e encontros perto de ti.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {FILTERS.map(([key, label]) => <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipOn]}>
        <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{label}</Text></Pressable>)}
    </ScrollView>
  </View>;

  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push("/community/new?type=event")} hitSlop={10} accessibilityLabel="Criar evento">
      <Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable> }} />
    <SectionList
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={item => String(item.id)}
      stickySectionHeadersEnabled
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => <View style={styles.dayHead}>
        <Text style={styles.dayNumber}>{section.day}</Text>
        <Text style={styles.dayLabel}>{section.label}</Text>
        {section.badge ? <Text style={styles.dayBadge}>{section.badge.toUpperCase()}</Text> : null}
      </View>}
      renderItem={({ item }) => <AgendaItem event={item} onRsvp={rsvp} />}
      ListEmptyComponent={items === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
        : <View style={styles.empty}><Ionicons name="calendar-outline" size={30} color={colors.muted} />
          <Text style={styles.emptyText}>{error || (filter === "all" ? "Não há eventos marcados para os próximos dias." : "Nada com este filtro.")}</Text></View>}
    />
  </>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  head: { paddingTop: 8, paddingBottom: 6, gap: 4 },
  kicker: { color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontSize: 15 },
  filters: { gap: 8, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontWeight: "600" },
  chipTextOn: { color: colors.background },
  dayHead: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 14, paddingBottom: 8, backgroundColor: colors.background },
  dayNumber: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -1 },
  dayLabel: { color: colors.muted, fontSize: 14, textTransform: "capitalize" },
  dayBadge: { color: colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, marginBottom: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  poster: { width: 84, height: 84, borderRadius: 12 },
  blank: { alignItems: "center", justifyContent: "center" },
  letter: { fontSize: 32, fontWeight: "800" },
  body: { flex: 1, gap: 2 },
  when: { color: colors.muted, fontSize: 13 },
  time: { color: colors.accent, fontWeight: "800" },
  name: { color: colors.text, fontSize: 16, fontWeight: "800" },
  host: { color: colors.muted, fontSize: 13 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  price: { color: colors.text, fontWeight: "800", fontSize: 13 },
  free: { color: "#1E9E4A" },
  fact: { color: colors.muted, fontSize: 13 },
  left: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  action: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.accent },
  actionOn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  actionText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  actionTextOn: { color: colors.text },
  empty: { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyText: { color: colors.muted, textAlign: "center" }
});
