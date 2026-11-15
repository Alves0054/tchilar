import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { colors, relativeTime } from "../lib/theme";
import { RowsSkeleton } from "../components/Loaders";

// Para onde vai cada notificação (igual ao que o servidor manda nos avisos push).
export function notificationRoute(item) {
  if (item.type === "message" && item.actor_id) return `/chat/${item.actor_id}`;
  if (item.type === "live") return "/live";
  if (["campaign", "payout", "ad"].includes(item.type)) return "/creator";
  if (["stars", "referral", "challenge"].includes(item.type)) return "/stars";
  if (item.type === "payment") return "/settings/pagamentos";
  if (item.type === "privacy") return /^Novo início de sessão/.test(item.text || "") ? "/settings/seguranca" : "/settings/conta";
  if (item.call_id) return `/call/direct/${item.call_id}`;
  if (item.post_id) return `/post/${item.post_id}`;
  if (item.group_id) return `/group/${item.group_id}`;
  if (item.actor_username) return `/u/${item.actor_username}`;
  return null;
}

export default function Notifications() {
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setItems((await api("/notifications")).notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  // Atualiza sempre que se abre o separador.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = item => {
    const path = notificationRoute(item);
    if (path) router.push(path);
    if (item.read) return;
    setItems(current => current.map(entry => entry.id === item.id ? { ...entry, read: true } : entry));
    api(`/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
  };
  const markAll = () => {
    setItems(current => current.map(entry => ({ ...entry, read: true })));
    api("/notifications/read-all", { method: "POST" }).catch(() => {});
  };
  const unread = (items || []).filter(item => !item.read).length;

  return <FlatList
    contentInsetAdjustmentBehavior="automatic"
    data={items || []}
    keyExtractor={item => String(item.id)}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    ListHeaderComponent={unread > 0 ? <Pressable style={styles.markAll} onPress={markAll}>
      <Text style={styles.markAllText}>Marcar todas como lidas ({unread})</Text></Pressable> : null}
    renderItem={({ item }) => <Pressable style={[styles.row, !item.read && styles.unread]} onPress={() => open(item)}>
      <Avatar user={{ display_name: item.actor_name || "Tchilar", avatar_url: item.actor_avatar }} size={46} />
      <View style={styles.text}>
        <Text style={styles.body}><Text style={styles.strong}>{item.actor_name || "Tchilar"}</Text> {item.text}</Text>
        <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
      </View>
      {!item.read && <View style={styles.dot} />}
    </Pressable>}
    ListEmptyComponent={items === null && !error ? <RowsSkeleton />
      : <Text style={styles.state}>{error || "Ainda não tens notificações."}</Text>}
  />;
}

const styles = StyleSheet.create({
  markAll: { padding: 14, alignItems: "flex-end" },
  markAllText: { color: colors.primary, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  unread: { backgroundColor: colors.primarySoft },
  text: { flex: 1, gap: 3 },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  strong: { fontWeight: "800" },
  time: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  state: { padding: 32, textAlign: "center", color: colors.muted }
});
