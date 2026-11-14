import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { findBackground } from "../lib/storyBackgrounds";

// Fundo de um story de texto: gradiente (cores) ou imagem ilustrada (temas do Tchilar).
export function StoryBackground({ backgroundKey, style, children }) {
  const background = findBackground(backgroundKey);
  if (background.image) {
    return <View style={[styles.fill, style]}>
      <Image source={background.image} style={StyleSheet.absoluteFill} contentFit="cover" />
      {children}
    </View>;
  }
  return <LinearGradient colors={background.colors} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.fill, style]}>{children}</LinearGradient>;
}

const styles = StyleSheet.create({ fill: { overflow: "hidden" } });
