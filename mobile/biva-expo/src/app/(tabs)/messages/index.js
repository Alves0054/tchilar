import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { api } from "../../../lib/api";
import { colors, relativeTime } from "../../../lib/theme";

export default function Messages() {
  const [conversations, setConversations] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setConversations((await api("/messages")).conversations);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return <FlatList contentInsetAdjustmentBehavior="automatic"
    data={conversations || []}
    keyExtractor={item => String(item.id)}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    renderItem={({ item }) => <Pressable style={styles.row} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id, name: item.display_name } })}>
      <Avatar user={item} size={50} />
      <View style={styles.text}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{item.display_name}</Text>
          <Text style={styles.time}>{relativeTime(item.latest_message_at)}</Text>
        </View>
        <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>{item.latest_message}</Text>
      </View>
      {item.unread > 0 && <View style={styles.count}><Text style={styles.countText}>{item.unread > 9 ? "9+" : item.unread}</Text></View>}
    </Pressable>}
    ListEmptyComponent={conversations === null && !error ? <ActivityIndicator style={styles.state} color={colors.primary} />
      : <Text style={styles.state}>{error || "Ainda não tens conversas."}</Text>}
  />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  text: { flex: 1, gap: 3 },
  top: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "700" },
  time: { color: colors.muted, fontSize: 12 },
  preview: { color: colors.muted, fontSize: 14 },
  previewUnread: { color: colors.text, fontWeight: "700" },
  count: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  countText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  state: { padding: 32, textAlign: "center", color: colors.muted }
});
