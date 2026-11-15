// O que se vê enquanto a app carrega:
// - BootLogo: o logótipo Tchilar a desfocar e focar (ao abrir a app, logo a seguir ao ecrã de arranque nativo);
// - esqueletos: a "forma" do ecrã (cartões, linhas, fotos) a pulsar, em vez de um ecrã branco com uma roda.
import { Image } from "expo-image";
import { createContext, useContext, useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import { colors, isDark } from "../lib/theme";

const LOGO = isDark ? require("../../assets/tchilar-splash-dark.png") : require("../../assets/tchilar-logo-full.png");

// Um ciclo de vaivém (0 → 1 → 0) que respeita "Reduzir movimento" do telemóvel.
function useLoop(duration) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let animation = null;
    let stopped = false;
    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (stopped) return;
      if (reduce) { value.setValue(1); return; }
      animation = Animated.loop(Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ]));
      animation.start();
    }).catch(() => value.setValue(1));
    return () => { stopped = true; animation?.stop(); };
  }, [value, duration]);
  return value;
}

// Desfoque → foco: uma cópia desfocada por baixo e a nítida por cima a aparecer (anima no lado nativo, sem esforço).
export function BootLogo() {
  const focus = useLoop(800);
  const scale = focus.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] });
  return <View style={styles.boot} accessibilityRole="progressbar" accessibilityLabel="A carregar o Tchilar">
    <Animated.View style={[styles.logoBox, { transform: [{ scale }] }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: focus.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }) }]}>
        <Image source={LOGO} style={styles.logo} contentFit="contain" blurRadius={14} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: focus }]}>
        <Image source={LOGO} style={styles.logo} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  </View>;
}

// ----- Esqueletos -----
// Todos os ossos de um ecrã pulsam juntos (um só relógio), como nas apps grandes.
const Pulse = createContext(null);
function SkeletonGroup({ children, style }) {
  const pulse = useLoop(700);
  return <Pulse.Provider value={pulse}><View style={style} accessibilityLabel="A carregar" accessibilityRole="progressbar">{children}</View></Pulse.Provider>;
}
export function Bone({ width = "100%", height = 12, radius = 6, style }) {
  const pulse = useContext(Pulse);
  const opacity = pulse ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) : 1;
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.line, opacity }, style]} />;
}

function PostBones({ media = true }) {
  return <View style={styles.post}>
    <View style={[styles.row, { paddingHorizontal: 14 }]}>
      <Bone width={40} height={40} radius={20} />
      <View style={{ flex: 1, gap: 7 }}><Bone width="45%" height={13} /><Bone width="28%" height={10} /></View>
    </View>
    <View style={{ gap: 7, paddingHorizontal: 14 }}><Bone width="92%" /><Bone width="70%" /></View>
    {media && <Bone height={240} radius={0} />}
    <View style={[styles.row, { justifyContent: "space-around" }]}>
      <Bone width={60} height={12} /><Bone width={70} height={12} /><Bone width={64} height={12} />
    </View>
  </View>;
}

// Início: histórias + publicações.
export function FeedSkeleton() {
  return <SkeletonGroup>
    <View style={[styles.row, { paddingHorizontal: 12, paddingVertical: 12 }]}>
      {[0, 1, 2, 3].map(index => <Bone key={index} width={92} height={150} radius={14} />)}
    </View>
    <PostBones />
    <PostBones media={false} />
  </SkeletonGroup>;
}

// Uma publicação (ecrã da publicação).
export function PostSkeleton() {
  return <SkeletonGroup><PostBones /></SkeletonGroup>;
}

// Ecrãs de definições, listas e painéis: cartões com linhas.
export function ListSkeleton({ cards = 3 }) {
  return <SkeletonGroup style={{ padding: 16, gap: 14 }}>
    {Array.from({ length: cards }, (_, card) => <View key={card} style={styles.card}>
      <Bone width="40%" height={15} />
      {[0, 1, 2].map(row => <View key={row} style={styles.row}>
        <Bone width={36} height={36} radius={10} />
        <View style={{ flex: 1, gap: 7 }}><Bone width={`${70 - row * 12}%`} /><Bone width={`${45 - row * 6}%`} height={10} /></View>
      </View>)}
    </View>)}
  </SkeletonGroup>;
}

// Listas de pessoas (mensagens, notificações): avatar + duas linhas.
export function RowsSkeleton({ rows = 8 }) {
  return <SkeletonGroup style={{ paddingVertical: 8 }}>
    {Array.from({ length: rows }, (_, index) => <View key={index} style={[styles.row, { paddingHorizontal: 16, paddingVertical: 10 }]}>
      <Bone width={48} height={48} radius={24} />
      <View style={{ flex: 1, gap: 8 }}><Bone width={`${55 - (index % 3) * 10}%`} height={13} /><Bone width={`${80 - (index % 4) * 12}%`} height={10} /></View>
    </View>)}
  </SkeletonGroup>;
}

// Conversa: bolhas dos dois lados.
export function ChatSkeleton() {
  const bubbles = [[false, 160], [false, 220], [true, 140], [false, 120], [true, 230], [true, 90], [false, 180]];
  return <SkeletonGroup style={{ padding: 14, gap: 10 }}>
    {bubbles.map(([mine, width], index) => <Bone key={index} width={width} height={38} radius={18} style={{ alignSelf: mine ? "flex-end" : "flex-start" }} />)}
  </SkeletonGroup>;
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#0B0B0C" : "#FFFFFF" },
  logoBox: { width: 220, height: 64 },
  logo: { width: "100%", height: "100%" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  post: { backgroundColor: colors.surface, marginBottom: 8, paddingVertical: 12, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 14 }
});
