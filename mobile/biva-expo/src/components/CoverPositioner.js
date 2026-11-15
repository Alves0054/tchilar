// Escolher que parte da foto aparece na capa (como no site): a capa mostra uma faixa da imagem; o
// controlo desliza essa faixa para cima ou para baixo (0 = topo, 100 = fundo).
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../lib/theme";
import { Button } from "./ui";

export function CoverPositioner({ uri, visible, initial = 50, busy, onCancel, onSave }) {
  const { width } = useWindowDimensions();
  const [position, setPosition] = useState(initial);
  useEffect(() => { if (visible) setPosition(initial); }, [visible, uri]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <Pressable onPress={onCancel} hitSlop={12}><Text style={styles.cancel}>Cancelar</Text></Pressable>
        <Text style={styles.title}>Posição da capa</Text>
        <View style={{ width: 70 }} />
      </View>
      <Text style={styles.hint}>Desliza para escolher que parte da foto aparece na capa.</Text>
      <View style={[styles.frame, { width, height: Math.round(width / 2.6) }]}>
        {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: `${position}%`, left: "50%" }} />}
      </View>
      <View style={styles.controls}>
        <Text style={styles.label}>Topo</Text>
        <Slider style={{ flex: 1 }} minimumValue={0} maximumValue={100} step={1} value={position} onValueChange={setPosition}
          minimumTrackTintColor={colors.text} maximumTrackTintColor={colors.line} thumbTintColor={colors.text} />
        <Text style={styles.label}>Fundo</Text>
      </View>
      <View style={{ padding: 16 }}><Button label="Guardar capa" busy={busy} onPress={() => onSave(Math.round(position))} /></View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  cancel: { color: colors.text, fontWeight: "700", width: 70 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  hint: { color: colors.muted, textAlign: "center", paddingHorizontal: 20, marginBottom: 12 },
  frame: { backgroundColor: colors.ink, overflow: "hidden" },
  controls: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, marginTop: 16 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700" }
});
