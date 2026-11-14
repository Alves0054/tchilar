// Efeitos e ajustes de fotos e vídeos, iguais aos do site (src/modules/core.jsx).
// Vídeo: a edição é guardada como instruções (post.video_edit) e aplicada no leitor; o ficheiro não muda.
// Foto: a edição é aplicada à imagem antes de a enviar (fica igual em todo o lado).
import { Platform } from "react-native";

export const FILTERS = [
  ["none", "Original", "none"],
  ["vivo", "Vivo", "saturate(1.45) contrast(1.08)"],
  ["quente", "Quente", "sepia(.22) saturate(1.3) hue-rotate(-8deg) brightness(1.04)"],
  ["frio", "Frio", "saturate(1.1) hue-rotate(12deg) brightness(1.03) contrast(1.05)"],
  ["pb", "P&B", "grayscale(1) contrast(1.15)"],
  ["retro", "Retro", "sepia(.55) contrast(.92) brightness(1.06) saturate(.85)"],
  ["sonho", "Sonho", "brightness(1.1) saturate(1.2) contrast(.9)"],
  ["noite", "Noite", "brightness(.85) contrast(1.25) saturate(1.2) hue-rotate(195deg)"]
];
export const SPEEDS = [[0.5, "0,5×"], [1, "1×"], [1.5, "1,5×"], [2, "2×"]];
export const TEXT_POSITIONS = [["top", "Cima"], ["center", "Meio"], ["bottom", "Baixo"]];
export const TEXT_STYLES = [["clean", "Simples"], ["box", "Caixa"], ["coral", "Destaque"]];
export const MAX_CLIP_SECONDS = 180;
export const MUSIC_FADE_SECONDS = 1.2;
export const DEFAULT_VIDEO_EDIT = {
  start: 0, end: null, speed: 1, filter: "none", originalVolume: 1,
  brightness: 100, contrast: 100, saturation: 100, mirror: false, music: null,
  text: "", textPosition: "bottom", textStyle: "clean"
};

// O mesmo efeito em texto CSS (o Android aplica-o tal e qual, como o site).
export function filterCss(settings) {
  const parts = [];
  const effect = FILTERS.find(([id]) => id === settings.filter)?.[2];
  if (effect && effect !== "none") parts.push(effect);
  if (settings.brightness && settings.brightness !== 100) parts.push(`brightness(${settings.brightness / 100})`);
  if (settings.contrast && settings.contrast !== 100) parts.push(`contrast(${settings.contrast / 100})`);
  if (settings.saturation && settings.saturation !== 100) parts.push(`saturate(${settings.saturation / 100})`);
  return parts.join(" ");
}

// ----- Matriz de cor (4×5) equivalente aos filtros CSS, para aplicar com o Skia nas fotos -----
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
function multiply(a, b) { // a depois de b
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let value = col === 4 ? a[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) value += a[row * 5 + k] * (col === 4 ? b[k * 5 + 4] : b[k * 5 + col]);
      out[row * 5 + col] = value;
    }
  }
  return out;
}
const rgb = m => [m[0], m[1], m[2], 0, m[9] || 0, m[3], m[4], m[5], 0, m[9] || 0, m[6], m[7], m[8], 0, m[9] || 0, 0, 0, 0, 1, 0];
const OPS = {
  brightness: v => rgb([v, 0, 0, 0, v, 0, 0, 0, v]),
  contrast: v => rgb([v, 0, 0, 0, v, 0, 0, 0, v, (1 - v) / 2]),
  saturate: s => rgb([
    0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
    0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
    0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s]),
  grayscale: g => OPS.saturate(1 - Math.min(1, g)),
  sepia: a => {
    const t = 1 - Math.min(1, a);
    return rgb([
      0.393 + 0.607 * t, 0.769 - 0.769 * t, 0.189 - 0.189 * t,
      0.349 - 0.349 * t, 0.686 + 0.314 * t, 0.168 - 0.168 * t,
      0.272 - 0.272 * t, 0.534 - 0.534 * t, 0.131 + 0.869 * t]);
  },
  "hue-rotate": degrees => {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return rgb([
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]);
  }
};
export function colorMatrix(settings) {
  let matrix = IDENTITY;
  for (const [, name, raw] of filterCss(settings).matchAll(/([a-z-]+)\(([-\d.]+)(deg)?\)/g)) {
    if (OPS[name]) matrix = multiply(OPS[name](Number(raw)), matrix);
  }
  return matrix;
}
export const hasColorEdit = settings => Boolean(filterCss(settings));

// iOS não aplica filtros CSS a vídeo: usa uma película de cor aproximada (o site e o Android mostram o efeito exato).
const IOS_TINTS = { quente: "rgba(255,140,40,0.14)", frio: "rgba(40,120,255,0.12)", retro: "rgba(170,120,60,0.2)", noite: "rgba(10,20,80,0.28)", vivo: "rgba(255,0,80,0.05)", sonho: "rgba(255,200,240,0.14)", pb: "rgba(128,128,128,0.35)" };
export function videoLook(settings) {
  if (Platform.OS === "android") {
    const css = filterCss(settings);
    return { style: css ? { filter: css } : null, tint: null };
  }
  return { style: null, tint: IOS_TINTS[settings.filter] || null };
}

// Só o que mudou em relação ao original (o servidor recusa valores fora dos limites).
export function serializeVideoEdit(edit) {
  const out = {};
  if (edit.start > 0) out.start = Math.round(edit.start * 100) / 100;
  if (edit.end !== null && edit.end !== undefined) out.end = Math.round(edit.end * 100) / 100;
  if (edit.speed !== 1) out.speed = edit.speed;
  if (edit.filter !== "none") out.filter = edit.filter;
  if (edit.originalVolume !== 1) out.originalVolume = Math.round(edit.originalVolume * 100) / 100;
  for (const key of ["brightness", "contrast", "saturation"]) if (edit[key] !== 100) out[key] = Math.round(edit[key]);
  if (edit.mirror) out.mirror = true;
  if (edit.music) out.music = { trackId: edit.music.trackId, offset: Math.round(edit.music.offset * 100) / 100, volume: Math.round(edit.music.volume * 100) / 100, fade: edit.music.fade !== false };
  if (edit.text.trim()) Object.assign(out, { text: edit.text.trim(), textPosition: edit.textPosition, textStyle: edit.textStyle });
  return Object.keys(out).length ? out : null;
}

export const clock = seconds => {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
