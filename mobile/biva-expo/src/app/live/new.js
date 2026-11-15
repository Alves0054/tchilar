// Entrar em direto a partir do telemóvel: câmara + microfone enviados por WHIP para o servidor de vídeo
// (MediaMTX), como o estúdio do site. Os espectadores veem por HLS, no site e na app.
//
// Precisa do módulo nativo react-native-webrtc: funciona na app instalada (build do EAS), não no Expo Go.
// No Expo Go, este ecrã explica isso e oferece o estúdio do site.
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GiftShow, useGiftShow } from "../../components/LiveGifts";
import { Button, Chips } from "../../components/ui";
import { WEB_URL, api } from "../../lib/api";
import { colors } from "../../lib/theme";

// Carrega o WebRTC só se existir (no Expo Go não existe e o import falharia ao abrir a app).
let webrtc = null;
try { webrtc = require("react-native-webrtc"); } catch { webrtc = null; }

const HEARTBEAT_MS = 20_000;
// Sai do ecrã: volta para trás, ou para a lista de diretos se não houver para onde voltar.
const leave = () => (router.canGoBack() ? router.back() : router.replace("/live"));
const closeHeader = { title: "Entrar em direto", headerLeft: () => <Pressable onPress={leave} hitSlop={12} accessibilityLabel="Fechar"><Ionicons name="close" size={26} color={colors.text} /></Pressable> };
const CATEGORY_LABELS = { conversa: "Conversa", musica: "Música", jogos: "Jogos", desporto: "Desporto", educacao: "Educação", negocios: "Negócios", fe: "Fé", arte: "Arte", outro: "Outro" };

// Publica o vídeo por WHIP: oferta SDP → servidor responde com a resposta SDP.
async function publishWhip(url, stream) {
  const { RTCPeerConnection } = webrtc;
  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);
  // Espera pelos candidatos ICE (até 2 s): o WHIP recebe a oferta completa de uma vez.
  await new Promise(resolve => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(resolve, 2000);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); } });
  });
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
  if (!response.ok) { pc.close(); throw new Error("O servidor de vídeo recusou a ligação. Tenta outra vez."); }
  const answer = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  const location = response.headers.get("Location");
  return { pc, resource: location ? new URL(location, url).toString() : null };
}

