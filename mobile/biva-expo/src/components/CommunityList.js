import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/theme";

// Lista comum a Grupos, Páginas e Eventos: carrega, filtra pelo texto e mostra uma ação por linha.
export function CommunityList({ path, field, empty, renderRow, filters }) {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setItems((await api(path))[field]);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [path, field]);
  useEffect(() => { load(); }, [load]);
  const update = (id, patch) => setItems(list => list.map(item => item.id === id ? { ...item, ...patch } : item));
  const visible = (items || []).filter(item => !filters || filters.find(entry => entry.key === filter).test(item));

  return <FlatList
    contentInsetAdjustmentBehavior="automatic"
    data={visible}
    keyExtractor={item => String(item.id)}
    contentContainerStyle={styles.list}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    ListHeaderComponent={filters ? <View style={styles.filters}>{filters.map(entry =>
      <Pressable key={entry.key} onPress={() => setFilter(entry.key)} style={[styles.chip, filter === entry.key && styles.chipActive]}>
        <Text style={[styles.chipText, filter === entry.key && styles.chipTextActive]}>{entry.label}</Text>
      </Pressable>)}</View> : null}
    renderItem={({ item }) => renderRow(item, patch => update(item.id, patch))}
    ListEmptyComponent={items === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
      : <Text style={styles.empty}>{error || empty}</Text>}
  />;
}

// Cartão de uma linha: ícone, título, detalhes e um botão à direita.
export function CommunityCard({ icon, tone = colors.primary, title, lines, action }) {
  return <View style={styles.card}>
    <View style={[styles.icon, { backgroundColor: `${tone}1F` }]}><Ionicons name={icon} size={24} color={tone} /></View>
    <View style={styles.text}>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      {lines.filter(Boolean).map((line, index) => <Text key={index} style={styles.line} numberOfLines={2}>{line}</Text>)}
    </View>
    {action}
  </View>;
}

export function ActionButton({ label, active, onPress, disabled }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, active && styles.buttonActive, disabled && { opacity: 0.5 }]}>
    <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 10 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface },
  icon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800" },
  line: { color: colors.muted, fontSize: 13 },
  button: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: colors.primary, justifyContent: "center" },
  buttonActive: { backgroundColor: colors.primarySoft },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  buttonTextActive: { color: colors.primary },
  empty: { color: colors.muted, textAlign: "center", padding: 32 }
});
