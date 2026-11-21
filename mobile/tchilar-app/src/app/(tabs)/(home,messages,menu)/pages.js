// Páginas: descobrir, as tuas e as que segues. O mesmo desenho do site (src/modules/pages.jsx): página oficial em
// destaque, atalho para as tuas páginas e cartões com capa, foto, tipo e números. Em tablets há 2 ou 3 colunas.
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { FeaturedPage, PageCard, PageLogo } from "../../../components/PageParts";
import { Loading } from "../../../components/ui";
import { api } from "../../../lib/api";
import { PAGE_CATEGORIES, pageCategory, pageCategoryPath, pageType } from "../../../lib/pages";
import { useSession } from "../../../lib/session";
import { colors } from "../../../lib/theme";

const plural = (count, one, many) => `${Number(count || 0).toLocaleString("pt-PT")} ${count === 1 ? one : many}`;

export default function Pages() {
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const columns = width >= 1000 ? 3 : width >= 680 ? 2 : 1;
  const [pages, setPages] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { setPages((await api("/pages")).pages); setError(""); }
    catch (loadError) { setError(loadError.message); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const isOwner = page => Boolean(user && page.owner_username === user.username);
  // Seguir muda logo no ecrã; se o servidor falhar, volta atrás.
  const toggleFollow = async page => {
    const following = !page.is_following;
    const apply = (value, delta) => setPages(list => list.map(item => item.id === page.id ? { ...item, is_following: value, follower_count: item.follower_count + delta } : item));
    setBusyId(page.id);
    apply(following, following ? 1 : -1);
    try { await api(`/pages/${page.id}/follow`, { method: following ? "POST" : "DELETE" }); }
    catch (followError) { apply(!following, following ? -1 : 1); Alert.alert("Páginas", followError.message); }
    finally { setBusyId(null); }
  };

  const all = pages || [];
  const mine = all.filter(isOwner);
  const followed = all.filter(page => page.is_following && !isOwner(page));
  const source = tab === "mine" ? mine : tab === "following" ? followed : all;
  const areas = PAGE_CATEGORIES.filter(item => all.some(page => page.category === item.key));
  const term = query.trim().toLowerCase();
  const visible = source.filter(page => (!area || page.category === area)
    && (!term || `${page.name} ${page.description} ${pageCategoryPath(page)} ${pageType(page.page_type).label} ${page.owner_name}`.toLowerCase().includes(term)));
  const browsing = tab === "discover" && !term && !area;
  const featured = browsing ? all.find(page => page.is_official) : null;
  const grid = featured ? visible.filter(page => page.id !== featured.id) : visible;
  const rows = useMemo(() => {
    const out = [];
    for (let index = 0; index < grid.length; index += columns) out.push(grid.slice(index, index + columns));
    return out;
  }, [grid, columns]);
  const open = page => router.push(`/page/${page.id}`);
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["mine", "As tuas", mine.length], ["following", "A seguir", followed.length]] : [])];
  const title = tab === "mine" ? "As tuas páginas" : tab === "following" ? "Páginas que segues" : area ? pageCategory(area)?.label : term ? "Resultados" : "Todas as páginas";

  const header = <View style={styles.header}>
    <Text style={styles.lead}>Negócios, artistas e projetos da tua comunidade. Segue os que gostas ou cria a tua.</Text>
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.muted} />
      <TextInput style={styles.searchInput} placeholder="Procurar por nome, tipo ou categoria" placeholderTextColor={colors.muted}
        value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" />
    </View>
    <View style={styles.segmented} accessibilityRole="tablist">
      {tabs.map(([key, label, count]) => <Pressable key={key} style={[styles.segment, tab === key && styles.segmentOn]} onPress={() => setTab(key)}
        accessibilityRole="tab" accessibilityState={{ selected: tab === key }}>
        <Text style={[styles.segmentText, tab === key && styles.segmentTextOn]} numberOfLines={1}>{label}</Text>
        <Text style={styles.segmentCount}>{count}</Text>
      </Pressable>)}
    </View>
    {areas.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {[{ key: "", label: "Todas" }, ...areas].map(item => <Pressable key={item.key || "all"} style={[styles.chip, area === item.key && styles.chipOn]}
        onPress={() => setArea(area === item.key ? "" : item.key)} accessibilityRole="button" accessibilityState={{ selected: area === item.key }}>
        <Text style={[styles.chipText, area === item.key && styles.chipTextOn]}>{item.label}</Text>
      </Pressable>)}
    </ScrollView>}
    {featured && <FeaturedPage page={featured} isOwner={isOwner(featured)} busy={busyId === featured.id} wide={width >= 680}
      onOpen={() => open(featured)} onToggleFollow={() => toggleFollow(featured)} />}
    {browsing && mine.length > 0 && <View style={{ gap: 10 }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>As tuas páginas</Text>
        {mine.length > 3 && <Pressable onPress={() => setTab("mine")} hitSlop={8}><Text style={styles.link}>Ver todas</Text></Pressable>}
      </View>
      {mine.slice(0, 3).map(page => <Pressable key={page.id} style={styles.mine} onPress={() => open(page)} accessibilityRole="button">
        <PageLogo page={page} size={46} border={0} />
        <View style={{ flex: 1 }}>
          <Text style={styles.mineName} numberOfLines={1}>{page.name}</Text>
          <Text style={styles.mineMeta} numberOfLines={1}>{plural(page.follower_count, "seguidor", "seguidores")} · {plural(page.post_count, "publicação", "publicações")}</Text>
        </View>
        <Text style={styles.mineGo}>Gerir</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>)}
    </View>}
    {grid.length > 0 && <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.count}>{grid.length}</Text>
    </View>}
  </View>;

  const empty = pages === null
    ? (error ? <Text style={styles.empty}>{error}</Text> : <Loading />)
    : visible.length ? null
      : <View style={styles.emptyBox}>
        <Ionicons name={tab === "mine" ? "document-text-outline" : tab === "following" ? "heart-outline" : "search"} size={26} color={colors.text} />
        <Text style={styles.emptyTitle}>{tab === "mine" && !term && !area ? "Ainda não tens páginas" : tab === "following" && !term && !area ? "Ainda não segues páginas" : "Nenhuma página encontrada"}</Text>
        <Text style={styles.empty}>{tab === "mine" && !term && !area ? "Uma página dá ao teu negócio, projeto ou arte um espaço próprio, com publicações, eventos, loja e diretos."
          : tab === "following" && !term && !area ? "Quando seguires uma página, as publicações dela aparecem no teu feed." : "Experimenta outro nome ou outra categoria."}</Text>
        {tab === "mine" && !term && !area
          ? <Pressable style={styles.primary} onPress={() => router.push("/community/new?type=page")}><Text style={styles.primaryText}>Criar a primeira página</Text></Pressable>
          : <Pressable style={styles.secondary} onPress={() => { setQuery(""); setArea(""); setTab("discover"); }}><Text style={styles.secondaryText}>Ver todas as páginas</Text></Pressable>}
      </View>;

  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push("/community/new?type=page")} hitSlop={10} accessibilityLabel="Criar página">
      <Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable> }} />
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      data={rows}
      keyExtractor={row => row.map(page => page.id).join("-")}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      renderItem={({ item: row }) => <View style={styles.row}>
        {row.map(page => <PageCard key={page.id} page={page} isOwner={isOwner(page)} busy={busyId === page.id}
          onOpen={() => open(page)} onToggleFollow={() => toggleFollow(page)} />)}
        {Array.from({ length: columns - row.length }, (_, index) => <View key={`gap-${index}`} style={{ flex: 1 }} />)}
      </View>}
    />
  </>;
}

