import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { PostCard } from "../../../components/PostCard";
import { HomeDiscover, HomeNow } from "../../../components/HomeBlocks";
import { StoriesBar } from "../../../components/StoriesBar";
import { api } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { colors } from "../../../lib/theme";

function HeaderActions() {
  const [unread, setUnread] = useState(0);
  useFocusEffect(useCallback(() => {
    api("/messages/unread-count").then(result => setUnread(result.unread)).catch(() => {});
  }, []));
  return <View style={styles.headerActions}>
    <Pressable style={styles.round} onPress={() => router.push("/search")} accessibilityLabel="Pesquisar">
      <Ionicons name="search" size={21} color={colors.text} />
    </Pressable>
    <Pressable style={styles.round} onPress={() => router.push("/messages")} accessibilityLabel={unread ? `Mensagens, ${unread} por ler` : "Mensagens"}>
      <Ionicons name="chatbubble-ellipses" size={21} color={colors.text} />
      {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text></View>}
    </Pressable>
  </View>;
}

// Início: stories, caixa para publicar, "Para ti / A seguir" e as publicações (carrega mais ao chegar ao fim).
export default function Feed() {
  const { user } = useSession();
  const navigation = useNavigation();
  const [scope, setScope] = useState("all");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [home, setHome] = useState(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <Image source={require("../../../../assets/tchilar-icon.png")} style={styles.logo} contentFit="contain" />,
      headerTitleAlign: "left",
      headerRight: () => <HeaderActions />
    });
  }, [navigation]);

  const load = useCallback(async (before = null) => {
    try {
      const query = new URLSearchParams({ ...(scope === "following" ? { feed: "following" } : {}), ...(before ? { before: String(before) } : {}) });
      const result = await api(`/posts${query.toString() ? `?${query}` : ""}`);
      setPosts(current => before ? [...current, ...result.posts] : result.posts);
      setCursor(result.nextCursor);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope]);
  // Ao trocar de filtro, recomeça do início.
  useEffect(() => { setLoading(true); setPosts([]); }, [scope]);
  // Carrega ao abrir, ao trocar de filtro e ao voltar de publicar (mostra logo a publicação nova).
  useFocusEffect(useCallback(() => {
    load();
    api("/home").then(setHome).catch(() => {});
  }, [load]));

  return <FlatList
    contentInsetAdjustmentBehavior="automatic"
    data={posts}
    keyExtractor={item => String(item.id)}
    renderItem={({ item, index }) => <>
      <PostCard post={item} />
      {index === 2 && <HomeDiscover discover={home?.discover} />}
    </>}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    onEndReached={() => { if (cursor && !loading) load(cursor); }}
    onEndReachedThreshold={0.5}
    ListHeaderComponent={<>
      <StoriesBar />
      <Pressable style={styles.composer} onPress={() => router.push("/create")}>
        <Avatar user={user} size={40} />
        <Text style={styles.composerText}>Em que estás a pensar?</Text>
        <Ionicons name="images" size={22} color="#2EAA6B" />
      </Pressable>
      <HomeNow now={home?.now} />
      {posts.length > 0 && posts.length < 3 && <HomeDiscover discover={home?.discover} />}
      <View style={styles.tabs}>
        {[["all", "Para ti"], ["following", "A seguir"]].map(([key, label]) =>
          <Pressable key={key} onPress={() => setScope(key)} style={[styles.tab, scope === key && styles.tabActive]}>
            <Text style={[styles.tabText, scope === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>)}
      </View>
    </>}
    ListEmptyComponent={loading ? <ActivityIndicator style={styles.state} color={colors.primary} />
      : <Text style={styles.state}>{error || "Ainda não há publicações aqui."}</Text>}
    ListFooterComponent={cursor ? <ActivityIndicator style={{ margin: 16 }} color={colors.primary} /> : null}
  />;
}

const styles = StyleSheet.create({
  logo: { width: 36, height: 36 },
  headerActions: { flexDirection: "row", gap: 8, marginRight: 12 },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  composer: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, padding: 10, borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  composerText: { flex: 1, color: colors.muted, fontSize: 15 },
  tabs: { flexDirection: "row", gap: 8, padding: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.text, fontWeight: "700" },
  tabTextActive: { color: "#fff" },
  state: { padding: 32, textAlign: "center", color: colors.muted }
});
