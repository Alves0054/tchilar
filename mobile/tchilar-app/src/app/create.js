import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/Avatar";
import { HeaderLogo } from "../components/HeaderLogo";
import { PhotoEditor } from "../components/PhotoEditor";
import { VideoEditor } from "../components/VideoEditor";
import { VideoPost } from "../components/VideoPost";
import { upload } from "../lib/api";
import { useKeyboardOverlap } from "../lib/keyboard";
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
  const [original, setOriginal] = useState(null);   // a foto antes de editar (para voltar a editar do zero)
  const [videoEdit, setVideoEdit] = useState(null); // { edit, track } — instruções do editor de vídeo
  const [editing, setEditing] = useState(false);
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();
  const [exclusive, setExclusive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async camera => {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError(camera ? "Permite o acesso à câmara nas definições do telemóvel." : "Permite o acesso às fotos nas definições do telemóvel.");
    const options = { mediaTypes: ["images", "videos"], quality: 0.85, videoMaxDuration: 180 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile(asset);
    setOriginal(asset);
    setVideoEdit(null);
    setEditing(true); // abre logo o editor (pode-se fechar sem mudar nada)
  };

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      const edit = file?.type === "video" && videoEdit?.edit ? JSON.stringify(videoEdit.edit) : undefined;
      await upload("/posts", { body: text.trim(), isExclusive: exclusive ? "true" : undefined, groupId, pageId, videoEdit: edit }, file);
      if (inTab) {
        setText(""); setFile(null); setOriginal(null); setVideoEdit(null); setExclusive(false);
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

  // A barra de baixo (foto, câmara, direto, exclusivo) sobe sempre por cima do teclado.
  return <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
    <View ref={keyboardRef} style={[styles.screen, { paddingBottom: keyboardOverlap }]}>
      {/* Este ecrã tem a barra de cima própria (sem a barra nativa): o logótipo entra aqui, como nas outras páginas. */}
      <View style={styles.logoBar}><HeaderLogo /></View>
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
            ? <VideoPost uri={file.uri} style={styles.previewMedia} edit={videoEdit?.edit} music={videoEdit?.track ? { audio_url: videoEdit.track.audio_url } : null} controls />
            : <Image source={{ uri: file.uri }} style={styles.previewMedia} contentFit="contain" />}
          <Pressable style={styles.removeFile} onPress={() => { setFile(null); setOriginal(null); setVideoEdit(null); }} accessibilityLabel="Retirar"><Ionicons name="close-circle" size={30} color="#fff" /></Pressable>
          <Pressable style={styles.editFile} onPress={() => setEditing(true)} accessibilityLabel="Editar">
            <Ionicons name={file.type === "video" ? "film" : "color-wand"} size={16} color="#fff" /><Text style={styles.editText}>Editar</Text>
          </Pressable>
        </View>}
        {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      {file?.type === "video"
        ? <VideoEditor asset={file} visible={editing} initial={videoEdit} onCancel={() => setEditing(false)}
          onDone={result => { setVideoEdit(result); setEditing(false); }} />
        : <PhotoEditor asset={original} visible={editing && Boolean(original)} onCancel={() => setEditing(false)}
          onDone={edited => { setFile(edited); setEditing(false); }} />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.toolsBar} contentContainerStyle={styles.tools}>
        <Pressable style={styles.tool} onPress={() => pick(false)}><Ionicons name="images" size={22} color="#30B350" /><Text style={styles.toolText}>Foto/vídeo</Text></Pressable>
        <Pressable style={styles.tool} onPress={() => pick(true)}><Ionicons name="camera" size={22} color="#0A84FF" /><Text style={styles.toolText}>Câmara</Text></Pressable>
        {!groupId && !pageId && <Pressable style={styles.tool} onPress={() => router.push("/live")} accessibilityLabel="Diretos: entrar em direto ou ver quem está ao vivo">
          <Ionicons name="radio" size={22} color="#D63384" /><Text style={styles.toolText}>Diretos</Text>
        </Pressable>}
        {user?.is_creator && !groupId && !pageId && <Pressable style={[styles.tool, exclusive && styles.toolOn]} onPress={() => setExclusive(!exclusive)}>
          <Ionicons name="lock-closed" size={20} color={exclusive ? "#fff" : "#AF52DE"} /><Text style={[styles.toolText, exclusive && { color: "#fff" }]}>Exclusivo</Text>
        </Pressable>}
      </ScrollView>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  logoBar: { alignItems: "center", paddingTop: 6, paddingBottom: 2 },
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
  editFile: { position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.6)" },
  editText: { color: "#fff", fontWeight: "800" },
  error: { color: colors.danger },
  toolsBar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  tools: { flexDirection: "row", gap: 8, padding: 12 },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 40, borderRadius: 20, backgroundColor: colors.background },
  toolOn: { backgroundColor: colors.accent },
  toolText: { color: colors.text, fontWeight: "700" }
});
