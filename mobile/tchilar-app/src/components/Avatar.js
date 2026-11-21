import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { mediaUri } from "../lib/api";
import { colors } from "../lib/theme";

// Foto de perfil; sem foto, mostra a inicial do nome num círculo com a cor do Tchilar.
export function Avatar({ user, size = 44 }) {
  const uri = mediaUri(user?.avatar_url);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[styles.base, shape]} contentFit="cover" transition={150} />;
  const initial = (user?.display_name || user?.username || "?").trim().charAt(0).toUpperCase();
  return <View style={[styles.base, styles.fallback, shape]}>
    <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
  </View>;
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.primarySoft },
  fallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  initial: { color: colors.onPrimary, fontWeight: "800" }
});
