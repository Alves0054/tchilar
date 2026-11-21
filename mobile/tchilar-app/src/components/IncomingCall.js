// "Está a ligar-te": com a app aberta, pergunta de 4 em 4 segundos se há uma chamada a tocar e mostra-a
// por cima de tudo (som + vibração). Com a app fechada, chega a notificação push, que abre a chamada.
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Avatar } from "./Avatar";

const RING = require("../../assets/sounds/gift-2.wav");

export function IncomingCall() {
  const { user } = useSession();
  const [call, setCall] = useState(null);
  const dismissed = useRef(new Set());

  useEffect(() => {
    if (!user) { setCall(null); return undefined; }
    const check = () => {
      if (AppState.currentState !== "active") return;
      api("/calls/incoming").then(result => setCall(result.call && !dismissed.current.has(result.call.id) ? result.call : null)).catch(() => {});
    };
    check();
    const timer = setInterval(check, 4000);
    return () => clearInterval(timer);
  }, [user?.id]);

  // A tocar: som de 2,5 em 2,5 segundos e vibração.
  useEffect(() => {
    if (!call) return undefined;
    let player = null;
    try { player = createAudioPlayer(RING); } catch { player = null; }
    const ring = () => { try { player?.seekTo(0); player?.play(); } catch { /* sem som */ } };
    ring();
    const timer = setInterval(ring, 2500);
    Vibration.vibrate([0, 700, 1300], true);
    return () => { clearInterval(timer); Vibration.cancel(); try { player?.remove(); } catch { /* já libertado */ } };
  }, [call?.id]);

  if (!call) return null;
  const decline = () => { dismissed.current.add(call.id); setCall(null); api(`/calls/${call.id}/decline`, { method: "POST" }).catch(() => {}); };
  const answer = () => {
    dismissed.current.add(call.id);
    setCall(null);
    router.push({ pathname: "/call/direct/[callId]", params: { callId: String(call.id), kind: call.kind, name: call.caller_name } });
  };
  return <Modal visible transparent animationType="fade" onRequestClose={decline}>
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.sheet} edges={["top", "bottom"]}>
        <Avatar user={{ display_name: call.caller_name, avatar_url: call.caller_avatar }} size={96} />
        <Text style={styles.name}>{call.caller_name}</Text>
        <Text style={styles.sub}>{call.kind === "voice" ? "Chamada de voz" : "Chamada de vídeo"}{call.count > 1 ? ` · ${call.count} pessoas` : ""}</Text>
        <View style={styles.buttons}>
          <View style={styles.action}>
            <Pressable style={[styles.btn, styles.decline]} onPress={decline} accessibilityLabel="Recusar"><Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} /></Pressable>
            <Text style={styles.label}>Recusar</Text>
          </View>
          <View style={styles.action}>
            <Pressable style={[styles.btn, styles.accept]} onPress={answer} accessibilityLabel="Atender"><Ionicons name={call.kind === "voice" ? "call" : "videocam"} size={30} color="#fff" /></Pressable>
            <Text style={styles.label}>Atender</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  sheet: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  name: { color: "#fff", fontSize: 26, fontWeight: "800", marginTop: 12, textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 16 },
  buttons: { flexDirection: "row", gap: 72, marginTop: 80 },
  action: { alignItems: "center", gap: 8 },
  btn: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  decline: { backgroundColor: "#E30613" },
  accept: { backgroundColor: "#1FA45A" },
  label: { color: "#fff", fontWeight: "700" }
});