const styles = StyleSheet.create({
  list: { padding: 14, gap: 14, width: "100%", maxWidth: 1180, alignSelf: "center" },
  header: { gap: 14 },
  lead: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 46, paddingHorizontal: 14, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  segmented: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 14, backgroundColor: colors.surface },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10 },
  segmentOn: { backgroundColor: colors.background },
  segmentText: { color: colors.muted, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  segmentTextOn: { color: colors.text },
  segmentCount: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chips: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: colors.surface },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  count: { color: colors.muted, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.surface, overflow: "hidden" },
  link: { color: colors.accent, fontWeight: "800" },
  mine: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surface },
  mineName: { color: colors.text, fontWeight: "800", fontSize: 15 },
  mineMeta: { color: colors.muted, fontSize: 12 },
  mineGo: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", gap: 14 },
  emptyBox: { alignItems: "center", gap: 8, padding: 28, borderRadius: 16, backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  empty: { color: colors.muted, textAlign: "center", lineHeight: 20 },
  primary: { marginTop: 6, paddingHorizontal: 18, height: 42, borderRadius: 12, backgroundColor: colors.accent, justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondary: { marginTop: 6, paddingHorizontal: 18, height: 42, borderRadius: 12, backgroundColor: colors.background, justifyContent: "center" },
  secondaryText: { color: colors.text, fontWeight: "800" }
});
