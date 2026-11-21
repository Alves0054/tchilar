import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { api, mediaUri } from "../lib/api";
import { useSession } from "../lib/session";
import { remember } from "../lib/store";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";
import { StoryBackground } from "./StoryBackground";

// Junta os stories por pessoa (os meus primeiro), do mais antigo para o mais recente dentro de cada pessoa.
export function groupStories(stories, myId) {
  const groups = new Map();
  for (const story of stories) {
    if (!groups.has(story.user_id)) groups.set(story.user_id, { user: story, items: [] });
    groups.get(story.user_id).items.push(story);
  }
  const list = [...groups.values()].map(group => ({ ...group, items: group.items.reverse() }));
  return list.sort((a, b) => (b.user.user_id === myId) - (a.user.user_id === myId));
}

function StoryPreview({ story }) {
  const media = story.media_type === "image" ? mediaUri(story.media_url) : null;
  if (media) return <Image source={{ uri: media }} style={StyleSheet.absoluteFill} contentFit="cover" />;
  return <StoryBackground backgroundKey={story.background} style={[StyleSheet.absoluteFill, styles.textStory]}>
    <Text style={styles.previewText} numberOfLines={4}>{story.body}</Text>
  </StoryBackground>;
}

// Faixa de stories no topo do feed, como no site: "Criar story" e um cartão por pessoa.
export function StoriesBar() {
  const { user } = useSession();
  const [groups, setGroups] = useState([]);
  useFocusEffect(useCallback(() => {
    api("/stories").then(result => setGroups(groupStories(result.stories, user?.id))).catch(() => {});
  }, [user?.id]));

  const open = index => {
    remember("stories", groups);
    router.push({ pathname: "/story/[index]", params: { index } });
  };

  return <FlatList
    horizontal
    showsHorizontalScrollIndicator={false}
    data={groups}
    keyExtractor={item => String(item.user.user_id)}
    contentContainerStyle={styles.list}
    ListHeaderComponent={<Pressable style={styles.card} onPress={() => router.push("/story/new")} accessibilityLabel="Criar story">
      <View style={styles.createTop}><Avatar user={user} size={52} /></View>
      <View style={styles.createPlus}><Ionicons name="add" size={20} color="#fff" /></View>
      <Text style={styles.createText}>Criar story</Text>
    </Pressable>}
    renderItem={({ item, index }) => {
      const latest = item.items[item.items.length - 1];
      return <Pressable style={styles.card} onPress={() => open(index)} accessibilityLabel={`Stories de ${item.user.display_name}`}>
        <StoryPreview story={latest} />
        <View style={styles.shade} />
        <View style={styles.ring}><Avatar user={item.user} size={34} /></View>
        <Text style={styles.name} numberOfLines={2}>{item.user.user_id === user?.id ? "O teu story" : item.user.display_name}</Text>
      </Pressable>;
    }}
  />;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  card: { width: 104, height: 168, borderRadius: 14, overflow: "hidden", backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  createTop: { height: 112, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  createPlus: { position: "absolute", top: 98, alignSelf: "center", width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.surface, alignItems: "center", justifyContent: "center" },
  createText: { marginTop: 22, textAlign: "center", color: colors.text, fontSize: 13, fontWeight: "700" },
  textStory: { alignItems: "center", justifyContent: "center", padding: 8 },
  previewText: { color: "#fff", fontSize: 12, fontWeight: "800", textAlign: "center" },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.18)" },
  ring: { position: "absolute", top: 8, left: 8, borderWidth: 3, borderColor: colors.accent, borderRadius: 22 },
  name: { position: "absolute", left: 8, right: 8, bottom: 8, color: "#fff", fontSize: 12, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }
});
