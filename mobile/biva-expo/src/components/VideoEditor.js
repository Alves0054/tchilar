// Editor de vídeo antes de publicar (Reels e feed): cortar, velocidade, efeitos, ajustes, texto, som e música.
// Não altera o ficheiro: devolve as instruções (videoEdit) que o servidor guarda e todos os leitores aplicam.
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DEFAULT_VIDEO_EDIT, FILTERS, MAX_CLIP_SECONDS, SPEEDS, TEXT_POSITIONS, TEXT_STYLES, clock, serializeVideoEdit } from "../lib/media-edit";
import { colors } from "../lib/theme";
import { MusicPicker } from "./MusicPicker";
import { Chips } from "./ui";
import { VideoPost } from "./VideoPost";

const TOOLS = [["cut", "cut", "Cortar"], ["speed", "speedometer", "Velocidade"], ["filter", "color-filter", "Efeitos"], ["adjust", "options", "Ajustes"],
  ["text", "text", "Texto"], ["sound", "musical-notes", "Som"]];
const ADJUST = [["brightness", "Brilho"], ["contrast", "Contraste"], ["saturation", "Saturação"]];

const darkSlider = { minimumTrackTintColor: "#fff", maximumTrackTintColor: "rgba(255,255,255,0.3)", thumbTintColor: "#fff" };

