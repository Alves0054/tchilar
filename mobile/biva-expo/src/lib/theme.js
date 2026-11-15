// Cores do Tchilar (as mesmas do site), regra 60-30-10:
// 60% preto e branco (texto, ícones, estados ativos), 30% cinzentos neutros (cartões, chips, botões secundários),
// 10% vermelho (accent): só botões principais, notificações e destaques.
//
// Tema: Automático (segue o telemóvel), Claro ou Escuro, em Definições → Aparência. A escolha fica no cofre do
// telemóvel e lê-se ao abrir a app, antes de qualquer ecrã: as cores são fixas enquanto a app está aberta, por isso
// mudar de tema recarrega a app. Appearance.setColorScheme faz as barras nativas, o teclado e os menus seguirem o tema.
import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";

const THEME_KEY = "tchilar-theme";
export const THEME_OPTIONS = [["auto", "Automático"], ["light", "Claro"], ["dark", "Escuro"]];

const LIGHT = {
  primary: "#0B0B0C",
  onPrimary: "#FFFFFF",
  primarySoft: "#F1F1F2",
  accent: "#E30613",
  secondary: "#6E6E73",
  ink: "#0B0B0C",
  text: "#0B0B0C",
  muted: "#6E6E73",
  line: "#E5E5EA",
  surface: "#FFFFFF",
  background: "#F4F4F5",
  danger: "#D10A16",
  // Estados (avisos, etiquetas): fundo suave + texto legível em cada tema.
  good: "#1E7A4B", goodSoft: "#E3F6EC",
  warning: "#9A5B00", warningSoft: "#FFF1DC",
  dangerSoft: "#FDE7E7"
};
const DARK = {
  primary: "#F2F2F2",
  onPrimary: "#0B0B0C",
  primarySoft: "#2C2C2E",
  accent: "#E30613",
  secondary: "#A1A1A6",
  ink: "#1C1C1E",
  text: "#F2F2F2",
  muted: "#A1A1A6",
  line: "#2C2C2E",
  surface: "#161618",
  background: "#0B0B0C",
  danger: "#FF453A",
  good: "#4CD58A", goodSoft: "#12301F",
  warning: "#FFB547", warningSoft: "#33240C",
  dangerSoft: "#3A1414"
};

function readPreference() {
  try {
    const value = SecureStore.getItem(THEME_KEY);
    return ["light", "dark"].includes(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export const themePreference = readPreference();
if (themePreference !== "auto") {
  try { Appearance.setColorScheme(themePreference); } catch { /* versões antigas: segue o sistema */ }
}
export const isDark = (themePreference === "auto" ? Appearance.getColorScheme() : themePreference) === "dark";
export const colors = isDark ? DARK : LIGHT;

// Guarda a escolha. Devolve true se mudou (é preciso recarregar a app para aplicar).
export async function saveThemePreference(value) {
  const next = ["light", "dark"].includes(value) ? value : "auto";
  if (next === "auto") await SecureStore.deleteItemAsync(THEME_KEY); else await SecureStore.setItemAsync(THEME_KEY, next);
  return next !== themePreference;
}

export function relativeTime(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  if (seconds < 604800) return `há ${Math.floor(seconds / 86400)} d`;
  return new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}
