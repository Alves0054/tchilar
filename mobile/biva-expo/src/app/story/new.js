import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StoryBackground } from "../../components/StoryBackground";
import { upload } from "../../lib/api";
import { DEFAULT_STORY_BACKGROUND, STORY_COLORS, STORY_THEMES } from "../../lib/storyBackgrounds";
import { colors } from "../../lib/theme";

const BACKGROUNDS = [...STORY_THEMES, ...STORY_COLORS];

// Criar story: texto sobre um fundo do Tchilar (cor ou tema), ou uma foto/vídeo da galeria ou da câmara.
export default function NewStory() {
  const [text, setText] = useState("");
  const [background, setBackground] = useState(DEFAULT_STORY_BACKGROUND);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async camera => {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setError(camera ? "Permite o acesso à câmara nas definições do telemóvel." : "Permite o acesso às fotos nas definições do telemóvel.");
    const options = { mediaTypes: ["images", "videos"], quality: 0.85, videoMaxDuration: 60 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) setFile(result.assets[0]);
  };

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      await upload("/stories", { body: text.trim(), background: file ? undefined : background }, file);
      router.back();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };
  const ready = Boolean(file || text.trim());

  return <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="close" size={28} color="#fff" /></Pressable>
        <Text style={styles.title}>Criar story</Text>
        <Pressable style={[styles.share, !ready && { opacity: 0.4 }]} onPress={publish} disabled={!ready || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.shareText}>Partilhar</Text>}
        </Pressable>
      </View>

      <View style={styles.stage}>
        {file ? <>
          <Image source={{ uri: file.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          <Pressable style={styles.removeFile} onPress={() => setFile(null)}><Ionicons name="close-circle" size={32} color="#fff" /></Pressable>
          <TextInput style={styles.caption} value={text} onChangeText={setText} placeholder="Escreve uma legenda" placeholderTextColor="rgba(255,255,255,0.7)" maxLength={500} />
        </> : <StoryBackground backgroundKey={background} style={[StyleSheet.absoluteFill, styles.center]}>
          <TextInput style={styles.text} value={text} onChangeText={setText} placeholder="Escreve algo…" placeholderTextColor="rgba(255,255,255,0.8)"
            multiline maxLength={500} textAlign="center" autoFocus />
        </StoryBackground>}
      </View>

      {!file && <FlatList horizontal data={BACKGROUNDS} keyExtractor={item => item.key} showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.picker}
        renderItem={({ item }) => <Pressable onPress={() => setBackground(item.key)} accessibilityLabel={`Fundo ${item.label}`}>
          <StoryBackground backgroundKey={item.key} style={[styles.swatch, background === item.key && styles.swatchActive]} />
        </Pressable>} />}
      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
      <View style={styles.tools}>
        <Pressable style={styles.tool} onPress={() => pick(false)}><Ionicons name="images" size={22} color="#fff" /><Text style={styles.toolText}>Galeria</Text></Pressable>
        <Pressable style={styles.tool} onPress={() => pick(true)}><Ionicons name="camera" size={22} color="#fff" /><Text style={styles.toolText}>Câmara</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  title: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "800" },
  share: { backgroundColor: colors.primary, paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: "center" },
  shareText: { color: "#fff", fontWeight: "800" },
  stage: { flex: 1, marginHorizontal: 12, borderRadius: 18, overflow: "hidden", backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  text: { color: "#fff", fontSize: 28, fontWeight: "800", width: "100%", textShadowColor: "rgba(0,0,0,0.35)", textShadowRadius: 8 },
  caption: { position: "absolute", left: 16, right: 16, bottom: 20, color: "#fff", fontSize: 17, fontWeight: "700", textAlign: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 10 },
  removeFile: { position: "absolute", top: 10, right: 10 },
  picker: { paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: "#fff", transform: [{ scale: 1.1 }] },
  error: { color: "#FFB4B4", paddingHorizontal: 16 },
  tools: { flexDirection: "row", gap: 12, padding: 12 },
  tool: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", height: 46, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)" },
  toolText: { color: "#fff", fontWeight: "700" }
});
