import { createContext, useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Scissors, Gauge, Wand2, Type, Music2, RotateCcw, SlidersHorizontal, Lock, Mail, MonitorSmartphone, Ban, ChevronDown, Globe, Image as ImageIcon, LayoutGrid, Search, ThumbsUp, BarChart3, Bell, CircleHelp, Flag, Info, MapPin, MoreHorizontal, Mic, MicOff, Radio, Send, Square, VideoOff, Volume2, VolumeX, CreditCard, Hash, Smartphone, BadgeCheck, BriefcaseBusiness, Copy, Gift, GraduationCap, Star, Trophy, ArrowDown, ArrowUp, Eye, Pause, Play, Move, ShieldCheck, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, FileText, Heart, House, Layers3, LogOut, Megaphone, MessageCircle, Moon, PenLine, Plus, Settings as SettingsIcon, Share2, Sparkles, Sun, Trash2, UserRound, UserRoundPlus, UsersRound, Video, X, Zap, Pin, PinOff, MicOff as MuteIcon } from "lucide-react";

export const API_BASE = (import.meta.env.DEV ? "" : import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export const API = `${API_BASE}/api`;
// Endereço público do site, para links que se partilham (convites). Vem do build (VITE_PUBLIC_URL)
// quando o site e a API estão em domínios diferentes; senão, é o endereço onde o site abriu.
export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, "");
export const UserContext = createContext({ user: null, refreshUser: () => {} });
export const ThemeContext = createContext({ theme: "light", setTheme: () => {} });
// Preferências deste dispositivo (não vão para o servidor): tamanho do texto, vídeos automáticos e animações.
export const DEVICE_PREFS_KEY = "biva-device";
export const DEVICE_PREFS_DEFAULTS = { textSize: "normal", autoplay: true, reduceMotion: false };
export function readDevicePrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_PREFS_KEY) || "{}");
    return {
      textSize: ["normal", "large", "larger"].includes(saved.textSize) ? saved.textSize : DEVICE_PREFS_DEFAULTS.textSize,
      autoplay: saved.autoplay !== false,
      reduceMotion: saved.reduceMotion === true
    };
  } catch {
    return { ...DEVICE_PREFS_DEFAULTS };
  }
}
export function applyDevicePrefs(prefs) {
  const root = document.documentElement;
  root.dataset.textSize = prefs.textSize;
  if (prefs.reduceMotion) root.dataset.motion = "reduce";
  else delete root.dataset.motion;
}
export function saveDevicePrefs(prefs) {
  try { localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs)); } catch { /* sem armazenamento: vale só nesta visita */ }
  applyDevicePrefs(prefs);
  return prefs;
}
export const token = () => localStorage.getItem("token");
export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let response;
  try {
    response = await fetch(API + path, { ...options, headers });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Não foi possível contactar o servidor do Tchilar. Confirma que a API está em execução com «npm.cmd run dev».");
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.error || "Não foi possível concluir o pedido.");
    failure.status = response.status;
    failure.data = data;
    throw failure;
  }
  return data;
}
// ---------------------------------------------------------------------------------------------
// Vídeos: efeitos e leitor próprio (Reels e feed)
// As edições (corte, velocidade, efeito, ajustes, texto, som e música) vêm do servidor em
// post.video_edit e são aplicadas aqui, no leitor; o ficheiro original não é alterado.
// ---------------------------------------------------------------------------------------------
export const VIDEO_FILTERS = [
  ["none", "Original", "none"],
  ["vivo", "Vivo", "saturate(1.45) contrast(1.08)"],
  ["quente", "Quente", "sepia(.22) saturate(1.3) hue-rotate(-8deg) brightness(1.04)"],
  ["frio", "Frio", "saturate(1.1) hue-rotate(12deg) brightness(1.03) contrast(1.05)"],
  ["pb", "P&B", "grayscale(1) contrast(1.15)"],
  ["retro", "Retro", "sepia(.55) contrast(.92) brightness(1.06) saturate(.85)"],
  ["sonho", "Sonho", "brightness(1.1) saturate(1.2) contrast(.9) blur(.4px)"],
  ["noite", "Noite", "brightness(.85) contrast(1.25) saturate(1.2) hue-rotate(195deg)"]
];
export const VIDEO_FILTER_CSS = Object.fromEntries(VIDEO_FILTERS.map(([id, , css]) => [id, css]));
export const VIDEO_SPEEDS = [[0.5, "0,5×"], [1, "1×"], [1.5, "1,5×"], [2, "2×"]];
export const DEFAULT_VIDEO_EDIT = {
  start: 0, end: null, speed: 1, filter: "none", muted: false, originalVolume: 1,
  brightness: 100, contrast: 100, saturation: 100, mirror: false, music: null,
  text: "", textPosition: "bottom", textStyle: "clean"
};
export const MUSIC_FADE_SECONDS = 1.2;
// Efeito + ajustes de brilho, contraste e saturação, num só filtro CSS.
export function videoFilterCss(settings) {
  const parts = [];
  const effect = VIDEO_FILTER_CSS[settings.filter];
  if (effect && effect !== "none") parts.push(effect);
  if (settings.brightness && settings.brightness !== 100) parts.push(`brightness(${settings.brightness / 100})`);
  if (settings.contrast && settings.contrast !== 100) parts.push(`contrast(${settings.contrast / 100})`);
  if (settings.saturation && settings.saturation !== 100) parts.push(`saturate(${settings.saturation / 100})`);
  return parts.join(" ") || "none";
}
export const formatClock = seconds => {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
// O som é uma preferência partilhada: quem ativa o som num reel ouve os seguintes também.
// Os browsers só deixam tocar com som depois de um toque, por isso começa sempre sem som.
export let reelSoundOn = false;
export const reelSoundListeners = new Set();
export const setReelSound = value => { reelSoundOn = value; reelSoundListeners.forEach(listener => listener(value)); };
// Leitor de vídeo próprio: toque no vídeo para pausar/continuar, botão de som, ecrã cheio,
// barra de progresso, música por cima do vídeo. Começa sozinho quando aparece no ecrã e pára quando sai.
// music: { title, artist, src } — a faixa escolhida (o início, volume e entrada suave vêm de edit.music).
export function VideoPlayer({ src, edit, music = null, className = "", autoPlay = true, label = "Vídeo" }) {
  const settings = { ...DEFAULT_VIDEO_EDIT, ...(edit || {}) };
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [soundOn, setSoundOn] = useState(reelSoundOn);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [flash, setFlash] = useState(null);        // ícone grande que aparece ao tocar
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const userPaused = useRef(false);

  const clipStart = settings.start || 0;
  const clipEnd = () => settings.end ?? videoRef.current?.duration ?? 0;
  const clipLength = ((settings.end ?? duration) - clipStart) / settings.speed;
  const originalVolume = settings.muted ? 0 : Math.min(1, Math.max(0, settings.originalVolume ?? 1));
  const musicSrc = settings.music && music?.src ? music.src : "";
  const musicOffset = settings.music?.offset || 0;
  const musicVolume = settings.music?.volume ?? 1;
  const musicFade = settings.music?.fade !== false;
  const hasSound = originalVolume > 0 || Boolean(musicSrc);

  // ----- Música: segue o vídeo (mesmo com velocidade diferente, a música toca à velocidade normal) -----
  const expectedMusicTime = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return 0;
    const elapsed = Math.max(0, video.currentTime - clipStart) / settings.speed;
    const position = musicOffset + elapsed;
    return Number.isFinite(audio.duration) && audio.duration > 0 ? position % audio.duration : position;
  };
  const syncMusic = (force = false) => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video || !musicSrc) return;
    const expected = expectedMusicTime();
    if (force || Math.abs(audio.currentTime - expected) > 0.3) {
      try { audio.currentTime = expected; } catch { /* ainda sem dados: volta a tentar no próximo tique */ }
    }
    // Entrada e saída suaves no início e no fim do corte.
    const elapsed = Math.max(0, video.currentTime - clipStart) / settings.speed;
    const left = Math.max(0, clipLength - elapsed);
    const fade = musicFade ? Math.min(1, elapsed / MUSIC_FADE_SECONDS, left / MUSIC_FADE_SECONDS) : 1;
    audio.volume = Math.min(1, Math.max(0, musicVolume * fade));
    if (video.paused) audio.pause();
    else if (audio.paused) audio.play().catch(() => {});
  };

  // No editor, mudar o corte leva logo o vídeo para o novo início.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (video.currentTime < clipStart || video.currentTime > clipEnd()) video.currentTime = clipStart;
    syncMusic(true);
  }, [clipStart, settings.end, duration]);

  // No editor, trocar de música ou mudar o início da música salta logo para o sítio certo.
  useEffect(() => { syncMusic(true); }, [musicSrc, musicOffset, musicVolume, musicFade]);

  useEffect(() => {
    reelSoundListeners.add(setSoundOn);
    return () => reelSoundListeners.delete(setSoundOn);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = originalVolume === 0 || !soundOn;
    video.volume = originalVolume || 1;
    video.playbackRate = settings.speed;
    if (audioRef.current) audioRef.current.muted = !soundOn;
  }, [soundOn, originalVolume, settings.speed, musicSrc]);

  // Começa quando pelo menos 60% do vídeo está visível; pára quando sai do ecrã.
  useEffect(() => {
    const video = videoRef.current;
    if (!autoPlay || !readDevicePrefs().autoplay || !video) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      // Entrar/sair do ecrã cheio muda o layout por instantes: nesse momento não se mexe no vídeo.
      if (document.fullscreenElement) return;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (!userPaused.current) video.play().catch(() => {});
      } else {
        video.pause();
      }
    }, { threshold: [0, 0.6, 1] });
    observer.observe(video);
    return () => observer.disconnect();
  }, [autoPlay, src]);

  useEffect(() => {
    const onChange = () => {
      const isFull = document.fullscreenElement === wrapRef.current;
      setFullscreen(isFull);
      // Ao entrar em ecrã cheio, o vídeo continua (ou começa) a tocar.
      if (isFull && !userPaused.current) videoRef.current?.play().catch(() => {});
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const showFlash = icon => {
    setFlash({ icon, key: Date.now() });
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      if (video.currentTime >= clipEnd() - 0.05) video.currentTime = clipStart;
      video.play().catch(() => {});
      showFlash("play");
    } else {
      userPaused.current = true;
      video.pause();
      showFlash("pause");
    }
  };

  const toggleSound = event => {
    event.stopPropagation();
    if (!hasSound) return;
    setReelSound(!soundOn);
  };

  const toggleFullscreen = event => {
    event.stopPropagation();
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    if (wrap?.requestFullscreen) return wrap.requestFullscreen().catch(() => {});
    video?.webkitEnterFullscreen?.(); // iPhone: só o próprio vídeo pode ir para ecrã cheio
  };

  const seek = event => {
    event.stopPropagation();
    const video = videoRef.current;
    const bar = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bar.left) / bar.width));
    if (video) video.currentTime = clipStart + ratio * (clipEnd() - clipStart);
    syncMusic(true);
  };

  const onKey = event => {
    if (event.target !== wrapRef.current) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k" || key === "enter") { event.preventDefault(); togglePlay(); }
    else if (key === "m") toggleSound(event);
    else if (key === "f") toggleFullscreen(event);
  };

  // Mantém o vídeo dentro do corte: começa no início escolhido e volta ao início no fim.
  const onLoaded = () => {
    const video = videoRef.current;
    video.playbackRate = settings.speed;
    if (clipStart && video.currentTime < clipStart) video.currentTime = clipStart;
    setDuration(video.duration || 0);
    setLoading(false);
  };
  const onTime = () => {
    const video = videoRef.current;
    const end = clipEnd();
    if (end && video.currentTime >= end - 0.03) {
      video.currentTime = clipStart;
      if (!video.paused) video.play().catch(() => {});
      syncMusic(true);
    } else if (video.currentTime < clipStart - 0.2) {
      video.currentTime = clipStart;
      syncMusic(true);
    } else {
      syncMusic();
    }
    const length = end - clipStart;
    setProgress(length > 0 ? Math.min(1, Math.max(0, (video.currentTime - clipStart) / length)) : 0);
  };

  const remaining = clipLength * (1 - progress);
  return <div ref={wrapRef} className={`video-player ${fullscreen ? "is-fullscreen" : ""} ${playing ? "is-playing" : "is-paused"} ${className}`}
    role="button" tabIndex={0} aria-label={`${label}. ${playing ? "Toca para pausar" : "Toca para ver"}`}
    onClick={togglePlay} onKeyDown={onKey}>
    <video ref={videoRef} src={src} playsInline loop={false} preload="metadata"
      style={{ filter: videoFilterCss(settings), transform: settings.mirror ? "scaleX(-1)" : undefined }}
      onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onWaiting={() => setLoading(true)}
      onPlaying={() => { setLoading(false); setPlaying(true); syncMusic(true); }}
      onPause={() => { setPlaying(false); audioRef.current?.pause(); }}
      onEnded={() => { const video = videoRef.current; video.currentTime = clipStart; video.play().catch(() => {}); }} />
    {musicSrc && <audio ref={audioRef} src={musicSrc} preload="auto" loop muted={!soundOn} onLoadedMetadata={() => syncMusic(true)} />}
    {settings.text && <span className={`video-text pos-${settings.textPosition} style-${settings.textStyle}`}>{settings.text}</span>}
    {loading && <span className="video-spinner" aria-hidden="true" />}
    {!playing && !loading && <span className="video-big-play" aria-hidden="true"><Icon name="play" size={34} /></span>}
    {flash && <span key={flash.key} className="video-flash" aria-hidden="true" onAnimationEnd={() => setFlash(null)}><Icon name={flash.icon} size={30} /></span>}
    <div className="video-top-controls">
      {settings.speed !== 1 && <span className="video-chip">{VIDEO_SPEEDS.find(([value]) => value === settings.speed)?.[1]}</span>}
      <button type="button" className="video-control" aria-label={fullscreen ? "Sair do ecrã cheio" : "Ecrã cheio"} onClick={toggleFullscreen}>
        <Icon name={fullscreen ? "exitFullscreen" : "fullscreen"} size={18} />
      </button>
    </div>
    <div className="video-bottom-controls" onClick={event => event.stopPropagation()}>
      <span className="video-bottom-left">
        <span className="video-time">{formatClock(Math.ceil(playing || progress ? remaining : clipLength))}</span>
        {musicSrc && <span className={`video-music ${playing ? "is-playing" : ""}`} title={`${music.title}${music.artist ? ` · ${music.artist}` : ""}`}>
          <Icon name="sound" size={13} /><span>{music.title}{music.artist ? ` · ${music.artist}` : ""}</span>
        </span>}
      </span>
      <button type="button" className={`video-control ${soundOn && hasSound ? "is-on" : ""}`} disabled={!hasSound}
        aria-label={!hasSound ? "Vídeo sem som" : soundOn ? "Tirar o som" : "Ativar o som"} aria-pressed={soundOn && hasSound} onClick={toggleSound}>
        <Icon name={soundOn && hasSound ? "volumeOn" : "volumeOff"} size={18} />
        {!soundOn && hasSound && <span className="video-sound-hint">Ativar som</span>}
      </button>
    </div>
    <div className="video-progress" role="slider" aria-label="Posição no vídeo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      onClick={seek}><span style={{ transform: `scaleX(${progress})` }} /></div>
  </div>;
}
export function Avatar({ user, size = "" }) {
  const initial = (user?.display_name || user?.username || "?").trim().charAt(0).toUpperCase();
  return user?.avatar_url
    ? <img className={`avatar ${size}`} src={`${API_BASE}${user.avatar_url}`} alt="" />
    : <span className={`avatar ${size}`}>{initial}</span>;
}
export const ICONS = {
  ad: Megaphone,
  chevronDown: ChevronDown,
  globe: Globe,
  grid: LayoutGrid,
  flag: Flag,
  image: ImageIcon,
  like: ThumbsUp,
  search: Search,
  block: Ban,
  help: CircleHelp,
  info: Info,
  location: MapPin,
  more: MoreHorizontal,
  live: Radio,
  mic: Mic,
  micOff: MicOff,
  send: Send,
  stop: Square,
  videoOff: VideoOff,
  volumeOff: VolumeX,
  volumeOn: Volume2,
  card: CreditCard,
  phone: Smartphone,
  reference: Hash,
  academy: GraduationCap,
  brand: BriefcaseBusiness,
  copy: Copy,
  gift: Gift,
  star: Star,
  trophy: Trophy,
  verified: BadgeCheck,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  eye: Eye,
  pause: Pause,
  play: Play,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  trim: Scissors,
  speed: Gauge,
  effects: Wand2,
  text: Type,
  sound: Music2,
  reset: RotateCcw,
  adjust: SlidersHorizontal,
  move: Move,
  report: Flag,
  shield: ShieldCheck,
  pin: Pin,
  unpin: PinOff,
  silence: MuteIcon,
  stats: BarChart3,
  bolt: Zap,
  camera: Camera,
  check: Check,
  close: X,
  lock: Lock,
  devices: MonitorSmartphone,
  mail: Mail,
  create: PenLine,
  events: CalendarDays,
  externalLink: ExternalLink,
  friends: UserRoundPlus,
  groups: UsersRound,
  heart: Heart,
  home: House,
  layers: Layers3,
  logout: LogOut,
  messages: MessageCircle,
  moon: Moon,
  next: ChevronRight,
  notifications: Bell,
  pages: FileText,
  plus: Plus,
  previous: ChevronLeft,
  profile: UserRound,
  reels: Clapperboard,
  settings: SettingsIcon,
  share: Share2,
  spark: Sparkles,
  sun: Sun,
  trash: Trash2,
  video: Video
};
export function Icon({ name, size = 16 }) {
  const LucideIcon = ICONS[name];
  if (!LucideIcon) throw new Error(`Unknown icon: ${name}`);
  return <LucideIcon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} />;
}
// Valores em kwanzas: "2 500 Kz" (sem cêntimos quando o valor é inteiro).
export const formatPrice = value => {
  const amount = Number(value) || 0;
  // O símbolo "Kz" é acrescentado à mão: alguns browsers mostrariam "AOA".
  return `${amount.toLocaleString("pt-PT", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} Kz`;
};
export const formatDate = value => new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
export const formatCount = value => Number(value || 0).toLocaleString("pt-PT");
