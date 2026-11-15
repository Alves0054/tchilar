// Perfil como no site: capa e foto (com troca direta no próprio perfil), nome, função, localidade e site,
// números, ações (seguir, amizade, mensagem, mais opções), subscrição dos criadores, amigos, atividade,
// maiores apoiantes e os separadores Publicações / Fotos e vídeos / Sobre. As publicações carregam mais ao descer.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { WEB_URL, api, mediaUri, upload } from "../lib/api";
import { useSession } from "../lib/session";
import { remember } from "../lib/store";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";
import { REPORT_REASONS, useOptions } from "./OptionsSheet";
import { CoverPositioner } from "./CoverPositioner";
import { PhotoEditor } from "./PhotoEditor";
import { PostCard } from "./PostCard";

const TABS = [["posts", "Publicações"], ["media", "Fotos e vídeos"], ["about", "Sobre"]];
const count = value => Number(value || 0).toLocaleString("pt-PT");
const kz = value => `${Number(value || 0).toLocaleString("pt-PT", { maximumFractionDigits: 2 })} Kz`;
const longDate = value => value ? new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : "";
const sinceDate = value => value ? new Date(value).toLocaleDateString("pt-PT", { month: "long", year: "numeric" }) : "";

// Link do site da pessoa: só abre http(s) e mostra o domínio.
function websiteLabel(href) {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { href: url.href, label: (url.hostname.replace(/^www\./, "") + url.pathname).replace(/\/$/, "") };
  } catch {
    return null;
  }
}

