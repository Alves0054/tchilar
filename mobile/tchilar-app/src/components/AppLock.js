// Ecrã de bloqueio por cima de tudo (só com sessão iniciada e o bloqueio ligado em Definições → Segurança).
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { LOCK_AFTER_MS, lockEnabled, lockMethod, onLockChange, unlock } from "../lib/applock";
import { useSession } from "../lib/session";
import { colors, isDark } from "../lib/theme";

export function AppLock() {
  const { user, signOut } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [method, setMethod] = useState(null);
  const leftAt = useRef(null);
  const prompting = useRef(false);

  // Ao abrir a app com o bloqueio ligado, começa bloqueada.
  useEffect(() => {
    if (!user) { setLocked(false); return; }
    lockEnabled().then(on => { setEnabled(on); if (on) setLocked(true); });
    lockMethod().then(setMethod);
    return onLockChange(setEnabled);
  }, [user?.id]);

  const tryUnlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    if (await unlock()) setLocked(false);
    prompting.current = false;
  }, []);

  useEffect(() => { if (locked) tryUnlock(); }, [locked, tryUnlock]);

  // Volta a bloquear depois de mais de 1 minuto fora da app.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (!enabled || !user) return;
      if (state === "background") leftAt.current = Date.now();
      if (state === "active" && leftAt.current && !prompting.current) {
        if (Date.now() - leftAt.current > LOCK_AFTER_MS) setLocked(true);
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [enabled, user?.id]);

  if (!user || !enabled || !locked) return null;
  return <View style={styles.cover} accessibilityViewIsModal>
    <Image source={isDark ? require("../../assets/tchilar-splash-dark.png") : require("../../assets/tchilar-logo-full.png")} style={styles.logo} contentFit="contain" accessibilityLabel="Tchilar" />
    <View style={styles.lockIcon}><Ionicons name="lock-closed" size={30} color={colors.text} /></View>
    <Text style={styles.title}>O Tchilar está bloqueado</Text>
    <Text style={styles.text}>Desbloqueia com {method || "o código do telemóvel"}.</Text>
    <Pressable style={styles.button} onPress={tryUnlock} accessibilityRole="button">
      <Ionicons name={method === "Face ID" ? "scan" : "finger-print"} size={20} color={colors.onPrimary} />
      <Text style={styles.buttonText}>Desbloquear</Text>
    </Pressable>
    <Pressable onPress={signOut} style={styles.out} accessibilityRole="button"><Text style={styles.outText}>Sair da conta</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  logo: { width: 170, height: 44, marginBottom: 24 },
  lockIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  text: { color: colors.muted, fontSize: 15, textAlign: "center" },
  button: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: 26, paddingVertical: 14, borderRadius: 999, marginTop: 12 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "800" },
  out: { padding: 12, marginTop: 4 },
  outText: { color: colors.muted, fontWeight: "700" }
});
