import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/Avatar";
import { upload } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

// Publicar no feed: texto, foto ou vídeo (galeria ou câmara). Criadores podem marcar como exclusivo.
// inTab: usado no separador "Publicar" (sem botão de fechar; depois de publicar, vai para o Início).
// /create?groupId=1&targetName=... publica num grupo; /create?pageId=2 numa página.
export default function Create() {
  const { groupId, pageId, targetName } = useLocalSearchParams();
  return <CreatePost groupId={groupId} pageId={pageId} targetName={targetName} />;
}

export function CreatePost({ inTab = false, groupId, pageId, targetName }) {
  const { user } = useSession();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [exclusive, setExclusive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async camera => {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError(camera ? "Permite o acesso à câmara nas definições do telemóvel." : "Permite o acesso às fotos nas definições do telemóvel.");
    const options = { mediaTypes: ["images", "videos"], quality: 0.85, videoMaxDuration: 180 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) setFile(result.assets[0]);
  };

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      await upload("/posts", { body: text.trim(), isExclusive: exclusive ? "true" : undefined, groupId, pageId }, file);
      if (inTab) {
        setText(""); setFile(null); setExclusive(false);
        router.navigate("/");
      } else {
        router.back();
      }
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };
  const ready = Boolean(text.trim() || file);

  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.head}>
        {!inTab && <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="close" size={28} color={colors.text} /></Pressable>}
        <Text style={styles.title} numberOfLines={1}>{targetName ? `Publicar em ${targetName}` : "Criar publicação"}</Text>
        <Pressable style={[styles.publish, (!ready || busy) && { opacity: 0.4 }]} onPress={publish} disabled={!ready || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishText}>Publicar</Text>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.author}>
          <Avatar user={user} size={44} />
          <View><Text style={styles.name}>{user?.display_name}</Text><Text style={styles.audience}>{exclusive ? "Só subscritores" : "Público"}</Text></View>
        </View>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={`Em que estás a pensar, ${user?.display_name?.split(" ")[0] || ""}?`}
          placeholderTextColor={colors.muted} multiline maxLength={5000} autoFocus={!inTab} />
        {file && <View style={styles.preview}>
          {file.type === "video"
            ? <View style={[styles.previewMedia, styles.video]}><Ionicons name="videocam" size={40} color="#fff" /><Text style={styles.videoText}>Vídeo pronto a publicar</Text></View>
            : <Image source={{ uri: file.uri }} style={styles.previewMedia} contentFit="cover" />}
          <Pressable style={styles.removeFile} onPress={() => setFile(null)} accessibilityLabel="Retirar"><Ionicons name="close-circle" size={30} color="#fff" /></Pressable>
        </View>}
        {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.tools}>
        <Pressable style={styles.tool} onPress={() => pick(false)}><Ionicons name="images" size={22} color="#2EAA6B" /><Text style={styles.toolText}>Foto/vídeo</Text></Pressable>
        <Pressable style={styles.tool} onPress={() => pick(true)}><Ionicons name="camera" size={22} color={colors.primary} /><Text style={styles.toolText}>Câmara</Text></Pressable>
        {user?.is_creator && !groupId && !pageId && <Pressable style={[styles.tool, exclusive && styles.toolOn]} onPress={() => setExclusive(!exclusive)}>
          <Ionicons name="lock-closed" size={20} color={exclusive ? "#fff" : colors.accent} /><Text style={[styles.toolText, exclusive && { color: "#fff" }]}>Exclusivo</Text>
        </Pressable>}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: "800" },
  publish: { backgroundColor: colors.accent, paddingHorizontal: 18, height: 38, borderRadius: 19, justifyContent: "center" },
  publishText: { color: "#fff", fontWeight: "800" },
  body: { padding: 14, gap: 12 },
  author: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: colors.text, fontWeight: "800", fontSize: 16 },
  audience: { color: colors.muted, fontSize: 13 },
  input: { minHeight: 120, fontSize: 18, color: colors.text, textAlignVertical: "top" },
  preview: { borderRadius: 14, overflow: "hidden" },
  previewMedia: { width: "100%", aspectRatio: 1, backgroundColor: colors.primarySoft },
  video: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, gap: 8 },
  videoText: { color: "#fff" },
  removeFile: { position: "absolute", top: 8, right: 8 },
  error: { color: colors.danger },
  tools: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 40, borderRadius: 20, backgroundColor: colors.background },
  toolOn: { backgroundColor: colors.accent },
  toolText: { color: colors.text, fontWeight: "700" }
});
