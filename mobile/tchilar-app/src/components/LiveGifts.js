// Presentes dos diretos (como no site): ícones desenhados (SVG, sem emojis), a folha para escolher o
// presente, o presente a aparecer em grande por cima do vídeo e o som de aviso dos presentes caros.
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import GIFT_ART from "../lib/live-gifts-art.json";
import { colors } from "../lib/theme";

// Sons 1 a 8 (assets/sounds, gerados por scripts/gift-sounds.mjs): cada um mais rico do que o anterior.
const SOUNDS = {
  1: require("../../assets/sounds/gift-1.wav"), 2: require("../../assets/sounds/gift-2.wav"),
  3: require("../../assets/sounds/gift-3.wav"), 4: require("../../assets/sounds/gift-4.wav"),
  5: require("../../assets/sounds/gift-5.wav"), 6: require("../../assets/sounds/gift-6.wav"),
  7: require("../../assets/sounds/gift-7.wav"), 8: require("../../assets/sounds/gift-8.wav")
};
function playGiftSound(level) {
  if (!SOUNDS[level]) return;
  try {
    const player = createAudioPlayer(SOUNDS[level]);
    player.volume = 0.9;
    player.play();
    setTimeout(() => { try { player.remove(); } catch { /* já libertado */ } }, 5000);
  } catch { /* sem áudio: segue sem som */ }
}
const kz = value => `${Number(value).toLocaleString("pt-PT")} Kz`;

export function GiftIcon({ gift, size = 40 }) {
  const xml = GIFT_ART[gift];
  if (!xml) return <Ionicons name="gift" size={size} color="#E5A000" />;
  return <SvgXml xml={xml} width={size} height={size} />;
}

// Folha para escolher o presente (paga-se com estrelas: 1 estrela = 10 Kz).
export function GiftSheet({ visible, gifts, balance, onClose, onSend }) {
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose} />
    <SafeAreaView edges={["bottom"]} style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Oferecer um presente</Text>
        <Pressable onPress={() => { onClose(); router.push("/stars"); }}><Text style={styles.balance}>{balance === null ? "Estrelas" : `${balance} estrelas`} ›</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.grid}>
        {gifts.map(item => {
          const short = balance !== null && balance < item.stars;
          return <Pressable key={item.key} style={[styles.option, short && { opacity: 0.4 }]} disabled={short} onPress={() => onSend(item)}
            accessibilityLabel={`${item.name}, ${item.stars} estrelas (${kz(item.kz)})`}>
            <GiftIcon gift={item.key} size={44} />
            <Text style={styles.optionName} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.optionPrice, item.sound > 0 && { color: colors.warning }]}>★ {Number(item.stars).toLocaleString("pt-PT")}</Text>
            <Text style={styles.optionKz}>= {kz(item.kz)}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <Text style={styles.hint}>Cada presente paga-se com estrelas (1 estrela = 10 Kz). Quem está em direto recebe 80%.</Text>
    </SafeAreaView>
  </Modal>;
}

// Vê os presentes novos que chegam no feed do direto e mostra-os um a um (com som nos mais caros).
// O histórico que já existia quando se abriu o direto não é animado.
export function useGiftShow(comments, gifts) {
  const [current, setCurrent] = useState(null);
  const lastSeen = useRef(null);
  const queue = useRef([]);
  const busy = useRef(false);
  const showNext = () => {
    const next = queue.current.shift();
    if (!next) { busy.current = false; setCurrent(null); return; }
    busy.current = true;
    setCurrent(next);
    playGiftSound(next.sound);
    setTimeout(showNext, next.sound >= 6 ? 4200 : next.sound ? 3400 : 2600);
  };
  useEffect(() => {
    if (!comments || !gifts?.length) return;
    const newest = comments.reduce((max, comment) => comment.gift ? Math.max(max, comment.id) : max, 0);
    if (lastSeen.current === null) { lastSeen.current = newest; return; }
    if (newest <= lastSeen.current) return;
    const catalog = Object.fromEntries(gifts.map(item => [item.key, item]));
    const fresh = comments.filter(comment => comment.gift && comment.id > lastSeen.current && catalog[comment.gift]);
    lastSeen.current = newest;
    queue.current.push(...fresh.slice(-6).map(comment => ({ ...catalog[comment.gift], id: comment.id, from: comment.display_name || "Alguém" })));
    if (!busy.current) showNext();
  }, [comments, gifts]);
  return current;
}

export function GiftShow({ gift }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!gift) return;
    scale.setValue(0.3); opacity.setValue(0);
    const hold = gift.sound >= 6 ? 3300 : gift.sound ? 2600 : 1800;
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true })
      ]),
      Animated.delay(hold),
      Animated.timing(opacity, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true })
    ]).start();
  }, [gift?.id]);
  if (!gift) return null;
  const big = gift.sound >= 5;
  return <Animated.View pointerEvents="none" style={[styles.show, big && styles.showBig, gift.sound === 8 && styles.showTop, { opacity, transform: [{ scale }] }]}>
    <GiftIcon gift={gift.key} size={big ? 120 : 96} />
    <Text style={styles.showFrom}>{gift.from}</Text>
    <Text style={styles.showText}>ofereceu {gift.name} · ★ {gift.stars}</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14, maxHeight: "70%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  balance: { color: colors.text, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 10, gap: 6 },
  option: { width: "23%", alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.background },
  optionName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  optionPrice: { color: "#C58A00", fontSize: 12, fontWeight: "800" },
  optionKz: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 12, textAlign: "center", padding: 12 },
  show: { position: "absolute", alignSelf: "center", top: "18%", alignItems: "center", gap: 2, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)" },
  showBig: { shadowColor: "#FFC21A", shadowOpacity: 0.8, shadowRadius: 24, elevation: 8 },
  showTop: { backgroundColor: "rgba(110,40,160,0.65)" },
  showFrom: { color: "#fff", fontSize: 17, fontWeight: "800" },
  showText: { color: "rgba(255,255,255,0.9)", fontSize: 13 }
});
