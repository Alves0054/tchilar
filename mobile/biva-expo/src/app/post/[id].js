import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../../components/Avatar";
import { PostCard } from "../../components/PostCard";
import { api } from "../../lib/api";
import { recall } from "../../lib/store";
import { colors, relativeTime } from "../../lib/theme";

// Publicação com os comentários e a caixa para comentar.
export default function PostComments() {
  const { id } = useLocalSearchParams();
  const post = recall(`post:${id}`);
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/posts/${id}/comments`).then(result => setComments(result.comments)).catch(loadError => setError(loadError.message));
  }, [id]);

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
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <FlatList contentInsetAdjustmentBehavior="automatic"
        data={comments || []}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={<>
          {post && <PostCard post={post} showCommentButton={false} />}
          <Text style={styles.section}>Comentários</Text>
        </>}
        renderItem={({ item }) => <View style={styles.comment}>
          <Pressable onPress={() => router.push(`/u/${item.username}`)}><Avatar user={item} size={36} /></Pressable>
          <View style={styles.bubbleWrap}>
            <View style={styles.bubble}>
              <Text style={styles.name}>{item.display_name}</Text>
              <Text style={styles.body}>{item.body}</Text>
            </View>
            <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
          </View>
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
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  section: { color: colors.text, fontSize: 16, fontWeight: "800", paddingHorizontal: 14, paddingVertical: 8 },
  comment: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 6 },
  bubbleWrap: { flex: 1 },
  bubble: { alignSelf: "flex-start", backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%" },
  name: { color: colors.text, fontWeight: "800", fontSize: 14 },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  time: { color: colors.muted, fontSize: 12, marginLeft: 12, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", padding: 24 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.background, color: colors.text, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }
});
