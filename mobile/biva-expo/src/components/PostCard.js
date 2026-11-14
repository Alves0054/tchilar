import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { WEB_URL, api, mediaUri } from "../lib/api";
import { useSession } from "../lib/session";
import { remember } from "../lib/store";
import { colors, relativeTime } from "../lib/theme";
import { Avatar } from "./Avatar";
import { TextWithTags } from "./TextWithTags";
import { REPORT_REASONS, useOptions } from "./OptionsSheet";
import { usePrompt } from "./usePrompt";
import { VideoPost } from "./VideoPost";

// Uma publicação do feed. O gosto muda logo no ecrã e volta atrás se a API recusar.
export function PostCard({ post, showCommentButton = true, onRemoved }) {
  const { user } = useSession();
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [likes, setLikes] = useState(Number(post.likes || 0));
  const [shares, setShares] = useState(Number(post.shares || 0));
  const [stars, setStars] = useState(Number(post.stars || 0));
  const [removed, setRemoved] = useState(false);
  const [options, choose] = useOptions();
  const [editor, ask] = usePrompt();
  const [body, setBody] = useState(post.body || "");
  const [edited, setEdited] = useState(Boolean(post.edited_at));
  const mine = user?.id === post.user_id;
  const media = mediaUri(post.media_url);

  const toggleLike = async () => {
    const before = { liked, likes };
    setLiked(!liked);
    setLikes(likes + (liked ? -1 : 1));
    try {
      const result = await api(`/posts/${post.id}/like`, { method: "POST" });
      setLiked(result.liked);
      setLikes(Number(result.likes));
    } catch {
      setLiked(before.liked);
      setLikes(before.likes);
    }
  };

  // Partilhar: no próprio perfil do Tchilar (com comentário opcional) ou para outra app (WhatsApp, SMS...).
  const share = async () => {
    const key = await choose("Partilhar", [
      { key: "profile", label: "Partilhar no meu perfil", icon: "repeat" },
      { key: "external", label: "Enviar para outra app", icon: "share-outline" }
    ]);
    if (key === "profile") {
      try { await api(`/posts/${post.id}/share`, { method: "POST", body: { profile: true, body: "" } }); setShares(value => value + 1); Alert.alert("Tchilar", "Partilhado no teu perfil."); }
      catch (error) { Alert.alert("Tchilar", error.message); }
    }
    if (key === "external") Share.share({ message: `${post.display_name} no Tchilar: ${post.body ? `${post.body.slice(0, 120)} ` : ""}${WEB_URL}/u/${post.username}` }).catch(() => {});
  };
  // Estrelas: oferecer ao autor (sai do teu saldo; podes comprar mais em Estrelas).
  const giveStars = async () => {
    const amount = await choose(`Oferecer estrelas a ${post.display_name}`, [1, 5, 10, 50, 100].map(value => ({ key: String(value), label: `★ ${value} ${value === 1 ? "estrela" : "estrelas"}`, icon: "star" })));
    if (!amount) return;
    try {
      const result = await api(`/posts/${post.id}/stars`, { method: "POST", body: { amount: Number(amount) } });
      setStars(result.stars);
      Alert.alert("Obrigado!", `Ofereceste ${amount} ★. Ficaste com ${result.balance}.`);
    } catch (error) {
      Alert.alert("Estrelas", error.message, error.status === 402 ? [{ text: "Fechar" }, { text: "Comprar estrelas", onPress: () => router.push("/stars") }] : undefined);
    }
  };
  const more = async () => {
    const key = await choose(null, mine
      ? [{ key: "edit", label: "Editar publicação", icon: "create-outline" }, { key: "delete", label: "Apagar publicação", icon: "trash-outline", danger: true }]
      : [{ key: "profile", label: `Ver perfil de ${post.display_name}`, icon: "person-outline" }, { key: "report", label: "Denunciar publicação", icon: "flag-outline", danger: true }]);
    if (key === "profile") router.push(`/u/${post.username}`);
    if (key === "edit") {
      const next = await ask({ title: "Editar publicação", initial: body, placeholder: "Escreve a publicação", confirmLabel: "Guardar", optional: Boolean(post.media_url) });
      if (next === null || next === body) return;
      try {
        const result = await api(`/posts/${post.id}`, { method: "PATCH", body: { body: next } });
        setBody(result.post.body); setEdited(true);
      } catch (error) { Alert.alert("Tchilar", error.message); }
    }
    if (key === "delete") Alert.alert("Apagar publicação", "Não pode ser desfeito.", [{ text: "Cancelar", style: "cancel" }, { text: "Apagar", style: "destructive", onPress: async () => {
      try { await api(`/posts/${post.id}`, { method: "DELETE" }); setRemoved(true); onRemoved?.(post.id); } catch (error) { Alert.alert("Tchilar", error.message); }
    } }]);
    if (key === "report") {
      const reason = await choose("Porque estás a denunciar?", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
      if (reason) api("/reports", { method: "POST", body: { targetType: "post", targetId: post.id, reason } })
        .then(() => Alert.alert("Obrigado", "A equipa de moderação vai analisar.")).catch(error => Alert.alert("Tchilar", error.message));
    }
  };

  if (removed) return null;
  return <View style={styles.card}>
    <View style={styles.head}>
      <Pressable style={styles.headLink} onPress={() => router.push(`/u/${post.username}`)}>
        <Avatar user={post} size={42} />
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>{post.display_name}{post.is_verified ? " ✓" : ""}</Text>
          <Text style={styles.meta}>@{post.username} · {relativeTime(post.created_at)}{post.group_name ? ` · ${post.group_name}` : ""}{post.is_exclusive ? " · 🔒 Exclusivo" : ""}{edited ? " · editado" : ""}</Text>
        </View>
      </Pressable>
      <Pressable onPress={more} hitSlop={10} accessibilityLabel="Mais opções"><Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} /></Pressable>
    </View>
    {Boolean(body) && <TextWithTags style={styles.body} text={body} />}
    {media && post.media_type === "image" && <Image source={{ uri: media }} style={styles.media} contentFit="cover" transition={200} />}
    {media && post.media_type === "video" && <VideoPost uri={media} style={styles.media} edit={post.video_edit} music={post.music} />}
    {post.shared && !post.shared.unavailable && <View style={styles.shared}>
      <Text style={styles.sharedName}>{post.shared.display_name}</Text>
      {Boolean(post.shared.body) && <TextWithTags style={styles.body} numberOfLines={4} text={post.shared.body} />}
    </View>}
    <View style={styles.actions}>
      <Pressable style={styles.action} onPress={toggleLike} accessibilityRole="button" accessibilityLabel={liked ? "Retirar gosto" : "Gostar"}>
        <Ionicons name={liked ? "heart" : "heart-outline"} size={22} color={liked ? colors.accent : colors.muted} />
        <Text style={styles.actionText}>{likes}</Text>
      </Pressable>
      <Pressable style={styles.action} disabled={!showCommentButton} accessibilityRole="button" accessibilityLabel="Comentários"
        onPress={() => { remember(`post:${post.id}`, post); router.push(`/post/${post.id}`); }}>
        <Ionicons name="chatbubble-outline" size={20} color={colors.muted} />
        <Text style={styles.actionText}>{Number(post.comments || 0)}</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={share} accessibilityRole="button" accessibilityLabel="Partilhar">
        <Ionicons name="arrow-redo-outline" size={21} color={colors.muted} />
        <Text style={styles.actionText}>{shares}</Text>
      </Pressable>
      {!mine && <Pressable style={styles.action} onPress={giveStars} accessibilityRole="button" accessibilityLabel="Oferecer estrelas">
        <Ionicons name="star-outline" size={20} color="#E8A600" />
        <Text style={styles.actionText}>{stars}</Text>
      </Pressable>}
    </View>
    {options}
    {editor}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, marginBottom: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  headLink: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headText: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 1 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, paddingHorizontal: 14, marginTop: 10 },
  media: { width: "100%", aspectRatio: 1, marginTop: 10, backgroundColor: colors.primarySoft },
  shared: { marginHorizontal: 14, marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  sharedName: { color: colors.text, fontWeight: "700", paddingHorizontal: 14 },
  actions: { flexDirection: "row", gap: 26, paddingHorizontal: 14, paddingTop: 12 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  actionText: { color: colors.muted, fontSize: 14, fontWeight: "600" }
});
