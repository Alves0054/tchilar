// Escolher que parte da foto aparece na capa (como no site): a capa mostra uma faixa da imagem.
// Arrasta-se a foto com o dedo (para cima/baixo) ou usa-se a barra (0 = topo, 100 = fundo).
// Funciona igual no telemóvel e no iPad: a moldura tem a forma da capa e nunca passa da largura do ecrã.
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../lib/theme";
import { StableSlider } from "./StableSlider";
import { Button } from "./ui";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// aspect: largura ÷ altura da capa onde a foto vai aparecer (perfil ≈ 2,6; páginas ≈ 2).
export function CoverPositioner({ uri, visible, initial = 50, busy, onCancel, onSave, aspect = 2.6 }) {
  const { width: screenWidth } = useWindowDimensions();
  const frameWidth = Math.min(screenWidth - 24, 900);
  const frameHeight = Math.round(frameWidth / aspect);
  const [position, setPosition] = useState(initial);
  const [natural, setNatural] = useState(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => { if (visible) { setPosition(initial); setNatural(null); } }, [visible, uri]);

  // Quantos pontos da foto ficam escondidos na vertical (é isso que se pode deslocar).
  const hidden = natural ? Math.max(0, Math.max(frameWidth / natural.width, frameHeight / natural.height) * natural.height - frameHeight) : 0;
  const canMove = hidden > 1;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // Arrastar para baixo mostra mais do topo da foto (a posição diminui), como no site.
  const pan = useMemo(() => {
    let start = 50;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => hiddenRef.current > 1,
      onMoveShouldSetPanResponder: (_, gesture) => hiddenRef.current > 1 && Math.abs(gesture.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = positionRef.current; },
      onPanResponderMove: (_, gesture) => setPosition(clamp(start - (gesture.dy / hiddenRef.current) * 100, 0, 100))
    });
  }, []);

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" supportedOrientations={["portrait", "landscape"]} onRequestClose={onCancel}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.head}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button"><Text style={styles.cancel}>Cancelar</Text></Pressable>
        <Text style={styles.title}>Posição da capa</Text>
        <View style={{ width: 70 }} />
      </View>
      <Text style={styles.hint}>{canMove || !natural ? "Arrasta a foto ou usa a barra para escolher a parte que aparece na capa." : "Esta foto já aparece inteira na capa: não há nada para ajustar."}</Text>
      <View style={[styles.frame, { width: frameWidth, height: frameHeight }]} {...pan.panHandlers}
        accessibilityLabel="Pré-visualização da capa. Arrasta para cima ou para baixo.">
        {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: `${position}%`, left: "50%" }}
          onLoad={event => setNatural(event.source?.width && event.source?.height ? { width: event.source.width, height: event.source.height } : null)} />}
      </View>
      <View style={[styles.controls, { width: frameWidth }]}>
        <Text style={styles.label}>Topo</Text>
        <StableSlider style={{ flex: 1 }} minimumValue={0} maximumValue={100} step={1} value={Math.round(position)} onValueChange={setPosition}
          disabled={Boolean(natural) && !canMove} accessibilityLabel="Posição vertical da capa"
          minimumTrackTintColor={colors.text} maximumTrackTintColor={colors.line} thumbTintColor={colors.text} />
        <Text style={styles.label}>Fundo</Text>
      </View>
      <View style={[styles.save, { width: frameWidth }]}><Button label="Guardar capa" busy={busy} onPress={() => onSave(Math.round(position))} /></View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", backgroundColor: colors.background },
  head: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  cancel: { color: colors.text, fontWeight: "700", width: 70 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  hint: { color: colors.muted, textAlign: "center", paddingHorizontal: 20, marginBottom: 12, maxWidth: 560 },
  frame: { backgroundColor: colors.ink, overflow: "hidden", borderRadius: 14 },
  controls: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  save: { paddingVertical: 16 }
});
