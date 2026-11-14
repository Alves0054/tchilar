// Escolher uma música para um vídeo: biblioteca do Tchilar e as músicas que a pessoa carregou.
// Toca uma pré-visualização; "Carregar música" envia um ficheiro do telemóvel (com confirmação de direitos).
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useAudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, mediaUri, upload } from "../lib/api";
import { audioDuration } from "../lib/audio";
import { colors } from "../lib/theme";

export function MusicPicker({ visible, onClose, onChoose }) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewUri, setPreviewUri] = useState(null);
  const preview = useAudioPlayer(previewUri ? { uri: previewUri } : null);

  const load = () => api(`/music${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`)
    .then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [visible, query]);
  useEffect(() => { if (previewUri) preview.play(); }, [previewUri, preview]);
  useEffect(() => { if (!visible) { preview.pause(); setPreviewId(null); } }, [visible]);

  const toggle = track => {
    if (previewId === track.id) { preview.pause(); setPreviewId(null); return; }
    setPreviewId(track.id);
    setPreviewUri(mediaUri(track.audio_url));
  };
  const choose = track => { preview.pause(); setPreviewId(null); onChoose(track); };

  const uploadTrack = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
    if (picked.canceled) return;
    const file = picked.assets[0];
    Alert.alert("Carregar música", "Confirmas que tens direitos para usar esta música (é tua ou tens licença)?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmo", onPress: async () => {
        setBusy(true);
        try {
          const title = (file.name || "Música").replace(/\.[^.]+$/, "").slice(0, 100);
          const duration = await audioDuration(file.uri);
          const result = await upload("/music", { title, duration: Math.round(duration * 100) / 100, rightsConfirmed: "true" }, { uri: file.uri, mimeType: file.mimeType || "audio/mpeg", fileName: file.name }, "audio");
          await load();
          choose(result.track);
        } catch (uploadError) {
          setError(uploadError.message);
        } finally {
          setBusy(false);
        }
      } }
    ]);
  };

  const rows = data ? [
    ...(data.mine.length ? [{ header: "As tuas músicas" }, ...data.mine] : []),
    { header: "Biblioteca do Tchilar" }, ...data.library
  ] : [];

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Text style={styles.title}>Música</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar"><Ionicons name="close" size={26} color={colors.text} /></Pressable>
      </View>
      <TextInput style={styles.search} placeholder="Procurar música ou artista" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} />
      <Pressable style={styles.upload} onPress={uploadTrack} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="cloud-upload" size={20} color="#0A84FF" />}
        <Text style={styles.uploadText}>Carregar música do telemóvel</Text>
      </Pressable>
      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      {!data && !error && <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />}
      <FlatList data={rows} keyExtractor={(item, index) => item.header ? `h${index}` : String(item.id)}
        renderItem={({ item }) => item.header ? <Text style={styles.section}>{item.header}</Text>
          : <View style={styles.row}>
            <Pressable style={styles.play} onPress={() => toggle(item)} accessibilityLabel={previewId === item.id ? `Parar ${item.title}` : `Ouvir ${item.title}`}>
              <Ionicons name={previewId === item.id ? "pause" : "play"} size={18} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.track} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.artist} numberOfLines={1}>{item.artist || "Artista desconhecido"}{item.genre ? ` · ${item.genre}` : ""}</Text>
            </View>
            <Pressable style={styles.use} onPress={() => choose(item)}><Text style={styles.useText}>Usar</Text></Pressable>
          </View>}
        ListEmptyComponent={data ? <Text style={styles.empty}>Sem músicas com esse nome.</Text> : null}
      />
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", padding: 14 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: "800" },
  search: { marginHorizontal: 14, height: 44, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.background, color: colors.text, fontSize: 16 },
  upload: { flexDirection: "row", alignItems: "center", gap: 8, margin: 14, marginBottom: 4 },
  uploadText: { color: colors.text, fontWeight: "700" },
  error: { color: colors.danger, paddingHorizontal: 14 },
  section: { color: colors.text, fontWeight: "800", fontSize: 16, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  track: { color: colors.text, fontWeight: "700" },
  artist: { color: colors.muted, fontSize: 13 },
  use: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, justifyContent: "center" },
  useText: { color: colors.text, fontWeight: "800" },
  empty: { color: colors.muted, textAlign: "center", padding: 20 }
});
