// Barras de cima nativas. No iOS 26 são de vidro (Liquid Glass): transparentes por cima do conteúdo,
// que desliza por trás delas. Os ecrãs com scroll usam contentInsetAdjustmentBehavior="automatic"
// para começarem abaixo da barra; os ecrãs sem scroll usam useGlassHeaderPadding().
import { useHeaderHeight } from "expo-router/react-navigation";
import { Platform } from "react-native";
import { colors } from "./theme";

export const IS_GLASS_IOS = Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

export const nativeHeaderOptions = {
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text, fontWeight: "800" },
  headerBackButtonDisplayMode: "minimal",
  // Antes do iOS 26 e no Android: barra com desfoque/cor do sistema.
  headerBlurEffect: IS_GLASS_IOS ? undefined : "systemChromeMaterial",
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background }
};

// Espaço por baixo da barra de vidro para ecrãs sem scroll (só no iOS 26+, onde a barra fica por cima).
export function useGlassHeaderPadding() {
  const height = useHeaderHeight();
  return IS_GLASS_IOS ? height : 0;
}
