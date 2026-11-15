import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { setStatusBarStyle } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "../../components/Avatar";
import { VideoPost } from "../../components/VideoPost";
import { api, mediaUri } from "../../lib/api";
import { remember } from "../../lib/store";
import { colors, isDark } from "../../lib/theme";

// Reels: vídeos em ecrã inteiro, um de cada vez. Só toca o que está no ecrã (e nada quando se sai do separador).
export default function Reels() {
  const [focused, setFocused] = useState(false);
  // Fundo preto: enquanto os Reels estão abertos, a barra de estado fica branca; ao sair volta à do tema.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    setStatusBarStyle("light");
    return () => { setFocused(false); setStatusBarStyle(isDark ? "light" : "dark"); };
  }, []));
  const insets = useSafeAreaInsets();
  const [reels, setReels] = useState(null);
  const [height, setHeight] = useState(0);
  const [current, setCurrent] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (before = null) => {
    try {
      const result = await api(`/posts?mediaType=video${before ? `&before=${before}` : ""}`);
      setReels(list => before ? [...(list || []), ...result.posts] : result.posts);
      setCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onViewable = useRef(({ viewableItems }) => {
    if (viewableItems[0]) setCurrent(viewableItems[0].index);
  }).current;

  const like = async (reel, index) => {
    try {
      const result = await api(`/posts/${reel.id}/like`, { method: "POST" });
      setReels(list => list.map((item, position) => position === index ? { ...item, liked: result.liked, likes: result.likes } : item));
    } catch { /* fica como estava */ }
  };

  return <View style={styles.screen} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    {reels === null && !error && <ActivityIndicator style={styles.center} color="#fff" />}
    {Boolean(error) && <Text style={styles.message}>{error}</Text>}
    {reels?.length === 0 && <Text style={styles.message}>Ainda não há Reels. Publica um vídeo!</Text>}
    {height > 0 && reels?.length > 0 && <FlatList
      data={reels}
      keyExtractor={item => String(item.id)}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
      onEndReached={() => { if (cursor) load(cursor); }}
      getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
      renderItem={({ item, index }) => <View style={{ height }}>
        {Math.abs(index - current) <= 1 && <VideoPost uri={mediaUri(item.media_url)} playing={focused && index === current} style={StyleSheet.absoluteFill} fullScreen edit={item.video_edit} music={item.music} />}
        <View style={[styles.side, { bottom: 24 + insets.bottom * 0 }]}>
          <Pressable style={styles.sideButton} onPress={() => like(item, index)} accessibilityLabel="Gostar">
            <Ionicons name={item.liked ? "heart" : "heart-outline"} size={32} color={item.liked ? colors.accent : "#fff"} />
            <Text style={styles.sideText}>{Number(item.likes || 0)}</Text>
          </Pressable>
          <Pressable style={styles.sideButton} onPress={() => { remember(`post:${item.id}`, item); router.push(`/post/${item.id}`); }} accessibilityLabel="Comentários">
            <Ionicons name="chatbubble-outline" size={30} color="#fff" />
            <Text style={styles.sideText}>{Number(item.comments || 0)}</Text>
          </Pressable>
        </View>
        <Pressable style={styles.info} onPress={() => router.push(`/u/${item.username}`)}>
          <View style={styles.author}><Avatar user={item} size={34} /><Text style={styles.name}>{item.display_name}</Text></View>
          {Boolean(item.body) && <Text style={styles.body} numberOfLines={3}>{item.body}</Text>}
        </Pressable>
      </View>}
    />}
    <View style={[styles.topBar, { top: insets.top + 6 }]}>
      {router.canGoBack() && <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Voltar">
        <Ionicons name="chevron-back" size={30} color="#fff" />
      </Pressable>}
      <Image source={require("../../../assets/tchilar-splash-dark.png")} style={styles.logo} contentFit="contain" accessibilityLabel="Tchilar Reels" />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", left: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { width: 115, height: 28 },
  titleText: { color: "#fff", fontSize: 22, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  screen: { flex: 1, backgroundColor: "#000" },
  center: { marginTop: 200 },
  message: { color: "#fff", textAlign: "center", marginTop: 200, paddingHorizontal: 24 },
  title: { position: "absolute", left: 16, color: "#fff", fontSize: 22, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  side: { position: "absolute", right: 12, alignItems: "center", gap: 18 },
  sideButton: { alignItems: "center", gap: 2 },
  sideText: { color: "#fff", fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  info: { position: "absolute", left: 14, right: 80, bottom: 24, gap: 8 },
  author: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: "#fff", fontWeight: "800", fontSize: 16, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  body: { color: "#fff", fontSize: 14, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }
});