export function VideoEditor({ asset, visible, initial, onCancel, onDone }) {
  const { width } = useWindowDimensions();
  const duration = Math.max(0.5, (asset?.duration || 0) / 1000 || 60); // o ImagePicker dá milissegundos
  const [edit, setEdit] = useState(DEFAULT_VIDEO_EDIT);
  const [track, setTrack] = useState(null);           // a música escolhida (para mostrar o nome e tocar)
  const [tool, setTool] = useState("cut");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setEdit({ ...DEFAULT_VIDEO_EDIT, ...(initial?.edit || {}) });
    setTrack(initial?.track || null);
    setTool("cut");
  }, [visible, asset?.uri]);
  if (!asset) return null;
  const set = patch => setEdit(current => ({ ...current, ...patch }));
  const end = edit.end ?? Math.min(duration, MAX_CLIP_SECONDS);
  const clipLength = end - edit.start;
  const tooLong = clipLength > MAX_CLIP_SECONDS + 0.5;
  const previewHeight = Math.min(width * 1.1, 460);

  const finish = () => onDone({ edit: serializeVideoEdit({ ...edit, end: edit.end !== null && edit.end < duration - 0.1 ? edit.end : null }), track });

  return <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityLabel="Cancelar"><Ionicons name="close" size={28} color="#fff" /></Pressable>
        <Text style={styles.title}>Editar vídeo</Text>
        <Pressable onPress={finish} disabled={tooLong} style={[styles.done, tooLong && { opacity: 0.4 }]}><Text style={styles.doneText}>Concluído</Text></Pressable>
      </View>

      <VideoPost uri={asset.uri} playing edit={{ ...edit, music: edit.music }} music={track ? { audio_url: track.audio_url } : null}
        style={{ width, height: previewHeight }} controls={false} />

      <ScrollView style={styles.panel} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
        {tool === "cut" && <>
          <Text style={styles.label}>Início · {clock(edit.start)}</Text>
          <Slider minimumValue={0} maximumValue={Math.max(0, duration - 0.5)} step={0.1} value={edit.start} {...darkSlider}
            onSlidingComplete={value => set({ start: Math.min(value, end - 0.5) })} />
          <Text style={styles.label}>Fim · {clock(end)}</Text>
          <Slider minimumValue={0.5} maximumValue={duration} step={0.1} value={end} {...darkSlider}
            onSlidingComplete={value => set({ end: Math.max(value, edit.start + 0.5) })} />
          <Text style={[styles.hint, tooLong && { color: "#FF8A80" }]}>
            {tooLong ? `Um vídeo pode ter até ${MAX_CLIP_SECONDS / 60} minutos. Encurta o corte.` : `Duração final: ${clock(clipLength / edit.speed)}`}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>Espelhar</Text>
            <Switch value={edit.mirror} onValueChange={mirror => set({ mirror })} trackColor={{ true: colors.accent }} />
          </View>
        </>}

        {tool === "speed" && <Chips options={SPEEDS} value={edit.speed} onChange={speed => set({ speed })} />}

        {tool === "filter" && <Chips options={FILTERS.map(([id, label]) => [id, label])} value={edit.filter} onChange={filter => set({ filter })} />}

        {tool === "adjust" && ADJUST.map(([key, label]) => <View key={key} style={styles.row}>
          <Text style={[styles.label, { width: 82 }]}>{label}</Text>
          <Slider style={{ flex: 1 }} minimumValue={50} maximumValue={150} step={1} value={edit[key]} {...darkSlider} onSlidingComplete={value => set({ [key]: value })} />
          <Text style={styles.value}>{Math.round(edit[key] - 100)}</Text>
        </View>)}

        {tool === "text" && <>
          <TextInput style={styles.input} value={edit.text} onChangeText={text => set({ text })} maxLength={80}
            placeholder="Escreve um texto por cima do vídeo" placeholderTextColor="rgba(255,255,255,0.5)" />
          <Chips options={TEXT_POSITIONS} value={edit.textPosition} onChange={textPosition => set({ textPosition })} />
          <Chips options={TEXT_STYLES} value={edit.textStyle} onChange={textStyle => set({ textStyle })} />
        </>}

        {tool === "sound" && <>
          <View style={styles.row}>
            <Text style={[styles.label, { width: 110 }]}>Som do vídeo</Text>
            <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} step={0.05} value={edit.originalVolume} {...darkSlider} onSlidingComplete={originalVolume => set({ originalVolume })} />
            <Text style={styles.value}>{Math.round(edit.originalVolume * 100)}%</Text>
          </View>
          <Pressable style={styles.music} onPress={() => setPicking(true)}>
            <Ionicons name="musical-notes" size={20} color="#fff" />
            <Text style={styles.musicText} numberOfLines={1}>{track ? `${track.title}${track.artist ? ` · ${track.artist}` : ""}` : "Adicionar música"}</Text>
            {track && <Pressable hitSlop={10} onPress={() => { setTrack(null); set({ music: null }); }} accessibilityLabel="Retirar música"><Ionicons name="close-circle" size={20} color="#fff" /></Pressable>}
          </Pressable>
          {edit.music && <>
            <View style={styles.row}>
              <Text style={[styles.label, { width: 110 }]}>Volume</Text>
              <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={1} step={0.05} value={edit.music.volume} {...darkSlider} onSlidingComplete={volume => set({ music: { ...edit.music, volume } })} />
              <Text style={styles.value}>{Math.round(edit.music.volume * 100)}%</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.label, { width: 110 }]}>Começa em</Text>
              <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={Math.max(1, Math.min(900, (track?.duration || 60) - 1))} step={0.5}
                value={edit.music.offset} {...darkSlider} onSlidingComplete={offset => set({ music: { ...edit.music, offset } })} />
              <Text style={styles.value}>{clock(edit.music.offset)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Entrada e saída suaves</Text>
              <Switch value={edit.music.fade !== false} onValueChange={fade => set({ music: { ...edit.music, fade } })} trackColor={{ true: colors.accent }} />
            </View>
          </>}
        </>}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolsBar} contentContainerStyle={styles.tools}>
        {TOOLS.map(([id, icon, label]) => <Pressable key={id} style={styles.tool} onPress={() => setTool(id)}>
          <Ionicons name={icon} size={22} color={tool === id ? "#fff" : "rgba(255,255,255,0.55)"} />
          <Text style={[styles.toolText, tool === id && { color: "#fff" }]}>{label}</Text>
        </Pressable>)}
      </ScrollView>

      <MusicPicker visible={picking} onClose={() => setPicking(false)} onChoose={chosen => {
        setPicking(false);
        setTrack(chosen);
        set({ music: { trackId: chosen.id, offset: 0, volume: 1, fade: true }, originalVolume: edit.originalVolume === 1 ? 0.3 : edit.originalVolume });
      }} />
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  title: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "800" },
  done: { backgroundColor: colors.accent, paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: "center" },
  doneText: { color: "#fff", fontWeight: "800" },
  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  label: { color: "#fff", fontWeight: "700" },
  hint: { color: "rgba(255,255,255,0.65)" },
  value: { color: "rgba(255,255,255,0.7)", width: 44, textAlign: "right" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" },
  input: { minHeight: 46, borderRadius: 12, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 16 },
  music: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" },
  musicText: { flex: 1, color: "#fff", fontWeight: "700" },
  toolsBar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.2)" },
  tools: { paddingHorizontal: 8 },
  tool: { alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 10 },
  toolText: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700" }
});