export default function GoLive() {
  const [config, setConfig] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState("user");
  const [micOn, setMicOn] = useState(true);
  const [liveId, setLiveId] = useState(null);
  const [state, setState] = useState("idle"); // idle | starting | live | ending
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState("");
  const whip = useRef(null);
  // Presentes que chegam durante o direto: quem transmite vê-os em grande e ouve o som dos mais caros.
  const [feed, setFeed] = useState(null);
  const [gifts, setGifts] = useState([]);
  const giftNow = useGiftShow(feed?.comments, gifts);
  useEffect(() => {
    if (state !== "live" || !liveId) return undefined;
    let active = true;
    let timer;
    const load = async () => {
      try { const result = await api(`/lives/${liveId}/feed`); if (active) setFeed(result); } catch { /* tenta outra vez */ }
      if (active) timer = setTimeout(load, 2500);
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [state, liveId]);

  useEffect(() => { api("/lives/config").then(result => { setConfig(result); setGifts(result.gifts || []); }).catch(loadError => setError(loadError.message)); }, []);

  // Câmara ligada logo à entrada, para a pessoa se ver antes de começar.
  useEffect(() => {
    if (!webrtc) return undefined;
    let current = null;
    webrtc.mediaDevices.getUserMedia({ audio: true, video: { facingMode: facing, width: 1280, height: 720, frameRate: 30 } })
      .then(media => { current = media; setStream(media); })
      .catch(() => setError("Permite o acesso à câmara e ao microfone nas definições do telemóvel."));
    return () => { current?.getTracks().forEach(track => track.stop()); };
  }, [facing]);

  // Enquanto está em direto: sinal de vida e número de espectadores.
  useEffect(() => {
    if (state !== "live" || !liveId) return undefined;
    const beat = () => api(`/lives/${liveId}/heartbeat`, { method: "POST" }).then(result => {
      setViewers(result.viewers || 0);
      if (result.status && result.status !== "live") setState("idle");
    }).catch(() => {});
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state, liveId]);

  // Trocar de câmara durante o direto: troca a faixa de vídeo sem desligar.
  useEffect(() => {
    if (!stream || !whip.current) return;
    const track = stream.getVideoTracks()[0];
    const sender = whip.current.pc.getSenders().find(item => item.track?.kind === "video");
    if (track && sender) sender.replaceTrack(track).catch(() => {});
  }, [stream]);

  useEffect(() => { stream?.getAudioTracks().forEach(track => { track.enabled = micOn; }); }, [micOn, stream]);
  useEffect(() => () => { stopWhip(); }, []);

  const stopWhip = () => {
    if (!whip.current) return;
    if (whip.current.resource) fetch(whip.current.resource, { method: "DELETE" }).catch(() => {});
    whip.current.pc.close();
    whip.current = null;
  };

  const start = async () => {
    setError("");
    setState("starting");
    let createdId = null;
    try {
      const created = await api("/lives", { method: "POST", body: { title: title.trim(), category: category || undefined, source: "browser" } });
      createdId = created.id;
      setLiveId(created.id);
      const { whip: url } = await api(`/lives/${created.id}/publish`, { method: "POST" });
      whip.current = await publishWhip(url, stream);
      setState("live");
    } catch (startError) {
      stopWhip();
      if (createdId) await api(`/lives/${createdId}/end`, { method: "POST" }).catch(() => {});
      setLiveId(null);
      setState("idle");
      setError(startError.message);
    }
  };

  const end = () => Alert.alert("Terminar o direto?", "Quem está a ver deixa de te ver.", [
    { text: "Continuar", style: "cancel" },
    { text: "Terminar", style: "destructive", onPress: async () => {
      setState("ending");
      stopWhip();
      await api(`/lives/${liveId}/end`, { method: "POST" }).catch(() => {});
      stream?.getTracks().forEach(track => track.stop());
      router.replace(`/live/${liveId}`);
    } }
  ]);

  if (!webrtc) {
    return <SafeAreaView style={[styles.screen, styles.center]}>
      <Stack.Screen options={closeHeader} />
      <Ionicons name="radio" size={44} color={colors.accent} />
      <Text style={styles.noteTitle}>Diretos na app instalada</Text>
      <Text style={styles.note}>Transmitir do telemóvel usa um módulo de vídeo que o Expo Go não tem. Na app instalada (Play Store, App Store ou versão de teste) funciona. Por agora, usa o estúdio do site.</Text>
      <Button label="Abrir o estúdio no site" icon="open" onPress={() => Linking.openURL(`${WEB_URL}/live`)} />
    </SafeAreaView>;
  }
  if (config && !config.browserPublish) {
    return <SafeAreaView style={[styles.screen, styles.center]}>
      <Stack.Screen options={closeHeader} />
      <Text style={styles.noteTitle}>Ainda não disponível</Text>
      <Text style={styles.note}>Este servidor ainda não tem o servidor de vídeo ligado (MediaMTX). Sem ele, os diretos só se fazem no estúdio do site.</Text>
      <Button label="Abrir o estúdio no site" icon="open" onPress={() => Linking.openURL(`${WEB_URL}/live`)} />
    </SafeAreaView>;
  }

  const { RTCView } = webrtc;
  const live = state === "live";
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: false }} />
    <StatusBar style="light" />
    {stream && <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={facing === "user"} />}
    <GiftShow gift={giftNow} />
    <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Pressable onPress={() => (live ? end() : leave())} hitSlop={12} accessibilityLabel={live ? "Terminar" : "Fechar"}>
          <Ionicons name="close" size={30} color="#fff" />
        </Pressable>
        {live && <View style={styles.badge}><Text style={styles.badgeText}>AO VIVO</Text></View>}
        {live && <View style={styles.viewers}><Ionicons name="eye" size={14} color="#fff" /><Text style={styles.badgeText}>{viewers}</Text></View>}
        <View style={{ flex: 1 }} />
        <Pressable style={styles.round} onPress={() => setMicOn(!micOn)} accessibilityLabel={micOn ? "Desligar microfone" : "Ligar microfone"}>
          <Ionicons name={micOn ? "mic" : "mic-off"} size={22} color="#fff" />
        </Pressable>
        <Pressable style={styles.round} onPress={() => setFacing(facing === "user" ? "environment" : "user")} accessibilityLabel="Trocar de câmara">
          <Ionicons name="camera-reverse" size={22} color="#fff" />
        </Pressable>
      </View>

      {!live && <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.form}>
        <TextInput style={styles.input} placeholder="Título do direto" placeholderTextColor="rgba(255,255,255,0.6)"
          value={title} onChangeText={setTitle} maxLength={120} />
        {config?.categories?.length > 0 && <Chips options={[["", "Sem categoria"], ...config.categories.map(item => [item, CATEGORY_LABELS[item] || item])]} value={category} onChange={setCategory} />}
        {Boolean(error) && <Text style={styles.error}>{error}</Text>}
        <Button label={state === "starting" ? "A ligar..." : "Entrar em direto"} icon="radio" busy={state === "starting"}
          disabled={!title.trim() || !stream || !config} onPress={start} />
      </KeyboardAvoidingView>}
      {live && <View style={styles.form}>
        <Button variant="danger" label="Terminar direto" icon="stop" onPress={end} busy={state === "ending"} />
      </View>}
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 14, backgroundColor: colors.background },
  noteTitle: { color: colors.text, fontSize: 20, fontWeight: "800", textAlign: "center" },
  note: { color: colors.muted, textAlign: "center", lineHeight: 21 },
  overlay: { flex: 1, justifyContent: "space-between" },
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  badge: { backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  viewers: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  form: { padding: 16, gap: 12 },
  input: { height: 50, borderRadius: 14, paddingHorizontal: 16, backgroundColor: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 17, fontWeight: "700" },
  error: { color: "#FF8A80", fontWeight: "700" }
});
