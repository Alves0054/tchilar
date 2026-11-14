// Início, como no site: "Agora no Tchilar" (o que está a acontecer) e "Descobrir" (grupos, páginas e pessoas).
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import catalog from "../lib/community-types.json";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";

const time = value => new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
const topicLabel = key => catalog.groupTopics.find(topic => topic.key === key)?.label || "Geral";

// Faixa horizontal com o que está a acontecer agora.
export function HomeNow({ now }) {
  if (!now) return null;
  const items = [
    ...now.events.map(event => ({ key: `e${event.id}`, icon: "calendar", tone: "#D64545", title: event.name, line: `Hoje às ${time(event.starts_at)}${event.location ? ` · ${event.location}` : ""}`, onPress: () => router.push("/events") })),
    ...now.groups.map(group => ({ key: `g${group.id}`, icon: "people", tone: "#2EAA6B", title: group.name, line: `${group.new_posts} ${group.new_posts === 1 ? "publicação nova" : "publicações novas"}`, onPress: () => router.push(`/group/${group.id}`) }))
  ];
  if (!items.length && !now.online.length) return null;
  return <View style={styles.block}>
    <Text style={styles.title}>Agora no Tchilar</Text>
    {now.online.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {now.online.map(person => <Pressable key={person.id} style={styles.online} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: person.id, name: person.display_name } })}>
        <View><Avatar user={person} size={52} /><View style={styles.dot} /></View>
        <Text style={styles.onlineName} numberOfLines={1}>{person.display_name.split(" ")[0]}</Text>
      </Pressable>)}
    </ScrollView>}
    {items.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map(item => <Pressable key={item.key} style={styles.nowCard} onPress={item.onPress}>
        <View style={[styles.icon, { backgroundColor: `${item.tone}1F` }]}><Ionicons name={item.icon} size={20} color={item.tone} /></View>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.cardLine} numberOfLines={2}>{item.line}</Text>
      </Pressable>)}
    </ScrollView>}
  </View>;
}

function DiscoverAction({ label, done, doneLabel, onPress }) {
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(done);
  const run = async () => {
    setBusy(true);
    try { await onPress(); setFinished(true); } catch (error) { Alert.alert("Tchilar", error.message); } finally { setBusy(false); }
  };
  return <Pressable style={[styles.action, finished && styles.actionDone]} disabled={busy || finished} onPress={run}>
    <Text style={[styles.actionText, finished && styles.actionTextDone]}>{finished ? doneLabel : label}</Text>
  </Pressable>;
}

// Sugestões: grupos (por amigos e temas), páginas e pessoas que talvez conheças.
export function HomeDiscover({ discover }) {
  if (!discover) return null;
  const cards = [
    ...discover.people.slice(0, 4).map(person => ({
      key: `u${person.id}`, onPress: () => router.push(`/u/${person.username}`), avatar: person, title: person.display_name,
      line: person.mutual_count ? `${person.mutual_count} ${person.mutual_count === 1 ? "amigo" : "amigos"} em comum` : person.same_province ? "Da tua província" : "Novo no Tchilar",
      action: <DiscoverAction label="Adicionar" doneLabel="Enviado" onPress={() => api(`/friends/${person.id}/request`, { method: "POST" })} />
    })),
    ...discover.groups.slice(0, 3).map(group => ({
      key: `g${group.id}`, onPress: () => router.push(`/group/${group.id}`), icon: "people", tone: "#2EAA6B", title: group.name,
      line: group.friend_count ? `${group.friend_count} ${group.friend_count === 1 ? "amigo participa" : "amigos participam"}` : `${topicLabel(group.topic)} · ${group.member_count} membros`,
      action: <DiscoverAction label={group.requires_approval ? "Pedir" : "Participar"} doneLabel={group.requires_approval ? "Pedido" : "Membro"} onPress={() => api(`/groups/${group.id}/join`, { method: "POST" })} />
    })),
    ...discover.pages.slice(0, 3).map(page => ({
      key: `p${page.id}`, onPress: () => router.push(`/page/${page.id}`), icon: "flag", tone: "#E8890C", title: page.name,
      line: page.friend_count ? `${page.friend_count} ${page.friend_count === 1 ? "amigo segue" : "amigos seguem"}` : `${page.follower_count} seguidores`,
      action: <DiscoverAction label="Seguir" doneLabel="A seguir" onPress={() => api(`/pages/${page.id}/follow`, { method: "POST" })} />
    }))
  ];
  if (!cards.length) return null;
  return <View style={styles.block}>
    <Text style={styles.title}>Descobrir</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {cards.map(card => <Pressable key={card.key} style={styles.discoverCard} onPress={card.onPress}>
        {card.avatar ? <Avatar user={card.avatar} size={64} />
          : <View style={[styles.bigIcon, { backgroundColor: `${card.tone}1F` }]}><Ionicons name={card.icon} size={30} color={card.tone} /></View>}
        <Text style={styles.cardTitle} numberOfLines={2}>{card.title}</Text>
        <Text style={[styles.cardLine, { textAlign: "center" }]} numberOfLines={2}>{card.line}</Text>
        {card.action}
      </Pressable>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  block: { paddingTop: 8, gap: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800", paddingHorizontal: 14 },
  row: { paddingHorizontal: 12, gap: 10, paddingVertical: 4 },
  online: { width: 64, alignItems: "center", gap: 4 },
  dot: { position: "absolute", right: 1, bottom: 1, width: 14, height: 14, borderRadius: 7, backgroundColor: "#2EAA6B", borderWidth: 2, borderColor: colors.surface },
  onlineName: { color: colors.text, fontSize: 12 },
  nowCard: { width: 160, padding: 12, borderRadius: 16, backgroundColor: colors.surface, gap: 4 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 14, textAlign: "center" },
  cardLine: { color: colors.muted, fontSize: 12 },
  discoverCard: { width: 150, padding: 12, borderRadius: 16, backgroundColor: colors.surface, alignItems: "center", gap: 6 },
  bigIcon: { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  action: { marginTop: 4, alignSelf: "stretch", height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  actionDone: { backgroundColor: colors.primarySoft },
  actionText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  actionTextDone: { color: colors.primary }
});