export function ProfileView({ username, own = false }) {
  const { refresh: refreshSession } = useSession();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [media, setMedia] = useState(null);
  const [friends, setFriends] = useState(null);
  const [supporters, setSupporters] = useState([]);
  const [tab, setTab] = useState("posts");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [options, choose] = useOptions();
  const [avatarDraft, setAvatarDraft] = useState(null);   // foto escolhida, à espera do editor
  const [coverDraft, setCoverDraft] = useState(null);     // capa escolhida (ou a atual), à espera da posição
  const loadingMore = useRef(false);

  const load = useCallback(async () => {
    try {
      const [person, list, people, top] = await Promise.all([
        api(`/users/${encodeURIComponent(username)}`),
        api(`/posts?username=${encodeURIComponent(username)}`),
        api(`/users/${encodeURIComponent(username)}/friends`).catch(() => null),
        api(`/users/${encodeURIComponent(username)}/supporters`).catch(() => ({ supporters: [] }))
      ]);
      setProfile(person.user);
      setPosts(list.posts);
      setCursor(list.nextCursor);
      setFriends(people);
      setSupporters(top.supporters || []);
      setMedia(null);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [username]);
  useEffect(() => { if (!own) load(); }, [own, load]);
  // Ao voltar de publicar ou de editar o perfil, o que mudou aparece logo.
  useFocusEffect(useCallback(() => { if (own) load(); }, [own, load]));

  // Fotos e vídeos: lista própria (todas as publicações com imagem ou vídeo, não só as já carregadas).
  useEffect(() => {
    if (tab !== "media" || media) return;
    api(`/posts?username=${encodeURIComponent(username)}&mediaType=media`).then(result => setMedia(result.posts)).catch(() => setMedia([]));
  }, [tab, media, username]);

  const loadMore = async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const result = await api(`/posts?username=${encodeURIComponent(username)}&before=${cursor}`);
      setPosts(current => [...(current || []), ...result.posts]);
      setCursor(result.nextCursor);
    } catch { /* tenta outra vez ao descer */ } finally { loadingMore.current = false; }
  };

  const act = async (key, task, done) => {
    setBusy(key);
    try { await task(); await load(); if (done) Alert.alert("Tchilar", done); } catch (actError) { Alert.alert("Tchilar", actError.message); } finally { setBusy(""); }
  };

  // ----- Foto de perfil e capa (só no próprio perfil) -----
  const changePhoto = async kind => {
    const current = kind === "avatar" ? profile.avatar_url : profile.cover_url;
    const key = await choose(kind === "avatar" ? "Foto de perfil" : "Capa", [
      { key: "library", label: "Escolher da galeria", icon: "images-outline" },
      { key: "camera", label: "Tirar foto", icon: "camera-outline" },
      ...(kind === "cover" && current ? [{ key: "position", label: "Ajustar a posição", icon: "move-outline" }] : []),
      ...(current ? [{ key: "remove", label: kind === "avatar" ? "Remover foto" : "Remover capa", icon: "trash-outline", danger: true }] : [])
    ]);
    if (!key) return;
    if (key === "remove") return act(kind, () => api(`/auth/me/${kind}`, { method: "DELETE" }).then(refreshSession));
    if (key === "position") return setCoverDraft({ uri: mediaUri(profile.cover_url), existing: true });
    const permission = key === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Tchilar", "Permite o acesso nas definições do telemóvel.");
    // Foto de perfil: recorte quadrado do sistema e depois efeitos e ajustes (editor do Tchilar).
    // Capa: a foto inteira e depois escolher que parte aparece (como no site).
    const pickerOptions = { mediaTypes: ["images"], quality: 0.9, allowsEditing: kind === "avatar", aspect: [1, 1] };
    const result = key === "camera" ? await ImagePicker.launchCameraAsync(pickerOptions) : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled) return;
    if (kind === "avatar") setAvatarDraft(result.assets[0]);
    else setCoverDraft({ asset: result.assets[0], uri: result.assets[0].uri });
  };
  const saveAvatar = edited => { setAvatarDraft(null); act("avatar", () => upload("/auth/me/avatar", {}, edited, "image").then(refreshSession)); };
  const saveCover = position => {
    const draft = coverDraft;
    setCoverDraft(null);
    act("cover", () => (draft.existing
      ? api("/auth/me/cover-position", { method: "PATCH", body: { position } })
      : upload("/auth/me/cover", { position: String(position) }, draft.asset, "image")).then(refreshSession));
  };

  // ----- Subscrição (criadores) -----
  const subscribe = () => act("subscription", async () => {
    const result = await api(`/subscriptions/${profile.id}`, { method: "POST" });
    if (result.checkoutUrl) await Linking.openURL(result.checkoutUrl);
    else if (result.message) Alert.alert("Tchilar", result.message);
  });
  const cancelSubscription = () => Alert.alert("Cancelar renovação?", "Manténs o acesso até ao fim do período pago.", [
    { text: "Voltar", style: "cancel" },
    { text: "Cancelar renovação", style: "destructive", onPress: () => act("subscription", () => api(`/subscriptions/${profile.id}`, { method: "DELETE" })) }
  ]);

  const more = async () => {
    const key = await choose(`@${profile.username}`, [
      { key: "share", label: "Partilhar perfil", icon: "share-outline" },
      { key: "copy", label: "Abrir no site", icon: "open-outline" },
      { key: "report", label: "Denunciar conta", icon: "flag-outline", danger: true },
      { key: "block", label: profile.is_blocked ? "Desbloquear" : "Bloquear", icon: "ban-outline", danger: true }
    ]);
    if (key === "report") {
      const reason = await choose("Porque estás a denunciar?", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
      if (reason) act("report", () => api("/reports", { method: "POST", body: { targetType: "user", targetId: profile.id, reason } }), "Obrigado. A equipa de moderação vai analisar.");
    }
    if (key === "block") {
      if (profile.is_blocked) act("block", () => api(`/users/${profile.id}/block`, { method: "DELETE" }));
      else Alert.alert(`Bloquear @${profile.username}?`, "Deixam de ver as publicações um do outro e de trocar mensagens.", [
        { text: "Cancelar", style: "cancel" },
        { text: "Bloquear", style: "destructive", onPress: () => act("block", () => api(`/users/${profile.id}/block`, { method: "POST" })) }
      ]);
    }
    if (key === "share") Share.share({ message: `${profile.display_name} no Tchilar: ${WEB_URL}/u/${profile.username}` }).catch(() => {});
    if (key === "copy") Linking.openURL(`${WEB_URL}/u/${profile.username}`).catch(() => {});
  };
  const shareOwn = () => Share.share({ message: `Segue-me no Tchilar: ${WEB_URL}/u/${profile.username}` }).catch(() => {});

  if (!profile) return error ? <Text style={styles.state}>{error}</Text> : <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
  const cover = mediaUri(profile.cover_url);
  const site = profile.website ? websiteLabel(profile.website) : null;
  const isCreatorWithPrice = profile.is_creator && Number(profile.subscription_price) > 0;

  // ----- Partes do cabeçalho -----
  const identity = <View style={styles.header}>
    <View>
      {cover ? <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" contentPosition={{ top: `${profile.cover_position ?? 50}%` }} />
        : <View style={[styles.cover, styles.coverEmpty]}>
          <Text style={styles.coverKicker}>TCHILAR · ESPAÇO DE CRIAÇÃO</Text>
          <Text style={styles.coverMessage}>Histórias que <Text style={{ color: colors.accent }}>nos aproximam.</Text></Text>
        </View>}
      {own && <Pressable style={styles.coverButton} onPress={() => changePhoto("cover")} accessibilityLabel="Mudar a capa">
        {busy === "cover" ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="camera" size={18} color="#fff" />}
        <Text style={styles.coverButtonText}>{profile.cover_url ? "Capa" : "Adicionar capa"}</Text>
      </Pressable>}
    </View>
    <View style={styles.avatarWrap}>
      <Avatar user={profile} size={104} />
      {profile.online && <View style={styles.onlineDot} />}
      {own && <Pressable style={styles.avatarButton} onPress={() => changePhoto("avatar")} accessibilityLabel="Mudar a foto de perfil">
        {busy === "avatar" ? <ActivityIndicator color={colors.text} size="small" /> : <Ionicons name="camera" size={17} color={colors.text} />}
      </Pressable>}
    </View>
    <View style={styles.nameRow}>
      <Text style={styles.name}>{profile.display_name}</Text>
      {profile.is_verified && <Ionicons name="checkmark-circle" size={20} color="#0A84FF" accessibilityLabel="Verificado" />}
    </View>
    <View style={styles.chips}>
      <Text style={styles.username}>@{profile.username}</Text>
      {profile.is_creator && <View style={styles.chip}><Ionicons name="sparkles" size={12} color="#AF52DE" /><Text style={styles.chipText}>Criador</Text></View>}
      {profile.online && <View style={styles.chip}><View style={styles.chipDot} /><Text style={styles.chipText}>Online</Text></View>}
      {profile.is_friend && !own && <View style={styles.chip}><Ionicons name="people" size={12} color="#30B350" /><Text style={styles.chipText}>Amigos</Text></View>}
    </View>
    {Boolean(profile.bio) && <Text style={styles.bio}>{profile.bio}</Text>}
    <View style={styles.meta}>
      {Boolean(profile.profession) && <View style={styles.metaItem}><Ionicons name="briefcase-outline" size={14} color={colors.muted} /><Text style={styles.metaText}>{profile.profession}</Text></View>}
      {Boolean(profile.location) && <View style={styles.metaItem}><Ionicons name="location-outline" size={14} color={colors.muted} /><Text style={styles.metaText}>{profile.location}</Text></View>}
      {site && <Pressable style={styles.metaItem} onPress={() => Linking.openURL(site.href)}><Ionicons name="link-outline" size={14} color="#0A84FF" /><Text style={[styles.metaText, { color: "#0A84FF" }]} numberOfLines={1}>{site.label}</Text></Pressable>}
    </View>
    <View style={styles.stats}>
      {[["Publicações", profile.posts, () => setTab("posts")], ["Seguidores", profile.followers], ["A seguir", profile.following], ["Amigos", profile.friends, () => setTab("about")]].map(([label, value, onPress]) =>
        <Pressable key={label} style={styles.stat} onPress={onPress} disabled={!onPress}><Text style={styles.statValue}>{count(value)}</Text><Text style={styles.statLabel}>{label}</Text></Pressable>)}
    </View>

    {own ? <View style={styles.actions}>
      <Pressable style={[styles.button, { flex: 1 }]} onPress={() => router.push("/settings/perfil")}><Ionicons name="pencil" size={16} color="#fff" /><Text style={styles.buttonText}>Editar perfil</Text></Pressable>
      <Pressable style={[styles.button, styles.secondary, { flex: 1 }]} onPress={() => router.push("/creator")}><Ionicons name="stats-chart" size={16} color={colors.text} /><Text style={[styles.buttonText, styles.secondaryText]}>Painel</Text></Pressable>
      <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push("/story/new")} accessibilityLabel="Criar story"><Ionicons name="add-circle" size={18} color={colors.text} /></Pressable>
      <Pressable style={[styles.button, styles.secondary]} onPress={shareOwn} accessibilityLabel="Partilhar o meu perfil"><Ionicons name="share-outline" size={18} color={colors.text} /></Pressable>
    </View> : !profile.is_blocked && <View style={styles.actions}>
      <Pressable style={[styles.button, { flex: 1 }, profile.is_following && styles.secondary]} disabled={Boolean(busy)}
        onPress={() => act("follow", () => api(`/users/${profile.id}/follow`, { method: "POST" }))}>
        {busy === "follow" ? <ActivityIndicator color={profile.is_following ? colors.text : "#fff"} size="small" />
          : <Text style={[styles.buttonText, profile.is_following && styles.secondaryText]}>{profile.is_following ? "A seguir" : "Seguir"}</Text>}
      </Pressable>
      {profile.is_friend
        ? <Pressable style={[styles.button, styles.secondary, { flex: 1 }]} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: profile.id, name: profile.display_name } })}>
          <Ionicons name="chatbubble" size={16} color={colors.text} /><Text style={[styles.buttonText, styles.secondaryText]}>Mensagem</Text>
        </Pressable>
        : <Pressable style={[styles.button, styles.secondary, { flex: 1 }]} disabled={Boolean(busy) || profile.friend_request_sent}
          onPress={() => act("friend", () => api(`/friends/${profile.id}/request`, { method: "POST" }))}>
          <Ionicons name={profile.friend_request_sent ? "checkmark" : "person-add"} size={16} color={colors.text} />
          <Text style={[styles.buttonText, styles.secondaryText]}>{profile.friend_request_sent ? "Pedido enviado" : "Adicionar"}</Text>
        </Pressable>}
      {!profile.is_friend && <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: profile.id, name: profile.display_name } })} accessibilityLabel="Mensagem">
        <Ionicons name="chatbubble" size={17} color={colors.text} />
      </Pressable>}
      <Pressable style={[styles.button, styles.secondary]} onPress={more} accessibilityLabel="Mais opções"><Ionicons name="ellipsis-horizontal" size={18} color={colors.text} /></Pressable>
    </View>}

    {profile.is_blocked && <View style={styles.blocked}>
      <Ionicons name="ban" size={20} color={colors.danger} />
      <Text style={styles.blockedText}>Bloqueaste @{profile.username}. Não vês as publicações desta conta e não podem trocar mensagens.</Text>
      <Pressable style={[styles.button, styles.secondary]} onPress={() => act("block", () => api(`/users/${profile.id}/block`, { method: "DELETE" }))}><Text style={[styles.buttonText, styles.secondaryText]}>Desbloquear</Text></Pressable>
    </View>}

    {isCreatorWithPrice && !profile.is_blocked && <View style={styles.subscription}>
      <Ionicons name="sparkles" size={20} color="#AF52DE" />
      <Text style={styles.subscriptionText}>
        {own ? `A tua subscrição custa ${kz(profile.subscription_price)}/mês. As publicações exclusivas só são vistas por subscritores.`
          : profile.is_subscribed && profile.subscription_canceling ? `A tua subscrição termina a ${longDate(profile.subscription_period_end)} e não vai renovar.`
            : profile.is_subscribed ? `Subscrito · renova a ${longDate(profile.subscription_period_end)} (${kz(profile.subscription_price)}/mês).`
              : `Subscreve para veres as publicações exclusivas de ${profile.display_name}.`}
      </Text>
      {!own && <Pressable style={[styles.button, profile.is_subscribed && !profile.subscription_canceling && styles.secondary]} disabled={busy === "subscription"}
        onPress={profile.is_subscribed && !profile.subscription_canceling ? cancelSubscription : subscribe}>
        {busy === "subscription" ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[styles.buttonText, profile.is_subscribed && !profile.subscription_canceling && styles.secondaryText]}>
          {profile.is_subscribed && profile.subscription_canceling ? "Retomar" : profile.is_subscribed ? "Cancelar renovação" : `Subscrever · ${kz(profile.subscription_price)}`}
        </Text>}
      </Pressable>}
    </View>}
  </View>;

  const friendsStrip = friends?.friends?.length > 0 && <View style={styles.card}>
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle}>Amigos</Text>
      <Text style={styles.cardHint}>{count(friends.total)}{friends.mutual ? ` · ${friends.mutual} em comum` : ""}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
      {friends.friends.map(person => <Pressable key={person.username} style={styles.friend} onPress={() => router.push(`/u/${person.username}`)}>
        <Avatar user={person} size={58} /><Text style={styles.friendName} numberOfLines={2}>{person.display_name}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;

  const supportersCard = supporters.length > 0 && <View style={styles.card}>
    <View style={styles.cardHead}><Ionicons name="trophy" size={18} color="#E5A000" /><Text style={styles.cardTitle}>Maiores apoiantes</Text></View>
    {supporters.map((person, index) => <Pressable key={person.username} style={styles.supporter} onPress={() => router.push(`/u/${person.username}`)}>
      <Text style={[styles.rank, index === 0 && { color: "#E5A000" }]}>{index + 1}</Text>
      <Avatar user={person} size={34} />
      <Text style={styles.supporterName} numberOfLines={1}>{person.display_name}</Text>
      <Ionicons name="star" size={13} color="#E5A000" /><Text style={styles.supporterStars}>{count(person.stars)}</Text>
    </Pressable>)}
  </View>;

  const activity = <View style={styles.card}>
    <Text style={styles.cardTitle}>Atividade</Text>
    <View style={styles.activity}>
      {[["Publicações", profile.posts], ["Seguidores", profile.followers], ["A seguir", profile.following], ["Amigos", profile.friends],
        ["Gostos recebidos", profile.likes_received], ["Comentários recebidos", profile.comments_received],
        ...(profile.subscribers !== null && profile.subscribers !== undefined ? [["Subscritores ativos", profile.subscribers]] : [])]
        .map(([label, value]) => <View key={label} style={styles.activityItem}><Text style={styles.statValue}>{count(value)}</Text><Text style={styles.statLabel}>{label}</Text></View>)}
    </View>
  </View>;

  const tabs = <View style={styles.tabs}>{TABS.map(([key, label]) => <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
    <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
  </Pressable>)}</View>;

  const header = <View>
    {identity}
    {tabs}
    {tab === "posts" && <>
      {own && !profile.bio && <Pressable style={styles.card} onPress={() => router.push("/settings/perfil")}>
        <Text style={styles.cardTitle}>Completa o teu perfil</Text>
        <Text style={styles.cardHint}>Uma biografia e uma foto ajudam as pessoas a reconhecer-te. Toca para adicionar.</Text>
      </Pressable>}
      {friendsStrip}
      {supportersCard}
      {own && <Pressable style={styles.composer} onPress={() => router.push("/create")} accessibilityLabel="Criar publicação">
        <Avatar user={profile} size={40} />
        <Text style={styles.composerText}>Em que estás a pensar?</Text>
        <Ionicons name="images" size={22} color="#30B350" />
      </Pressable>}
    </>}
    {tab === "media" && (media === null ? <ActivityIndicator style={{ margin: 24 }} color={colors.primary} />
      : <View style={styles.grid}>
        {media.length === 0 ? <Text style={styles.state}>Ainda não há fotos nem vídeos.</Text> : media.map(post => <Pressable key={post.id} style={styles.cell}
          onPress={() => { remember(`post:${post.id}`, post); router.push(`/post/${post.id}`); }}>
          {post.media_type === "image" ? <Image source={{ uri: mediaUri(post.media_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            : <View style={[StyleSheet.absoluteFill, styles.videoCell]}><Ionicons name="play" size={28} color="#fff" /></View>}
        </Pressable>)}
      </View>)}
    {tab === "about" && <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sobre {profile.display_name}</Text>
        {[["person-outline", "Biografia", profile.bio || "Ainda não adicionou uma biografia."], ["at", "Nome de utilizador", `@${profile.username}`],
          profile.profession && ["briefcase-outline", "Profissão", profile.profession], profile.location && ["location-outline", "Localidade", profile.location],
          site && ["link-outline", "Site", site.label], ["calendar-outline", "No Tchilar desde", sinceDate(profile.created_at)]]
          .filter(Boolean).map(([icon, label, value]) => <Pressable key={label} style={styles.aboutRow} disabled={label !== "Site"} onPress={() => site && Linking.openURL(site.href)}>
            <View style={styles.aboutIcon}><Ionicons name={icon} size={18} color={colors.text} /></View>
            <View style={{ flex: 1 }}><Text style={styles.aboutLabel}>{label}</Text><Text style={[styles.aboutText, label === "Site" && { color: "#0A84FF" }]}>{value}</Text></View>
          </Pressable>)}
      </View>
      {activity}
      {friendsStrip}
      {supportersCard}
    </>}
  </View>;

  return <>
    {!own && <Stack.Screen options={{ title: profile.display_name }} />}
    <FlatList contentInsetAdjustmentBehavior="automatic"
      data={tab === "posts" && !profile.is_blocked ? posts || [] : []}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} onRemoved={() => setPosts(current => current.filter(post => post.id !== item.id))} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListFooterComponent={tab === "posts" && cursor ? <ActivityIndicator style={{ margin: 20 }} color={colors.primary} /> : null}
      ListEmptyComponent={tab === "posts" && !profile.is_blocked ? (posts === null ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.state}>Ainda não há publicações neste perfil.</Text>) : null}
    />
    {options}
    <PhotoEditor asset={avatarDraft} visible={Boolean(avatarDraft)} fixedCrop="1:1" title="Foto de perfil" onCancel={() => setAvatarDraft(null)} onDone={saveAvatar} />
    <CoverPositioner uri={coverDraft?.uri} visible={Boolean(coverDraft)} initial={coverDraft?.existing ? profile.cover_position ?? 50 : 50}
      onCancel={() => setCoverDraft(null)} onSave={saveCover} />
  </>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingBottom: 16, alignItems: "center" },
  cover: { width: "100%", aspectRatio: 2.6, minHeight: 140 },
  coverEmpty: { backgroundColor: colors.ink, justifyContent: "center", paddingHorizontal: 20, gap: 6 },
  coverKicker: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  coverMessage: { color: "#fff", fontSize: 22, fontWeight: "800" },
  coverButton: { position: "absolute", right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.55)" },
  coverButtonText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  avatarWrap: { marginTop: -52, borderWidth: 4, borderColor: colors.surface, borderRadius: 60 },
  avatarButton: { position: "absolute", right: 0, bottom: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, borderWidth: 3, borderColor: colors.surface, alignItems: "center", justifyContent: "center" },
  onlineDot: { position: "absolute", left: 6, bottom: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: "#30B350", borderWidth: 3, borderColor: colors.surface },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 16 },
  name: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 4 },
  username: { color: colors.muted, fontSize: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.background },
  chipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#30B350" },
  chipText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  bio: { color: colors.text, fontSize: 15, textAlign: "center", paddingHorizontal: 24, marginTop: 10, lineHeight: 21 },
  meta: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 8, paddingHorizontal: 16 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 220 },
  metaText: { color: colors.muted, fontSize: 13 },
  stats: { flexDirection: "row", gap: 20, marginTop: 14 },
  stat: { alignItems: "center" },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12, textAlign: "center" },
  actions: { flexDirection: "row", gap: 8, marginTop: 14, paddingHorizontal: 14, alignSelf: "stretch" },
  button: { flexDirection: "row", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  secondary: { backgroundColor: colors.primarySoft },
  secondaryText: { color: colors.text },
  blocked: { flexDirection: "row", alignItems: "center", gap: 10, margin: 14, marginBottom: 0, padding: 12, borderRadius: 14, backgroundColor: colors.dangerSoft, alignSelf: "stretch" },
  blockedText: { flex: 1, color: colors.text, fontSize: 13 },
  subscription: { flexDirection: "row", alignItems: "center", gap: 10, margin: 14, marginBottom: 0, padding: 12, borderRadius: 14, backgroundColor: colors.background, alignSelf: "stretch" },
  subscriptionText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 10, padding: 14, borderRadius: 16, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800", flex: 1 },
  cardHint: { color: colors.muted, fontSize: 13 },
  friend: { width: 70, alignItems: "center", gap: 4 },
  friendName: { color: colors.text, fontSize: 12, textAlign: "center" },
  supporter: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 18, color: colors.muted, fontWeight: "800", textAlign: "center" },
  supporterName: { flex: 1, color: colors.text, fontWeight: "700" },
  supporterStars: { color: colors.text, fontWeight: "800" },
  activity: { flexDirection: "row", flexWrap: "wrap", rowGap: 14 },
  activityItem: { width: "33%", alignItems: "center" },
  composer: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginTop: 10, marginBottom: 2, padding: 10, borderRadius: 16, backgroundColor: colors.surface },
  composerText: { flex: 1, color: colors.muted, fontSize: 15 },
  tabs: { flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 3, borderColor: "transparent" },
  tabActive: { borderColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextActive: { color: colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 8 },
  cell: { width: "33%", aspectRatio: 1, backgroundColor: colors.primarySoft },
  videoCell: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  aboutRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  aboutIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  aboutLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  aboutText: { color: colors.text, fontSize: 15 },
  state: { padding: 32, textAlign: "center", color: colors.muted, width: "100%" }
});
