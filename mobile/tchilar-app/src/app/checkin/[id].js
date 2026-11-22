// Modo entrada: quem organiza um evento lê os QR dos bilhetes, um atrás do outro, sem sair do ecrã.
// Cada leitura pergunta ao servidor (POST /events/:id/check-in) e mostra o resultado em ecrã inteiro:
// verde "Pode entrar" com o nome, ou vermelho (já entrou / inválido / outro evento), com vibração.
// O QR leva a ligação https://tchilar.ao/events/:id?checkin=CÓDIGO; também aceita só o código.
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../lib/api";

const RESULT_MS = 1800;          // tempo que o verde/vermelho fica no ecrã antes de ler o próximo
const SAME_CODE_MS = 4000;       // o mesmo QR à frente da câmara não é lido duas vezes seguidas

// Tira o evento e o código de um QR do Tchilar (ou aceita um código escrito).
function readTicketQr(data) {
  const text = String(data || "").trim();
  try {
    const url = new URL(text);
    const match = url.pathname.match(/\/events\/(\d+)\/?$/);
    const code = url.searchParams.get("checkin");
    if (match && code) return { eventId: Number(match[1]), code };
    return null;
  } catch {
    const code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length >= 6 && code.length <= 16 ? { eventId: null, code } : null;
  }
}

