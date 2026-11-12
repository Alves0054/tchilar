// Edições de vídeo dos Reels, guardadas como instruções ao lado do ficheiro original (não destrutivas):
// o leitor aplica o corte, a velocidade, o efeito, o texto e o som. O vídeo original nunca é alterado,
// por isso funciona em qualquer servidor (sem ffmpeg) e a edição pode ser mudada mais tarde.
const VIDEO_FILTERS = ["none", "vivo", "quente", "frio", "pb", "retro", "sonho", "noite"];
const VIDEO_SPEEDS = [0.5, 1, 1.5, 2];
const TEXT_POSITIONS = ["top", "center", "bottom"];
const TEXT_STYLES = ["clean", "box", "coral"];
const MAX_CLIP_SECONDS = 180;
const MAX_TEXT = 80;
const ADJUST_MIN = 50;
const ADJUST_MAX = 150;

const round = value => Math.round(value * 100) / 100;

// Devolve { edit } (null quando não há nenhuma edição) ou { error }.
function parseVideoEdit(raw) {
  if (raw === undefined || raw === null || raw === "") return { edit: null };
  let input = raw;
  if (typeof raw === "string") {
    if (raw.length > 3000) return { error: "A edição do vídeo é inválida." };
    try { input = JSON.parse(raw); } catch { return { error: "A edição do vídeo é inválida." }; }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "A edição do vídeo é inválida." };

  const start = input.start === undefined ? 0 : Number(input.start);
  const end = input.end === undefined || input.end === null ? null : Number(input.end);
  if (!Number.isFinite(start) || start < 0 || start > 36000) return { error: "O início do corte é inválido." };
  if (end !== null && (!Number.isFinite(end) || end <= start + 0.2 || end > 36000)) return { error: "O fim do corte tem de ser depois do início." };
  if (end !== null && end - start > MAX_CLIP_SECONDS + 0.5) return { error: `Um reel pode ter até ${MAX_CLIP_SECONDS / 60} minutos.` };

  const speed = input.speed === undefined ? 1 : Number(input.speed);
  if (!VIDEO_SPEEDS.includes(speed)) return { error: "A velocidade escolhida é inválida." };
  const filter = input.filter === undefined ? "none" : input.filter;
  if (!VIDEO_FILTERS.includes(filter)) return { error: "O efeito escolhido é inválido." };
  if (input.muted !== undefined && typeof input.muted !== "boolean") return { error: "A opção de som é inválida." };

  const text = typeof input.text === "string" ? input.text.replace(/\s+/g, " ").trim() : "";
  if (input.text !== undefined && typeof input.text !== "string") return { error: "O texto do vídeo é inválido." };
  if (text.length > MAX_TEXT) return { error: `O texto no vídeo pode ter até ${MAX_TEXT} caracteres.` };
  const textPosition = input.textPosition === undefined ? "bottom" : input.textPosition;
  const textStyle = input.textStyle === undefined ? "clean" : input.textStyle;
  if (!TEXT_POSITIONS.includes(textPosition) || !TEXT_STYLES.includes(textStyle)) return { error: "O estilo do texto é inválido." };

  // Ajustes de imagem (percentagem: 100 = sem alteração) e espelhar.
  const adjust = {};
  for (const key of ["brightness", "contrast", "saturation"]) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < ADJUST_MIN || value > ADJUST_MAX) return { error: "Os ajustes de imagem são inválidos." };
    if (value !== 100) adjust[key] = value;
  }
  if (input.mirror !== undefined && typeof input.mirror !== "boolean") return { error: "A opção de espelhar é inválida." };

  // Volume do som original (0 = sem som). "muted" é o formato antigo e continua a ser aceite.
  const originalVolume = input.originalVolume === undefined ? (input.muted === true ? 0 : 1) : Number(input.originalVolume);
  if (!Number.isFinite(originalVolume) || originalVolume < 0 || originalVolume > 1) return { error: "O volume do vídeo é inválido." };

  // Música: { trackId, offset (onde começa a música, em segundos), volume, fade }.
  let music = null;
  if (input.music !== undefined && input.music !== null) {
    const raw = input.music;
    if (typeof raw !== "object" || Array.isArray(raw)) return { error: "A música escolhida é inválida." };
    const trackId = Number(raw.trackId);
    const offset = raw.offset === undefined ? 0 : Number(raw.offset);
    const volume = raw.volume === undefined ? 1 : Number(raw.volume);
    if (!Number.isSafeInteger(trackId) || trackId <= 0) return { error: "A música escolhida é inválida." };
    if (!Number.isFinite(offset) || offset < 0 || offset > 900) return { error: "O início da música é inválido." };
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) return { error: "O volume da música é inválido." };
    if (raw.fade !== undefined && typeof raw.fade !== "boolean") return { error: "A opção de entrada suave é inválida." };
    music = { trackId, offset: round(offset), volume: round(volume), fade: raw.fade !== false };
  }

  const edit = {
    start: round(start),
    end: end === null ? null : round(end),
    speed,
    filter,
    muted: originalVolume === 0,
    ...(originalVolume !== 1 && originalVolume !== 0 && { originalVolume: round(originalVolume) }),
    ...adjust,
    ...(input.mirror === true && { mirror: true }),
    ...(music && { music }),
    ...(text && { text, textPosition, textStyle })
  };
  const isDefault = edit.start === 0 && edit.end === null && speed === 1 && filter === "none" && !edit.muted
    && edit.originalVolume === undefined && !Object.keys(adjust).length && !edit.mirror && !music && !text;
  return { edit: isDefault ? null : edit };
}

module.exports = { MAX_CLIP_SECONDS, TEXT_POSITIONS, TEXT_STYLES, VIDEO_FILTERS, VIDEO_SPEEDS, parseVideoEdit };
