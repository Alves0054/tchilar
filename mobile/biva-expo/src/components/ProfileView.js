import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { WEB_URL, api, mediaUri } from "../lib/api";
import { remember } from "../lib/store";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";
import { REPORT_REASONS, useOptions } from "./OptionsSheet";
import { PostCard } from "./PostCard";

const TABS = [["posts", "Publicações"], ["media", "Fotos e vídeos"], ["about", "Sobre"]];

// Perfil como no site: capa, foto, números, ações (amizade, seguir, mensagem), separadores e amigos.
export function ProfileView({ username, own = false }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState(null);
  const [friends, setFriends] = useState(null);
  const [tab, setTab] = useState("posts");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [options, choose] = useOptions();

  const load = useCallback(async () => {
    try {
      const [person, list, people] = await Promise.all([
        api(`/users/${encodeURIComponent(username)}`),
        api(`/posts?username=${encodeURIComponent(username)}`),
        api(`/users/${encodeURIComponent(username)}/friends`).catch(() => null)
      ]);
      setProfile(person.user);
      setPosts(list.posts);
      setFriends(people);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [username]);
  useEffect(() => { load(); }, [load]);

  const act = async (key, task) => {
    setBusy(key);
    try { await task(); await load(); } catch (actError) { Alert.alert("Tchilar", actError.message); } finally { setBusy(""); }
  };
  const more = async () => {
    const key = await choose(`@${profile.username}`, [
      { key: "share", label: "Partilhar perfil", icon: "share-outline" },
      { key: "report", label: "Denunciar", icon: "flag-outline", danger: true },
      { key: "block", label: profile.is_blocked ? "Desbloquear" : "Bloquear", icon: "ban-outline", danger: true }
    ]);
    if (key === "report") {
      const reason = await choose("Porque estás a denunciar?", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
      if (reason) act("report", () => api("/reports", { method: "POST", body: { targetType: "user", targetId: profile.id, reason } }).then(() => Alert.alert("Obrigado", "A equipa de moderação vai analisar.")));
    }
    if (key === "block") act("block", () => api(`/users/${profile.id}/block`, { method: profile.is_blocked ? "DELETE" : "POST" }));
    if (key === "share") Share.share({ message: `${profile.display_name} no Tchilar: ${WEB_URL}/u/${profile.username}` }).catch(() => {});
  };

  if (!profile) return error ? <Text style={styles.state}>{error}</Text> : <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
  const cover = mediaUri(profile.cover_url);
  const media = (posts || []).filter(post => post.media_url && ["image", "video"].includes(post.media_type));
  const friendLabel = profile.is_friend ? "Amigos" : profile.friend_request_sent ? "Pedido enviado" : "Adicionar";

  const header = <View>
    <View style={styles.header}>
      {cover ? <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" /> : <View style={[styles.cover, styles.coverEmpty]} />}
      <View style={styles.avatarWrap}>
        <Avatar user={profile} size={100} />
        {profile.online && <View style={styles.onlineDot} />}
      </View>
      <Text style={styles.name}>{profile.display_name}{profile.is_verified ? " ✓" : ""}</Text>
      <Text style={styles.username}>@{profile.username}{profile.is_creator ? " · Criador" : ""}{profile.online ? " · Online agora" : ""}</Text>
      {Boolean(profile.bio) && <Text style={styles.bio}>{profile.bio}</Text>}
      <View style={styles.stats}>
        {[["Publicações", profile.posts], ["Amigos", profile.friends], ["Seguidores", profile.followers], ["A seguir", profile.following]].map(([label, value]) =>
          <View key={label} style={styles.stat}><Text style={styles.statValue}>{Number(value || 0)}</Text><Text style={styles.statLabel}>{label}</Text></View>)}
      </View>
      {own ? <View style={styles.actions}>
        <Pressable style={styles.button} onPress={() => router.push("/settings/perfil")}><Ionicons name="pencil" size={16} color="#fff" /><Text style={styles.buttonText}>Editar perfil</Text></Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push("/story/new")}><Ionicons name="add-circle" size={16} color={colors.primary} /><Text style={[styles.buttonText, styles.secondaryText]}>Story</Text></Pressable>
      </View> : <View style={styles.actions}>
        <Pressable style={[styles.button, (profile.is_friend || profile.friend_request_sent) && styles.secondary]} disabled={Boolean(busy) || profile.is_friend || profile.friend_request_sent}
          onPress={() => act("friend", () => api(`/friends/${profile.id}/request`, { method: "POST" }))}>
          <Ionicons name={profile.is_friend ? "people" : "person-add"} size={16} color={profile.is_friend || profile.friend_request_sent ? colors.primary : "#fff"} />
          <Text style={[styles.buttonText, (profile.is_friend || profile.friend_request_sent) && styles.secondaryText]}>{friendLabel}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} disabled={Boolean(busy)} onPress={() => act("follow", () => api(`/users/${profile.id}/follow`, { method: "POST" }))}>
          <Text style={[styles.buttonText, styles.secondaryText]}>{profile.is_following ? "A seguir" : "Seguir"}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: profile.id, name: profile.display_name } })}>
          <Ionicons name="chatbubble" size={16} color={colors.primary} />
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={more} accessibilityLabel="Mais opções">
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.primary} />
        </Pressable>
      </View>}
    </View>
    <View style={styles.tabs}>{TABS.map(([key, label]) => <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
      <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
    </Pressable>)}</View>
    {tab === "media" && <View style={styles.grid}>
      {media.length === 0 ? <Text style={styles.state}>Ainda não há fotos nem vídeos.</Text> : media.map(post => <Pressable key={post.id} style={styles.cell}
        onPress={() => { remember(`post:${post.id}`, post); router.push(`/post/${post.id}`); }}>
        {post.media_type === "image" ? <Image source={{ uri: mediaUri(post.media_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <View style={[StyleSheet.absoluteFill, styles.videoCell]}><Ionicons name="play" size={28} color="#fff" /></View>}
      </Pressable>)}
    </View>}
    {tab === "about" && <View style={styles.about}>
      {[["briefcase", profile.profession], ["location", profile.location], ["globe", profile.website], ["calendar", profile.created_at && `No Tchilar desde ${new Date(profile.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}`]]
        .filter(([, value]) => value).map(([icon, value]) => <View key={icon} style={styles.aboutRow}>
          <Ionicons name={icon} size={18} color={colors.muted} />
          <Text style={[styles.aboutText, icon === "globe" && { color: colors.primary }]} onPress={icon === "globe" && /^https?:\/\//.test(value) ? () => Linking.openURL(value) : undefined}>{value}</Text>
        </View>)}
      {friends?.friends?.length > 0 && <>
        <Text style={styles.section}>Amigos · {friends.total}{friends.mutual ? ` (${friends.mutual} em comum)` : ""}</Text>
        <View style={styles.friends}>{friends.friends.map(person => <Pressable key={person.username} style={styles.friend} onPress={() => router.push(`/u/${person.username}`)}>
          <Avatar user={person} size={56} /><Text style={styles.friendName} numberOfLines={1}>{person.display_name}</Text>
        </Pressable>)}</View>
      </>}
    </View>}
  </View>;

  return <>
    {!own && <Stack.Screen options={{ title: profile.display_name }} />}
    <FlatList contentInsetAdjustmentBehavior="automatic"
      data={tab === "posts" ? posts || [] : []}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListEmptyComponent={tab === "posts" ? (posts === null ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.state}>Ainda não há publicações.</Text>) : null}
    />
    {options}
  </>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingBottom: 14, alignItems: "center" },
  cover: { width: "100%", height: 160 },
  coverEmpty: { backgroundColor: colors.primary },
  avatarWrap: { marginTop: -50, borderWidth: 4, borderColor: colors.surface, borderRadius: 56 },
  onlineDot: { position: "absolute", right: 6, bottom: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: "#2EAA6B", borderWidth: 3, borderColor: colors.surface },
  name: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: 8 },
  username: { color: colors.muted, fontSize: 14, marginTop: 2 },
  bio: { color: colors.text, fontSize: 15, textAlign: "center", paddingHorizontal: 24, marginTop: 10, lineHeight: 21 },
  stats: { flexDirection: "row", gap: 22, marginTop: 14 },
  stat: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 14 },
  button: { flexDirection: "row", gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  secondary: { backgroundColor: colors.primarySoft },
  secondaryText: { color: colors.primary },
  tabs: { flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line, marginBottom: 8 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 3, borderColor: "transparent" },
  tabActive: { borderColor: colors.primary },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextActive: { color: colors.primary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  cell: { width: "33%", aspectRatio: 1, backgroundColor: colors.primarySoft },
  videoCell: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  about: { backgroundColor: colors.surface, padding: 14, gap: 12 },
  aboutRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  aboutText: { color: colors.text, fontSize: 15, flex: 1 },
  section: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 6 },
  friends: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  friend: { width: 72, alignItems: "center", gap: 4 },
  friendName: { color: colors.text, fontSize: 12, textAlign: "center" },
  state: { padding: 32, textAlign: "center", color: colors.muted, width: "100%" }
});
