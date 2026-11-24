import { Ionicons } from "@expo/vector-icons";
import { useProtectScreen } from "../../../../lib/protect";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../../../../components/Avatar";
import { REPORT_REASONS, useOptions } from "../../../../components/OptionsSheet";
import { PostCard } from "../../../../components/PostCard";
import { PostSkeleton } from "../../../../components/Loaders";
import { api } from "../../../../lib/api";
import { useSession } from "../../../../lib/session";
import { recall } from "../../../../lib/store";
import { colors, relativeTime } from "../../../../lib/theme";
import { useKeyboardOverlap } from "../../../../lib/keyboard";
import { fontSize } from "../../../../lib/display";

// Publicação com os comentários e a caixa para comentar.
export default function PostComments() {
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();
  const { id } = useLocalSearchParams();
  // Vinda do feed, a publicação já está em memória; vinda de uma notificação ou de um link, carrega-se pelo id.
  const [post, setPost] = useState(() => recall(`post:${id}`));
  // Publicação de um grupo secreto: sem capturas nem gravações de ecrã.
  useProtectScreen(Boolean(post?.group_is_secret), `post-${id}`);
  const [postError, setPostError] = useState("");
  useEffect(() => {
    api(`/posts/${id}`).then(result => setPost(result.post)).catch(loadError => { if (!recall(`post:${id}`)) setPostError(loadError.message); });
  }, [id]);
  const { user } = useSession();
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [options, choose] = useOptions();

  useEffect(() => {
    api(`/posts/${id}/comments`).then(result => setComments(result.comments)).catch(loadError => setError(loadError.message));
  }, [id]);

  // Toque longo num comentário: quem o escreveu ou o autor da publicação pode apagá-lo (como no site);
  // num comentário de outra pessoa, denunciá-lo.
  const remove = async comment => {
    const mine = comment.user_id === user?.id || post?.user_id === user?.id;
    if (!mine) {
      const reason = await choose("Denunciar comentário", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
      if (reason) api("/reports", { method: "POST", body: { targetType: "comment", targetId: comment.id, reason } })
        .then(() => Alert.alert("Obrigado", "A equipa de moderação vai analisar.")).catch(error => Alert.alert("Tchilar", error.message));
      return;
    }
    Alert.alert("Apagar comentário?", "Não pode ser desfeito.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Apagar", style: "destructive", onPress: async () => {
        try {
          await api(`/comments/${comment.id}`, { method: "DELETE" });
          setComments(current => current.filter(item => item.id !== comment.id));
        } catch (deleteError) { Alert.alert("Tchilar", deleteError.message); }
      } }
    ]);
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    try {
      await api(`/posts/${id}/comments`, { method: "POST", body: { body } });
      setText("");
      setComments((await api(`/posts/${id}/comments`)).comments);
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };

  return <SafeAreaView style={styles.screen} edges={["bottom"]}>
    {/* A caixa de escrever fica sempre por cima do teclado (mede quanto o teclado tapa). */}
    <View ref={keyboardRef} style={[styles.screen, { paddingBottom: keyboardOverlap }]}>
      <FlatList contentInsetAdjustmentBehavior="automatic"
        data={comments || []}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={<>
          {post && <PostCard post={post} showCommentButton={false} />}
          {!post && !postError && <PostSkeleton />}
          {postError ? <View style={styles.missing}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.muted} />
            <Text style={styles.missingTitle}>Publicação indisponível</Text>
            <Text style={styles.empty}>{postError}</Text>
          </View> : null}
          <Text style={styles.section}>Comentários</Text>
        </>}
        renderItem={({ item }) => <View style={styles.comment}>
          <Pressable onPress={() => router.push(`/u/${item.username}`)}><Avatar user={item} size={36} /></Pressable>
          <Pressable style={styles.bubbleWrap} onLongPress={() => remove(item)} delayLongPress={350}>
            <View style={styles.bubble}>
              <Text style={styles.name}>{item.display_name}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
            <Text style={styles.time}>{relativeTime(item.created_at)}{(item.user_id === user?.id || post?.user_id === user?.id) ? " · toca e mantém para apagar" : " · toca e mantém para denunciar"}</Text>
          </Pressable>
        </View>}
        ListEmptyComponent={comments === null && !error ? <ActivityIndicator color={colors.primary} />
          : <Text style={styles.empty}>{error || "Sê a primeira pessoa a comentar."}</Text>}
      />
      <View style={styles.composer}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Escreve um comentário" placeholderTextColor={colors.muted} multiline maxLength={2000} />
        <Pressable style={[styles.send, (!text.trim() || busy) && { opacity: 0.4 }]} onPress={send} disabled={!text.trim() || busy} accessibilityLabel="Comentar">
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
    {options}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  missing: { alignItems: "center", gap: 6, padding: 28 },
  missingTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  screen: { flex: 1, backgroundColor: colors.background },
  section: { color: colors.text, fontSize: 16, fontWeight: "800", paddingHorizontal: 14, paddingVertical: 8 },
  comment: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 6 },
  bubbleWrap: { flex: 1 },
  bubble: { alignSelf: "flex-start", backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  name: { color: colors.text, fontWeight: "800", fontSize: 14 },
  body: { color: colors.text, fontSize: fontSize(15), lineHeight: fontSize(20) },
  time: { color: colors.muted, fontSize: 12, marginLeft: 12, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", padding: 24 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.background, color: colors.text, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }
});
