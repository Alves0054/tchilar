import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { PostCard } from "../../components/PostCard";
import { Badge, Button, Card, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { pageCategoryPath, pageType } from "../../lib/pages";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

// Uma página por dentro: tipo, categoria, seguir e as publicações. Quem gere a página publica aqui.
export default function PageScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useSession();
  const [page, setPage] = useState(null);
  const [posts, setPosts] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, feed] = await Promise.all([api("/pages"), api(`/posts?pageId=${id}`)]);
      const found = list.pages.find(item => String(item.id) === String(id));
      if (!found) throw new Error("Página não encontrada.");
      setPage(found);
      setPosts(feed.posts);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!page) return error ? <Text style={styles.state}>{error}</Text> : <Loading />;
  const owner = page.owner_username === user?.username;
  const type = pageType(page.page_type);
  const category = pageCategoryPath(page);
  const toggleFollow = async () => {
    try { await api(`/pages/${page.id}/follow`, { method: page.is_following ? "DELETE" : "POST" }); await load(); } catch (followError) { Alert.alert("Página", followError.message); }
  };

  return <>
    <Stack.Screen options={{ title: page.name }} />
    <FlatList contentInsetAdjustmentBehavior="automatic"
      data={posts || []}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={<View style={{ padding: 12, gap: 12 }}>
        <Card title={page.name} subtitle={`${category} · ${page.follower_count} ${page.follower_count === 1 ? "seguidor" : "seguidores"}`}
          right={type ? <Badge label={type.label} tone="info" /> : null}>
          {Boolean(page.description) && <Text style={{ color: colors.text, lineHeight: 20 }}>{page.description}</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {owner ? <Button small label="Publicar na página" icon="create" onPress={() => router.push({ pathname: "/create", params: { pageId: page.id, targetName: page.name } })} />
              : <Button small variant={page.is_following ? "secondary" : "primary"} label={page.is_following ? "A seguir" : "Seguir"} onPress={toggleFollow} />}
          </View>
        </Card>
        <Text style={styles.section}>Publicações</Text>
      </View>}
      ListEmptyComponent={posts === null ? <Loading /> : <Text style={styles.state}>Ainda não há publicações.</Text>}
    />
  </>;
}

const styles = StyleSheet.create({
  section: { color: colors.text, fontSize: 17, fontWeight: "800" },
  state: { padding: 32, textAlign: "center", color: colors.muted }
});
