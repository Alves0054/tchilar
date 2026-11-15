// Um evento: data em destaque, local (abre no mapa), quem criou, descrição, participar e quem vai
// (amigos primeiro). Quem criou pode apagar; toda a gente pode partilhar.
import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Button, Card, Empty, Loading, Notice, Page, count } from "../../components/ui";
import { WEB_URL, api } from "../../lib/api";
import { colors } from "../../lib/theme";

const fmt = (value, options) => new Date(value).toLocaleString("pt-PT", options);

export default function EventScreen() {
  const { id } = useLocalSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api(`/events/${id}`).then(setData).catch(loadError => setError(loadError.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;
  const { event, attendees } = data;
  const starts = new Date(event.starts_at);
  const past = starts < new Date();

  const rsvp = async () => {
    setBusy(true);
    try { await api(`/events/${event.id}/rsvp`, { method: "POST" }); await load(); } catch (rsvpError) { Alert.alert("Eventos", rsvpError.message); } finally { setBusy(false); }
  };
  const openMap = () => {
    const query = encodeURIComponent(event.location);
    Linking.openURL(Platform.OS === "ios" ? `maps:0,0?q=${query}` : `geo:0,0?q=${query}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`));
  };
  const remove = () => Alert.alert("Apagar evento?", "Quem ia participar deixa de o ver.", [
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
      {!past && <Button label={event.is_attending ? "Vou ✓ (toca para sair)" : "Participar"} variant={event.is_attending ? "secondary" : "primary"} icon={event.is_attending ? undefined : "calendar"} busy={busy} onPress={rsvp} />}
      <Button variant="secondary" label="Partilhar" icon="share-outline" onPress={() => Share.share({ message: `${event.name} · ${fmt(starts, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}${event.location ? ` · ${event.location}` : ""}\n${WEB_URL}/events` }).catch(() => {})} />
    </Card>

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
  friend: { color: "#30B350", fontSize: 11, fontWeight: "700" }
});
