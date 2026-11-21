import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../../components/Avatar";
import { GiftIcon, GiftSheet, GiftShow, useGiftShow } from "../../components/LiveGifts";
import { VideoPost } from "../../components/VideoPost";
import { WEB_URL, api } from "../../lib/api";
import { useGlassHeaderPadding } from "../../lib/headers";
import { colors } from "../../lib/theme";
import { useKeyboardOverlap } from "../../lib/keyboard";

const REACTIONS = [["heart", "❤️"], ["like", "👍"], ["spark", "✨"]];

// Ver um direto: vídeo (quando o direto passa pelo servidor de vídeo), chat, reações e estrelas.
// Também conta como espectador (sinal de vida) enquanto o ecrã está aberto.
export default function LiveViewer() {
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();
  const { id } = useLocalSearchParams();
  const [live, setLive] = useState(null);
  const [feed, setFeed] = useState(null);
  const [text, setText] = useState("");
  const [showGifts, setShowGifts] = useState(false);
  const [gifts, setGifts] = useState([]);
  const [balance, setBalance] = useState(null);
  const giftNow = useGiftShow(feed?.comments, gifts);
  useEffect(() => {
    api("/lives/config").then(result => setGifts(result.gifts || [])).catch(() => {});
    api("/stars").then(result => setBalance(result.balance ?? null)).catch(() => {});
  }, []);
  const [error, setError] = useState("");
  const list = useRef(null);
  const top = useGlassHeaderPadding();

  useEffect(() => {
    let active = true;
    api(`/lives/${id}`).then(result => { if (active) setLive(result.live); }).catch(loadError => setError(loadError.message));
    let feedTimer;
    const loadFeed = async () => {
      try {
        const result = await api(`/lives/${id}/feed`);
        if (!active) return;
        setFeed(result);
        feedTimer = setTimeout(loadFeed, Math.max(1500, Number(result.poll) || 3000));
      } catch {
        feedTimer = setTimeout(loadFeed, 5000);
      }
    };
    loadFeed();
    let beatTimer;
    const beat = async () => {
      try {
        const result = await api(`/lives/${id}/heartbeat`, { method: "POST" });
        if (active) beatTimer = setTimeout(beat, Math.max(10000, Number(result.next) || 20000));
      } catch {
        if (active) beatTimer = setTimeout(beat, 20000);
      }
    };
    beat();
    return () => {
      active = false;
      clearTimeout(feedTimer); clearTimeout(beatTimer);
      api(`/lives/${id}/leave`, { method: "POST" }).catch(() => {});
    };
  }, [id]);

  // Direto pago: quem ainda não pagou vê o preço e paga a entrada (uma vez por direto).
  const locked = Boolean(live && live.entry_stars > 0 && !live.has_access && live.status === "live");
  const [paying, setPaying] = useState(false);
  const payEntry = () => Alert.alert("Direto pago", `Entrar por ${live.entry_stars} estrelas? Vês até ao fim, com chat e presentes.`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Entrar", onPress: async () => {
      setPaying(true); setError("");
      try {
        const result = await api(`/lives/${id}/ticket`, { method: "POST" });
        setBalance(result.balance ?? balance);
        setLive(current => ({ ...current, has_access: true, playback: result.playback || current.playback }));
        api(`/lives/${id}/heartbeat`, { method: "POST" }).catch(() => {});
      } catch (payError) {
        if (/estrelas suficientes/.test(payError.message)) Alert.alert("Estrelas", payError.message, [{ text: "Agora não" }, { text: "Comprar estrelas", onPress: () => router.push("/stars") }]);
        else setError(payError.message);
      } finally { setPaying(false); }
    } }
  ]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText(""); setError("");
    try { await api(`/lives/${id}/comments`, { method: "POST", body: { body } }); } catch (sendError) { setError(sendError.message); setText(body); }
  };
  const react = kind => api(`/lives/${id}/react`, { method: "POST", body: { kind } }).catch(() => {});
  const gift = async item => {
    setShowGifts(false); setError("");
    try {
      const result = await api(`/lives/${id}/stars`, { method: "POST", body: { gift: item.key } });
      setBalance(result.balance ?? null);
    } catch (giftError) { setError(giftError.message); }
  };

  const ended = feed?.status && feed.status !== "live";
  return <SafeAreaView style={[styles.screen, { paddingTop: top }]} edges={["bottom"]}>
    <Stack.Screen options={{ title: live?.title || "Direto", headerLeft: () => <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/live"))} hitSlop={12} accessibilityLabel="Voltar">
      <Ionicons name="chevron-back" size={28} color={colors.text} /></Pressable> }} />
    <View style={styles.video}>
      {locked ? <View style={styles.noVideo}>
          <Avatar user={live} size={72} />
          <Text style={styles.paywallTitle}>Direto pago</Text>
          <Text style={styles.paywallText}>Entrada: {live.entry_stars} estrelas. As estrelas vão para quem está em direto.</Text>
          <Pressable style={styles.paywallButton} onPress={payEntry} disabled={paying} accessibilityRole="button">
            <Ionicons name="star" size={16} color="#fff" /><Text style={styles.paywallButtonText}>{paying ? "A pagar..." : `Entrar por ${live.entry_stars} ★`}</Text>
          </Pressable>
        </View>
        : live?.playback?.hls && !ended ? <VideoPost uri={live.playback.hls} playing fullScreen style={StyleSheet.absoluteFill} />
        : <View style={styles.noVideo}>
          {live && <Avatar user={live} size={80} />}
          <Text style={styles.noVideoText}>{ended ? "Este direto terminou." : "O vídeo deste direto ainda só se vê no site."}</Text>
          {!ended && <Pressable onPress={() => Linking.openURL(`${WEB_URL}/live/${id}`)}><Text style={styles.link}>Ver no site ›</Text></Pressable>}
        </View>}
      <GiftShow gift={giftNow} />
      <View style={styles.overlay}>
        {!ended && <View style={styles.tag}><Text style={styles.tagText}>AO VIVO</Text></View>}
        <Text style={styles.stat}>👁 {feed?.viewers ?? 0}</Text>
        <Text style={styles.stat}>★ {feed?.stars ?? 0}</Text>
      </View>
    </View>
    {live && <Pressable style={styles.host} onPress={() => router.push(`/u/${live.username}`)}>
      <Avatar user={live} size={36} />
      <View style={{ flex: 1 }}><Text style={styles.hostName}>{live.display_name}</Text><Text style={styles.muted} numberOfLines={1}>{live.description || live.category}</Text></View>
    </Pressable>}
    {feed?.pinned && <View style={styles.pinned}><Ionicons name="pin" size={14} color={colors.primary} /><Text style={styles.pinnedText}><Text style={{ fontWeight: "800" }}>{feed.pinned.display_name}: </Text>{feed.pinned.body}</Text></View>}
    {/* A caixa de escrever fica sempre por cima do teclado (mede quanto o teclado tapa). */}
    <View ref={keyboardRef} style={{ flex: 1, paddingBottom: keyboardOverlap }}>
      <FlatList ref={list} data={feed?.comments || []} keyExtractor={item => String(item.id)} contentContainerStyle={styles.chat}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => <View style={styles.comment}>
          <Avatar user={item} size={26} />
          {item.gift ? <GiftIcon gift={item.gift} size={20} /> : null}
          <Text style={styles.commentText}><Text style={{ fontWeight: "800" }}>{item.display_name}{item.stars && !item.gift ? ` ★${item.stars}` : ""} </Text>{item.body}</Text>
        </View>}
        ListEmptyComponent={<Text style={styles.muted}>Ainda não há comentários. Diz olá!</Text>} />
      <GiftSheet visible={showGifts} gifts={gifts} balance={balance} onClose={() => setShowGifts(false)} onSend={gift} />
      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      {!ended && <View style={styles.composer}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Comenta…" placeholderTextColor={colors.muted} maxLength={300} onSubmitEditing={send} />
        {REACTIONS.map(([kind, emoji]) => <Pressable key={kind} onPress={() => react(kind)} hitSlop={6}><Text style={{ fontSize: 22 }}>{emoji}</Text></Pressable>)}
        <Pressable onPress={() => setShowGifts(true)} hitSlop={6} accessibilityLabel="Oferecer um presente"><Ionicons name="gift" size={24} color="#E30613" /></Pressable>
        <Pressable onPress={send} hitSlop={6} accessibilityLabel="Enviar"><Ionicons name="send" size={22} color={colors.primary} /></Pressable>
      </View>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  paywallTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 10 },
  paywallText: { color: "rgba(255,255,255,0.8)", textAlign: "center", paddingHorizontal: 24 },
  paywallButton: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: "#E30613" },
  paywallButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  screen: { flex: 1, backgroundColor: colors.surface },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  noVideo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 16, backgroundColor: colors.ink },
  noVideoText: { color: "#fff", textAlign: "center" },
  link: { color: "#FFFFFF", fontWeight: "800", textDecorationLine: "underline" },
  overlay: { position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 8, alignItems: "center" },
  tag: { backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  stat: { color: "#fff", fontWeight: "800", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  host: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  hostName: { color: colors.text, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13 },
  pinned: { flexDirection: "row", gap: 6, alignItems: "center", margin: 8, padding: 8, borderRadius: 10, backgroundColor: colors.primarySoft },
  pinnedText: { flex: 1, color: colors.text },
  chat: { padding: 10, gap: 8 },
  comment: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  commentText: { flex: 1, color: colors.text, lineHeight: 19 },
  error: { color: colors.danger, paddingHorizontal: 12 },
  composer: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  input: { flex: 1, height: 40, borderRadius: 20, paddingHorizontal: 14, backgroundColor: colors.background, color: colors.text }
});
