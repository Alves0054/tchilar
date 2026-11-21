// Aparência que fica neste telemóvel (Definições → Aparência), lida ao abrir a app como o tema:
// - tamanho do texto das publicações e comentários (soma-se ao tamanho de letra do sistema);
// - vídeos do Início a tocar sozinhos, sem som, quando aparecem no ecrã (ou só ao tocar, para poupar dados).
import * as SecureStore from "expo-secure-store";

const TEXT_KEY = "tchilar-text-size";
const AUTOPLAY_KEY = "tchilar-autoplay";
export const TEXT_SIZES = [["normal", "Normal", 1], ["large", "Grande", 1.15], ["xlarge", "Muito grande", 1.3]];
export const AUTOPLAY_OPTIONS = [["always", "Sempre", "Tocam sozinhos, sem som, quando aparecem"], ["never", "Só quando toco", "Poupa dados móveis"]];

const read = (key, allowed, fallback) => {
  try { const value = SecureStore.getItem(key); return allowed.includes(value) ? value : fallback; } catch { return fallback; }
};
export const textSize = read(TEXT_KEY, TEXT_SIZES.map(([value]) => value), "normal");
export const textScale = TEXT_SIZES.find(([value]) => value === textSize)[2];
export const autoplay = read(AUTOPLAY_KEY, AUTOPLAY_OPTIONS.map(([value]) => value), "always");

// Tamanho de letra já com a escala escolhida.
export const fontSize = size => Math.round(size * textScale);

export async function saveTextSize(value) { await SecureStore.setItemAsync(TEXT_KEY, value); return value !== textSize; }
export async function saveAutoplay(value) { await SecureStore.setItemAsync(AUTOPLAY_KEY, value); return value !== autoplay; }
