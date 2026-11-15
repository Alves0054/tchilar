// Ecrã de uma chamada de voz ou vídeo (grupos e mensagens). Igual ao site: cada participante liga-se
// diretamente a cada um dos outros (até 8 pessoas) e a API só passa as ofertas e respostas (server/group-calls.js).
// base: caminho da API da chamada (…/heartbeat, …/signal, …/leave); start: entra (ou começa) e devolve a configuração;
// direct: chamada das mensagens (mostra quem está a ser chamado, deixa adicionar pessoas e desliga se ninguém atender).
// Precisa do módulo nativo react-native-webrtc: funciona na app instalada (build do EAS), não no Expo Go.
import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "./Avatar";
import { usePrompt } from "./usePrompt";
import { WEB_URL, api } from "../lib/api";
import { useSession } from "../lib/session";

let webrtc = null;
try { webrtc = require("react-native-webrtc"); } catch { webrtc = null; }

const close = () => (router.canGoBack() ? router.back() : router.replace("/groups"));
const waitForIce = (pc, timeout = 3000) => new Promise(resolve => {
  if (pc.iceGatheringState === "complete") return resolve();
  const timer = setTimeout(resolve, timeout);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(timer); resolve(); } });
});

function Tile({ person, stream, local, kind, height }) {
  const { RTCView } = webrtc;
  const showVideo = kind === "video" && person.camera !== false && stream && stream.getVideoTracks().length > 0;
  return <View style={[styles.tile, { height }]}>
    {showVideo ? <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={local} zOrder={local ? 1 : 0} />
      : <View style={styles.tileAvatar}><Avatar user={person} size={72} /></View>}
    <View style={styles.tileName}>
      {person.muted && <Ionicons name="mic-off" size={13} color="#fff" />}
      <Text style={styles.tileNameText} numberOfLines={1}>{local ? "Tu" : person.display_name}{!stream && !local ? " · a ligar…" : ""}</Text>
    </View>
  </View>;
}

