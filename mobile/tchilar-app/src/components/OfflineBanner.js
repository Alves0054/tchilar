// Aviso "Sem ligação à internet" no topo do ecrã, enquanto os pedidos não chegam ao servidor.
// Com o aviso à vista, volta a tentar de 5 em 5 segundos e desaparece sozinho quando a ligação volta.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, isOnline, onConnectionChange } from "../lib/api";

export function OfflineBanner() {
  const [online, setOnline] = useState(isOnline());
  const insets = useSafeAreaInsets();
  useEffect(() => onConnectionChange(setOnline), []);
  useEffect(() => {
    if (online) return undefined;
    const timer = setInterval(() => { api("/health").catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [online]);
  if (online) return null;
  return <View pointerEvents="none" style={[styles.banner, { paddingTop: insets.top + 6 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
    <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
    <Text style={styles.text}>Sem ligação à internet. A tentar outra vez…</Text>
  </View>;
}

const styles = StyleSheet.create({
  banner: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 8, backgroundColor: "#3A3A3C" },
  text: { color: "#fff", fontWeight: "700", fontSize: 13 }
});
