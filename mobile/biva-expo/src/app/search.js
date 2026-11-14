import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { PostCard } from "../components/PostCard";
import { Chips } from "../components/ui";
import { api } from "../lib/api";
import { colors } from "../lib/theme";

const TABS = [["all", "Tudo"], ["people", "Pessoas"], ["posts", "Publicações"], ["hashtags", "Hashtags"], ["groups", "Grupos"], ["pages", "Páginas"]];
const HASHTAG = /^#[\p{L}\p{N}_]{1,50}$/u;

// Pesquisa: pessoas, publicações, hashtags, grupos e páginas, com a barra de pesquisa nativa
// (vidro no iOS 26, Material no Android). Abrir "/search?q=%23tag" mostra as publicações dessa hashtag.
export default function Search() {
  const params = useLocalSearchParams();
  const [term, setTerm] = useState(typeof params.q === "string" ? params.q : "");
  const [tab, setTab] = useState(typeof params.q === "string" && HASHTAG.test(params.q) ? "posts" : "all");
  const [results, setResults] = useState(null);
  const [posts, setPosts] = useState(null);
  const query = term.trim();
  const isTag = HASHTAG.test(query);

  useEffect(() => {
    if (query.length < 2) { setResults(null); setPosts(null); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      const postsUrl = isTag ? `/posts?tag=${encodeURIComponent(query.slice(1))}` : `/posts?q=${encodeURIComponent(query)}`;
      Promise.all([api(`/search?q=${encodeURIComponent(query)}`), api(postsUrl)])
        .then(([found, postResult]) => { if (active) { setResults(found); setPosts(postResult.posts); } })
        .catch(() => { if (active) { setResults({ users: [], groups: [], pages: [], hashtags: [] }); setPosts([]); } });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [query, isTag]);

  // Uma só lista com cabeçalhos de secção: em "Tudo" mostra os primeiros de cada tipo.
  const limit = tab === "all" ? 4 : 50;
  const rows = [];
  const section = (id, title, items, render) => {
    if ((tab !== "all" && tab !== id) || !items?.length) return;
    rows.push({ key: `h-${id}`, header: title });
    items.slice(0, id === "posts" ? 50 : limit).forEach(item => rows.push({ key: `${id}-${item.id ?? item.tag}`, render: () => render(item) }));
  };
  if (results) {
    section("people", "Pessoas", results.users, item => <Pressable style={styles.row} onPress={() => router.push(`/u/${item.username}`)}>
      <Avatar user={item} size={44} />
      <View style={styles.flex}><Text style={styles.name}>{item.display_name}</Text><Text style={styles.sub}>@{item.username}</Text></View>
    </Pressable>);
    section("hashtags", "Hashtags", results.hashtags, item => <Pressable style={styles.row} onPress={() => { setTerm(`#${item.tag}`); setTab("posts"); }}>
      <View style={[styles.icon, { backgroundColor: "#5E5CE61F" }]}><Ionicons name="pricetag" size={20} color="#5E5CE6" /></View>
      <View style={styles.flex}><Text style={styles.name}>#{item.tag}</Text><Text style={styles.sub}>{item.posts === 1 ? "1 publicação" : `${item.posts} publicações`}</Text></View>
    </Pressable>);
    section("groups", "Grupos", results.groups, item => <Pressable style={styles.row} onPress={() => router.push(`/group/${item.id}`)}>
      <View style={[styles.icon, { backgroundColor: "#30B3501F" }]}><Ionicons name="people" size={20} color="#30B350" /></View>
      <View style={styles.flex}><Text style={styles.name}>{item.name}</Text>
        <Text style={styles.sub}>{item.member_count === 1 ? "1 membro" : `${item.member_count} membros`}{item.requires_approval ? " · Privado" : ""}</Text></View>
    </Pressable>);
    section("pages", "Páginas", results.pages, item => <Pressable style={styles.row} onPress={() => router.push(`/page/${item.id}`)}>
      <View style={[styles.icon, { backgroundColor: "#FF8A001F" }]}><Ionicons name="flag" size={20} color="#FF8A00" /></View>
      <View style={styles.flex}><Text style={styles.name}>{item.name}</Text>
        <Text style={styles.sub}>{item.follower_count === 1 ? "1 seguidor" : `${item.follower_count} seguidores`}</Text></View>
    </Pressable>);
  }
  if (posts) section("posts", "Publicações", posts, item => <PostCard post={item} />);

  return <>
    <Stack.Screen options={{
      title: isTag ? query : "Pesquisar",
      headerSearchBarOptions: {
        placeholder: "Pessoas, publicações, #hashtags",
        autoFocus: !params.q,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        onChangeText: event => setTerm(event.nativeEvent.text)
      }
    }} />
    <FlatList contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      data={rows}
      keyExtractor={item => item.key}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={query.length >= 2 ? <View style={styles.tabs}><Chips options={TABS} value={tab} onChange={setTab} /></View> : null}
      renderItem={({ item }) => item.header ? <Text style={styles.header}>{item.header}</Text> : item.render()}
      ListEmptyComponent={<Text style={styles.empty}>{query.length < 2 ? "Escreve pelo menos 2 letras, ou # para hashtags."
        : results ? `Sem resultados para «${query}».` : "A procurar..."}</Text>}
    />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabs: { paddingHorizontal: 12, paddingTop: 10 },
  header: { color: colors.text, fontSize: 17, fontWeight: "800", paddingHorizontal: 14, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.surface },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  name: { color: colors.text, fontWeight: "700", fontSize: 16 },
  sub: { color: colors.muted, marginTop: 1 },
  empty: { color: colors.muted, textAlign: "center", padding: 24 }
});
