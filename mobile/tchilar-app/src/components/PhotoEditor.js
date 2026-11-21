// Editor de fotos antes de publicar: efeitos, brilho/contraste/saturação, rodar, espelhar e cortar.
// Rodar, espelhar e cortar fazem-se com o expo-image-manipulator; os efeitos de cor com o Skia, numa
// imagem fora do ecrã. O resultado é um JPEG novo: a foto fica igual no site, na app e em qualquer leitor.
import { Ionicons } from "@expo/vector-icons";
import { Canvas, ColorMatrix, Image as SkImage, ImageFormat, Skia, useImage } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import { FlipType, ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { FILTERS, colorMatrix, hasColorEdit } from "../lib/media-edit";
import { colors } from "../lib/theme";
import { StableSlider } from "./StableSlider";
import { Chips } from "./ui";

const TOOLS = [["filter", "Efeitos"], ["adjust", "Ajustes"], ["crop", "Cortar"]];
const CROPS = [["original", "Original"], ["1:1", "Quadrado"], ["4:5", "4:5"], ["16:9", "16:9"]];
const ADJUST = [["brightness", "Brilho"], ["contrast", "Contraste"], ["saturation", "Saturação"]];
const MAX_SIDE = 2048;

// cropX/cropY: onde fica o recorte (0 = esquerda/topo, 0.5 = centro, 1 = direita/fundo). Muda-se a arrastar a moldura.
const INITIAL = { filter: "none", brightness: 100, contrast: 100, saturation: 100, rotate: 0, flip: false, crop: "original", cropX: 0.5, cropY: 0.5 };
// Espaço que o cabeçalho e o painel de ferramentas ocupam (a foto usa o resto do ecrã).
const HEAD_HEIGHT = 58;
const PANEL_HEIGHT = 250;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Recorte com a proporção pedida, na posição escolhida (centrado por omissão).
function cropRect(width, height, crop, cropX = 0.5, cropY = 0.5) {
  if (crop === "original") return null;
  const [w, h] = crop.split(":").map(Number);
  const target = w / h;
  if (width / height > target) {
    const cropWidth = Math.round(height * target);
    return { originX: Math.round((width - cropWidth) * clamp(cropX, 0, 1)), originY: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / target);
  return { originX: 0, originY: Math.round((height - cropHeight) * clamp(cropY, 0, 1)), width, height: cropHeight };
}

// Aplica rodar/espelhar/cortar/reduzir. Devolve { uri, width, height }.
async function applyGeometry(asset, edit) {
  const context = ImageManipulator.manipulate(asset.uri);
  if (edit.rotate) context.rotate(edit.rotate);
  if (edit.flip) context.flip(FlipType.Horizontal);
  const turned = edit.rotate % 180 !== 0;
  const width = turned ? asset.height : asset.width;
  const height = turned ? asset.width : asset.height;
  const rect = cropRect(width, height, edit.crop, edit.cropX, edit.cropY);
  if (rect) context.crop(rect);
  const finalWidth = rect ? rect.width : width;
  const finalHeight = rect ? rect.height : height;
  const scale = Math.min(1, MAX_SIDE / Math.max(finalWidth, finalHeight));
  if (scale < 1) context.resize({ width: Math.round(finalWidth * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

// Aplica o efeito de cor com o Skia e grava um JPEG na cache.
async function applyColor(photo, edit) {
  const data = await Skia.Data.fromURI(photo.uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error("Não foi possível ler a foto.");
  const surface = Skia.Surface.MakeOffscreen(image.width(), image.height());
  if (!surface) throw new Error("Não foi possível aplicar o efeito.");
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(colorMatrix(edit)));
  surface.getCanvas().drawImage(image, 0, 0, paint);
  surface.flush();
  const base64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 90);
  const file = new File(Paths.cache, `tchilar-foto-${Date.now()}.jpg`);
  await file.write(base64, { encoding: "base64" });
  return { uri: file.uri, width: image.width(), height: image.height() };
}

// fixedCrop: proporção obrigatória (ex.: "1:1" na foto de perfil) — esconde a escolha de corte.
export function PhotoEditor({ asset, visible, onCancel, onDone, fixedCrop = null, title = "Editar foto" }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [edit, setEdit] = useState(INITIAL);
  const [tool, setTool] = useState("filter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const image = useImage(asset?.uri || null);
  const start = fixedCrop ? { ...INITIAL, crop: fixedCrop } : INITIAL;
  useEffect(() => { if (visible) { setEdit(start); setTool("filter"); setError(""); } }, [visible, asset?.uri]);
  // Arrastar a moldura do recorte (fica guardado em cropX/cropY). Os valores do momento ficam em refs para o gesto.
  const geometry = useRef(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const pan = useMemo(() => {
    let start = null;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => Boolean(geometry.current?.rect),
      onMoveShouldSetPanResponder: (_, gesture) => Boolean(geometry.current?.rect) && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = { x: editRef.current.cropX, y: editRef.current.cropY }; },
      onPanResponderMove: (_, gesture) => {
        const current = geometry.current;
        if (!current?.rect || !start) return;
        const spareX = current.naturalW - current.rect.width;
        const spareY = current.naturalH - current.rect.height;
        setEdit(value => ({
          ...value,
          cropX: spareX > 0 ? clamp(start.x + gesture.dx / current.scale / spareX, 0, 1) : value.cropX,
          cropY: spareY > 0 ? clamp(start.y + gesture.dy / current.scale / spareY, 0, 1) : value.cropY
        }));
      }
    });
  }, []);
  if (!asset) return null;
  const set = patch => setEdit(current => ({ ...current, ...patch }));

  // Pré-visualização: a foto inteira (rodada) com o efeito; o corte aparece como moldura.
  // O tamanho vem do espaço livre no ecrã (telemóvel ou iPad, ao alto ou deitado): a foto nunca empurra as
  // ferramentas para fora do ecrã.
  const turned = edit.rotate % 180 !== 0;
  const naturalW = turned ? asset.height : asset.width;
  const naturalH = turned ? asset.width : asset.height;
  const maxW = Math.min(screenWidth - 16, 1000);
  const maxH = Math.max(160, screenHeight - insets.top - insets.bottom - HEAD_HEIGHT - PANEL_HEIGHT);
  const scale = Math.min(maxW / naturalW, maxH / naturalH);
  const shownW = naturalW * scale;
  const shownH = naturalH * scale;
  const boxH = shownH;
  const rect = cropRect(naturalW, naturalH, edit.crop, edit.cropX, edit.cropY);
  geometry.current = { rect, scale, naturalW, naturalH };

  const done = async () => {
    setBusy(true);
    setError("");
    try {
      let photo = await applyGeometry(asset, edit);
      if (hasColorEdit(edit)) photo = await applyColor(photo, edit);
      onDone({ ...asset, uri: photo.uri, width: photo.width, height: photo.height, type: "image", mimeType: "image/jpeg", fileName: "tchilar.jpg" });
    } catch (applyError) {
      setError(applyError.message || "Não foi possível guardar a edição.");
    } finally {
      setBusy(false);
    }
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={onCancel}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityLabel="Cancelar"><Ionicons name="close" size={28} color="#fff" /></Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable onPress={done} disabled={busy} style={styles.done}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.doneText}>Concluído</Text>}</Pressable>
      </View>

      <View style={[styles.stage, { height: boxH }]}>
        <View style={{ width: shownW, height: shownH, alignItems: "center", justifyContent: "center" }} {...pan.panHandlers}>
          {/* A foto desenha-se direita e é a vista que roda/espelha (como o manipulador: roda e depois espelha). */}
          {image && <Canvas style={{ width: asset.width * scale, height: asset.height * scale, transform: [{ scaleX: edit.flip ? -1 : 1 }, { rotate: `${edit.rotate}deg` }] }}>
            <SkImage image={image} x={0} y={0} width={asset.width * scale} height={asset.height * scale} fit="fill">
              <ColorMatrix matrix={colorMatrix(edit)} />
            </SkImage>
          </Canvas>}
          {rect && <View pointerEvents="none" style={[styles.cropFrame, { left: rect.originX * scale, top: rect.originY * scale, width: rect.width * scale, height: rect.height * scale }]} />}
        </View>
      </View>
      {rect && <Text style={styles.cropHint}>Arrasta a foto para escolher a parte que fica dentro da moldura.</Text>}

      <View style={styles.panel}>
        {tool === "filter" && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map(([id, label]) => <Pressable key={id} onPress={() => set({ filter: id })} style={styles.filterItem}>
            <View style={[styles.filterThumb, edit.filter === id && styles.filterOn]}>
              {image && <Canvas style={{ width: 64, height: 64 }}><SkImage image={image} x={0} y={0} width={64} height={64} fit="cover"><ColorMatrix matrix={colorMatrix({ filter: id })} /></SkImage></Canvas>}
            </View>
            <Text style={[styles.filterLabel, edit.filter === id && { color: "#fff" }]}>{label}</Text>
          </Pressable>)}
        </ScrollView>}
        {tool === "adjust" && <View style={styles.sliders}>
          {ADJUST.map(([key, label]) => <View key={key} style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>{label}</Text>
            <StableSlider style={{ flex: 1 }} minimumValue={50} maximumValue={150} step={1} value={edit[key]} onValueChange={value => set({ [key]: value })}
              accessibilityLabel={label}
              minimumTrackTintColor="#fff" maximumTrackTintColor="rgba(255,255,255,0.3)" thumbTintColor="#fff" />
            <Text style={styles.sliderValue}>{Math.round(edit[key] - 100)}</Text>
          </View>)}
        </View>}
        {tool === "crop" && <View style={{ gap: 12 }}>
          {!fixedCrop && <Chips options={CROPS} value={edit.crop} onChange={crop => set({ crop, cropX: 0.5, cropY: 0.5 })} />}
          <View style={styles.row}>
            <Pressable style={styles.action} onPress={() => set({ rotate: (edit.rotate + 90) % 360 })}><Ionicons name="refresh" size={20} color="#fff" /><Text style={styles.actionText}>Rodar</Text></Pressable>
            <Pressable style={[styles.action, edit.flip && styles.actionOn]} onPress={() => set({ flip: !edit.flip })}><Ionicons name="swap-horizontal" size={20} color="#fff" /><Text style={styles.actionText}>Espelhar</Text></Pressable>
            <Pressable style={styles.action} onPress={() => setEdit(start)}><Ionicons name="arrow-undo" size={20} color="#fff" /><Text style={styles.actionText}>Repor</Text></Pressable>
          </View>
        </View>}
        {Boolean(error) && <Text style={styles.error}>{error}</Text>}
        <View style={styles.tabs}>
          {TOOLS.map(([id, label]) => [id, id === "crop" && fixedCrop ? "Rodar" : label]).map(([id, label]) => <Pressable key={id} onPress={() => setTool(id)} style={styles.tab}>
            <Text style={[styles.tabText, tool === id && styles.tabOn]}>{label}</Text>
          </Pressable>)}
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  title: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "800" },
  done: { backgroundColor: colors.accent, paddingHorizontal: 16, height: 36, borderRadius: 18, justifyContent: "center" },
  doneText: { color: "#fff", fontWeight: "800" },
  stage: { alignItems: "center", justifyContent: "center", marginVertical: 8 },
  cropFrame: { position: "absolute", borderWidth: 2, borderColor: "#fff", shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 6 },
  panel: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 14, gap: 14, width: "100%", maxWidth: 720, alignSelf: "center" },
  cropHint: { color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center", paddingHorizontal: 16 },
  filters: { gap: 10, paddingVertical: 4 },
  filterItem: { alignItems: "center", gap: 6 },
  filterThumb: { width: 64, height: 64, borderRadius: 12, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  filterOn: { borderColor: "#fff" },
  filterLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  sliders: { gap: 6 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sliderLabel: { color: "#fff", width: 82, fontWeight: "700" },
  sliderValue: { color: "rgba(255,255,255,0.7)", width: 34, textAlign: "right" },
  row: { flexDirection: "row", gap: 10 },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)" },
  actionOn: { backgroundColor: colors.accent },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  error: { color: "#FF8A80" },
  tabs: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.2)" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: { color: "rgba(255,255,255,0.6)", fontWeight: "800" },
  tabOn: { color: "#fff" }
});