export function CallScreen({ title: name, base, start, kind: wanted = "video", direct = false, webPath = "/messages" }) {
  const { user } = useSession();
  const [state, setState] = useState("starting"); // starting | live | error
  const [error, setError] = useState("");
  const [call, setCall] = useState(null);
  const [local, setLocal] = useState(null);
  const [remote, setRemote] = useState({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(wanted === "video");
  const config = useRef(null);
  const localRef = useRef(null);
  const peers = useRef(new Map());
  const busy = useRef(false);
  const flags = useRef({ muted: false, camera: wanted === "video" });
  const baseRef = useRef(base);
  baseRef.current = base;
  const answered = useRef(false);
  const [prompt, ask] = usePrompt();

  const signal = (to, kind, payload = "") => api(`${baseRef.current}/signal`, { method: "POST", body: { to, kind, payload } }).catch(() => {});
  const dropPeer = userId => {
    peers.current.get(userId)?.pc.close();
    peers.current.delete(userId);
    setRemote(current => { const next = { ...current }; delete next[userId]; return next; });
  };
  const newPeer = (userId, joinedAt) => {
    dropPeer(userId);
    const pc = new webrtc.RTCPeerConnection({ iceServers: config.current.iceServers, iceTransportPolicy: config.current.iceTransportPolicy || "all" });
    localRef.current.getTracks().forEach(track => pc.addTrack(track, localRef.current));
    pc.addEventListener("track", event => { if (event.streams?.[0]) setRemote(current => ({ ...current, [userId]: event.streams[0] })); });
    pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(pc.connectionState) && peers.current.get(userId)?.pc === pc) dropPeer(userId); });
    peers.current.set(userId, { pc, joinedAt });
    return pc;
  };
  const offerTo = async person => {
    const pc = newPeer(person.user_id, person.joined_at);
    await pc.setLocalDescription(await pc.createOffer({}));
    await waitForIce(pc);
    await signal(person.user_id, "offer", JSON.stringify({ sdp: pc.localDescription.sdp }));
  };
  const answer = async (from, payload, joinedAt) => {
    const pc = newPeer(from, joinedAt);
    await pc.setRemoteDescription({ type: "offer", sdp: JSON.parse(payload).sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    await signal(from, "answer", JSON.stringify({ sdp: pc.localDescription.sdp }));
  };

  // Entrar: microfone (e câmara) primeiro, depois a chamada.
  useEffect(() => {
    if (!webrtc) return undefined;
    let cancelled = false;
    (async () => {
      const stream = await webrtc.mediaDevices.getUserMedia({ audio: true, video: wanted === "video" ? { facingMode: "user", width: 640, height: 480, frameRate: 24 } : false });
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      localRef.current = stream;
      setLocal(stream);
      const result = await start(wanted);
      config.current = result;
      setCall(result.call);
      if (result.call.kind === "voice") { stream.getVideoTracks().forEach(track => { track.stop(); stream.removeTrack(track); }); setCamOn(false); flags.current.camera = false; }
      setState("live");
    })().catch(startError => {
      if (cancelled) return;
      setState("error");
      setError(/permission|denied|NotAllowed/i.test(String(startError?.message || startError?.name)) ? "Autoriza o microfone e a câmara nas definições do telemóvel para entrares na chamada." : startError.message);
    });
    return () => {
      cancelled = true;
      peers.current.forEach(({ pc }) => pc.close());
      peers.current.clear();
      localRef.current?.getTracks().forEach(track => track.stop());
      if (config.current) api(`${baseRef.current}/leave`, { method: "POST" }).catch(() => {});
    };
  }, []);

  // Sinal de vida a cada 2,5 s (com a app aberta): quem está, sinais para mim, ligar a quem falta.
  useEffect(() => {
    if (state !== "live") return undefined;
    const beat = async () => {
      if (busy.current || AppState.currentState !== "active") return;
      busy.current = true;
      try {
        const result = await api(`${baseRef.current}/heartbeat`, { method: "POST", body: flags.current });
        if (!result.call) { setState("error"); setError("A chamada terminou."); return; }
        setCall(result.call);
        if (result.call.participants.length > 1) answered.current = true;
        const others = result.call.participants.filter(person => person.user_id !== user.id);
        for (const item of result.signals) {
          const person = others.find(p => p.user_id === item.from_user);
          if (item.kind === "offer") await answer(item.from_user, item.payload, person?.joined_at).catch(() => {});
          if (item.kind === "answer") {
            const peer = peers.current.get(item.from_user);
            if (peer?.pc.signalingState === "have-local-offer") await peer.pc.setRemoteDescription({ type: "answer", sdp: JSON.parse(item.payload).sdp }).catch(() => dropPeer(item.from_user));
          }
          if (item.kind === "bye") dropPeer(item.from_user);
        }
        for (const [userId, peer] of peers.current) {
          const person = others.find(p => p.user_id === userId);
          if (!person || (peer.joinedAt && person.joined_at !== peer.joinedAt)) dropPeer(userId);
        }
        for (const person of others) if (user.id < person.user_id && !peers.current.has(person.user_id)) await offerTo(person).catch(() => dropPeer(person.user_id));
      } catch { /* sem rede: tenta no próximo */ }
      finally { busy.current = false; }
    };
    beat();
    const timer = setInterval(beat, 2500);
    return () => clearInterval(timer);
  }, [state, user?.id]);
  // Mensagens: se ninguém atender em 50 s, desliga.
  useEffect(() => {
    if (!direct || state !== "live") return undefined;
    const timer = setTimeout(() => { if (!answered.current) { setState("error"); setError("Ninguém atendeu."); } }, 50000);
    return () => clearTimeout(timer);
  }, [direct, state]);
  const addPerson = async () => {
    const username = await ask({ title: "Adicionar à chamada", placeholder: "@nome de utilizador", confirmLabel: "Ligar" });
    if (!username?.trim()) return;
    try { await api(`${baseRef.current}/invite`, { method: "POST", body: { username: username.trim() } }); }
    catch (inviteError) { setError(inviteError.message); }
  };

  const toggleMic = () => { const next = !micOn; localRef.current?.getAudioTracks().forEach(track => { track.enabled = next; }); flags.current.muted = !next; setMicOn(next); };
  const toggleCam = () => { const next = !camOn; localRef.current?.getVideoTracks().forEach(track => { track.enabled = next; }); flags.current.camera = next; setCamOn(next); };
  // Trocar entre a câmara da frente e a de trás (sem voltar a ligar a ninguém).
  const flip = () => { localRef.current?.getVideoTracks().forEach(track => track._switchCamera?.()); };

  if (!webrtc) return <SafeAreaView style={styles.screen}>
    <Stack.Screen options={{ headerShown: false }} />
    <StatusBar style="light" />
    <View style={styles.message}>
      <Ionicons name="call" size={40} color="#fff" />
      <Text style={styles.messageTitle}>Chamadas na app instalada</Text>
      <Text style={styles.messageText}>As chamadas usam um módulo de vídeo que o Expo Go não tem. Na app instalada (Play Store, App Store ou versão de teste) funcionam. Por agora, entra pelo site.</Text>
      <Pressable style={styles.primary} onPress={() => Linking.openURL(`${WEB_URL}${webPath}`)}><Text style={styles.primaryText}>Abrir no site</Text></Pressable>
      <Pressable onPress={close} style={{ padding: 12 }}><Text style={styles.link}>Voltar</Text></Pressable>
    </View>
  </SafeAreaView>;

  const kind = call?.kind || wanted;
  const others = (call?.participants || []).filter(person => person.user_id !== user?.id);
  const meTile = { ...user, user_id: user?.id, muted: !micOn, camera: camOn };
  const total = others.length + 1;
  const tileHeight = total <= 1 ? 520 : total === 2 ? 300 : 220;
  const count = call?.participants.length || 1;
  const ringing = (call?.invited || []).filter(person => !person.declined);

  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <Stack.Screen options={{ headerShown: false }} />
    <StatusBar style="light" />
    <View style={styles.head}>
      <Text style={styles.headTitle} numberOfLines={1}>{name}</Text>
      <Text style={styles.headSub}>Chamada de {kind === "voice" ? "voz" : "vídeo"} · {count} {count === 1 ? "pessoa" : "pessoas"}</Text>
    </View>
    {state === "error" ? <View style={styles.message}>
      <Ionicons name="alert-circle-outline" size={40} color="#fff" />
      <Text style={styles.messageText}>{error}</Text>
      <Pressable style={styles.primary} onPress={close}><Text style={styles.primaryText}>Fechar</Text></Pressable>
    </View> : <ScrollView contentContainerStyle={styles.grid}>
      <View style={[styles.cell, total > 2 && styles.half]}><Tile person={meTile} stream={local} local kind={kind} height={tileHeight} /></View>
      {others.map(person => <View key={person.user_id} style={[styles.cell, total > 2 && styles.half]}>
        <Tile person={person} stream={remote[person.user_id]} kind={kind} height={tileHeight} />
      </View>)}
      {state === "starting" && <Text style={styles.wait}>A ligar o microfone{wanted === "video" ? " e a câmara" : ""}…</Text>}
      {state === "live" && (direct ? ringing.length > 0 : !others.length) && <Text style={styles.wait}>{direct
        ? `A chamar ${ringing.map(p => p.display_name).join(", ")}…` : "À espera dos outros membros… avisámos o grupo."}</Text>}
    </ScrollView>}
    <View style={styles.controls}>
      <Pressable style={[styles.btn, !micOn && styles.btnOff]} onPress={toggleMic} disabled={state !== "live"} accessibilityLabel={micOn ? "Desligar microfone" : "Ligar microfone"}>
        <Ionicons name={micOn ? "mic" : "mic-off"} size={24} color={micOn ? "#fff" : "#0b0b0c"} />
      </Pressable>
      {kind === "video" && <>
        <Pressable style={[styles.btn, !camOn && styles.btnOff]} onPress={toggleCam} disabled={state !== "live"} accessibilityLabel={camOn ? "Desligar câmara" : "Ligar câmara"}>
          <Ionicons name={camOn ? "videocam" : "videocam-off"} size={24} color={camOn ? "#fff" : "#0b0b0c"} />
        </Pressable>
        <Pressable style={styles.btn} onPress={flip} disabled={state !== "live" || !camOn} accessibilityLabel="Trocar de câmara">
          <Ionicons name="camera-reverse" size={24} color="#fff" />
        </Pressable>
      </>}
      {direct && <Pressable style={styles.btn} onPress={addPerson} disabled={state !== "live" || count >= 8} accessibilityLabel="Adicionar pessoa à chamada">
        <Ionicons name="person-add" size={22} color="#fff" />
      </Pressable>}
      <Pressable style={[styles.btn, styles.leave]} onPress={close} accessibilityLabel="Sair da chamada"><Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} /></Pressable>
    </View>
    {prompt}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0b0c" },
  head: { paddingHorizontal: 18, paddingVertical: 10 },
  headTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  headSub: { color: "rgba(255,255,255,0.65)", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 10, paddingBottom: 10 },
  cell: { width: "100%" },
  half: { width: "48.8%" },
  tile: { borderRadius: 18, overflow: "hidden", backgroundColor: "#1c1c1e" },
  tileAvatar: { flex: 1, alignItems: "center", justifyContent: "center" },
  tileName: { position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, maxWidth: "90%" },
  tileNameText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  wait: { width: "100%", textAlign: "center", color: "rgba(255,255,255,0.7)", padding: 16 },
  controls: { flexDirection: "row", justifyContent: "center", gap: 16, paddingVertical: 14 },
  btn: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  btnOff: { backgroundColor: "#fff" },
  leave: { backgroundColor: "#E30613" },
  message: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  messageTitle: { color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  messageText: { color: "rgba(255,255,255,0.8)", fontSize: 15, textAlign: "center", lineHeight: 21 },
  primary: { backgroundColor: "#fff", paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999, marginTop: 8 },
  primaryText: { color: "#0b0b0c", fontWeight: "800", fontSize: 16 },
  link: { color: "rgba(255,255,255,0.75)", fontWeight: "700" }
});
