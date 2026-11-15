import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useGlassHeaderPadding } from "../../lib/headers";
import { useSession } from "../../lib/session";
import { colors, relativeTime } from "../../lib/theme";
import { useKeyboardOverlap } from "../../lib/keyboard";
import { ChatSkeleton } from "../../components/Loaders";

// Conversa com uma pessoa. Pergunta por mensagens novas a cada 4 segundos enquanto está aberta.
export default function Chat() {
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();
  const { id, name } = useLocalSearchParams();
  const { user } = useSession();
  const [messages, setMessages] = useState(null);
  const [person, setPerson] = useState(null);
  const [canMessage, setCanMessage] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lastId = useRef(null);
  const top = useGlassHeaderPadding();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api(`/messages/${id}${lastId.current ? `?after=${lastId.current}` : ""}`);
        if (!active) return;
        setPerson(result.person);
        setCanMessage(result.canMessage);
        if (result.messages.length) lastId.current = result.messages[result.messages.length - 1].id;
        setMessages(current => {
          const known = new Set((current || []).map(item => item.id));
          return [...(current || []), ...result.messages.filter(item => !known.has(item.id))];
        });
      } catch (loadError) {
        if (active) setError(loadError.message);
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError("");
    try {
      const result = await api(`/messages/${id}`, { method: "POST", body: { body } });
      lastId.current = Math.max(lastId.current || 0, result.message.id);
      setMessages(current => [...(current || []), result.message]);
      setText("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  return <SafeAreaView style={[styles.safe, { paddingTop: top }]} edges={["bottom"]}>
    <Stack.Screen options={{
      title: person?.display_name || name || "Conversa",
      // Ligar a esta pessoa (voz ou vídeo); durante a chamada dá para adicionar mais pessoas, até 8.
      headerRight: () => <View style={{ flexDirection: "row", gap: 18 }}>
        {["voice", "video"].map(kind => <Pressable key={kind} hitSlop={10} accessibilityLabel={kind === "voice" ? "Chamada de voz" : "Chamada de vídeo"}
          onPress={() => router.push({ pathname: "/call/direct/[callId]", params: { callId: "new", to: String(id), kind, name: person?.display_name || name || "Chamada" } })}>
          <Ionicons name={kind === "voice" ? "call-outline" : "videocam-outline"} size={23} color={colors.text} />
        </Pressable>)}
      </View>
    }} />
    {/* A caixa de escrever fica sempre por cima do teclado (mede quanto o teclado tapa). */}
    <View ref={keyboardRef} style={[styles.safe, { paddingBottom: keyboardOverlap }]}>
      {messages === null ? <ChatSkeleton />
        : <FlatList
          data={[...messages].reverse()}
          inverted
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.id;
            return <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={[styles.body, mine && styles.mineText]}>{item.body}</Text>
              <Text style={[styles.time, mine && styles.mineTime]}>{relativeTime(item.created_at)}</Text>
            </View>;
          }}
          ListEmptyComponent={<Text style={styles.empty}>Diz olá 👋</Text>}
        />}
      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      {canMessage ? <View style={styles.composer}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Escreve uma mensagem" placeholderTextColor={colors.muted}
          multiline maxLength={4000} />
        <Pressable style={[styles.send, (!text.trim() || sending) && { opacity: 0.4 }]} onPress={send} disabled={!text.trim() || sending}
          accessibilityRole="button" accessibilityLabel="Enviar">
          <Ionicons name="send" size={20} color="#fff" />
        </Pressable>
      </View> : <Text style={styles.empty}>Não é possível enviar mensagens a esta pessoa.</Text>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 12, gap: 6 },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  mineText: { color: colors.onPrimary },
  time: { color: colors.muted, fontSize: 11, marginTop: 3 },
  mineTime: { color: "rgba(255,255,255,0.75)" },
  empty: { textAlign: "center", color: colors.muted, padding: 24 },
  error: { color: colors.danger, paddingHorizontal: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.background, color: colors.text, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }
});