export default function CheckIn() {
  const { id } = useLocalSearchParams();
  const eventId = Number(id);
  const [permission, requestPermission] = useCameraPermissions();
  const [stats, setStats] = useState(null);
  const [event, setEvent] = useState(null);
  const [result, setResult] = useState(null);       // { ok, title, detail }
  const [torch, setTorch] = useState(false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const busy = useRef(false);
  const last = useRef({ code: "", at: 0 });
  const timer = useRef(null);

  const loadStats = useCallback(() => api(`/events/${eventId}/tickets`).then(setStats).catch(() => {}), [eventId]);
  useEffect(() => {
    api(`/events/${eventId}`).then(data => setEvent(data.event)).catch(() => {});
    loadStats();
    return () => clearTimeout(timer.current);
  }, [eventId, loadStats]);

  const show = next => {
    setResult(next);
    Vibration.vibrate(next.ok ? 90 : [0, 220, 120, 220]);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setResult(null); busy.current = false; }, RESULT_MS);
  };

  const validate = async ticketCode => {
    try {
      const response = await api(`/events/${eventId}/check-in`, { method: "POST", body: { code: ticketCode } });
      show({ ok: true, title: "Pode entrar", detail: `${response.person.display_name} · @${response.person.username}` });
      loadStats();
    } catch (checkError) {
      show({ ok: false, title: /já entrou/.test(checkError.message) ? "Já entrou" : "Não entra", detail: checkError.message });
    }
  };

  const onScan = ({ data }) => {
    if (busy.current || result) return;
    const ticket = readTicketQr(data);
    const now = Date.now();
    if (ticket && ticket.code === last.current.code && now - last.current.at < SAME_CODE_MS) return;
    busy.current = true;
    last.current = { code: ticket?.code || String(data), at: now };
    if (!ticket) return show({ ok: false, title: "Não é um bilhete", detail: "Este QR não é de um bilhete do Tchilar." });
    if (ticket.eventId && ticket.eventId !== eventId) return show({ ok: false, title: "Outro evento", detail: "Este bilhete é de outro evento." });
    validate(ticket.code);
  };

  const submitCode = () => {
    const ticket = readTicketQr(code);
    if (!ticket) return;
    setCode(""); setTyping(false);
    busy.current = true;
    validate(ticket.code);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace(`/event/${eventId}`));
  const counter = stats ? `${stats.checked_in} de ${stats.sold} já entraram` : "A carregar...";

  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return <SafeAreaView style={[styles.screen, styles.center]}>
      <Ionicons name="camera-outline" size={48} color="#fff" />
      <Text style={styles.askTitle}>Câmara para ler os bilhetes</Text>
      <Text style={styles.askText}>O Tchilar usa a câmara só neste ecrã, para ler o QR de cada bilhete à entrada.</Text>
      <Pressable style={styles.askButton} onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}>
        <Text style={styles.askButtonText}>{permission.canAskAgain ? "Permitir a câmara" : "Abrir as definições"}</Text>
      </Pressable>
      <Pressable onPress={close} style={{ marginTop: 16 }}><Text style={styles.link}>Voltar</Text></Pressable>
    </SafeAreaView>;
  }

  return <View style={styles.screen}>
    <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={result || typing ? undefined : onScan} />

    <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Pressable onPress={close} hitSlop={12} accessibilityLabel="Fechar" style={styles.round}><Ionicons name="close" size={24} color="#fff" /></Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title} numberOfLines={1}>{event?.name || "Bilhetes à entrada"}</Text>
          <Text style={styles.counter}>{counter}</Text>
        </View>
        <Pressable onPress={() => setTorch(on => !on)} hitSlop={12} accessibilityLabel="Lanterna" style={styles.round}>
          <Ionicons name={torch ? "flashlight" : "flashlight-outline"} size={22} color="#fff" /></Pressable>
      </View>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Aponta para o QR do bilhete</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {typing ? <View style={styles.typeBox}>
          <TextInput value={code} onChangeText={value => setCode(value.toUpperCase())} placeholder="Código do bilhete" placeholderTextColor="#8E8E93"
            autoCapitalize="characters" autoCorrect={false} autoFocus maxLength={16} style={styles.input} onSubmitEditing={submitCode} returnKeyType="done" />
          <Pressable style={styles.typeButton} onPress={submitCode}><Text style={styles.typeButtonText}>Validar</Text></Pressable>
        </View>
          : <Pressable style={styles.manual} onPress={() => setTyping(true)}>
            <Ionicons name="keypad-outline" size={18} color="#fff" /><Text style={styles.manualText}>Escrever o código</Text>
          </Pressable>}
      </KeyboardAvoidingView>
    </SafeAreaView>

    {result && <View style={[StyleSheet.absoluteFill, styles.result, { backgroundColor: result.ok ? "#1E9E4A" : "#D70015" }]}>
      <Ionicons name={result.ok ? "checkmark-circle" : "close-circle"} size={96} color="#fff" />
      <Text style={styles.resultTitle}>{result.title}</Text>
      <Text style={styles.resultDetail}>{result.detail}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  overlay: { flex: 1, justifyContent: "space-between" },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  counter: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600", marginTop: 2 },
  frameWrap: { alignItems: "center", gap: 14 },
  frame: { width: 250, height: 250, borderRadius: 28, borderWidth: 4, borderColor: "#fff" },
  hint: { color: "#fff", fontWeight: "700", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: "hidden" },
  manual: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 8, marginBottom: 18, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)" },
  manualText: { color: "#fff", fontWeight: "700" },
  typeBox: { flexDirection: "row", gap: 8, margin: 16, padding: 8, borderRadius: 18, backgroundColor: "#fff" },
  input: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: 3, paddingHorizontal: 10, color: "#111" },
  typeButton: { paddingHorizontal: 18, justifyContent: "center", borderRadius: 12, backgroundColor: "#E30613" },
  typeButtonText: { color: "#fff", fontWeight: "800" },
  result: { alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  resultTitle: { color: "#fff", fontSize: 40, fontWeight: "900" },
  resultDetail: { color: "#fff", fontSize: 19, fontWeight: "700", textAlign: "center" },
  askTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  askText: { color: "rgba(255,255,255,0.8)", textAlign: "center" },
  askButton: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999, backgroundColor: "#E30613" },
  askButtonText: { color: "#fff", fontWeight: "800" },
  link: { color: "#fff", fontWeight: "700" }
});
