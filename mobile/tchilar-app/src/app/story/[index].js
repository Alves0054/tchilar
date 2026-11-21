import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "../../components/Avatar";
import { StoryBackground } from "../../components/StoryBackground";
import { api, mediaUri } from "../../lib/api";
import { useSession } from "../../lib/session";
import { recall } from "../../lib/store";
import { relativeTime } from "../../lib/theme";

const DURATION = 5000;

function StoryVideo({ uri }) {
  const player = useVideoPlayer(uri, item => { item.loop = false; item.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

// Leitor de stories em ecrã inteiro: avança sozinho a cada 5 segundos; toque à esquerda volta,
// à direita avança; carregar e manter pausa (como no site).
export default function StoryViewer() {
  const insets = useSafeAreaInsets();
  const { index } = useLocalSearchParams();
  const { user } = useSession();
  const groups = recall("stories") || [];
  const [groupIndex, setGroupIndex] = useState(Number(index) || 0);
  const [itemIndex, setItemIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const paused = useRef(false);
  const group = groups[groupIndex];
  const story = group?.items[itemIndex];

  const next = () => {
    if (!group) return;
    if (itemIndex < group.items.length - 1) { setItemIndex(itemIndex + 1); setProgress(0); return; }
    if (groupIndex < groups.length - 1) { setGroupIndex(groupIndex + 1); setItemIndex(0); setProgress(0); return; }
    router.back();
  };
  const previous = () => {
    if (itemIndex > 0) { setItemIndex(itemIndex - 1); setProgress(0); return; }
    if (groupIndex > 0) { setGroupIndex(groupIndex - 1); setItemIndex(0); setProgress(0); }
  };

  useEffect(() => {
    if (!story) return undefined;
    const started = Date.now();
    let elapsed = 0;
    let last = started;
    const timer = setInterval(() => {
      const now = Date.now();
      if (!paused.current) elapsed += now - last;
      last = now;
      setProgress(Math.min(1, elapsed / DURATION));
      if (elapsed >= DURATION) { clearInterval(timer); next(); }
    }, 50);
    return () => clearInterval(timer);
  }, [groupIndex, itemIndex]);

  if (!story) return <View style={styles.screen}><Pressable onPress={() => router.back()}><Text style={styles.empty}>Sem stories. Toca para voltar.</Text></Pressable></View>;
  const media = mediaUri(story.media_url);
  const mine = story.user_id === user?.id;

  const remove = async () => {
    try { await api(`/stories/${story.id}`, { method: "DELETE" }); } catch { /* já não existe */ }
    router.back();
  };

  // O story fica num cartão dentro da zona segura: não passa por baixo da hora, da bateria nem da câmara,
  // nem da barra de gestos em baixo. A barra de estado fica branca (fundo preto).
  return <View style={[styles.screen, { paddingTop: insets.top + 4, paddingBottom: Math.max(insets.bottom, 8) }]}>
    <StatusBar style="light" />
    <View style={styles.card}>
    {story.media_type === "image" && media ? <Image source={{ uri: media }} style={StyleSheet.absoluteFill} contentFit="contain" />
      : story.media_type === "video" && media ? <StoryVideo key={story.id} uri={media} />
        : <StoryBackground backgroundKey={story.background} style={[StyleSheet.absoluteFill, styles.textWrap]}>
          <Text style={styles.text}>{story.body}</Text>
        </StoryBackground>}
    {Boolean(story.body) && story.media_type && <Text style={styles.caption}>{story.body}</Text>}

    <Pressable style={styles.tapLeft} onPress={previous} onLongPress={() => { paused.current = true; }} onPressOut={() => { paused.current = false; }} />
    <Pressable style={styles.tapRight} onPress={next} onLongPress={() => { paused.current = true; }} onPressOut={() => { paused.current = false; }} />

    <View style={styles.top} pointerEvents="box-none">
      <View style={styles.bars}>{group.items.map((item, position) => <View key={item.id} style={styles.bar}>
        <View style={[styles.barFill, { width: `${position < itemIndex ? 100 : position === itemIndex ? progress * 100 : 0}%` }]} />
      </View>)}</View>
      <View style={styles.head}>
        <Avatar user={group.user} size={36} />
        <Text style={styles.name}>{group.user.display_name}</Text>
        <Text style={styles.time}>{relativeTime(story.created_at)}</Text>
        <View style={{ flex: 1 }} />
        {mine && <Pressable onPress={remove} hitSlop={12} accessibilityLabel="Apagar story"><Ionicons name="trash-outline" size={24} color="#fff" /></Pressable>}
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Fechar"><Ionicons name="close" size={30} color="#fff" /></Pressable>
      </View>
    </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  card: { flex: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#111" },
  empty: { color: "#fff", marginTop: 120, textAlign: "center" },
  textWrap: { alignItems: "center", justifyContent: "center", padding: 32 },
  text: { color: "#fff", fontSize: 30, fontWeight: "800", textAlign: "center", textShadowColor: "rgba(0,0,0,0.35)", textShadowRadius: 8 },
  caption: { position: "absolute", left: 16, right: 16, bottom: 28, color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center", textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 6 },
  tapLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: "33%" },
  tapRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: "67%" },
  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 10, paddingTop: 4 },
  bars: { flexDirection: "row", gap: 4, marginTop: 6 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  barFill: { height: 3, backgroundColor: "#fff" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  name: { color: "#fff", fontWeight: "800", fontSize: 15 },
  time: { color: "rgba(255,255,255,0.8)", fontSize: 13 }
});
