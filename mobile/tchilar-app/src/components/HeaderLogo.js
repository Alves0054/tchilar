import { Image } from "expo-image";
import { isDark } from "../lib/theme";

// Logótipo completo do Tchilar no centro da barra de cima, em todas as páginas.
export function HeaderLogo() {
  return <Image source={isDark ? require("../../assets/tchilar-splash-dark.png") : require("../../assets/tchilar-logo-full.png")} style={{ width: 115, height: 28 }} contentFit="contain" accessibilityLabel="Tchilar" />;
}
