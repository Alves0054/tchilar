import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Maximize,
  Minimize,
  Scissors,
  Gauge,
  Wand2,
  Type,
  Music2,
  RotateCcw,
  SlidersHorizontal,
  Lock,
  Mail,
  MonitorSmartphone,
  Ban,
  ChevronDown,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Search,
  ThumbsUp,
  BarChart3,
  Bell,
  CircleHelp,
  Flag,
  Info,
  MapPin,
  MoreHorizontal,
  Mic,
  MicOff,
  Radio,
  Send,
  Square,
  VideoOff,
  Volume2,
  VolumeX,
  CreditCard,
  Hash,
  Smartphone,
  BadgeCheck,
  BriefcaseBusiness,
  Copy,
  Gift,
  GraduationCap,
  Star,
  Trophy,
  ArrowDown,
  ArrowUp,
  Eye,
  Pause,
  Play,
  Move,
  ShieldCheck,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  FileText,
  Heart,
  House,
  Layers3,
  LogOut,
  Megaphone,
  MessageCircle,
  Moon,
  PenLine,
  Plus,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  UserRoundPlus,
  UsersRound,
  Video,
  X,
  Zap,
  Pin,
  PinOff,
  MicOff as MuteIcon
} from "lucide-react";
import "@fontsource-variable/nunito";
import "@fontsource-variable/bricolage-grotesque";
import { AvatarEditor, CoverEditor, downscaleImage } from "./PhotoEditors.jsx";
import "./styles.css";

const API_BASE = (import.meta.env.DEV ? "" : import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API = `${API_BASE}/api`;
const UserContext = createContext({ user: null, refreshUser: () => {} });
const ThemeContext = createContext({ theme: "light", setTheme: () => {} });

// Preferências deste dispositivo (não vão para o servidor): tamanho do texto, vídeos automáticos e animações.
const DEVICE_PREFS_KEY = "biva-device";
const DEVICE_PREFS_DEFAULTS = { textSize: "normal", autoplay: true, reduceMotion: false };
function readDevicePrefs() {
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
function applyDevicePrefs(prefs) {
  const root = document.documentElement;
  root.dataset.textSize = prefs.textSize;
  if (prefs.reduceMotion) root.dataset.motion = "reduce";
  else delete root.dataset.motion;
}
function saveDevicePrefs(prefs) {
  try { localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs)); } catch { /* sem armazenamento: vale só nesta visita */ }
  applyDevicePrefs(prefs);
  return prefs;
}
const token = () => localStorage.getItem("token");

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let response;
  try {
    response = await fetch(API + path, { ...options, headers });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Não foi possível contactar o servidor do Biva. Confirma que a API está em execução com «npm.cmd run dev».");
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
const VIDEO_FILTERS = [
  ["none", "Original", "none"],
  ["vivo", "Vivo", "saturate(1.45) contrast(1.08)"],
  ["quente", "Quente", "sepia(.22) saturate(1.3) hue-rotate(-8deg) brightness(1.04)"],
  ["frio", "Frio", "saturate(1.1) hue-rotate(12deg) brightness(1.03) contrast(1.05)"],
  ["pb", "P&B", "grayscale(1) contrast(1.15)"],
  ["retro", "Retro", "sepia(.55) contrast(.92) brightness(1.06) saturate(.85)"],
  ["sonho", "Sonho", "brightness(1.1) saturate(1.2) contrast(.9) blur(.4px)"],
  ["noite", "Noite", "brightness(.85) contrast(1.25) saturate(1.2) hue-rotate(195deg)"]
];
const VIDEO_FILTER_CSS = Object.fromEntries(VIDEO_FILTERS.map(([id, , css]) => [id, css]));
const VIDEO_SPEEDS = [[0.5, "0,5×"], [1, "1×"], [1.5, "1,5×"], [2, "2×"]];
const DEFAULT_VIDEO_EDIT = {
  start: 0, end: null, speed: 1, filter: "none", muted: false, originalVolume: 1,
  brightness: 100, contrast: 100, saturation: 100, mirror: false, music: null,
  text: "", textPosition: "bottom", textStyle: "clean"
};
const MUSIC_FADE_SECONDS = 1.2;

// Efeito + ajustes de brilho, contraste e saturação, num só filtro CSS.
function videoFilterCss(settings) {
  const parts = [];
  const effect = VIDEO_FILTER_CSS[settings.filter];
  if (effect && effect !== "none") parts.push(effect);
  if (settings.brightness && settings.brightness !== 100) parts.push(`brightness(${settings.brightness / 100})`);
  if (settings.contrast && settings.contrast !== 100) parts.push(`contrast(${settings.contrast / 100})`);
  if (settings.saturation && settings.saturation !== 100) parts.push(`saturate(${settings.saturation / 100})`);
  return parts.join(" ") || "none";
}

const formatClock = seconds => {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// O som é uma preferência partilhada: quem ativa o som num reel ouve os seguintes também.
// Os browsers só deixam tocar com som depois de um toque, por isso começa sempre sem som.
let reelSoundOn = false;
const reelSoundListeners = new Set();
const setReelSound = value => { reelSoundOn = value; reelSoundListeners.forEach(listener => listener(value)); };

// Leitor de vídeo próprio: toque no vídeo para pausar/continuar, botão de som, ecrã cheio,
// barra de progresso, música por cima do vídeo. Começa sozinho quando aparece no ecrã e pára quando sai.
// music: { title, artist, src } — a faixa escolhida (o início, volume e entrada suave vêm de edit.music).
function VideoPlayer({ src, edit, music = null, className = "", autoPlay = true, label = "Vídeo" }) {
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

function Avatar({ user, size = "" }) {
  const initial = (user?.display_name || user?.username || "?").trim().charAt(0).toUpperCase();
  return user?.avatar_url
    ? <img className={`avatar ${size}`} src={`${API_BASE}${user.avatar_url}`} alt="" />
    : <span className={`avatar ${size}`}>{initial}</span>;
}

const ICONS = {
  ad: Megaphone,
  chevronDown: ChevronDown,
  globe: Globe,
  grid: LayoutGrid,
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

function Icon({ name, size = 16 }) {
  const LucideIcon = ICONS[name];
  if (!LucideIcon) throw new Error(`Unknown icon: ${name}`);
  return <LucideIcon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} />;
}

function Layout({ children }) {
  // Preferência guardada: "light", "dark" ou "system" (segue o telemóvel/computador).
  const [themePreference, setTheme] = useState(() => {
    const saved = localStorage.getItem("biva-theme") || localStorage.getItem("nova-theme");
    return ["light", "dark", "system"].includes(saved) ? saved : "light";
  });
  const [systemDark, setSystemDark] = useState(() => !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const theme = themePreference === "system" ? (systemDark ? "dark" : "light") : themePreference;
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [authReady, setAuthReady] = useState(!token());
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("biva-theme", themePreference);
    localStorage.removeItem("nova-theme");
  }, [theme, themePreference]);

  const refreshUser = async () => {
    if (!token()) {
      setUser(null);
      setUnreadCount(0);
      setAuthReady(true);
      return;
    }
    try {
      const result = await api("/auth/me");
      setUser(result.user);
      setAuthError("");
      await refreshBadges();
    } catch (error) {
      // Sessão expirada, conta suspensa ou apagada: termina a sessão neste browser.
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        localStorage.removeItem("token");
        setUser(null);
        setUnreadCount(0);
        setUnreadMessages(0);
      }
      setAuthError(error.message);
    } finally {
      setAuthReady(true);
    }
  };

  const refreshBadges = async () => {
    if (!token()) return;
    try {
      const [notificationResult, messageResult] = await Promise.all([api("/notifications"), api("/messages/unread-count")]);
      setUnreadCount(notificationResult.unreadCount);
      setUnreadMessages(messageResult.unread);
    } catch { /* os contadores são opcionais */ }
  };

  useEffect(() => { refreshUser(); }, [location.pathname]);
  usePolling(refreshBadges, 30000, !!user);

  const authPage = !user && ["/", "/login", "/register", "/verify-email", "/forgot-password", "/reset-password"].includes(location.pathname);
  return <ThemeContext.Provider value={{ theme, themePreference, setTheme }}><UserContext.Provider value={{ user, refreshUser, authReady }}>
    <div className={`app ${authPage ? "app-public" : "app-community"}`}>
      {!authPage && <TopBar user={user} unreadCount={unreadCount} unreadMessages={unreadMessages}
        onLogout={() => { localStorage.removeItem("token"); setUser(null); setUnreadCount(0); setUnreadMessages(0); }} />}
      {authError && !authPage && <p className="global-error">{authError}</p>}
      <main className={authPage ? "auth-page-main" : ""}>{children}</main>
    </div>
  </UserContext.Provider></ThemeContext.Provider>;
}

// Fecha um menu ao clicar fora dele ou ao carregar em Escape.
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = event => { if (!ref.current?.contains(event.target)) close(); };
    const onKey = event => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

function SearchBox({ user }) {
  const navigate = useNavigate();
  const box = useRef(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const close = useRef(() => setOpen(false)).current;
  useDismiss(box, open, close);

  useEffect(() => {
    const term = query.trim();
    if (!user || term.length < 2) { setResults([]); return undefined; }
    const timer = window.setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(term)}`).then(result => setResults(result.users)).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, user]);

  const go = person => {
    setOpen(false);
    setQuery("");
    navigate(`/u/${person.username}`);
  };

  return <div className="topbar-search" ref={box}>
    <Icon name="search" size={17} />
    <input type="search" aria-label="Pesquisar pessoas no Biva" placeholder="Pesquisar no Biva" value={query}
      onChange={event => { setQuery(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={event => { if (event.key === "Enter" && results[0]) go(results[0]); }} />
    {open && query.trim().length >= 2 && <div className="topbar-dropdown search-results" role="listbox" aria-label="Resultados da pesquisa">
      {!user && <p className="muted">Entra na tua conta para pesquisar pessoas.</p>}
      {user && !results.length && <p className="muted">Sem resultados para «{query.trim()}».</p>}
      {results.map(person => <button type="button" role="option" aria-selected="false" key={person.id} onClick={() => go(person)}>
        <Avatar user={person} size="tiny" />
        <span><strong>{person.display_name}</strong><small>@{person.username}</small></span>
      </button>)}
    </div>}
  </div>;
}

const NAV_ITEMS = [
  ["/", "home", "Início"],
  ["/reels", "reels", "Reels"],
  ["/live", "live", "Diretos"],
  ["/friends", "friends", "Amigos"],
  ["/groups", "groups", "Grupos"],
  ["/events", "events", "Eventos"]
];

function TopBar({ user, unreadCount, unreadMessages, onLogout }) {
  const { theme, setTheme } = useContext(ThemeContext);
  const [openMenu, setOpenMenu] = useState("");
  const menus = useRef(null);
  const close = useRef(() => setOpenMenu("")).current;
  useDismiss(menus, !!openMenu, close);
  const location = useLocation();
  useEffect(() => { setOpenMenu(""); }, [location.pathname]);
  const toggle = name => setOpenMenu(current => current === name ? "" : name);

  return <header className="topbar">
    <div className="topbar-left">
      <Link className="logo" to="/" aria-label="Biva, início"><img src="/biva-logo.png" alt="" /></Link>
      <SearchBox user={user} />
    </div>
    <nav className="topbar-nav" aria-label="Principal">
      {NAV_ITEMS.map(([to, icon, label]) => <NavLink key={to} to={to} end={to === "/"} aria-label={label} title={label}><Icon name={icon} size={24} /></NavLink>)}
    </nav>
    <div className="topbar-right" ref={menus}>
      {user ? <>
        <div className="topbar-menu">
          <button className="round-button" type="button" aria-label="Menu" title="Menu" aria-haspopup="menu" aria-expanded={openMenu === "apps"} onClick={() => toggle("apps")}><Icon name="grid" size={20} /></button>
          {openMenu === "apps" && <div className="topbar-dropdown apps-menu" role="menu">
            <h2>Menu</h2>
            {[["/pages", "pages", "Páginas", "Segue projetos e marcas"], ["/events", "events", "Eventos", "Encontros perto de ti"], ["/groups", "groups", "Grupos", "Pessoas com os mesmos interesses"],
              ["/reels", "reels", "Reels", "Vídeos da comunidade"], ["/live", "live", "Diretos", "Quem está ao vivo agora"], ["/creator", "stats", "Painel do criador", "Insights, conteúdo e anúncios"],
              ["/estrelas", "star", "Estrelas", "Apoia os teus criadores"], ["/marcas", "brand", "Marcas", "Campanhas com criadores"],
              ["/desafios", "trophy", "Desafios", "Participa e ganha prémios"], ["/convidar", "gift", "Convidar amigos", "Ganha estrelas"],
              ["/academia", "academy", "Academia Biva", "Cresce como criador"], ["/help", "help", "Ajuda", "Perguntas frequentes"]]
              .map(([to, icon, label, hint]) => <Link key={to} to={to} role="menuitem"><span className={`menu-icon tone-${icon}`}><Icon name={icon} size={18} /></span><span><strong>{label}</strong><small>{hint}</small></span></Link>)}
          </div>}
        </div>
        <Link className="round-button" to="/messages" aria-label={unreadMessages ? `Mensagens, ${unreadMessages} por ler` : "Mensagens"} title="Mensagens">
          <Icon name="messages" size={20} />{unreadMessages > 0 && <span className="notification-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</span>}
        </Link>
        <Link className="round-button" to="/notifications" aria-label={unreadCount ? `Notificações, ${unreadCount} por ler` : "Notificações"} title="Notificações">
          <Icon name="notifications" size={20} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 20 ? "20+" : unreadCount}</span>}
        </Link>
        <div className="topbar-menu">
          <button className="account-button" type="button" aria-label="A tua conta" title="A tua conta" aria-haspopup="menu" aria-expanded={openMenu === "account"} onClick={() => toggle("account")}>
            <Avatar user={user} /><span className="account-chevron"><Icon name="chevronDown" size={12} /></span>
          </button>
          {openMenu === "account" && <div className="topbar-dropdown account-menu" role="menu">
            <Link className="account-card" to={`/u/${user.username}`} role="menuitem"><Avatar user={user} /><span><strong>{user.display_name}</strong><small>Ver o teu perfil</small></span></Link>
            <Link to="/settings" role="menuitem"><span className="menu-icon"><Icon name="settings" size={18} /></span>Definições e privacidade</Link>
            <Link to="/creator" role="menuitem"><span className="menu-icon"><Icon name="stats" size={18} /></span>Painel do criador</Link>
            {user.is_admin && <Link to="/admin" role="menuitem"><span className="menu-icon"><Icon name="shield" size={18} /></span>Administração</Link>}
            <button type="button" role="menuitemcheckbox" aria-checked={theme === "dark"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              <span className="menu-icon"><Icon name={theme === "dark" ? "sun" : "moon"} size={18} /></span>{theme === "dark" ? "Modo claro" : "Modo escuro"}
            </button>
            <Link to="/help" role="menuitem"><span className="menu-icon"><Icon name="help" size={18} /></span>Ajuda</Link>
            <button type="button" role="menuitem" onClick={onLogout}><span className="menu-icon"><Icon name="logout" size={18} /></span>Terminar sessão</button>
            <InfoLinks />
          </div>}
        </div>
      </> : <Link className="btn" to="/login">Entrar</Link>}
    </div>
  </header>;
}

// "agora", "há 12 min", "há 3 h", "ontem", "12 de nov."
function relativeTime(value) {
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return "ontem";
  return date.toLocaleDateString("pt-PT", { day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
}

function Home() {
  const { user, authReady } = useContext(UserContext);
  if (!authReady) return <div className="auth-loading" role="status">A preparar a tua comunidade...</div>;
  return user ? <Feed /> : <Auth key="login" mode="login" />;
}

const PASSWORD_MIN = 8;
const USERNAME_PATTERN = /^[a-z0-9._]{3,40}$/;

// Força estimada da palavra-passe (0–4). É uma ajuda visual; o servidor só exige o mínimo.
function passwordStrength(password) {
  if (password.length < PASSWORD_MIN) return 0;
  let score = 1;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}
const STRENGTH_LABELS = ["Demasiado curta", "Fraca", "Razoável", "Boa", "Forte"];

// "Ana Sofia" + "Gonçalves" → "ana.sofia.goncalves"
function suggestUsername(firstName, lastName) {
  return `${firstName} ${lastName}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
}

// Campo com a etiqueta dentro da caixa: fica no lugar do texto enquanto está vazio
// e sobe quando se escreve. A etiqueta é sempre um <label> real (acessível).
function EntryInput({ id, label, invalid, describedBy, prefix, children, ...inputProps }) {
  return <div className={`entry-control${prefix ? " has-prefix" : ""}`}>
    <input id={id} placeholder=" " aria-invalid={invalid || undefined} aria-describedby={describedBy} {...inputProps} />
    <label htmlFor={id}>{label}</label>
    {prefix && <span className="entry-prefix" aria-hidden="true">{prefix}</span>}
    {children}
  </div>;
}

function PasswordField({ id, label, value, onChange, autoComplete, invalid, describedBy, children }) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = event => setCapsLock(event.getModifierState?.("CapsLock") === true);
  return <div className="entry-field">
    <EntryInput id={id} label={label} required minLength={PASSWORD_MIN} type={visible ? "text" : "password"} autoComplete={autoComplete}
      value={value} onChange={onChange} onKeyUp={checkCaps} onKeyDown={checkCaps} onBlur={() => setCapsLock(false)}
      invalid={invalid} describedBy={describedBy}>
      <button type="button" className="entry-reveal" aria-pressed={visible} aria-controls={id} onClick={() => setVisible(current => !current)}>
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </EntryInput>
    {capsLock && <p className="entry-hint entry-hint-warn" role="status">O Caps Lock está ligado.</p>}
    {children}
  </div>;
}

// Lado esquerdo: ícone, colagem de momentos da comunidade e o título.
// Link entre Entrar e Criar conta com a troca animada dos dois lados (View Transitions API).
// O BrowserRouter ignora a opção viewTransition, por isso a transição é iniciada aqui;
// flushSync garante que o React atualiza o ecrã dentro da transição.
function SwapLink({ to, onClick, ...props }) {
  const navigate = useNavigate();
  const handleClick = event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition !== "function" || reduceMotion) {
      navigate(to);
      return;
    }
    document.startViewTransition(() => flushSync(() => navigate(to)));
  };
  return <Link to={to} onClick={handleClick} {...props} />;
}

function EntryShowcase({ mode }) {
  return <aside className="entry-showcase">
    <Link className="entry-logo" to="/" aria-label="Biva, página inicial"><img src="/biva-logo.png" alt="" /></Link>
    <div className="entry-collage" aria-hidden="true">
      <figure className="entry-card entry-card-story">
        <span className="entry-story-bars"><i /><i /><i /></span>
        <img src="/biva-community-selfie.jpg" alt="" />
        <span className="entry-chip entry-chip-time"><Icon name="events" size={14} /> 19:30</span>
      </figure>
      <figure className="entry-card entry-card-photo">
        <span className="entry-card-badge"><Icon name="camera" size={14} /></span>
        <img src="/biva-community-friends.jpg" alt="" />
      </figure>
      <figure className="entry-card entry-card-post">
        <span className="entry-card-badge entry-card-badge-accent"><Icon name="groups" size={14} /></span>
        <img src="/biva-community-join.jpg" alt="" />
        <span className="entry-lines"><i /><i /></span>
      </figure>
      <span className="entry-avatar"><span>M</span></span>
      <span className="entry-sticker entry-sticker-heart"><Icon name="heart" size={26} /></span>
      <span className="entry-sticker entry-sticker-chat"><Icon name="messages" size={22} /></span>
    </div>
    <h2 className="entry-title">{mode === "login"
      ? <>Partilha<br />o que te<br /><span>faz viver.</span></>
      : <>Junta-te<br />a quem<br /><span>te inspira.</span></>}</h2>
  </aside>;
}

function Auth({ mode }) {
  const isLogin = mode === "login";
  const navigate = useNavigate();
  const { refreshUser } = useContext(UserContext);
  const [form, setForm] = useState({ firstName: "", lastName: "", username: "", email: "", password: "", isCreator: false });
  const [authParams] = useSearchParams();
  const invite = (authParams.get("convite") || "").trim().toLowerCase();
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState("idle");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const update = (key, value) => {
    if (key === "email" || key === "password") setNeedsCode(false);
    setForm(current => ({ ...current, [key]: value }));
    setFieldErrors(current => ({ ...current, [key]: undefined }));
  };

  // Sugere o nome de utilizador a partir do nome, até a pessoa o editar.
  useEffect(() => {
    if (isLogin || usernameTouched) return;
    setForm(current => ({ ...current, username: suggestUsername(current.firstName, current.lastName) }));
  }, [form.firstName, form.lastName, usernameTouched, isLogin]);

  // Verifica, com uma pequena espera, se o nome de utilizador está livre.
  useEffect(() => {
    if (isLogin) return undefined;
    const username = form.username.trim().toLowerCase();
    if (!username) { setUsernameStatus("idle"); return undefined; }
    if (!USERNAME_PATTERN.test(username)) { setUsernameStatus("format"); return undefined; }
    setUsernameStatus("checking");
    const timer = window.setTimeout(async () => {
      try {
        const result = await api(`/auth/username-available?username=${encodeURIComponent(username)}`);
        setUsernameStatus(result.available ? "available" : result.reason === "format" ? "format" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form.username, isLogin]);

  const validate = () => {
    const errors = {};
    if (!isLogin) {
      if (!form.firstName.trim()) errors.firstName = "Escreve o teu nome próprio.";
      if (!USERNAME_PATTERN.test(form.username.trim().toLowerCase())) errors.username = "Usa 3 a 40 letras minúsculas, números, pontos ou underscores.";
      else if (usernameStatus === "taken") errors.username = "Este nome de utilizador já está a ser usado. Experimenta outro.";
      if (form.password.length < PASSWORD_MIN) errors.password = `A palavra-passe precisa de pelo menos ${PASSWORD_MIN} caracteres.`;
    } else if (!form.password) {
      errors.password = "Escreve a tua palavra-passe.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Escreve um email válido, por exemplo nome@exemplo.com.";
    setFieldErrors(errors);
    const first = ["firstName", "username", "email", "password"].find(key => errors[key]);
    if (first) {
      const ids = { firstName: "first-name", username: "username", email: "email", password: "password" };
      window.requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
    }
    return !first;
  };

  const submit = async event => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!validate()) return;
    setBusy(true);
    try {
      if (isLogin) {
        const result = await api("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email.trim(), password: form.password, ...(needsCode && { code: twoFactorCode }) })
        });
        localStorage.setItem("token", result.token);
        await refreshUser();
        navigate("/");
        return;
      }
      const result = await api("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          email: form.email.trim(),
          password: form.password,
          isCreator: form.isCreator,
          ...(invite && { invite }),
          displayName: `${form.firstName} ${form.lastName}`.trim()
        })
      });
      setSentTo(form.email.trim());
      setActionUrl(result.verificationUrl || "");
      setForm(current => ({ ...current, password: "" }));
    } catch (submitError) {
      // Palavra-passe certa, mas a conta tem verificação em dois passos: pede o código.
      if (isLogin && submitError.data?.twoFactorRequired) {
        setTwoFactorCode("");
        if (needsCode) setError(submitError.message);
        setNeedsCode(true);
        window.requestAnimationFrame(() => document.getElementById("two-factor-code")?.focus());
      } else {
        setError(submitError.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async email => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      setNotice(result.message);
      if (result.verificationUrl) setActionUrl(result.verificationUrl);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const needsVerification = isLogin && error.includes("Confirma o teu email");
  const strength = passwordStrength(form.password);
  const usernameMessage = {
    checking: ["A verificar...", ""],
    available: [`@${form.username.trim().toLowerCase()} está livre.`, "ok"],
    taken: ["Este nome de utilizador já está a ser usado.", "bad"],
    format: ["Usa 3 a 40 letras minúsculas, números, pontos ou underscores.", "bad"]
  }[usernameStatus];
  const fieldError = key => fieldErrors[key] && <p className="entry-hint entry-hint-error" id={`${key}-error`}>{fieldErrors[key]}</p>;

  const heading = sentTo ? "Confirma o teu email" : isLogin ? "Entrar no Biva" : "Criar conta no Biva";

  return <section className={`entry entry-${mode}`}>
    <EntryShowcase mode={mode} />
    <div className="entry-main">
      <div className="entry-panel">
        <Link className="entry-mobile-logo" to="/" aria-label="Biva, página inicial"><img src="/biva-logo-full.png" alt="Biva" /></Link>
        <header className="entry-head">
          {!isLogin && <SwapLink className="entry-back" to="/login" aria-label="Voltar a entrar"><Icon name="previous" size={22} /></SwapLink>}
          <h1>{heading}</h1>
        </header>

        {sentTo
          ? <div className="entry-form entry-sent" role="status">
            <span className="entry-sent-icon" aria-hidden="true"><Icon name="messages" size={26} /></span>
            <p className="entry-sub">Enviámos uma ligação para <strong>{sentTo}</strong>. Abre-a na próxima hora para ativar a conta. Se não a encontrares, procura na pasta de spam.</p>
            {actionUrl && <a className="entry-btn entry-btn-primary" href={actionUrl}>Confirmar email agora</a>}
            {notice && <p className="entry-notice">{notice}</p>}
            {error && <p className="entry-alert" role="alert">{error}</p>}
            <button className="entry-btn entry-btn-outline" type="button" disabled={busy} onClick={() => resend(sentTo)}>{busy ? "A reenviar..." : "Reenviar email"}</button>
            <SwapLink className="entry-link" to="/login">Já confirmei, quero entrar</SwapLink>
          </div>
          : <form className="entry-form" onSubmit={submit} noValidate>
            {!isLogin && <div className="entry-names">
              <div className="entry-field">
                <EntryInput id="first-name" label="Nome próprio" required autoComplete="given-name" maxLength={50}
                  value={form.firstName} onChange={event => update("firstName", event.target.value)}
                  invalid={!!fieldErrors.firstName} describedBy={fieldErrors.firstName ? "firstName-error" : undefined} />
                {fieldError("firstName")}
              </div>
              <div className="entry-field">
                <EntryInput id="last-name" label="Apelido (opcional)" autoComplete="family-name" maxLength={50}
                  value={form.lastName} onChange={event => update("lastName", event.target.value)} />
              </div>
            </div>}

            {!isLogin && <div className="entry-field">
              <EntryInput id="username" label="Nome de utilizador" prefix="@" required autoComplete="username" autoCapitalize="none" spellCheck="false" maxLength={40}
                value={form.username}
                onChange={event => { setUsernameTouched(true); update("username", event.target.value.toLowerCase().replace(/\s/g, "")); }}
                invalid={!!fieldErrors.username || usernameStatus === "taken"} describedBy="username-status" />
              {fieldErrors.username
                ? <p className="entry-hint entry-hint-error" id="username-status">{fieldErrors.username}</p>
                : <p className={`entry-hint${usernameMessage?.[1] ? ` entry-hint-${usernameMessage[1]}` : ""}`} id="username-status" aria-live="polite">
                  {usernameMessage ? usernameMessage[0] : "É o teu endereço no Biva."}
                </p>}
            </div>}

            <div className="entry-field">
              <EntryInput id="email" label={isLogin ? "Email" : "Email"} required type="email" autoComplete="email" inputMode="email"
                value={form.email} onChange={event => update("email", event.target.value)}
                invalid={!!fieldErrors.email} describedBy={fieldErrors.email ? "email-error" : undefined} />
              {fieldError("email")}
            </div>

            <PasswordField id="password" label="Palavra-passe" value={form.password}
              onChange={event => update("password", event.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"}
              invalid={!!fieldErrors.password}
              describedBy={fieldErrors.password ? "password-error" : isLogin ? undefined : "password-help"}>
              {isLogin && fieldError("password")}
              {!isLogin && <>
                <div className={`entry-strength strength-${strength}`} aria-hidden="true"><i /><i /><i /><i /></div>
                {fieldErrors.password
                  ? <p className="entry-hint entry-hint-error" id="password-error">{fieldErrors.password}</p>
                  : <p className="entry-hint" id="password-help">{form.password
                    ? `${STRENGTH_LABELS[strength]}. ${strength < 3 ? "Uma frase com várias palavras é fácil de lembrar e difícil de adivinhar." : ""}`
                    : `Pelo menos ${PASSWORD_MIN} caracteres.`}</p>}
              </>}
            </PasswordField>

            {isLogin && needsCode && <div className="entry-field entry-two-factor">
              <EntryInput id="two-factor-code" label="Código de 6 dígitos" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}"
                value={twoFactorCode} onChange={event => setTwoFactorCode(event.target.value.replace(/\D/g, "").slice(0, 6))} describedBy="two-factor-help" />
              <p className="entry-hint" id="two-factor-help">Abre a tua app de autenticação (Google Authenticator, Authy...) e escreve o código do Biva.</p>
            </div>}

            {!isLogin && <label className="entry-creator">
              <input type="checkbox" checked={form.isCreator} onChange={event => update("isCreator", event.target.checked)} />
              <span className="entry-switch-track" aria-hidden="true"><i /></span>
              <span><strong>Também quero publicar como criador</strong><small>Podes ter subscritores e conteúdo exclusivo. O preço define-se depois, nas Definições.</small></span>
            </label>}

            {error && <div className="entry-alert" role="alert">
              <p>{error}</p>
              {needsVerification && <button className="text-button" type="button" disabled={busy || !form.email} onClick={() => resend(form.email.trim())}>Reenviar email de confirmação</button>}
            </div>}
            {notice && <div className="entry-notice" role="status"><p>{notice}</p>{actionUrl && <a href={actionUrl}>Confirmar email agora</a>}</div>}

            {!isLogin && <p className="entry-legal">Ao criar conta, aceitas os <Link to="/terms">Termos de utilização</Link> e a <Link to="/privacy">Política de privacidade</Link>.</p>}

            <button className="entry-btn entry-btn-primary" type="submit" disabled={busy}>
              {busy ? (isLogin ? "A entrar..." : "A criar conta...") : isLogin ? "Entrar" : "Criar conta"}
            </button>

            {isLogin && <Link className="entry-link" to="/forgot-password">Esqueceste-te da palavra-passe?</Link>}

            <SwapLink className="entry-btn entry-btn-outline entry-alt" to={isLogin ? "/register" : "/login"}>
              {isLogin ? "Criar nova conta" : "Já tenho conta"}
            </SwapLink>
          </form>}

        <footer className="entry-foot">
          <span className="entry-wordmark"><img src="/biva-logo.png" alt="" /> biva</span>
          <InfoLinks />
        </footer>
      </div>
    </div>
  </section>;
}

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("A confirmar o email...");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("A ligação de confirmação está incompleta.");
      return;
    }
    api("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    }).then(result => setStatus(result.message)).catch(verifyError => setError(verifyError.message));
  }, [searchParams]);

  return <section className="auth page"><div className="auth-card"><div className="eyebrow">BIVA</div><h1>Confirmação de email</h1>{error ? <p className="error">{error}</p> : <p className="success">{status}</p>}<Link className="btn full" to="/login">Ir para iniciar sessão</Link></div></section>;
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResetUrl("");
    try {
      const result = await api("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      setNotice(result.message);
      setResetUrl(result.resetUrl || "");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="auth page"><form className="auth-card" onSubmit={submit}><div className="eyebrow">BIVA</div><h1>Recuperar acesso.</h1><p className="muted">Indica o email da tua conta para receber uma ligação de redefinição.</p><input required type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} />{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}{resetUrl && <a className="btn full" href={resetUrl}>Redefinir palavra-passe</a>}<button className="btn full" disabled={busy}>{busy ? "A enviar..." : "Enviar ligação"}</button><p className="muted"><Link to="/login">Voltar ao início de sessão</Link></p></form></section>;
}

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: searchParams.get("token"), password })
      });
      setNotice(result.message);
      setPassword("");
      window.setTimeout(() => navigate("/login"), 1500);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="auth page"><form className="auth-card" onSubmit={submit}><div className="eyebrow">BIVA</div><h1>Nova palavra-passe.</h1><input required minLength={PASSWORD_MIN} type="password" autoComplete="new-password" placeholder="Nova palavra-passe" value={password} onChange={event => setPassword(event.target.value)} />{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<button className="btn full" disabled={busy}>{busy ? "A guardar..." : "Atualizar palavra-passe"}</button></form></section>;
}

function ExclusiveToggle({ user, checked, onChange }) {
  if (!user?.is_creator || !(Number(user.subscription_price) > 0)) return null;
  return <label className="exclusive-toggle">
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    Só para subscritores
  </label>;
}

function Composer({ onPosted, target }) {
  const { user } = useContext(UserContext);
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [exclusive, setExclusive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!published) return undefined;
    const timer = window.setTimeout(() => setPublished(null), 15000);
    return () => window.clearTimeout(timer);
  }, [published]);
  const fileInput = useRef(null);
  const textArea = useRef(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const open = () => {
    if (!token()) return navigate("/login");
    setExpanded(true);
    window.requestAnimationFrame(() => textArea.current?.focus());
  };

  const pick = accept => {
    if (!token()) return navigate("/login");
    fileInput.current.accept = accept;
    fileInput.current.click();
  };

  const reset = () => {
    setBody("");
    setFile(null);
    setExclusive(false);
    setExpanded(false);
    setError("");
  };

  const submit = async event => {
    event.preventDefault();
    if (!body.trim() && !file) return setError("Escreve alguma coisa ou junta uma fotografia ou vídeo.");
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 2048, 2048));
    if (target?.type === "group") formData.append("groupId", target.id);
    if (target?.type === "page") formData.append("pageId", target.id);
    if (!target && exclusive) formData.append("isExclusive", "true");
    try {
      const result = await api("/posts", { method: "POST", body: formData });
      reset();
      if (!target && !exclusive && result.post?.id) setPublished(result.post.id);
      onPosted?.();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const firstName = user?.display_name?.split(" ")[0];
  return <form className="composer card" onSubmit={submit}>
    {published && <div className="composer-published" role="status">
      <Icon name="check" size={16} /><span>Publicado! Queres que mais pessoas vejam?</span>
      <Link to={`/creator/anuncios?impulsionar=${published}&orcamento=2000`}><Icon name="bolt" size={14} /> Impulsionar por {formatPrice(2000)}</Link>
      <button type="button" className="round-button" aria-label="Fechar" onClick={() => setPublished(null)}><Icon name="close" size={14} /></button>
    </div>}
    <input ref={fileInput} className="sr-only" type="file" tabIndex={-1} aria-hidden="true"
      onChange={event => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) { setFile(picked); setExpanded(true); } }} />
    <div className="composer-row">
      <Avatar user={user} />
      {expanded
        ? <textarea ref={textArea} aria-label="Nova publicação" rows={3} maxLength={5000} value={body} onChange={event => setBody(event.target.value)}
          placeholder={firstName ? `No que estás a pensar, ${firstName}?` : "No que estás a pensar?"} />
        : <button className="composer-prompt" type="button" onClick={open}>{firstName ? `No que estás a pensar, ${firstName}?` : "No que estás a pensar?"}</button>}
      {!expanded && <div className="composer-quick">
        <button type="button" className="composer-icon tone-video" aria-label="Publicar um vídeo" title="Vídeo" onClick={() => pick("video/*")}><Icon name="video" size={22} /></button>
        <button type="button" className="composer-icon tone-image" aria-label="Publicar uma fotografia" title="Fotografia" onClick={() => pick("image/*")}><Icon name="image" size={22} /></button>
      </div>}
    </div>
    {expanded && <>
      {file && <div className="composer-preview">
        {file.type.startsWith("video") ? <video src={preview} controls muted /> : <img src={preview} alt="Pré-visualização da fotografia escolhida" />}
        <button type="button" className="round-button" aria-label="Remover ficheiro" onClick={() => setFile(null)}><Icon name="close" size={16} /></button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-footer">
        <button type="button" className="composer-chip" onClick={() => pick("image/*,video/*")}><span className="tone-image"><Icon name="image" size={18} /></span>Fotografia ou vídeo</button>
        {!target && <ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />}
        <span className="composer-actions">
          <button className="btn secondary" type="button" disabled={busy} onClick={reset}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy || (!body.trim() && !file)}>{busy ? "A publicar..." : "Publicar"}</button>
        </span>
      </div>
    </>}
  </form>;
}

const REPORT_REASONS = [
  ["spam", "Spam ou publicidade enganosa"],
  ["harassment", "Assédio ou bullying"],
  ["hate", "Discurso de ódio"],
  ["violence", "Violência ou ameaças"],
  ["sexual", "Conteúdo sexual"],
  ["self_harm", "Automutilação ou suicídio"],
  ["false_info", "Informação falsa"],
  ["impersonation", "Está a fazer-se passar por outra pessoa"],
  ["other", "Outro motivo"]
];

// Janela para denunciar uma publicação, comentário ou conta.
function ReportDialog({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const what = { post: "publicação", comment: "comentário", user: "conta" }[targetType];

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, details })
      });
      setDone(result.message);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal card report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit}>
      <h2 id="report-title">Denunciar {what}</h2>
      {done
        ? <><p className="success" role="status">{done}</p><div className="modal-actions"><button className="btn" type="button" onClick={onClose} autoFocus>Fechar</button></div></>
        : <>
          <p className="muted">Quem é denunciado não sabe quem fez a denúncia. Se alguém estiver em perigo imediato, contacta as autoridades.</p>
          <fieldset className="report-reasons">
            <legend>Motivo</legend>
            {REPORT_REASONS.map(([id, label]) => <label key={id}><input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} /> {label}</label>)}
          </fieldset>
          <label className="report-details">Detalhes (opcional)<textarea maxLength={1000} rows={3} value={details} onChange={event => setDetails(event.target.value)} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="submit" disabled={busy || !reason}>{busy ? "A enviar..." : "Enviar denúncia"}</button>
          </div>
        </>}
    </form>
  </div>;
}

// Visualizações: uma publicação conta quando fica pelo menos 1 s com metade visível.
// Os ids juntam-se num lote enviado a cada 3 s (ou ao sair da página).
const viewQueue = new Set();
const viewsSent = new Set();
let viewTimer = null;

function flushPostViews() {
  window.clearTimeout(viewTimer);
  viewTimer = null;
  const ids = [...viewQueue];
  viewQueue.clear();
  if (!ids.length || !token()) return;
  api("/posts/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), keepalive: true }).catch(() => {});
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPostViews(); });
}

function usePostView(ref, postId, enabled) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || viewsSent.has(postId) || typeof IntersectionObserver !== "function") return undefined;
    let timer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        timer = window.setTimeout(() => {
          viewsSent.add(postId);
          viewQueue.add(postId);
          observer.disconnect();
          if (!viewTimer) viewTimer = window.setTimeout(flushPostViews, 3000);
        }, 1000);
      } else {
        window.clearTimeout(timer);
      }
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [postId, enabled]);
}

const MAX_SHARE_GROUPS = 5;

function useSeenOnce(ref, enabled, callback) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver !== "function") return undefined;
    let timer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) timer = window.setTimeout(() => { observer.disconnect(); callback(); }, 1000);
      else window.clearTimeout(timer);
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [enabled]);
}

// Promoções pagas: a impressão só é cobrada quando aparece mesmo no ecrã.
const recordAdImpression = adId => { if (token()) api(`/ads/${adId}/impression`, { method: "POST" }).catch(() => {}); };
const recordAdClick = adId => api(`/ads/${adId}/click`, { method: "POST" }).catch(() => ({}));

// Partilhar: escrever algo e escolher o perfil, uma página própria e/ou até 5 grupos.
function ShareDialog({ post, onClose, onShared }) {
  const { user } = useContext(UserContext);
  const [text, setText] = useState("");
  const [toProfile, setToProfile] = useState(true);
  const [pageId, setPageId] = useState("");
  const [groupIds, setGroupIds] = useState([]);
  const [pages, setPages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    Promise.allSettled([api("/pages"), api("/groups")]).then(([pageResult, groupResult]) => {
      setPages((pageResult.value?.pages || []).filter(page => page.owner_username === user?.username));
      setGroups((groupResult.value?.groups || []).filter(group => group.is_member));
    });
  }, [user?.username]);

  const toggleGroup = id => setGroupIds(current => current.includes(id)
    ? current.filter(item => item !== id)
    : current.length < MAX_SHARE_GROUPS ? [...current, id] : current);

  const destinations = (toProfile ? 1 : 0) + (pageId ? 1 : 0) + groupIds.length;

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, profile: toProfile, pageId: pageId ? Number(pageId) : null, groupIds })
      });
      const places = [toProfile && "no teu perfil", pageId && "na página", groupIds.length && (groupIds.length === 1 ? "num grupo" : `em ${groupIds.length} grupos`)].filter(Boolean);
      setDone(`Partilhado ${places.join(", ").replace(/, ([^,]*)$/, " e $1")}.`);
      onShared(result.shared);
      window.setTimeout(onClose, 1400);
    } catch (shareError) {
      setError(shareError.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="share-title">Partilhar publicação</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      {done
        ? <p className="success share-done" role="status"><Icon name="check" size={18} /> {done}</p>
        : <>
          <div className="share-author"><Avatar user={user} /><strong>{user?.display_name}</strong></div>
          <textarea className="share-text" aria-label="Escreve algo sobre esta publicação" placeholder="Diz algo sobre isto..." maxLength={5000} rows={3}
            value={text} onChange={event => setText(event.target.value)} autoFocus />
          <SharedPostPreview post={post} compact />
          <fieldset className="share-targets">
            <legend>Onde queres partilhar?</legend>
            <label className="share-target">
              <input type="checkbox" checked={toProfile} onChange={event => setToProfile(event.target.checked)} />
              <span className="share-target-icon tone-profile"><Icon name="profile" size={18} /></span>
              <span><strong>No teu perfil</strong><small>Aparece no teu perfil e no feed de quem te segue.</small></span>
            </label>
            {pages.length > 0 && <label className="share-target share-target-select">
              <span className="share-target-icon tone-pages"><Icon name="pages" size={18} /></span>
              <span><strong>Numa página</strong><small>Só páginas que geres.</small></span>
              <select value={pageId} onChange={event => setPageId(event.target.value)} aria-label="Página onde partilhar">
                <option value="">Nenhuma</option>
                {pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select>
            </label>}
            {groups.length > 0 && <div className="share-groups">
              <div className="share-groups-head"><span className="share-target-icon tone-groups"><Icon name="groups" size={18} /></span>
                <span><strong>Em grupos</strong><small>Escolhe até {MAX_SHARE_GROUPS}.</small></span>
                <span className="share-groups-count" aria-live="polite">{groupIds.length}/{MAX_SHARE_GROUPS}</span></div>
              <div className="share-group-list">
                {groups.map(group => {
                  const checked = groupIds.includes(group.id);
                  return <label key={group.id} className={`share-group${checked ? " is-checked" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={!checked && groupIds.length >= MAX_SHARE_GROUPS} onChange={() => toggleGroup(group.id)} />
                    <span className="share-group-initial" aria-hidden="true">{group.name.charAt(0).toUpperCase()}</span>
                    <span>{group.name}<small>{group.member_count} {group.member_count === 1 ? "membro" : "membros"}</small></span>
                  </label>;
                })}
              </div>
            </div>}
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn" type="submit" disabled={busy || !destinations}>{busy ? "A partilhar..." : "Partilhar agora"}</button>
          </div>
        </>}
    </form>
  </div>, document.body);
}

// Pré-visualização da publicação original dentro de uma partilha.
function SharedPostPreview({ post, compact = false }) {
  if (post.unavailable) return <div className="shared-post shared-post-unavailable"><Icon name="info" size={16} /> Esta publicação já não está disponível.</div>;
  return <div className={`shared-post${compact ? " is-compact" : ""}`}>
    {post.media_url && (post.media_type === "video"
      ? <video className="shared-post-media" controls={!compact} src={`${API_BASE}${post.media_url}`} />
      : <img className="shared-post-media" src={`${API_BASE}${post.media_url}`} alt="" />)}
    <div className="shared-post-content">
      <div className="shared-post-head">
        <Link to={`/u/${post.username}`}><Avatar user={post} size="tiny" /></Link>
        <span><Link className="post-author" to={`/u/${post.username}`}>{post.display_name}</Link><small>{relativeTime(post.created_at)}</small></span>
      </div>
      {post.body && <p className="shared-post-body">{post.body}</p>}
    </div>
  </div>;
}

// "A ter sucesso": publicação pública com pelo menos 3 interações nas primeiras 72 horas.
const isTrending = (post, interactions) => !post.is_exclusive && !post.group_id && !post.shared_post_id && !post.hidden_at
  && interactions >= 3 && Date.now() - new Date(post.created_at).getTime() < 72 * 3600 * 1000;

function PostCard({ post, onChanged }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body || "");
  const [body, setBody] = useState(post.body || "");
  const [editedAt, setEditedAt] = useState(post.edited_at || null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [likes, setLikes] = useState(Number(post.likes) || 0);
  const [commentCount, setCommentCount] = useState(Number(post.comments) || 0);
  const [shares, setShares] = useState(Number(post.shares) || 0);
  const [stars, setStars] = useState(Number(post.stars) || 0);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const likeBusy = useRef(false);
  const cardRef = useRef(null);
  usePostView(cardRef, post.id, Boolean(user) && String(user?.id) !== String(post.user_id));
  useSeenOnce(cardRef, Boolean(post.sponsored && user), () => recordAdImpression(post.sponsored.ad_id));
  const onSponsoredClick = event => { if (post.sponsored && event.target.closest("a")) recordAdClick(post.sponsored.ad_id); };

  useEffect(() => { setBody(post.body || ""); setEditedAt(post.edited_at || null); }, [post.body, post.edited_at]);
  useEffect(() => {
    setLiked(Boolean(post.liked));
    setLikes(Number(post.likes) || 0);
    setCommentCount(Number(post.comments) || 0);
    setShares(Number(post.shares) || 0);
    setStars(Number(post.stars) || 0);
  }, [post.id, post.liked, post.likes, post.comments, post.shares, post.stars]);

  const saveEdit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft })
      });
      setBody(result.post.body);
      setEditedAt(result.post.edited_at);
      setEditing(false);
    } catch (editError) {
      setError(editError.message);
    } finally {
      setBusy(false);
    }
  };

  const [reporting, setReporting] = useState(null);

  const blockAuthor = async () => {
    if (!window.confirm(`Bloquear @${post.username}? Deixam de ver as publicações um do outro e de poder trocar mensagens.`)) return;
    setError("");
    try {
      await api(`/users/${post.user_id}/block`, { method: "POST" });
      await onChanged();
    } catch (blockError) {
      setError(blockError.message);
    }
  };

  const deleteComment = async commentId => {
    setError("");
    try {
      await api(`/comments/${commentId}`, { method: "DELETE" });
      setComments(current => current.filter(comment => comment.id !== commentId));
      setCommentCount(count => Math.max(0, count - 1));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  // Otimista: o botão muda logo; se o servidor falhar, volta ao estado anterior.
  const toggleLike = async () => {
    if (!token()) return navigate("/login");
    if (likeBusy.current) return;
    likeBusy.current = true;
    setError("");
    const before = { liked, likes };
    setLiked(!liked);
    setLikes(likes + (liked ? -1 : 1));
    try {
      const result = await api(`/posts/${post.id}/like`, { method: "POST" });
      setLiked(result.liked);
      setLikes(result.likes);
    } catch (actionError) {
      setLiked(before.liked);
      setLikes(before.likes);
      setError(actionError.message);
    } finally {
      likeBusy.current = false;
    }
  };

  const toggleComments = async () => {
    const opening = !showComments;
    setShowComments(opening);
    if (!opening) return;
    setError("");
    try {
      const result = await api(`/posts/${post.id}/comments`);
      setComments(result.comments);
    } catch (actionError) {
      setError(actionError.message);
    }
  };

  const addComment = async event => {
    event.preventDefault();
    if (!token()) return navigate("/login");
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentText })
      });
      setComments([...comments, { ...result.comment, user_id: user?.id, username: user?.username, display_name: user?.display_name, avatar_url: user?.avatar_url }]);
      setCommentText("");
      setCommentCount(count => count + 1);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  };

  // Partilhar a partilha de alguém partilha a publicação original.
  const shareSource = post.shared && !post.shared.unavailable ? post.shared : post;
  const canShare = post.shared ? !post.shared.unavailable : !post.is_exclusive && !post.group_id;
  const share = () => {
    if (!token()) return navigate("/login");
    setNotice("");
    setSharing(true);
  };

  const deletePost = async () => {
    setDeleting(true);
    setError("");
    try {
      await api(`/posts/${post.id}`, { method: "DELETE" });
      await onChanged();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting(false);
    }
  };

  const ownsPost = user && String(user.id) === String(post.user_id);

  return <article className={`post card${post.sponsored ? " is-sponsored" : ""}`} ref={cardRef} onClickCapture={onSponsoredClick}>
    <div className="post-head">
      <Link to={`/u/${post.username}`}><Avatar user={post} /></Link>
      <div className="post-byline"><span className="post-author-line"><Link className="post-author" to={`/u/${post.username}`}>{post.display_name}</Link><VerifiedBadge show={post.is_verified} /></span><span className="post-meta">{post.sponsored && <><span className="sponsored-label"><Icon name="spark" size={12} /> Patrocinado</span><span aria-hidden="true">·</span></>}<span>@{post.username}</span><span aria-hidden="true">·</span><time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString("pt-PT")}>{relativeTime(post.created_at)}</time><span aria-hidden="true">·</span><span className="post-audience" title={post.is_exclusive ? "Só subscritores" : post.group_name ? `Grupo: ${post.group_name}` : "Público"}><Icon name={post.is_exclusive ? "spark" : post.group_name ? "groups" : "globe"} size={12} /></span>{editedAt && <span title={new Date(editedAt).toLocaleString("pt-PT")}>· editado</span>}</span></div>
      {(post.is_creator || post.is_exclusive || user) && <div className="post-head-tools">
        {post.is_creator && <span className="creator-badge">Criador</span>}
        {post.is_exclusive && <span className="exclusive-badge">Exclusivo</span>}
        {post.hidden_at && ownsPost && <span className="hidden-badge" title="Escondida pela moderação: só tu a vês.">Escondida</span>}
        {user && !ownsPost && <div className="post-menu">
          <button className="post-delete-button" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Opções da publicação" title="Opções" onClick={() => setMenuOpen(open => !open)}><Icon name="more" size={20} /></button>
          {menuOpen && <div className="post-menu-list" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReporting({ targetType: "post", targetId: post.id }); }}><Icon name="report" size={15} /> Denunciar publicação</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); blockAuthor(); }}><Icon name="block" size={15} /> Bloquear @{post.username}</button>
          </div>}
        </div>}
        {ownsPost && (confirmDelete
          ? <div className="post-delete-confirm" role="group" aria-label="Confirmar eliminação da publicação">
            <span>Apagar publicação?</span>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancelar</button>
            <button className="confirm" type="button" onClick={deletePost} disabled={deleting}>{deleting ? "A apagar..." : "Apagar"}</button>
          </div>
          : <div className="post-menu">
            <button className="post-delete-button" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Opções da publicação" title="Opções" onClick={() => setMenuOpen(open => !open)}><Icon name="more" size={20} /></button>
            {menuOpen && <div className="post-menu-list" role="menu">
              {!post.is_exclusive && !post.group_id && !post.shared_post_id && !post.hidden_at && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); navigate(`/creator/anuncios?impulsionar=${post.id}`); }}><Icon name="bolt" size={15} /> Impulsionar publicação</button>}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDraft(body); setEditing(true); }}><Icon name="create" size={15} /> Editar</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setError(""); setConfirmDelete(true); }}><Icon name="trash" size={15} /> Apagar</button>
            </div>}
          </div>)}
      </div>}
    </div>
    {editing
      ? <form className="post-edit" onSubmit={saveEdit}>
        <textarea aria-label="Editar publicação" maxLength={5000} rows={4} value={draft} onChange={event => setDraft(event.target.value)} autoFocus />
        <div className="post-edit-actions">
          <button className="btn secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy}>{busy ? "A guardar..." : "Guardar"}</button>
        </div>
      </form>
      : body && <p className="post-body">{body}</p>}
    {post.shared && <SharedPostPreview post={post.shared} />}
    {post.media_url && (post.media_type === "video"
      ? <VideoPlayer className="media" src={`${API_BASE}${post.media_url}`} edit={post.video_edit} label={`Vídeo de ${post.display_name}`}
        music={post.music ? { title: post.music.title, artist: post.music.artist, src: `${API_BASE}${post.music.audio_url}` } : null} />
      : <img className="media" src={`${API_BASE}${post.media_url}`} alt="Publicação" />)}
    <div className="post-counts">
      <span><span className="post-count-mark" aria-hidden="true"><Icon name="heart" size={11} /></span>{formatCount(likes)} {likes === 1 ? "gosto" : "gostos"}</span>
      <span className="post-counts-right">
        <button className="text-button" onClick={toggleComments}>{formatCount(commentCount)} {commentCount === 1 ? "comentário" : "comentários"}</button>
        {shares > 0 && <span>{formatCount(shares)} {shares === 1 ? "partilha" : "partilhas"}</span>}
        {stars > 0 && <span className="post-stars-count"><Icon name="star" size={13} /> {formatCount(stars)}</span>}
      </span>
    </div>
    <div className="post-actions">
      <button className={liked ? "active" : ""} type="button" aria-pressed={liked} onClick={toggleLike}><span className="post-like-icon" aria-hidden="true"><Icon name="like" size={18} /></span>{liked ? "Gostaste" : "Gosto"}</button>
      <button type="button" aria-expanded={showComments} onClick={toggleComments}><span aria-hidden="true"><Icon name="messages" size={18} /></span>Comentar</button>
      <button type="button" onClick={share} disabled={!canShare} title={canShare ? "Partilhar" : "Só publicações públicas podem ser partilhadas"}><span aria-hidden="true"><Icon name="share" size={18} /></span>Partilhar</button>
      {user && !ownsPost && <StarGiftButton post={post} onGifted={setStars} />}
    </div>
    {ownsPost && !post.sponsored && isTrending(post, likes + commentCount + shares) && <Link className="boost-nudge" to={`/creator/anuncios?impulsionar=${post.id}&orcamento=2000`}>
      <Icon name="bolt" size={16} /><span><strong>Esta publicação está a ter sucesso.</strong> Impulsiona por {formatPrice(2000)} e chega a mais pessoas.</span><Icon name="next" size={16} />
    </Link>}
    {showComments && <div className="comments">
      {comments.map(comment => <div className="comment" key={comment.id}>
        <Avatar user={comment} size="tiny" />
        <p><strong>{comment.display_name || comment.username}</strong> {comment.body}</p>
        {user && (String(comment.user_id) === String(user.id) || ownsPost) && <button className="comment-delete" type="button" aria-label="Apagar comentário" title="Apagar comentário" onClick={() => deleteComment(comment.id)}><Icon name="trash" size={14} /></button>}
        {user && String(comment.user_id) !== String(user.id) && <button className="comment-delete" type="button" aria-label="Denunciar comentário" title="Denunciar comentário" onClick={() => setReporting({ targetType: "comment", targetId: comment.id })}><Icon name="report" size={14} /></button>}
      </div>)}
      {user && <form className="comment-form" onSubmit={addComment}><Avatar user={user} size="tiny" /><input value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Escreve um comentário..." maxLength="2000" /><button className="text-button" disabled={busy}>Publicar</button></form>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {sharing && <ShareDialog post={shareSource} onClose={() => setSharing(false)} onShared={count => {
      if (shareSource.id === post.id) setShares(value => value + count);
      setNotice(count === 1 ? "Publicação partilhada." : `Publicação partilhada em ${count} sítios.`);
    }} />}
    {reporting && <ReportDialog {...reporting} onClose={() => setReporting(null)} />}
  </article>;
}

const STORY_SECONDS = 10;

function StoryZone() {
  const { user } = useContext(UserContext);
  const [stories, setStories] = useState([]);
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  // Temporizador: cada story fica STORY_SECONDS no ecrã (os vídeos, a sua duração).
  const [storyReady, setStoryReady] = useState(false);
  const [storyDuration, setStoryDuration] = useState(STORY_SECONDS);
  const [storyPaused, setStoryPaused] = useState(false);
  const [storyHeld, setStoryHeld] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);

  const load = async () => {
    try {
      const result = await api("/stories");
      setStories(result.stories);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, []);

  const storyGroups = stories.reduce((groups, story) => {
    let group = groups.find(item => item.user_id === story.user_id);
    if (!group) {
      group = { user_id: story.user_id, username: story.username, display_name: story.display_name, avatar_url: story.avatar_url, stories: [] };
      groups.push(group);
    }
    group.stories.push(story);
    return groups;
  }, []);
  const [liveNow, setLiveNow] = useState([]);
  useEffect(() => { api("/lives").then(result => setLiveNow(result.lives.slice(0, 6))).catch(() => {}); }, []);
  const [sponsoredStory, setSponsoredStory] = useState(null);
  useEffect(() => { api("/ads/feed?placement=stories").then(result => setSponsoredStory(result.posts[0] || null)).catch(() => {}); }, []);
  if (sponsoredStory) storyGroups.splice(0, 0, {
    user_id: `ad-${sponsoredStory.sponsored.ad_id}`, sponsoredAdId: sponsoredStory.sponsored.ad_id,
    username: sponsoredStory.username, display_name: sponsoredStory.display_name, avatar_url: sponsoredStory.avatar_url,
    stories: [{ id: `ad-${sponsoredStory.id}`, user_id: sponsoredStory.user_id, body: sponsoredStory.body, media_url: sponsoredStory.media_url, media_type: sponsoredStory.media_type, created_at: sponsoredStory.created_at }]
  });
  const activeGroup = storyGroups.find(group => group.user_id === activeGroupId);
  // Abrir o story patrocinado conta como impressão.
  useEffect(() => { if (activeGroup?.sponsoredAdId) recordAdImpression(activeGroup.sponsoredAdId); }, [activeGroup?.sponsoredAdId]);
  const activeStory = activeGroup?.stories[activeStoryIndex];

  useEffect(() => {
    if (!activeStory) return undefined;
    const handleKeyDown = event => {
      if (event.key === "Escape") setActiveGroupId(null);
      if (event.key === "ArrowRight") moveStory(1);
      if (event.key === "ArrowLeft") moveStory(-1);
      if (event.key === " " && event.target === document.body) { event.preventDefault(); setStoryPaused(value => !value); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeStory, activeGroup, activeStoryIndex]);

  // Cada story novo começa do zero; texto está pronto logo, imagens e vídeos quando carregam.
  useEffect(() => {
    setStoryReady(!activeStory?.media_url);
    setStoryDuration(STORY_SECONDS);
    setStoryHeld(false);
  }, [activeStory?.id]);

  useEffect(() => {
    if (!activeGroupId) setStoryPaused(false);
  }, [activeGroupId]);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const storyRunning = storyReady && !storyPaused && !storyHeld && !pageHidden;
  const storyVideo = useRef(null);
  useEffect(() => {
    const video = storyVideo.current;
    if (!video) return;
    if (storyRunning) video.play().catch(() => {});
    else video.pause();
  }, [storyRunning, activeStory?.id]);

  const createStory = async event => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 1080, 1920));
    try {
      const result = await api("/stories", { method: "POST", body: formData });
      setStories(current => [result.story, ...current]);
      setBody("");
      setFile(null);
      setShowComposer(false);
      setNotice("O teu story já está visível durante 24 horas.");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const track = useRef(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  useEffect(() => {
    const element = track.current;
    if (!element) return undefined;
    const update = () => setCanScroll({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { element.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [stories.length]);
  const scrollStories = direction => track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: "smooth" });

  // Avança/recua dentro dos stories da pessoa; nos extremos passa para a pessoa seguinte ou anterior.
  const moveStory = direction => {
    if (!activeGroup) return;
    const nextIndex = activeStoryIndex + direction;
    const groupIndex = storyGroups.findIndex(group => group.user_id === activeGroup.user_id);
    if (nextIndex >= 0 && nextIndex < activeGroup.stories.length) {
      setActiveStoryIndex(nextIndex);
    } else if (direction > 0 && groupIndex < storyGroups.length - 1) {
      setActiveGroupId(storyGroups[groupIndex + 1].user_id);
      setActiveStoryIndex(0);
    } else if (direction < 0 && groupIndex > 0) {
      const previousGroup = storyGroups[groupIndex - 1];
      setActiveGroupId(previousGroup.user_id);
      setActiveStoryIndex(previousGroup.stories.length - 1);
    } else if (direction > 0) {
      setActiveGroupId(null);
    }
  };

  return <section className="stories" aria-label="Stories">
    <div className="stories-track" ref={track}>
      <button className="stories-card stories-create" type="button" onClick={() => { setError(""); setShowComposer(true); }}>
        <span className="stories-create-photo">{user?.avatar_url ? <img src={`${API_BASE}${user.avatar_url}`} alt="" /> : <span>{(user?.display_name || "?").charAt(0).toUpperCase()}</span>}</span>
        <span className="stories-create-plus" aria-hidden="true"><Icon name="plus" size={20} /></span>
        <span className="stories-create-label">Criar story</span>
      </button>
      {/* O cartão abre o story; o nome é um link à parte (um link não pode ficar dentro de um botão). */}
      {liveNow.map(live => <Link key={`live-${live.id}`} className="stories-card stories-live" to={`/live/${live.id}`} aria-label={`Ver o direto de ${live.display_name}`}>
        <span className={`stories-live-cover tone-page-${pageTone(live.username)}`} />
        <span className="stories-ring is-live"><Avatar user={live} size="tiny" /></span>
        <LiveBadge small />
        <span className="stories-name">{live.display_name}</span>
      </Link>)}
      {storyGroups.map(group => <div className="stories-card" key={group.user_id}>
        <button className="stories-open" type="button" aria-label={`Ver story de ${group.display_name}`}
          onClick={() => { setActiveStoryIndex(0); setActiveGroupId(group.user_id); }}>
          {group.stories[0].media_url
            ? group.stories[0].media_type === "video"
              ? <video src={`${API_BASE}${group.stories[0].media_url}`} muted playsInline />
              : <img src={`${API_BASE}${group.stories[0].media_url}`} alt="" />
            : <span className={`stories-text story-cover-tone-${group.user_id % 4}`}><span>{group.stories[0].body}</span></span>}
          <span className="stories-ring"><Avatar user={group} size="tiny" /></span>
        </button>
        {group.sponsoredAdId && <span className="stories-sponsored">Patrocinado</span>}
        <Link className="stories-name" to={`/u/${group.username}`}>{group.display_name}</Link>
      </div>)}
    </div>
    {canScroll.right && <button className="stories-arrow next" type="button" aria-label="Ver mais stories" onClick={() => scrollStories(1)}><Icon name="next" size={20} /></button>}
    {canScroll.left && <button className="stories-arrow previous" type="button" aria-label="Stories anteriores" onClick={() => scrollStories(-1)}><Icon name="previous" size={20} /></button>}
    {notice && <p className="story-notice" role="status">{notice}</p>}
    {error && <p className="story-error" role="alert">{error}</p>}
    {showComposer && <div className="story-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowComposer(false); }}>
      <form className="story-composer-modal" onSubmit={createStory} aria-label="Criar story">
        <button className="story-modal-close" type="button" aria-label="Fechar" onClick={() => setShowComposer(false)}><Icon name="close" size={17} /></button>
        <p className="feed-section-kicker">Um momento, à tua maneira</p>
        <h2>Criar story</h2>
        <p className="story-modal-description">Escreve uma ideia ou junta uma fotografia. O teu story fica disponível durante 24 horas.</p>
        <textarea aria-label="Texto do story" maxLength="500" placeholder="O que gostarias de partilhar?" value={body} onChange={event => setBody(event.target.value)} />
        <div className="story-modal-footer">
          <label className="story-file-label"><Icon name="camera" size={15} />Fotografia ou vídeo<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <span className="story-character-count">{body.length}/500</span>
        </div>
        {file && <p className="story-selected-file">{file.name}</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn full" type="submit" disabled={busy || (!body.trim() && !file)}>{busy ? "A publicar..." : "Partilhar story"}</button>
      </form>
    </div>}
    {activeStory && <div className="story-viewer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setActiveGroupId(null); }}>
      <section className={`story-viewer${storyRunning ? "" : " is-paused"}`} role="dialog" aria-modal="true" aria-label={`Story de ${activeGroup.display_name}`}
        style={{ "--story-duration": `${storyDuration}s` }}>
        <div className="story-viewer-top">
          {/* Uma barra por story; a atual enche durante o tempo do story e depois avança sozinha. */}
          <div className="story-progress-row" aria-hidden="true">{activeGroup.stories.map((story, index) => <span key={story.id}
            className={index < activeStoryIndex ? "done" : index === activeStoryIndex ? "current" : ""}>
            {index === activeStoryIndex && <i key={story.id} onAnimationEnd={() => moveStory(1)} />}
          </span>)}</div>
          <div className="story-viewer-author"><Link className="story-viewer-profile" to={`/u/${activeGroup.username}`} onClick={() => setActiveGroupId(null)} title={`Ver perfil de ${activeGroup.display_name}`}><Avatar user={activeGroup} size="tiny" /><span className="story-viewer-meta"><strong>{activeGroup.display_name}</strong><small>{activeGroup.sponsoredAdId ? "Patrocinado" : relativeTime(activeStory.created_at)}</small></span></Link><button type="button" className="story-viewer-pause" aria-label={storyPaused ? "Continuar story" : "Pausar story"} aria-pressed={storyPaused} onClick={() => setStoryPaused(value => !value)}><Icon name={storyPaused ? "play" : "pause"} size={16} /></button><button type="button" aria-label="Fechar story" onClick={() => setActiveGroupId(null)}><Icon name="close" size={17} /></button></div>
        </div>
        {activeStory.media_url && (activeStory.media_type === "video"
          ? <video key={activeStory.id} ref={storyVideo} className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} playsInline
            onLoadedMetadata={event => { const seconds = event.currentTarget.duration; setStoryDuration(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : STORY_SECONDS); setStoryReady(true); }}
            onError={() => setStoryReady(true)} />
          : <img key={activeStory.id} className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} alt={`Story de ${activeGroup.display_name}`}
            onLoad={() => setStoryReady(true)} onError={() => setStoryReady(true)} />)}
        {activeStory.body && <p className={`story-viewer-body ${activeStory.media_url ? "" : `story-cover-tone-${activeStory.user_id % 4}`}`}>{activeStory.body}</p>}
        <div className="story-viewer-hold" aria-hidden="true"
          onPointerDown={() => setStoryHeld(true)} onPointerUp={() => setStoryHeld(false)}
          onPointerLeave={() => setStoryHeld(false)} onPointerCancel={() => setStoryHeld(false)} />
        <button className="story-viewer-nav previous" type="button" aria-label="Story anterior" onClick={() => moveStory(-1)}><Icon name="previous" size={20} /></button>
        <button className="story-viewer-nav next" type="button" aria-label="Próximo story" onClick={() => moveStory(1)}><Icon name="next" size={20} /></button>
      </section>
    </div>}
  </section>;
}

// Dados partilhados pelas colunas laterais do feed (amigos, pedidos, grupos, páginas, eventos).
function useHomeSidebars(user) {
  const [data, setData] = useState({ friends: [], requests: [], groups: [], pages: [], events: [] });
  const load = async () => {
    if (!user) return;
    const [friendResult, groupResult, pageResult, eventResult] = await Promise.allSettled([api("/friends"), api("/groups"), api("/pages"), api("/events")]);
    setData({
      friends: friendResult.value?.friends || [],
      requests: friendResult.value?.requests || [],
      groups: (groupResult.value?.groups || []).filter(group => group.is_member),
      pages: (pageResult.value?.pages || []).filter(page => page.is_following),
      events: eventResult.value?.events || []
    });
  };
  useEffect(() => { load(); }, [user?.id]);
  return [data, load];
}

const HOME_LINKS = [
  ["/creator", "stats", "Painel do criador"],
  ["/live", "live", "Diretos"],
  ["/friends", "friends", "Amigos"],
  ["/messages", "messages", "Mensagens"],
  ["/groups", "groups", "Grupos"],
  ["/pages", "pages", "Páginas"],
  ["/events", "events", "Eventos"],
  ["/reels", "reels", "Reels"]
];
const HOME_MORE_LINKS = [
  ["/estrelas", "star", "Estrelas"],
  ["/desafios", "trophy", "Desafios"],
  ["/marcas", "brand", "Marcas"],
  ["/convidar", "gift", "Convidar amigos"],
  ["/academia", "academy", "Academia Biva"],
  ["/notifications", "notifications", "Notificações"],
  ["/settings", "settings", "Definições"],
  ["/help", "help", "Ajuda"]
];

function HomeLeft({ user, data }) {
  const [more, setMore] = useState(false);
  const shortcuts = [
    ...data.groups.map(group => ({ key: `g${group.id}`, to: `/groups/${group.id}`, name: group.name, kind: "groups" })),
    ...data.pages.map(page => ({ key: `p${page.id}`, to: `/pages/${page.id}`, name: page.name, kind: "pages" }))
  ].slice(0, 8);
  const links = more ? [...HOME_LINKS, ...HOME_MORE_LINKS, ...(user?.is_admin ? [["/admin", "shield", "Administração"]] : [])] : HOME_LINKS;
  return <aside className="home-left" aria-label="Atalhos">
    {user && <Link className="home-link" to={`/u/${user.username}`}><Avatar user={user} /><span>{user.display_name}</span></Link>}
    {links.map(([to, icon, label]) => <Link className="home-link" key={to} to={to}><span className={`home-link-icon tone-${icon}`}><Icon name={icon} size={20} /></span><span>{label}</span></Link>)}
    <button className="home-link" type="button" aria-expanded={more} onClick={() => setMore(value => !value)}>
      <span className="home-link-icon tone-neutral"><Icon name={more ? "previous" : "chevronDown"} size={20} /></span><span>{more ? "Ver menos" : "Ver mais"}</span>
    </button>
    <hr />
    <h2 className="home-heading">Os teus atalhos</h2>
    {shortcuts.length
      ? shortcuts.map(item => <Link className="home-link" key={item.key} to={item.to}>
        <span className={`home-shortcut tone-${item.kind}`}>{item.name.charAt(0).toUpperCase()}</span><span>{item.name}</span>
      </Link>)
      : <p className="home-empty">Os grupos e páginas que segues aparecem aqui. <Link to="/groups">Descobrir grupos</Link></p>}
    <InfoLinks />
  </aside>;
}

function HomeRight({ data, reload }) {
  const [busyId, setBusyId] = useState(null);
  const answer = async (id, action) => {
    setBusyId(id);
    try {
      await api(`/friends/requests/${id}/${action}`, { method: "POST" });
      await reload();
    } finally {
      setBusyId(null);
    }
  };
  return <aside className="home-right" aria-label="Novidades">
    <section>
      <h2 className="home-heading">Patrocinado</h2>
      <SponsoredSlot />
    </section>
    {data.requests.length > 0 && <section>
      <div className="home-heading-row"><h2 className="home-heading">Pedidos de amizade</h2><Link to="/friends">Ver tudo</Link></div>
      {data.requests.slice(0, 2).map(request => <div className="home-request" key={request.id}>
        <Link to={`/u/${request.username}`}><Avatar user={request} size="large" /></Link>
        <div>
          <Link className="home-request-name" to={`/u/${request.username}`}>{request.display_name}</Link>
          <small>{relativeTime(request.created_at)}</small>
          <div className="home-request-actions">
            <button className="btn" type="button" disabled={busyId === request.id} onClick={() => answer(request.id, "accept")}>Confirmar</button>
            <button className="btn secondary" type="button" disabled={busyId === request.id} onClick={() => answer(request.id, "reject")}>Recusar</button>
          </div>
        </div>
      </div>)}
    </section>}
    {data.events.length > 0 && <section>
      <div className="home-heading-row"><h2 className="home-heading">Próximos eventos</h2><Link to="/events">Ver tudo</Link></div>
      {data.events.slice(0, 2).map(event => <Link className="home-event" key={event.id} to="/events">
        <span className="home-event-date"><strong>{new Date(event.starts_at).toLocaleDateString("pt-PT", { day: "2-digit" })}</strong><small>{new Date(event.starts_at).toLocaleDateString("pt-PT", { month: "short" })}</small></span>
        <span><strong>{event.name}</strong><small>{event.attendee_count} {event.attendee_count === 1 ? "participante" : "participantes"}{event.location ? ` · ${event.location}` : ""}</small></span>
      </Link>)}
    </section>}
    <section>
      <h2 className="home-heading">Contactos</h2>
      {data.friends.length
        ? data.friends.slice(0, 12).map(friend => <Link className="home-link" key={friend.id} to={`/messages/${friend.id}`} title={`Enviar mensagem a ${friend.display_name}`}>
          <Avatar user={friend} /><span>{friend.display_name}</span>
        </Link>)
        : <p className="home-empty">Ainda não tens amigos no Biva. <Link to="/friends">Encontrar pessoas</Link></p>}
    </section>
  </aside>;
}

function Feed() {
  const { user } = useContext(UserContext);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [scope, setScope] = useState(() => {
    try { return (localStorage.getItem("biva-feed") || localStorage.getItem("buala-feed")) === "following" ? "following" : "all"; } catch { return "all"; }
  });
  const activeScope = user ? scope : "all";
  const [sidebars, reloadSidebars] = useHomeSidebars(user);
  const [sponsored, setSponsored] = useState([]);
  useEffect(() => { api("/ads/feed").then(result => setSponsored(result.posts)).catch(() => setSponsored([])); }, [user?.id]);
  const feedItems = useMemo(() => {
    // Se a publicação impulsionada já está no feed, essa cópia recebe a etiqueta (sem a repetir).
    const sponsorById = new Map(sponsored.map(post => [post.id, post.sponsored]));
    const organicIds = new Set(posts.map(post => post.id));
    const extra = sponsored.filter(post => !organicIds.has(post.id));
    const items = posts.map(post => ({ key: post.id, post: sponsorById.has(post.id) ? { ...post, sponsored: sponsorById.get(post.id) } : post }));
    if (!posts.length || !extra.length) return items;
    [3, 10].forEach((position, index) => {
      const ad = extra[index];
      if (ad) items.splice(Math.min(position + index, items.length), 0, { key: `sponsored-${ad.sponsored.ad_id}`, post: ad });
    });
    return items;
  }, [posts, sponsored]);

  const load = async () => {
    setError("");
    try {
      const result = await api(`/posts?feed=${activeScope}`);
      setPosts(result.posts);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message === "Failed to fetch" ? "Não foi possível ligar à API. Confirma que o servidor está em execução." : loadError.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await api(`/posts?feed=${activeScope}&before=${nextCursor}`);
      setPosts(current => [...current, ...result.posts.filter(post => !current.some(existing => existing.id === post.id))]);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const changeScope = value => {
    setScope(value);
    setLoading(true);
    try { localStorage.setItem("biva-feed", value); } catch { /* preferência opcional */ }
  };

  useEffect(() => { load(); }, [activeScope]);

  return <div className="home">
    <HomeLeft user={user} data={sidebars} />
    <section className="home-feed" aria-label="Feed">
      <Composer onPosted={load} />
      <StoryZone />
      {user && <div className="feed-tabs" role="tablist" aria-label="Que publicações mostrar">
        <button type="button" role="tab" aria-selected={activeScope === "all"} onClick={() => changeScope("all")}>Para ti</button>
        <button type="button" role="tab" aria-selected={activeScope === "following"} onClick={() => changeScope("following")}>Amigos e quem segues</button>
      </div>}
      {loading && <div className="empty card">A carregar publicações...</div>}
      {error && <div className="empty card error">{error}</div>}
      {!loading && !error && !posts.length && <div className="empty card">{activeScope === "following"
        ? <>Ainda não há publicações de amigos ou de quem segues. <Link to="/friends">Encontra pessoas</Link> ou vê o separador «Para ti».</>
        : "Ainda não há publicações. Sê a primeira pessoa a partilhar algo."}</div>}
      {!loading && feedItems.map(item => <PostCard key={item.key} post={item.post} onChanged={load} />)}
      {!loading && nextCursor && <button className="btn secondary feed-more" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "A carregar..." : "Carregar mais publicações"}</button>}
      {!loading && !nextCursor && posts.length > 0 && <p className="feed-end muted">Chegaste ao fim. Volta mais tarde para veres novidades.</p>}
    </section>
    <HomeRight data={sidebars} reload={reloadSidebars} />
  </div>;
}

// Partilhar um vídeo sem sair da página Reels: escolher, editar (cortar, velocidade, efeitos, texto,
// som), escrever a legenda e publicar. As edições seguem como instruções (videoEdit) e o leitor aplica-as.
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_CLIP_SECONDS = 180;
const FILMSTRIP_FRAMES = 8;

// Tira fotogramas do vídeo escolhido para a tira do corte e para as miniaturas dos efeitos.
function useVideoFrames(url) {
  const [state, setState] = useState({ duration: 0, frames: [] });
  useEffect(() => {
    if (!url) { setState({ duration: 0, frames: [] }); return undefined; }
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const seekTo = time => new Promise(resolve => {
      const done = () => { video.removeEventListener("seeked", done); resolve(); };
      video.addEventListener("seeked", done);
      video.currentTime = time;
    });
    video.addEventListener("loadedmetadata", async () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (cancelled) return;
      setState({ duration, frames: [] });
      const canvas = document.createElement("canvas");
      const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 9 / 16;
      canvas.height = 112;
      canvas.width = Math.round(112 * ratio);
      const context = canvas.getContext("2d");
      const frames = [];
      for (let index = 0; index < FILMSTRIP_FRAMES && !cancelled; index += 1) {
        try {
          await seekTo(Math.min(duration - 0.05, (duration * (index + 0.5)) / FILMSTRIP_FRAMES));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push(canvas.toDataURL("image/jpeg", 0.7));
          if (!cancelled) setState({ duration, frames: [...frames] });
        } catch {
          break;
        }
      }
    }, { once: true });
    return () => { cancelled = true; video.removeAttribute("src"); video.load(); };
  }, [url]);
  return state;
}

const REEL_TOOLS = [
  ["trim", "trim", "Cortar"],
  ["music", "sound", "Música"],
  ["effects", "effects", "Efeitos"],
  ["adjust", "adjust", "Ajustes"],
  ["text", "text", "Texto"],
  ["speed", "speed", "Velocidade"]
];
const MUSIC_GENRE_LABELS = {
  afrobeat: "Afrobeat", kizomba: "Kizomba", semba: "Semba", kuduro: "Kuduro", amapiano: "Amapiano",
  hiphop: "Hip-hop", pop: "Pop", gospel: "Gospel", calmo: "Calmo", outro: "Outros"
};
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const ADJUSTMENTS = [["brightness", "Brilho"], ["contrast", "Contraste"], ["saturation", "Saturação"]];

// Lê a duração de um ficheiro de áudio no próprio browser (para o servidor e para o início da música).
const audioDuration = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  audio.onloadedmetadata = () => { const value = audio.duration; URL.revokeObjectURL(url); Number.isFinite(value) ? resolve(value) : reject(new Error("duration")); };
  audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("audio")); };
  audio.src = url;
});

// Escolher música: biblioteca da Biva, as tuas músicas, pesquisa, géneros, ouvir antes e carregar a tua.
function MusicPicker({ onSelect, onCancel }) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState(null);
  const [uploading, setUploading] = useState(null);    // { file, title, artist, rights, busy, error }
  const previewAudio = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (genre) params.set("genre", genre);
      api(`/music?${params}`).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, genre]);
  useEffect(() => () => previewAudio.current?.pause(), []);

  const togglePreview = track => {
    const audio = previewAudio.current;
    if (!audio) return;
    if (previewId === track.id) { audio.pause(); setPreviewId(null); return; }
    audio.src = `${API_BASE}${track.audio_url}`;
    audio.currentTime = 0;
    audio.play().then(() => setPreviewId(track.id)).catch(() => setPreviewId(null));
  };
  const choose = track => { previewAudio.current?.pause(); setPreviewId(null); onSelect(track); };

  const pickFile = file => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return setError("Escolhe um ficheiro de áudio (MP3, M4A, AAC, WAV ou OGG).");
    if (file.size > MAX_AUDIO_BYTES) return setError("A música tem mais de 15 MB.");
    setError("");
    setUploading({ file, title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100), artist: "", rights: false, busy: false, error: "" });
  };
  const upload = async () => {
    setUploading(current => ({ ...current, busy: true, error: "" }));
    try {
      const duration = await audioDuration(uploading.file).catch(() => { throw new Error("Não foi possível ler esta música. Experimenta outro ficheiro."); });
      const form = new FormData();
      form.append("audio", uploading.file);
      form.append("title", uploading.title);
      form.append("artist", uploading.artist);
      form.append("duration", String(duration));
      form.append("rightsConfirmed", String(uploading.rights));
      const result = await api("/music", { method: "POST", body: form });
      setUploading(null);
      choose(result.track);
    } catch (uploadError) {
      setUploading(current => ({ ...current, busy: false, error: uploadError.message }));
    }
  };
  const remove = async track => {
    if (!window.confirm(`Apagar "${track.title}" das tuas músicas?`)) return;
    try {
      await api(`/music/${track.id}`, { method: "DELETE" });
      setData(current => ({ ...current, mine: current.mine.filter(item => item.id !== track.id) }));
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const trackRow = (track, own) => <li key={track.id} className={`music-row ${previewId === track.id ? "is-previewing" : ""}`}>
    <button type="button" className="music-preview" aria-label={previewId === track.id ? `Parar ${track.title}` : `Ouvir ${track.title}`} onClick={() => togglePreview(track)}>
      <Icon name={previewId === track.id ? "pause" : "play"} size={16} />
    </button>
    <span className="music-info">
      <strong>{track.title}</strong>
      <small>{[track.artist, formatClock(track.duration), track.uses ? `${track.uses} ${track.uses === 1 ? "vídeo" : "vídeos"}` : null].filter(Boolean).join(" · ")}</small>
    </span>
    {own && !track.uses && <button type="button" className="music-delete" aria-label={`Apagar ${track.title}`} onClick={() => remove(track)}><Icon name="trash" size={15} /></button>}
    <button type="button" className="music-use" onClick={() => choose(track)}>Usar</button>
  </li>;

  return <div className="music-picker">
    <audio ref={previewAudio} onEnded={() => setPreviewId(null)} />
    <div className="music-search">
      <Icon name="search" size={16} />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Procurar música ou artista" aria-label="Procurar música" />
    </div>
    <div className="music-genres" role="radiogroup" aria-label="Género">
      <button type="button" role="radio" aria-checked={!genre} className={!genre ? "active" : ""} onClick={() => setGenre("")}>Todas</button>
      {(data?.genres || Object.keys(MUSIC_GENRE_LABELS)).map(id => <button key={id} type="button" role="radio" aria-checked={genre === id}
        className={genre === id ? "active" : ""} onClick={() => setGenre(genre === id ? "" : id)}>{MUSIC_GENRE_LABELS[id] || id}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}

    {uploading
      ? <div className="music-upload">
        <strong>Carregar música</strong>
        <label>Nome da música<input maxLength={100} value={uploading.title} onChange={event => setUploading({ ...uploading, title: event.target.value })} /></label>
        <label>Artista <small>opcional</small><input maxLength={100} value={uploading.artist} onChange={event => setUploading({ ...uploading, artist: event.target.value })} /></label>
        <label className="music-rights">
          <input type="checkbox" checked={uploading.rights} onChange={event => setUploading({ ...uploading, rights: event.target.checked })} />
          <span>Tenho direitos para usar esta música: é minha, tenho autorização do artista ou tem licença livre. Músicas com direitos de autor de outras pessoas podem ser removidas.</span>
        </label>
        {uploading.error && <p className="error" role="alert">{uploading.error}</p>}
        <div className="music-upload-actions">
          <button type="button" className="btn secondary" disabled={uploading.busy} onClick={() => setUploading(null)}>Cancelar</button>
          <button type="button" className="btn" disabled={uploading.busy || !uploading.rights || !uploading.title.trim()} onClick={upload}>{uploading.busy ? "A carregar..." : "Carregar e usar"}</button>
        </div>
      </div>
      : <button type="button" className="music-upload-button" onClick={() => fileInput.current.click()}><Icon name="plus" size={16} />Carregar música do telemóvel ou computador</button>}
    <input ref={fileInput} className="sr-only" type="file" accept="audio/*" tabIndex={-1} aria-hidden="true" onChange={event => { pickFile(event.target.files?.[0]); event.target.value = ""; }} />

    {!data && !error && <p className="reel-hint">A carregar músicas...</p>}
    {!!data?.mine?.length && <section><h3 className="music-heading">As tuas músicas</h3><ul className="music-list">{data.mine.map(track => trackRow(track, true))}</ul></section>}
    {data && <section>
      <h3 className="music-heading">Biblioteca da Biva</h3>
      {data.library.length
        ? <ul className="music-list">{data.library.map(track => trackRow(track, false))}</ul>
        : <p className="reel-hint">{query || genre ? "Nenhuma música encontrada. Experimenta outra pesquisa." : "A biblioteca ainda está vazia. Carrega uma música tua para usar já."}</p>}
    </section>}
    {onCancel && <button type="button" className="reel-reset" onClick={onCancel}>Voltar</button>}
  </div>;
}

function ShareReelDialog({ onClose, onPosted }) {
  const { user } = useContext(UserContext);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [edit, setEdit] = useState(DEFAULT_VIDEO_EDIT);
  const [track, setTrack] = useState(null);           // música escolhida (dados para o leitor)
  const [pickingMusic, setPickingMusic] = useState(false);
  const [tool, setTool] = useState("trim");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const { duration, frames } = useVideoFrames(preview);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  // Vídeo novo: edição do zero (mantém a música escolhida); vídeos com mais de 3 minutos ficam nos primeiros 3.
  useEffect(() => {
    setEdit(current => ({ ...DEFAULT_VIDEO_EDIT, music: current.music, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null }));
  }, [duration]);

  const update = changes => setEdit(current => ({ ...current, ...changes }));
  const end = edit.end ?? duration;
  const clipSeconds = Math.max(0, end - edit.start);
  const finalSeconds = clipSeconds / edit.speed;
  const edited = edit.start > 0 || (edit.end !== null && edit.end < duration - 0.05) || edit.speed !== 1 || edit.filter !== "none"
    || edit.originalVolume !== 1 || edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100 || edit.mirror
    || edit.music || edit.text.trim();
  const maxMusicOffset = track ? Math.max(0, track.duration - Math.min(finalSeconds, track.duration)) : 0;

  const choose = picked => {
    setError("");
    if (!picked) return;
    if (!picked.type.startsWith("video/")) return setError("Escolhe um ficheiro de vídeo.");
    if (picked.size > MAX_VIDEO_BYTES) return setError("O vídeo tem mais de 100 MB. Escolhe um mais curto.");
    setFile(picked);
    setTool("trim");
  };

  const selectTrack = picked => {
    setTrack(picked);
    setPickingMusic(false);
    // Com música, o som do vídeo baixa para 30% (a música fica em destaque); ajusta-se nos controlos.
    update({ music: { trackId: picked.id, offset: 0, volume: 1, fade: true }, originalVolume: edit.music ? edit.originalVolume : Math.min(edit.originalVolume, 0.3) });
  };
  const removeTrack = () => {
    setTrack(null);
    update({ music: null, originalVolume: 1 });
  };
  const updateMusic = changes => update({ music: { ...edit.music, ...changes } });

  // Os dois puxadores do corte: o início não passa o fim (e vice-versa) e o reel não passa de 3 minutos.
  const setStart = value => {
    const start = Math.min(Number(value), end - 0.5);
    update({ start: Math.max(0, Math.round(start * 10) / 10), end: end - start > MAX_CLIP_SECONDS ? start + MAX_CLIP_SECONDS : edit.end });
  };
  const setEnd = value => {
    const next = Math.max(Number(value), edit.start + 0.5);
    const clamped = Math.min(next, edit.start + MAX_CLIP_SECONDS);
    update({ end: clamped >= duration - 0.05 ? null : Math.round(clamped * 10) / 10 });
  };

  const resetAll = () => {
    setTrack(null);
    setEdit({ ...DEFAULT_VIDEO_EDIT, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null });
  };

  const submit = async event => {
    event.preventDefault();
    if (!file) return setError("Escolhe primeiro um vídeo.");
    setBusy(true);
    setError("");
    const formData = new FormData();
    formData.append("body", caption);
    formData.append("media", file);
    if (exclusive) formData.append("isExclusive", "true");
    if (edited) {
      const { text, textPosition, textStyle, muted, music, ...rest } = edit;
      formData.append("videoEdit", JSON.stringify({
        ...rest,
        ...(music && { music }),
        ...(text.trim() && { text: text.trim(), textPosition, textStyle })
      }));
    }
    try {
      const result = await api("/posts", { method: "POST", body: formData });
      onPosted(result.post);
    } catch (submitError) {
      setError(submitError.message);
      setBusy(false);
    }
  };

  const percent = value => (duration ? `${(value / duration) * 100}%` : "0%");
  const thumb = frames[Math.min(frames.length - 1, 2)] || frames[0];
  const playerMusic = track ? { title: track.title, artist: track.artist, src: `${API_BASE}${track.audio_url}` } : null;
  const toolDot = id => ({
    trim: edit.start > 0 || (edit.end !== null && edit.end < duration - 0.05),
    music: Boolean(edit.music),
    effects: edit.filter !== "none",
    adjust: edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100 || edit.mirror,
    text: Boolean(edit.text.trim()),
    speed: edit.speed !== 1
  })[id];

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card share-reel-dialog" role="dialog" aria-modal="true" aria-labelledby="share-reel-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="share-reel-title">{file ? "Editar e partilhar" : "Partilhar vídeo"}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <input ref={fileInput} className="sr-only" type="file" accept="video/*" tabIndex={-1} aria-hidden="true"
        onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="share-reel-grid">
        {file
          ? <div className="share-reel-preview">
            <VideoPlayer key={preview} src={preview} edit={edit} music={playerMusic} label="Pré-visualização do teu vídeo" />
            <button type="button" className="share-reel-change" onClick={() => fileInput.current.click()} disabled={busy}><Icon name="video" size={15} />Trocar</button>
          </div>
          : <button type="button" className="share-reel-pick" onClick={() => fileInput.current.click()}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}>
            <span className="share-reel-pick-icon"><Icon name="video" size={28} /></span>
            <strong>Escolher vídeo</strong>
            <small>Do telemóvel ou do computador, até 100 MB. Vídeos ao alto ficam melhor.</small>
          </button>}

        <div className="share-reel-fields">
          {file && <section className="reel-editor" aria-label="Editar o vídeo">
            <div className="reel-tools" role="tablist" aria-label="Ferramentas">
              {REEL_TOOLS.map(([id, icon, label]) => <button key={id} type="button" role="tab" aria-selected={tool === id}
                className={tool === id ? "active" : ""} onClick={() => setTool(id)}>
                <span className="reel-tool-icon"><Icon name={icon} size={18} />{toolDot(id) && <i className="reel-tool-dot" aria-label="(alterado)" />}</span>
                <span>{label}</span>
              </button>)}
            </div>

            <div className="reel-tool-panel" role="tabpanel">
              {tool === "trim" && <>
                <div className="reel-trim">
                  <div className="reel-filmstrip" aria-hidden="true">
                    {frames.length ? frames.map((src, index) => <img key={index} src={src} alt="" />) : <span className="reel-filmstrip-loading">A preparar o vídeo...</span>}
                  </div>
                  <span className="reel-trim-shade" style={{ left: 0, width: percent(edit.start) }} />
                  <span className="reel-trim-shade" style={{ left: percent(end), right: 0 }} />
                  <span className="reel-trim-window" style={{ left: percent(edit.start), width: percent(clipSeconds) }} />
                  <input type="range" className="reel-trim-handle" min="0" max={duration || 0} step="0.1" value={edit.start}
                    aria-label="Início do vídeo" aria-valuetext={formatClock(edit.start)} onChange={event => setStart(event.target.value)} disabled={!duration} />
                  <input type="range" className="reel-trim-handle" min="0" max={duration || 0} step="0.1" value={end}
                    aria-label="Fim do vídeo" aria-valuetext={formatClock(end)} onChange={event => setEnd(event.target.value)} disabled={!duration} />
                </div>
                <p className="reel-trim-info">
                  <span>Início <strong>{formatClock(edit.start)}</strong></span>
                  <span>Fim <strong>{formatClock(end)}</strong></span>
                  <span>Duração final <strong>{formatClock(Math.ceil(finalSeconds))}</strong></span>
                </p>
                {duration > MAX_CLIP_SECONDS && <p className="reel-hint">Os reels podem ter até 3 minutos. Arrasta para escolher a melhor parte.</p>}
              </>}

              {tool === "music" && (pickingMusic || !track
                ? <MusicPicker onSelect={selectTrack} onCancel={track ? () => setPickingMusic(false) : null} />
                : <div className="music-selected">
                  <div className="music-selected-card">
                    <span className="music-selected-icon"><Icon name="sound" size={20} /></span>
                    <span className="music-info"><strong>{track.title}</strong><small>{[track.artist, formatClock(track.duration)].filter(Boolean).join(" · ")}</small></span>
                    <button type="button" className="music-use" onClick={() => setPickingMusic(true)}>Trocar</button>
                    <button type="button" className="music-delete" aria-label="Tirar a música" onClick={removeTrack}><Icon name="close" size={15} /></button>
                  </div>
                  {maxMusicOffset > 0 && <label className="reel-slider">
                    <span>Começar a música em <strong>{formatClock(edit.music.offset)}</strong></span>
                    <input type="range" min="0" max={maxMusicOffset} step="0.5" value={Math.min(edit.music.offset, maxMusicOffset)}
                      onChange={event => updateMusic({ offset: Number(event.target.value) })} />
                    <small>Escolhe a parte da música que fica melhor com o vídeo (o refrão, por exemplo).</small>
                  </label>}
                  <label className="reel-slider">
                    <span>Volume da música <strong>{Math.round(edit.music.volume * 100)}%</strong></span>
                    <input type="range" min="0" max="1" step="0.05" value={edit.music.volume} onChange={event => updateMusic({ volume: Number(event.target.value) })} />
                  </label>
                  <label className="reel-slider">
                    <span>Som do vídeo <strong>{edit.originalVolume === 0 ? "sem som" : `${Math.round(edit.originalVolume * 100)}%`}</strong></span>
                    <input type="range" min="0" max="1" step="0.05" value={edit.originalVolume} onChange={event => update({ originalVolume: Number(event.target.value) })} />
                  </label>
                  <label className="reel-sound-toggle">
                    <input type="checkbox" checked={edit.music.fade} onChange={event => updateMusic({ fade: event.target.checked })} />
                    <span className="entry-switch-track" aria-hidden="true"><i /></span>
                    <span><strong>Entrada e saída suaves</strong><small>A música aumenta no início e baixa no fim do vídeo.</small></span>
                  </label>
                  <p className="reel-hint">Ativa o som na pré-visualização para ouvires a mistura.</p>
                </div>)}

              {tool === "effects" && <div className="reel-effects" role="radiogroup" aria-label="Efeitos">
                {VIDEO_FILTERS.map(([id, label, css]) => <button key={id} type="button" role="radio" aria-checked={edit.filter === id}
                  className={edit.filter === id ? "active" : ""} onClick={() => update({ filter: id })}>
                  <span className="reel-effect-thumb">{thumb ? <img src={thumb} alt="" style={{ filter: css }} /> : <i style={{ filter: css }} />}</span>
                  <small>{label}</small>
                </button>)}
              </div>}

              {tool === "adjust" && <div className="reel-adjust">
                {ADJUSTMENTS.map(([key, label]) => <label key={key} className="reel-slider">
                  <span>{label} <strong>{edit[key] > 100 ? "+" : ""}{edit[key] - 100}</strong></span>
                  <input type="range" min="50" max="150" step="1" value={edit[key]} onChange={event => update({ [key]: Number(event.target.value) })}
                    onDoubleClick={() => update({ [key]: 100 })} />
                </label>)}
                <label className="reel-sound-toggle">
                  <input type="checkbox" checked={edit.mirror} onChange={event => update({ mirror: event.target.checked })} />
                  <span className="entry-switch-track" aria-hidden="true"><i /></span>
                  <span><strong>Espelhar</strong><small>Vira o vídeo da esquerda para a direita (útil em vídeos da câmara da frente).</small></span>
                </label>
                {(edit.brightness !== 100 || edit.contrast !== 100 || edit.saturation !== 100) &&
                  <button type="button" className="reel-reset" onClick={() => update({ brightness: 100, contrast: 100, saturation: 100 })}><Icon name="reset" size={14} />Repor ajustes</button>}
              </div>}

              {tool === "text" && <div className="reel-text-tool">
                <label>Texto no vídeo <small>{edit.text.length}/80</small>
                  <input maxLength={80} value={edit.text} onChange={event => update({ text: event.target.value })} placeholder="Ex.: Sábado na Ilha de Luanda" />
                </label>
                <div className="reel-chips" role="radiogroup" aria-label="Posição do texto">
                  {[["top", "Em cima"], ["center", "Ao meio"], ["bottom", "Em baixo"]].map(([value, label]) => <button key={value} type="button" role="radio"
                    aria-checked={edit.textPosition === value} className={edit.textPosition === value ? "active" : ""} onClick={() => update({ textPosition: value })}>{label}</button>)}
                </div>
                <div className="reel-chips reel-text-styles" role="radiogroup" aria-label="Estilo do texto">
                  {[["clean", "Simples"], ["box", "Caixa"], ["coral", "Coral"]].map(([value, label]) => <button key={value} type="button" role="radio"
                    aria-checked={edit.textStyle === value} className={`${edit.textStyle === value ? "active" : ""} sample-${value}`} onClick={() => update({ textStyle: value })}><span>{label}</span></button>)}
                </div>
              </div>}

              {tool === "speed" && <div className="reel-chips" role="radiogroup" aria-label="Velocidade">
                {VIDEO_SPEEDS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={edit.speed === value}
                  className={edit.speed === value ? "active" : ""} onClick={() => update({ speed: value })}>{label}</button>)}
                <p className="reel-hint">{edit.speed < 1 ? "Câmara lenta: ótimo para danças e momentos especiais." : edit.speed > 1 ? "Acelerado: bom para receitas, viagens e tutoriais." : "Velocidade normal."} A música toca sempre à velocidade normal.</p>
              </div>}
            </div>
            {edited && <button type="button" className="reel-reset" onClick={resetAll}><Icon name="reset" size={14} />Repor o original</button>}
          </section>}

          <div className="share-reel-author"><Avatar user={user} size="tiny" /><strong>{user?.display_name}</strong></div>
          <label>Legenda <small>{caption.length}/5000</small>
            <textarea rows={file ? 3 : 5} maxLength={5000} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Conta o que se passa no vídeo..." />
          </label>
          <ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !file}>{busy ? "A publicar o vídeo..." : "Publicar"}</button>
      </div>
    </form>
  </div>, document.body);
}

function Reels() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const [posts, setPosts] = useState([]);
  const [sponsoredReels, setSponsoredReels] = useState([]);
  useEffect(() => { api("/ads/feed?placement=reels").then(result => setSponsoredReels(result.posts)).catch(() => {}); }, []);
  const reelItems = useMemo(() => {
    const ids = new Set(posts.map(post => post.id));
    const items = posts.map(post => ({ key: post.id, post }));
    sponsoredReels.filter(post => !ids.has(post.id)).forEach((post, index) => {
      items.splice(Math.min(2 + index * 5, items.length), 0, { key: `sponsored-${post.sponsored.ad_id}`, post });
    });
    return items;
  }, [posts, sponsoredReels]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError("");
    try {
      const result = await api("/posts?mediaType=video");
      setPosts(result.posts);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Sem sessão iniciada é preciso entrar primeiro; com sessão, tudo acontece aqui mesmo.
  const startSharing = () => (user ? setSharing(true) : navigate("/login"));
  const onPosted = post => {
    setSharing(false);
    if (post) setPosts(current => [{ ...post, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url, likes: 0, comments: 0 }, ...current]);
    setNotice("O teu vídeo foi publicado.");
    window.scrollTo({ top: 0, behavior: "smooth" });
    load();
  };

  return <section className="page narrow reels-page">
    <header className="reels-heading">
      <span className="reels-heading-icon"><Icon name="reels" size={22} /></span>
      <div><p className="feed-section-kicker">Vídeos da comunidade</p><h1>Reels</h1><p>Momentos em vídeo partilhados por quem está no Biva.</p></div>
      <button className="reels-create-link" type="button" onClick={startSharing}><Icon name="camera" size={16} />Partilhar vídeo</button>
    </header>
    {notice && <p className="settings-form-success reels-notice" role="status"><Icon name="check" size={14} />{notice}</p>}
    {loading && <div className="empty card">A carregar vídeos...</div>}
    {error && <div className="empty card error">{error}</div>}
    {!loading && !error && !posts.length && <div className="reels-empty card"><span className="reels-empty-icon"><Icon name="video" size={25} /></span><h2>Ainda não há Reels</h2><p>Quando alguém partilhar um vídeo, vais encontrá-lo aqui. Também podes ser a primeira pessoa a publicar.</p><button className="btn" type="button" onClick={startSharing}>Partilhar vídeo</button></div>}
    {sharing && <ShareReelDialog onClose={() => setSharing(false)} onPosted={onPosted} />}
    {!loading && !error && <div className="reels-list">{reelItems.map(item => <PostCard key={item.key} post={item.post} onChanged={load} />)}</div>}
  </section>;
}

function BlockedAccounts() {
  const [blocked, setBlocked] = useState(null);
  const [error, setError] = useState("");

  const load = () => api("/blocks").then(result => setBlocked(result.blocked)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);

  const unblock = async id => {
    setError("");
    try {
      await api(`/users/${id}/block`, { method: "DELETE" });
      await load();
    } catch (unblockError) {
      setError(unblockError.message);
    }
  };

  return <div className="prefs-row prefs-blocked">
    <span className="prefs-row-icon"><Icon name="block" /></span>
    <span>
      <strong>Contas bloqueadas</strong>
      <small>{blocked === null ? "A carregar..." : blocked.length ? "Estas contas não te veem nem te podem contactar." : "Não bloqueaste nenhuma conta."}</small>
      {!!blocked?.length && <div className="blocked-list">
        {blocked.map(person => <div key={person.id}>
          <Avatar user={person} size="tiny" />
          <span><strong>{person.display_name}</strong> <small>@{person.username}</small></span>
          <button className="prefs-link" type="button" onClick={() => unblock(person.id)}>Desbloquear</button>
        </div>)}
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
    </span>
  </div>;
}

// Visitas diárias ao perfil: uma série, barras finas, dica ao passar o rato e tabela alternativa.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------------------------
// Painel do criador
// ---------------------------------------------------------------------------------------------

const CREATOR_SECTIONS = [
  ["", "home", "Página inicial"],
  ["insights", "stats", "Insights"],
  ["conteudo", "pages", "Conteúdo"],
  ["engajamento", "messages", "Engajamento"],
  ["monetizacao", "spark", "Monetização"],
  ["ganhos", "gift", "Ganhos"],
  ["parcerias", "brand", "Parcerias"],
  ["anuncios", "ad", "Anúncios"]
];

const INSIGHT_METRICS = [
  ["views", "Visualizações", "eye", "publicações vistas por outras pessoas"],
  ["engagement", "Engajamento", "messages", "gostos, comentários e partilhas"],
  ["followers", "Novos seguidores", "friends", "pessoas que começaram a seguir-te"],
  ["visits", "Visitas ao perfil", "profile", "pessoas que abriram o teu perfil"]
];

const PERIOD_OPTIONS = [[7, "Últimos 7 dias"], [28, "Últimos 28 dias"], [90, "Últimos 90 dias"]];

const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortDate = day => { const date = new Date(`${day}T12:00:00`); return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`; };

// Variação face ao período anterior: null quando não há base de comparação.
function percentChange(total, previous) {
  if (!previous) return total ? null : 0;
  return Math.round(((total - previous) / previous) * 100);
}

function DeltaBadge({ total, previous }) {
  const change = percentChange(total, previous);
  if (change === null) return <span className="delta delta-new">novo</span>;
  if (change === 0) return <span className="delta delta-flat">0%</span>;
  const up = change > 0;
  return <span className={`delta ${up ? "delta-up" : "delta-down"}`} title="Comparado com o período anterior">
    <Icon name={up ? "arrowUp" : "arrowDown"} size={13} />{up ? "+" : ""}{change}%
  </span>;
}

// Escala "redonda" para o eixo: 4, 10, 20, 50, 100, 200...
function niceMax(value) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value);
}

// Gráfico de área de uma só série, com linha de referência e dica ao passar o rato/teclado.
function InsightsChart({ daily, metric, label }) {
  const wrapRef = useRef(null);
  // A largura vem do contentor: o gráfico só é desenhado depois de a medir, para nunca o alargar.
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = 230;
  const pad = { top: 14, right: 14, bottom: 30, left: 44 };
  const values = daily.map(day => day[metric]);
  const max = niceMax(Math.max(0, ...values));
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const x = index => pad.left + (daily.length <= 1 ? innerWidth / 2 : (index * innerWidth) / (daily.length - 1));
  const y = value => pad.top + innerHeight - (value / max) * innerHeight;
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const step = Math.max(1, Math.ceil(daily.length / 6));
  const xTicks = daily.map((day, index) => index).filter(index => index % step === 0 || index === daily.length - 1)
    .filter((index, position, list) => position === list.length - 1 || list[position + 1] - index >= step * 0.6);

  const pick = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - pad.left) / innerWidth;
    setActive(clamp(Math.round(ratio * (daily.length - 1)), 0, daily.length - 1));
  };
  const onKeyDown = event => {
    if (event.key === "ArrowRight") { event.preventDefault(); setActive(index => clamp((index ?? -1) + 1, 0, daily.length - 1)); }
    if (event.key === "ArrowLeft") { event.preventDefault(); setActive(index => clamp((index ?? daily.length) - 1, 0, daily.length - 1)); }
  };
  const current = active === null ? null : daily[active];
  const total = values.reduce((sum, value) => sum + value, 0);

  return <figure className="insights-chart">
    <div className="insights-chart-plot" ref={wrapRef}>
      {width > 0 && <svg width={width} height={height} role="img" tabIndex={0}
        aria-label={`${label}: ${formatCount(total)} no período, máximo de ${formatCount(Math.max(0, ...values))} num dia. Usa as setas para ver cada dia.`}
        onPointerMove={pick} onPointerLeave={() => setActive(null)} onKeyDown={onKeyDown} onBlur={() => setActive(null)}>
        {[0, max / 2, max].map(tick => <g key={tick} className="insights-grid">
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
          <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatCount(tick)}</text>
        </g>)}
        <path className="insights-area" d={area} />
        <path className="insights-line" d={line} />
        {xTicks.map(index => <text key={index} className="insights-x" x={x(index)} y={height - 8}
          textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"}>{shortDate(daily[index].day)}</text>)}
        {current && <g className="insights-cursor">
          <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerHeight} />
          <circle cx={x(active)} cy={y(values[active])} r="5" />
        </g>}
      </svg>}
      {current && <div className="insights-tooltip" role="status"
        style={{ left: clamp(x(active), 70, width - 70), top: Math.max(0, y(values[active]) - 62) }}>
        <strong>{formatCount(values[active])}</strong><span>{label.toLowerCase()}</span><small>{shortDate(current.day)}</small>
      </div>}
    </div>
    <details className="insights-table">
      <summary>Ver como tabela</summary>
      <table>
        <thead><tr><th scope="col">Dia</th><th scope="col">{label}</th></tr></thead>
        <tbody>{daily.map(day => <tr key={day.day}><td>{shortDate(day.day)}</td><td>{formatCount(day[metric])}</td></tr>)}</tbody>
      </table>
    </details>
  </figure>;
}

function useCreatorOverview(days) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    api(`/creator/overview?days=${days}`)
      .then(result => { if (alive) setData(result); })
      .catch(loadError => { if (alive) setError(loadError.message); });
    return () => { alive = false; };
  }, [days]);
  return [data, error];
}

function PeriodSelect({ days, onChange }) {
  return <label className="period-select">
    <span className="visually-hidden">Período</span>
    <select value={days} onChange={event => onChange(Number(event.target.value))}>
      {PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <Icon name="chevronDown" size={16} />
  </label>;
}

function InsightsCard({ data, error, days, onDays, full = false }) {
  const [metric, setMetric] = useState("views");
  const selected = INSIGHT_METRICS.find(([key]) => key === metric);
  return <section className="creator-card insights-card" aria-labelledby="insights-title">
    <div className="creator-card-head">
      <div><h2 id="insights-title">Insights</h2><p>Sabe como está o desempenho do teu perfil.</p></div>
      <div className="creator-card-tools">
        <PeriodSelect days={days} onChange={onDays} />
        {!full && <Link className="creator-see-all" to="/creator/insights">Ver tudo</Link>}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="creator-loading">A calcular...</div>}
    {data && <>
      <div className="metric-tiles" role="tablist" aria-label="Métrica do gráfico">
        {INSIGHT_METRICS.map(([key, label, icon, hint]) => <button key={key} type="button" role="tab" aria-selected={metric === key}
          className="metric-tile" onClick={() => setMetric(key)} title={hint}>
          <span className="metric-tile-icon"><Icon name={icon} size={18} /></span>
          <span className="metric-tile-value"><strong>{formatCount(data.metrics[key].total)}</strong><DeltaBadge {...data.metrics[key]} /></span>
          <span className="metric-tile-label">{label}</span>
        </button>)}
      </div>
      <InsightsChart daily={data.daily} metric={metric} label={selected[1]} />
      {full && <p className="muted creator-footnote">A percentagem compara com os {days} dias anteriores. {selected[1]}: {selected[3]}.</p>}
    </>}
  </section>;
}

function ProfileStatusCard({ profile }) {
  if (!profile) return <section className="creator-card"><h2>Estado do perfil</h2><div className="creator-loading">A verificar...</div></section>;
  const problem = profile.suspended_at
    ? ["block", "A tua conta está suspensa. Contacta a equipa do Biva."]
    : profile.hidden_posts > 0
      ? ["report", `${profile.hidden_posts} ${profile.hidden_posts === 1 ? "publicação escondida" : "publicações escondidas"} pela moderação.`]
      : null;
  return <section className="creator-card profile-status" aria-labelledby="profile-status-title">
    <h2 id="profile-status-title">Estado do perfil</h2>
    <div className="profile-status-row">
      <span className="profile-status-avatar"><Avatar user={profile} size="large" /><span className={`profile-status-dot ${problem ? "is-warning" : "is-ok"}`}><Icon name={problem ? "info" : "check"} size={12} /></span></span>
      <div>
        <strong>{profile.display_name}</strong>
        <p>{problem ? problem[1] : "Não há problemas no perfil."} <Link to="/help">Saber mais</Link></p>
        <small>{formatCount(profile.followers)} {profile.followers === 1 ? "seguidor" : "seguidores"}</small>
      </div>
    </div>
  </section>;
}

function postKind(post) {
  if (post.shared_post_id) return "Partilha";
  if (post.media_type === "video") return "Vídeo";
  if (post.media_type === "image") return "Fotografia";
  return "Texto";
}

function ContentThumb({ post }) {
  return <div className="content-thumb">
    {post.media_url && post.media_type === "image"
      ? <img src={`${API_BASE}${post.media_url}`} alt="" />
      : post.media_url && post.media_type === "video"
        ? <video src={`${API_BASE}${post.media_url}`} muted preload="metadata" />
        : <span className="content-thumb-text">{post.excerpt || postKind(post)}</span>}
    <span className="content-thumb-views"><Icon name="eye" size={13} /> {formatCount(post.views)}</span>
  </div>;
}

function CreatorHome({ user }) {
  const [days, setDays] = useState(28);
  const [data, error] = useCreatorOverview(days);
  const [welcome, setWelcome] = useState(() => { try { return localStorage.getItem("biva-creator-welcome") !== "hidden"; } catch { return true; } });
  const hideWelcome = () => { setWelcome(false); try { localStorage.setItem("biva-creator-welcome", "hidden"); } catch { /* opcional */ } };
  return <>
    {welcome && <section className="creator-card creator-welcome">
      <div><h2>Bem-vindo ao Painel do criador</h2><p>Acompanha o desempenho do teu perfil, gere as tuas publicações, as subscrições e os anúncios — tudo num só lugar.</p></div>
      <Link className="btn secondary" to="/help">Saber mais</Link>
      <button className="round-button creator-welcome-close" type="button" aria-label="Fechar mensagem de boas-vindas" onClick={hideWelcome}><Icon name="close" size={16} /></button>
    </section>}
    <div className="creator-columns">
      <InsightsCard data={data} error={error} days={days} onDays={setDays} />
      <ProfileStatusCard profile={data?.profile && { ...data.profile, avatar_url: data.profile.avatar_url || user.avatar_url }} />
    </div>
    <section className="creator-card" aria-labelledby="content-title">
      <div className="creator-card-head">
        <div><h2 id="content-title">Conteúdo</h2><p>As tuas publicações mais recentes e quantas pessoas as viram.</p></div>
        <Link className="creator-see-all" to="/creator/conteudo">Ver tudo</Link>
      </div>
      {data && (data.recent.length
        ? <div className="content-strip">
          <Link className="content-thumb content-create" to="/create"><Icon name="plus" size={22} /><span>Criar publicação</span></Link>
          {data.recent.map(post => <ContentThumb key={post.id} post={post} />)}
        </div>
        : <p className="muted">Ainda não publicaste nada. <Link to="/create">Criar a primeira publicação</Link></p>)}
    </section>
    <div className="creator-columns is-even">
      <MonetizationSummary />
      <AdsSummary />
    </div>
  </>;
}

function MonetizationSummary() {
  const [data, setData] = useState(null);
  useEffect(() => { api("/creator/monetization").then(setData).catch(() => {}); }, []);
  return <section className="creator-card" aria-labelledby="money-title">
    <div className="creator-card-head"><div><h2 id="money-title">Monetização</h2><p>Subscrições do teu conteúdo exclusivo.</p></div><Link className="creator-see-all" to="/creator/monetizacao">Ver tudo</Link></div>
    {!data ? <div className="creator-loading">A carregar...</div>
      : data.is_creator
        ? <div className="mini-stats">
          <div><strong>{formatCount(data.active_subscribers)}</strong><span>subscritores ativos</span></div>
          <div><strong>{formatPrice(data.estimated_monthly_revenue)}</strong><span>receita mensal estimada</span></div>
        </div>
        : <p className="muted">Ativa o modo criador para receberes subscrições. <Link to="/creator/monetizacao">Saber como</Link></p>}
  </section>;
}

function AdsSummary() {
  const [ads, setAds] = useState(null);
  useEffect(() => { api("/ads/mine").then(result => setAds(result.ads)).catch(() => setAds([])); }, []);
  const active = ads?.filter(ad => ad.status === "active") || [];
  const impressions = active.reduce((sum, ad) => sum + ad.impressions, 0);
  return <section className="creator-card" aria-labelledby="ads-title">
    <div className="creator-card-head"><div><h2 id="ads-title">Anúncios</h2><p>Mostra o teu perfil ou o teu negócio a mais pessoas.</p></div><Link className="creator-see-all" to="/creator/anuncios">Ver tudo</Link></div>
    {!ads ? <div className="creator-loading">A carregar...</div>
      : active.length
        ? <div className="mini-stats">
          <div><strong>{formatCount(active.length)}</strong><span>{active.length === 1 ? "anúncio ativo" : "anúncios ativos"}</span></div>
          <div><strong>{formatCount(impressions)}</strong><span>pessoas alcançadas</span></div>
        </div>
        : <div className="creator-empty-action"><p className="muted">Não tens anúncios ativos.</p><Link className="btn" to="/creator/anuncios?novo=1"><Icon name="bolt" size={16} /> Impulsionar</Link></div>}
  </section>;
}

function CreatorInsights() {
  const [days, setDays] = useState(28);
  const [data, error] = useCreatorOverview(days);
  return <>
    <InsightsCard data={data} error={error} days={days} onDays={setDays} full />
    {data && <section className="creator-card" aria-labelledby="top-title">
      <h2 id="top-title">Publicações recentes</h2>
      <div className="content-strip">{data.recent.map(post => <ContentThumb key={post.id} post={post} />)}</div>
    </section>}
  </>;
}

function CreatorContent() {
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const load = async before => {
    try {
      const result = await api(`/creator/content${before ? `?before=${before}` : ""}`);
      setPosts(current => before ? [...(current || []), ...result.posts] : result.posts);
      setCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { load(); }, []);
  const where = post => post.group_name ? `Grupo · ${post.group_name}` : post.page_name ? `Página · ${post.page_name}` : "Perfil";
  return <section className="creator-card" aria-labelledby="content-list-title">
    <div className="creator-card-head"><div><h2 id="content-list-title">Conteúdo</h2><p>Todas as tuas publicações e o desempenho de cada uma.</p></div><Link className="btn" to="/create"><Icon name="create" size={16} /> Criar publicação</Link></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!posts && !error && <div className="creator-loading">A carregar...</div>}
    {posts && !posts.length && <p className="muted">Ainda não publicaste nada.</p>}
    {posts && posts.length > 0 && <div className="content-table" role="table" aria-label="Publicações">
      <div className="content-row content-row-head" role="row">
        <span role="columnheader">Publicação</span><span role="columnheader">Visualizações</span><span role="columnheader">Gostos</span><span role="columnheader">Comentários</span><span role="columnheader">Partilhas</span><span role="columnheader"><span className="visually-hidden">Ações</span></span>
      </div>
      {posts.map(post => <div className="content-row" role="row" key={post.id}>
        <span role="cell" className="content-row-main">
          <ContentThumb post={post} />
          <span>
            <strong>{post.excerpt || postKind(post)}</strong>
            <small>{new Date(post.created_at).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" })} · {where(post)}</small>
            <span className="content-tags">
              <span className="content-tag">{postKind(post)}</span>
              {post.is_exclusive && <span className="content-tag is-exclusive">Exclusivo</span>}
              {post.hidden_at && <span className="content-tag is-hidden">Escondida</span>}
            </span>
          </span>
        </span>
        <span role="cell" data-label="Visualizações">{formatCount(post.views)}</span>
        <span role="cell" data-label="Gostos">{formatCount(post.likes)}</span>
        <span role="cell" data-label="Comentários">{formatCount(post.comments)}</span>
        <span role="cell" data-label="Partilhas">{formatCount(post.shares)}</span>
        <span role="cell" className="content-row-action">{canBoost(post) && <Link className="btn secondary" to={`/creator/anuncios?impulsionar=${post.id}`}><Icon name="bolt" size={15} /> Impulsionar</Link>}</span>
      </div>)}
    </div>}
    {cursor && <button className="btn secondary creator-more" type="button" disabled={loadingMore}
      onClick={async () => { setLoadingMore(true); await load(cursor); setLoadingMore(false); }}>{loadingMore ? "A carregar..." : "Carregar mais"}</button>}
  </section>;
}

function PersonLine({ person, children, time }) {
  return <li className="person-line">
    <Link to={`/u/${person.username}`}><Avatar user={person} /></Link>
    <span><Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link> {children}{time && <small>{relativeTime(time)}</small>}</span>
  </li>;
}

function CreatorEngagement() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/creator/engagement").then(setData).catch(loadError => setError(loadError.message)); }, []);
  const excerpt = text => text ? `«${text.length > 60 ? `${text.slice(0, 60)}…` : text}»` : "a tua publicação";
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <section className="creator-card"><div className="creator-loading">A carregar...</div></section>}
    {data && <div className="creator-columns is-three">
      <section className="creator-card" aria-labelledby="eng-comments">
        <h2 id="eng-comments">Comentários recentes</h2>
        {data.comments.length ? <ul className="person-list">{data.comments.map(comment => <PersonLine key={comment.id} person={comment} time={comment.created_at}>
          comentou {excerpt(comment.post_excerpt)}: <q>{comment.body}</q></PersonLine>)}</ul> : <p className="muted">Ainda sem comentários.</p>}
      </section>
      <section className="creator-card" aria-labelledby="eng-likes">
        <h2 id="eng-likes">Gostos recentes</h2>
        {data.likes.length ? <ul className="person-list">{data.likes.map((like, index) => <PersonLine key={`${like.post_id}-${like.username}-${index}`} person={like} time={like.created_at}>
          gostou de {excerpt(like.post_excerpt)}</PersonLine>)}</ul> : <p className="muted">Ainda sem gostos.</p>}
      </section>
      <section className="creator-card" aria-labelledby="eng-followers">
        <h2 id="eng-followers">Novos seguidores</h2>
        {data.followers.length ? <ul className="person-list">{data.followers.map(follower => <PersonLine key={follower.username} person={follower} time={follower.created_at}>
          começou a seguir-te</PersonLine>)}</ul> : <p className="muted">Ainda ninguém te segue.</p>}
      </section>
    </div>}
  </>;
}

function CreatorMonetization() {
  const { refreshUser } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/creator/monetization").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const enable = async () => {
    setBusy(true);
    try {
      await api("/creator/enable", { method: "POST" });
      await refreshUser();
      await load();
    } catch (enableError) {
      setError(enableError.message);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <section className="creator-card"><p className="error" role="alert">{error}</p></section>;
  if (!data) return <section className="creator-card"><div className="creator-loading">A carregar...</div></section>;
  if (!data.is_creator) return <><PartnerProgramCard /><section className="creator-card creator-cta">
    <span className="creator-cta-icon"><Icon name="spark" size={26} /></span>
    <h2>Recebe apoio de quem gosta do teu trabalho</h2>
    <p>Com o modo criador, defines um preço mensal em kwanzas e marcas publicações como exclusivas para quem te subscreve.</p>
    <button className="btn" type="button" disabled={busy} onClick={enable}>{busy ? "A ativar..." : "Ativar modo criador"}</button>
  </section></>;
  const tiles = [
    ["Subscritores ativos", formatCount(data.active_subscribers)],
    ["A pagar", formatCount(data.paying_subscribers)],
    ["Não vão renovar", formatCount(data.canceling_subscribers)],
    ["Receita mensal estimada", formatPrice(data.estimated_monthly_revenue)],
    ["Publicações exclusivas", formatCount(data.exclusive_posts)],
    ["Gasto em anúncios", formatPrice(data.ads.spent)]
  ];
  return <>
    <PartnerProgramCard />
    <section className="creator-card" aria-labelledby="money-full-title">
      <div className="creator-card-head">
        <div><h2 id="money-full-title">Subscrições</h2><p>{data.price > 0 ? <>A tua subscrição custa <strong>{formatPrice(data.price)}</strong> por mês.</> : "Ainda não definiste o preço da tua subscrição."}</p></div>
        <Link className="btn secondary" to="/profile/edit"><Icon name="settings" size={16} /> {data.price > 0 ? "Alterar preço" : "Definir preço"}</Link>
      </div>
      <div className="stat-grid">{tiles.map(([label, value]) => <div className="stat-box" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="muted creator-footnote">A receita é uma estimativa bruta (subscritores a pagar × preço atual), antes de taxas e impostos.</p>
    </section>
    <section className="creator-card" aria-labelledby="subs-title">
      <h2 id="subs-title">Subscritores</h2>
      {data.subscribers.length
        ? <ul className="person-list">{data.subscribers.map(subscriber => <PersonLine key={subscriber.username} person={subscriber} time={subscriber.created_at}>
          <span className={`status-pill ${subscriber.is_active ? (subscriber.cancel_at_period_end ? "is-warning" : "is-ok") : "is-off"}`}>
            {subscriber.is_active ? (subscriber.cancel_at_period_end ? "Não vai renovar" : "Ativa") : "Terminada"}</span>
        </PersonLine>)}</ul>
        : <p className="muted">Ainda ninguém subscreveu. Marca algumas publicações como exclusivas para dares um motivo.</p>}
    </section>
  </>;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = key => { const [year, month] = key.split("-").map(Number); return `${MONTH_NAMES[month - 1]} de ${year}`; };

// Programa de Parceiros: mostra o progresso para as regras e, depois de aderir, os ganhos por mês.
function PartnerProgramCard() {
  const { refreshUser } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/creator/partner").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/creator/partner/join", { method: "POST" });
      await refreshUser();
      await load();
    } catch (joinError) {
      setError(joinError.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <section className="creator-card partner-card">{error ? <p className="error" role="alert">{error}</p> : <div className="creator-loading">A carregar...</div>}</section>;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const current = data.months.find(month => month.month === thisMonth) || { views: 0, amount: 0 };
  const pending = data.months.filter(month => month.month !== thisMonth).reduce((sum, month) => sum + month.amount, 0);
  return <section className="creator-card partner-card" aria-labelledby="partner-title">
    <div className="creator-card-head">
      <div>
        <h2 id="partner-title"><Icon name="spark" size={18} /> Programa de Parceiros Biva</h2>
        <p>O Biva paga-te <strong>{formatPrice(data.rpm)}</strong> por cada 1000 visualizações das tuas publicações.</p>
      </div>
      {data.partner_since && <span className={`status-pill ${data.earning ? "is-ok" : "is-warning"}`}>{data.earning ? "Parceiro ativo" : "Ganhos em pausa"}</span>}
    </div>

    {!data.partner_since || !data.earning ? <>
      <p className="partner-intro">{data.partner_since
        ? "Deixaste de cumprir uma das regras. Os ganhos voltam assim que voltares a cumpri-las."
        : "Para começares a ganhar dinheiro com o Biva tens de cumprir todas estas regras:"}</p>
      <ul className="partner-checks">
        {data.checks.map(check => <li key={check.key} className={check.met ? "is-met" : ""}>
          <span className="partner-check-icon" aria-hidden="true"><Icon name={check.met ? "check" : "close"} size={14} /></span>
          <span className="partner-check-text">
            <strong>{check.label}</strong>
            {check.target !== undefined && <>
              <span className="partner-progress" role="progressbar" aria-label={check.label} aria-valuemin={0} aria-valuemax={check.target} aria-valuenow={Math.min(check.current, check.target)}>
                <span style={{ width: `${Math.min(100, (check.current / check.target) * 100)}%` }} />
              </span>
              <small>{formatCount(check.current)} de {formatCount(check.target)}{check.met ? "" : ` · faltam ${formatCount(check.target - check.current)}`}</small>
            </>}
            {check.target === undefined && <small>{check.met ? "Cumprido" : "Por cumprir"}</small>}
          </span>
        </li>)}
      </ul>
      {!data.partner_since && <div className="partner-join">
        <button className="btn" type="button" disabled={!data.eligible || busy} onClick={join}>{busy ? "A aderir..." : "Aderir ao programa"}</button>
        {!data.eligible && <small className="muted">O botão fica disponível quando cumprires todas as regras.</small>}
      </div>}
    </> : <>
      <div className="stat-grid">
        <div className="stat-box"><span>Ganhos este mês</span><strong>{formatPrice(current.amount)}</strong></div>
        <div className="stat-box"><span>Visualizações este mês</span><strong>{formatCount(current.views)}</strong></div>
        <div className="stat-box"><span>Meses anteriores</span><strong>{formatPrice(pending)}</strong></div>
      </div>
      {data.months.length > 0 && <table className="partner-months">
        <thead><tr><th scope="col">Mês</th><th scope="col">Visualizações</th><th scope="col">Ganhos</th></tr></thead>
        <tbody>{data.months.map(month => <tr key={month.month}><td>{monthLabel(month.month)}</td><td>{formatCount(month.views)}</td><td>{formatPrice(month.amount)}</td></tr>)}</tbody>
      </table>}
      <p className="muted creator-footnote">Parceiro desde {new Date(data.partner_since).toLocaleDateString("pt-PT")}. Os ganhos são pagos uma vez por mês, quando o total acumulado chega a {formatPrice(data.min_payout)}. Só contam visualizações de outras pessoas (uma por pessoa e por dia).</p>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

const AD_STATUS = {
  pending_payment: ["A aguardar pagamento", "is-warning"],
  in_review: ["Em revisão", "is-warning"],
  rejected: ["Recusada", "is-off"],
  active: ["Ativo", "is-ok"],
  paused: ["Em pausa", "is-warning"],
  ended: ["Terminado", "is-off"]
};

// Igual ao espaço «Patrocinado» da página inicial (SponsoredSlot), dentro de uma moldura da coluna.
function AdPreview({ ad, imageSrc, advertiser }) {
  const site = ad.destination === "link" ? (() => { try { return new URL(ad.linkUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";
  return <div className="ad-preview-frame">
    <span className="home-heading">Patrocinado</span>
    <div className="home-sponsor ad-preview" aria-label="Pré-visualização do anúncio">
      <span className="home-sponsor-art">{imageSrc ? <img src={imageSrc} alt="" /> : <img src="/biva-logo.png" alt="" />}</span>
      <span>
        <strong className={ad.title ? "" : "is-placeholder"}>{ad.title || "Título do anúncio"}</strong>
        <small className={ad.body ? "" : "is-placeholder"}>{ad.body || "O texto do teu anúncio aparece aqui."}</small>
        <small className="home-sponsor-by">{advertiser}</small>
      </span>
    </div>
    <p className="ad-preview-click"><Icon name={ad.destination === "link" ? "externalLink" : "profile"} size={14} />
      {ad.destination === "link" ? (site ? `Ao clicar abre ${site}` : "Ao clicar abre o teu site") : "Ao clicar abre o teu perfil"}</p>
  </div>;
}

function CharCount({ value, max }) {
  const left = max - value.length;
  return <small className={`char-count${left <= Math.ceil(max * 0.1) ? " is-near" : ""}`} aria-live={left <= 10 ? "polite" : "off"}>{value.length}/{max}</small>;
}

const AD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AD_IMAGE_MAX = 8 * 1024 * 1024;

// Imagem do anúncio: escolher, arrastar para cá, trocar ou remover.
function AdImagePicker({ image, preview, onChange }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const accept = file => {
    if (!file) return;
    if (!AD_IMAGE_TYPES.includes(file.type)) return setError("A imagem tem de ser JPG, PNG ou WebP.");
    if (file.size > AD_IMAGE_MAX) return setError("A imagem é demasiado grande (máximo 8 MB).");
    setError("");
    onChange(file);
  };
  const drop = event => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files?.[0]); };
  return <div className="ad-field">
    <span className="ad-field-head">Imagem <small>Opcional</small></span>
    <div className={`ad-image-drop${dragging ? " is-dragging" : ""}${image ? " has-image" : ""}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <input ref={inputRef} type="file" accept={AD_IMAGE_TYPES.join(",")} className="visually-hidden" id="ad-image-input"
        onChange={event => { accept(event.target.files?.[0]); event.target.value = ""; }} />
      {image ? <>
        {preview ? <img src={preview} alt="Imagem escolhida para o anúncio" /> : <span className="ad-image-placeholder" />}
        <span className="ad-image-info"><strong>{image.name}</strong><small>{(image.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB</small></span>
        <span className="ad-image-actions">
          <button type="button" className="btn secondary" onClick={() => inputRef.current?.click()}>Trocar</button>
          <button type="button" className="btn secondary icon-only" aria-label="Remover imagem" title="Remover" onClick={() => onChange(null)}><Icon name="trash" size={16} /></button>
        </span>
      </> : <label htmlFor="ad-image-input">
        <span className="ad-kind-icon"><Icon name="image" size={18} /></span>
        <span><strong>Escolher imagem</strong><small>ou arrasta-a para aqui · JPG, PNG ou WebP · quadrada fica melhor</small></span>
      </label>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

const EMPTY_AD = { kind: "boost", postId: "", title: "", body: "", destination: "profile", linkUrl: "", budget: "5000", days: "7", provinces: [], minAge: "", maxAge: "" };
const BUDGET_PRESETS = [2000, 5000, 10000, 25000, 50000];
const AD_DAY_OPTIONS = [1, 3, 7, 14, 30];
// Separadores da lista: cada promoção cai num só grupo.
const AD_FILTERS = [
  ["all", "Todas", () => true],
  ["live", "No ar", ad => ad.status === "active" || ad.status === "paused"],
  ["review", "Em revisão", ad => ad.status === "in_review"],
  ["unpaid", "Por pagar", ad => ad.status === "pending_payment"],
  ["done", "Terminadas", ad => ad.status === "ended" || ad.status === "rejected"]
];
const dayLabel = value => `${value} ${Number(value) === 1 ? "dia" : "dias"}`;
const percentOf = (part, whole) => whole ? `${((part / whole) * 100).toFixed(1).replace(".", ",")}%` : "0%";

// Só publicações públicas tuas podem ser impulsionadas.
const canBoost = post => !post.is_exclusive && !post.group_id && !post.hidden_at && !post.shared_post_id;

// Resumo de todas as promoções pagas (as recusadas são devolvidas, por isso não contam).
function AdsOverview({ ads }) {
  const paid = ads.filter(ad => ad.paid_at && ad.status !== "rejected");
  const sum = key => paid.reduce((total, ad) => total + Number(ad[key] || 0), 0);
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const live = ads.filter(ad => ad.status === "active").length;
  const tiles = [
    ["Investido", formatPrice(sum("budget")), `${formatPrice(sum("spent"))} já usados`],
    ["Pessoas alcançadas", formatCount(sum("reach")), `${formatCount(impressions)} visualizações`],
    ["Cliques", formatCount(clicks), `${percentOf(clicks, impressions)} de quem viu`],
    ["No ar agora", formatCount(live), live === 1 ? "promoção ativa" : "promoções ativas"]
  ];
  return <dl className="ads-overview">
    {tiles.map(([label, value, hint]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><small>{hint}</small></div>)}
  </dl>;
}

// Resultados de uma promoção: evolução por dia e onde está o público (só números agregados).
function AdResults({ ad }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState("impressions");
  useEffect(() => { api(`/ads/${ad.id}/stats`).then(setData).catch(loadError => setError(loadError.message)); }, [ad.id]);
  if (error) return <div className="ad-results"><p className="error" role="alert">{error}</p></div>;
  if (!data) return <div className="ad-results"><div className="creator-loading">A carregar resultados...</div></div>;
  const hasData = data.daily.some(day => day.impressions || day.clicks);
  const people = data.provinces.reduce((total, row) => total + row.people, 0);
  const top = Math.max(1, ...data.provinces.map(row => row.people));
  return <div className="ad-results">
    <div className="ad-results-chart">
      <div className="ad-results-head">
        <h4>Por dia</h4>
        <div className="ad-toggle" role="group" aria-label="Mostrar">
          {[["impressions", "Visualizações"], ["clicks", "Cliques"]].map(([key, label]) =>
            <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>{label}</button>)}
        </div>
      </div>
      {hasData
        ? <InsightsChart daily={data.daily} metric={metric} label={metric === "clicks" ? "Cliques" : "Visualizações"} />
        : <p className="muted">Ainda não há resultados. Os números aparecem assim que a promoção começar a ser vista.</p>}
    </div>
    <div className="ad-results-audience">
      <h4>Onde está o público</h4>
      {data.provinces.length
        ? <ul>{data.provinces.map(row => <li key={row.province || "outras"}>
          <span>{row.province || "Outras ou não indicada"}</span>
          <span className="ad-results-bar" aria-hidden="true"><span style={{ width: `${(row.people / top) * 100}%` }} /></span>
          <strong>{percentOf(row.people, people)}</strong>
        </li>)}</ul>
        : <p className="muted">Sem pessoas alcançadas ainda.</p>}
      <small className="muted">Grupos com menos de 5 pessoas juntam-se em «Outras», para ninguém poder ser identificado.</small>
    </div>
  </div>;
}

// Pré-visualização de uma publicação impulsionada em cada sítio onde pode aparecer.
function BoostPreview({ post, user, placement }) {
  const media = post.media_url
    ? post.media_type === "video" ? <video src={`${API_BASE}${post.media_url}`} muted preload="metadata" /> : <img src={`${API_BASE}${post.media_url}`} alt="" />
    : <span className="boost-mock-text">{post.excerpt || postKind(post)}</span>;
  const who = <><Avatar user={user} size="tiny" /><span><strong>{user?.display_name || user?.username}</strong><small><Icon name="spark" size={11} /> Patrocinado</small></span></>;
  if (placement === "feed") return <div className="boost-mock is-feed">
    <div className="boost-mock-head">{who}</div>
    {post.media_url && post.excerpt && <p>{post.excerpt}</p>}
    <div className="boost-mock-media">{media}</div>
  </div>;
  return <div className={`boost-mock is-tall is-${placement}`}>
    <div className="boost-mock-media">{media}</div>
    <div className="boost-mock-head">{who}</div>
    {placement === "reels" && <span className="boost-mock-side" aria-hidden="true"><Icon name="heart" size={18} /><Icon name="messages" size={18} /><Icon name="share" size={18} /></span>}
  </div>;
}

function CreatorAds() {
  const { user } = useContext(UserContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [ads, setAds] = useState(null);
  const [cost, setCost] = useState(0.5);
  const [payments, setPayments] = useState("stripe");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const boostParam = searchParams.get("impulsionar");
  const [creating, setCreating] = useState(searchParams.get("novo") === "1" || Boolean(boostParam));
  const [form, setForm] = useState(() => ({ ...EMPTY_AD, postId: boostParam || "", budget: searchParams.get("orcamento") || EMPTY_AD.budget }));
  const [provinceList, setProvinceList] = useState([]);
  const [surcharge, setSurcharge] = useState(0.2);
  const [posts, setPosts] = useState([]);
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [formError, setFormError] = useState("");
  const [formHint, setFormHint] = useState("");
  const [filter, setFilter] = useState("all");
  const [openResults, setOpenResults] = useState(null);
  const [placement, setPlacement] = useState("feed");
  const formRef = useRef(null);

  const load = () => api("/ads/mine").then(result => {
    setAds(result.ads);
    setCost(result.cost_per_impression);
    setPayments(result.payments);
    setSurcharge(result.targeting_surcharge ?? 0.2);
  }).catch(loadError => setError(loadError.message));

  useEffect(() => {
    load();
    api("/creator/content").then(result => setPosts(result.posts.filter(canBoost))).catch(() => {});
    api("/provinces").then(result => setProvinceList(result.provinces)).catch(() => {});
    const payment = searchParams.get("pagamento");
    if (payment) {
      setNotice(payment === "sucesso"
        ? "Pagamento recebido. A promoção fica em revisão e entra no ar assim que a equipa a aprovar (normalmente em menos de 24 horas)."
        : "O pagamento foi cancelado. A promoção continua guardada e podes pagá-la quando quiseres.");
      setSearchParams({}, { replace: true });
      if (payment === "sucesso") window.setTimeout(load, 4000);
    }
  }, []);

  useEffect(() => {
    if (!image) { setImagePreview(""); return undefined; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const targeted = form.provinces.length > 0 || form.minAge !== "" || form.maxAge !== "";
  const budget = Number(form.budget) || 0;
  const reach = Math.floor(budget / (cost * (targeted ? 1 + surcharge : 1)));
  const toggleProvince = province => update("provinces", form.provinces.includes(province) ? form.provinces.filter(item => item !== province) : [...form.provinces, province]);
  const selectedPost = posts.find(post => String(post.id) === String(form.postId));
  // Reels só mostram vídeos e Stories só publicações com imagem ou vídeo (como em /api/ads/feed).
  const placements = [["feed", "Feed", true], ["stories", "Stories", Boolean(selectedPost?.media_url)], ["reels", "Reels", selectedPost?.media_type === "video"]];
  const shownPlacement = placements.find(([key, , available]) => key === placement && available) ? placement : "feed";

  const [paying, setPaying] = useState(null);
  const paidNotice = "Pagamento recebido. A promoção fica em revisão e entra no ar assim que a equipa a aprovar (normalmente em menos de 24 horas).";

  const openForm = () => { setCreating(true); window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const closeForm = () => { setCreating(false); setFormError(""); setFormHint(""); setForm(EMPTY_AD); setImage(null); };

  // Criar: abre o ecrã de pagamento; a promoção só é criada quando se escolhe como pagar.
  const submit = event => {
    event.preventDefault();
    if (form.kind === "boost" && !form.postId) return setFormError("Escolhe a publicação que queres impulsionar.");
    if (budget < 1000) return setFormError(`O orçamento mínimo é ${formatPrice(1000)}.`);
    setFormError("");
    let createdId = null;
    setPaying({
      title: form.kind === "boost" ? "Pagar publicação impulsionada" : "Pagar anúncio",
      amount: budget,
      onPay: async choice => {
        // Segunda tentativa (por exemplo, outro método): paga a promoção já criada.
        if (createdId) return api(`/ads/${createdId}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) });
        const data = await buildAdForm();
        Object.entries(choice).forEach(([key, value]) => data.append(key, value));
        const result = await api("/ads", { method: "POST", body: data });
        createdId = result.id;
        closeForm();
        return result;
      }
    });
  };

  const buildAdForm = async () => {
    const data = new FormData();
    const fields = form.kind === "boost"
      ? { postId: form.postId, title: form.title, budget: form.budget, days: form.days }
      : { title: form.title, body: form.body, destination: form.destination, linkUrl: form.linkUrl, budget: form.budget, days: form.days };
    Object.entries(fields).forEach(([key, value]) => data.append(key, value));
    if (form.provinces.length) data.append("targetProvinces", form.provinces.join(","));
    if (form.minAge !== "") data.append("targetMinAge", form.minAge);
    if (form.maxAge !== "") data.append("targetMaxAge", form.maxAge);
    if (image && form.kind === "ad") data.append("image", await downscaleImage(image, 1200, 1200));
    return data;
  };

  // Repetir: preenche o formulário com uma promoção anterior (a imagem tem de ser escolhida outra vez).
  const repeat = ad => {
    const external = ad.link_url && !ad.link_url.startsWith("/");
    const postAvailable = !ad.post_id || posts.some(post => post.id === ad.post_id);
    setForm({
      ...EMPTY_AD, kind: ad.post_id ? "boost" : "ad", postId: ad.post_id && postAvailable ? String(ad.post_id) : "",
      title: ad.post_id ? "" : ad.title, body: ad.body || "", destination: external ? "link" : "profile", linkUrl: external ? ad.link_url : "",
      budget: String(Math.round(ad.budget)), days: String(ad.days), provinces: ad.target_provinces || [],
      minAge: ad.target_min_age ?? "", maxAge: ad.target_max_age ?? ""
    });
    setImage(null);
    setFormError("");
    setFormHint(!postAvailable ? "A publicação original já não pode ser impulsionada. Escolhe outra."
      : !ad.post_id && ad.image_url ? "Copiámos o texto, o orçamento e o público. Escolhe a imagem outra vez."
        : "Copiámos o orçamento, a duração e o público. Revê e paga quando quiseres.");
    openForm();
  };

  const pay = ad => setPaying({
    title: `Pagar «${ad.title}»`,
    amount: ad.budget,
    onPay: choice => api(`/ads/${ad.id}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) })
  });

  const setStatus = async (ad, status) => {
    setError("");
    try {
      await api(`/ads/${ad.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      setAds(current => current.map(item => item.id === ad.id ? { ...item, status } : item));
    } catch (statusError) {
      setError(statusError.message);
    }
  };

  const remove = async ad => {
    if (!window.confirm(`Apagar «${ad.title}»? As métricas também são apagadas. O valor já pago não é devolvido automaticamente.`)) return;
    try {
      await api(`/ads/${ad.id}`, { method: "DELETE" });
      setAds(current => current.filter(item => item.id !== ad.id));
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const counts = Object.fromEntries(AD_FILTERS.map(([key, , test]) => [key, ads?.filter(test).length || 0]));
  const activeFilter = AD_FILTERS.find(([key]) => key === filter) || AD_FILTERS[0];
  const visibleAds = ads?.filter(activeFilter[2]) || [];
  const endsOn = new Date(Date.now() + Number(form.days) * 86400000).toLocaleDateString("pt-PT", { day: "numeric", month: "long" });

  return <>
    {paying && <PaymentDialog title={paying.title} amountKz={paying.amount} onPay={paying.onPay}
      onDone={() => { setNotice(paidNotice); load(); }} onClose={() => { setPaying(null); load(); }} />}
    <section className="creator-card" aria-labelledby="ads-full-title">
      <div className="creator-card-head">
        <div><h2 id="ads-full-title">Anúncios e publicações impulsionadas</h2>
          <p>Pagas uma vez e o Biva mostra a tua promoção a quem ainda não a viu: {formatPrice(cost * 1000)} por cada 1000 pessoas alcançadas.</p></div>
        {!creating && <button className="btn" type="button" onClick={openForm}><Icon name="plus" size={16} /> Criar promoção</button>}
      </div>
      {notice && <p className="success" role="status">{notice}</p>}
      {payments === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Pagamentos em modo de demonstração: as promoções ficam ativas sem cobrança.</p>}
      {ads && ads.length > 0 && <AdsOverview ads={ads} />}

      {creating && <form className="ad-form" onSubmit={submit} ref={formRef} aria-labelledby="ad-form-title">
        <div className="ad-form-fields">
          <h3 id="ad-form-title" className="ad-form-title">Nova promoção</h3>
          {formHint && <p className="info-draft" role="status"><Icon name="copy" size={15} /> {formHint}</p>}
          <div className="ad-kind" role="radiogroup" aria-label="Tipo de promoção">
            <label className={form.kind === "boost" ? "is-selected" : ""}>
              <input type="radio" name="kind" checked={form.kind === "boost"} onChange={() => update("kind", "boost")} />
              <span className="ad-kind-icon"><Icon name="bolt" size={18} /></span>
              <span><strong>Impulsionar publicação</strong><small>Um vídeo, fotografia ou trabalho teu aparece no feed, nos Stories e nos Reels de mais pessoas.</small></span>
            </label>
            <label className={form.kind === "ad" ? "is-selected" : ""}>
              <input type="radio" name="kind" checked={form.kind === "ad"} onChange={() => update("kind", "ad")} />
              <span className="ad-kind-icon"><Icon name="ad" size={18} /></span>
              <span><strong>Anúncio</strong><small>Título, texto e imagem em «Patrocinado», com ligação para o teu perfil ou site.</small></span>
            </label>
          </div>

          {form.kind === "boost" ? <fieldset className="boost-picker">
            <legend>Que publicação queres impulsionar?</legend>
            {posts.length
              ? <div className="boost-posts">{posts.slice(0, 12).map(post => <label key={post.id} className={`boost-post${String(form.postId) === String(post.id) ? " is-selected" : ""}`}>
                <input type="radio" name="postId" checked={String(form.postId) === String(post.id)} onChange={() => update("postId", String(post.id))} />
                <ContentThumb post={post} />
                <small>{post.excerpt || postKind(post)}</small>
              </label>)}</div>
              : <p className="muted">Ainda não tens publicações públicas. <Link to="/create">Publica primeiro</Link> e volta para a impulsionar.</p>}
          </fieldset> : <>
            <label className="ad-field">
              <span className="ad-field-head">Título <CharCount value={form.title} max={80} /></span>
              <input value={form.title} maxLength={80} required onChange={event => update("title", event.target.value)} placeholder="Ex.: Novas peças na loja da Rita" />
            </label>
            <label className="ad-field">
              <span className="ad-field-head">Texto <CharCount value={form.body} max={200} /></span>
              <textarea rows={3} value={form.body} maxLength={200} onChange={event => update("body", event.target.value)} placeholder="Diz em poucas palavras o que estás a promover. Ex.: Até 40% em peças selecionadas, só esta semana." />
            </label>
            <AdImagePicker image={image} preview={imagePreview} onChange={setImage} />
            <fieldset className="ad-destination">
              <legend>Quando alguém clica, vai para…</legend>
              <div className="ad-kind is-compact" role="radiogroup" aria-label="Destino do clique">
                <label className={form.destination === "profile" ? "is-selected" : ""}>
                  <input type="radio" name="destination" checked={form.destination === "profile"} onChange={() => update("destination", "profile")} />
                  <span className="ad-kind-icon"><Icon name="profile" size={17} /></span>
                  <span><strong>O teu perfil</strong><small>@{user?.username}</small></span>
                </label>
                <label className={form.destination === "link" ? "is-selected" : ""}>
                  <input type="radio" name="destination" checked={form.destination === "link"} onChange={() => update("destination", "link")} />
                  <span className="ad-kind-icon"><Icon name="globe" size={17} /></span>
                  <span><strong>Um site</strong><small>A tua loja, WhatsApp ou página</small></span>
                </label>
              </div>
              {form.destination === "link" && <div className="ad-url">
                <Icon name="externalLink" size={16} />
                <input type="url" inputMode="url" placeholder="https://aminhaloja.ao" value={form.linkUrl} required onChange={event => update("linkUrl", event.target.value)} aria-label="Endereço do site (começa por https://)" />
              </div>}
            </fieldset>
          </>}

          <fieldset className="ad-choice">
            <legend>Orçamento total</legend>
            <div className="ad-chips" role="group" aria-label="Valores sugeridos">
              {BUDGET_PRESETS.map(value => <button key={value} type="button" className="province-chip" aria-pressed={budget === value} onClick={() => update("budget", String(value))}>{formatPrice(value)}</button>)}
            </div>
            <label className="ad-custom-budget">Outro valor (Kz)<input type="number" min="1000" max="10000000" step="500" required value={form.budget} onChange={event => update("budget", event.target.value)} /></label>
          </fieldset>
          <fieldset className="ad-choice">
            <legend>Duração</legend>
            <div className="ad-chips" role="radiogroup" aria-label="Duração">
              {AD_DAY_OPTIONS.map(value => <label key={value} className="ad-day">
                <input type="radio" name="days" checked={form.days === String(value)} onChange={() => update("days", String(value))} />
                <span>{dayLabel(value)}</span>
              </label>)}
            </div>
          </fieldset>
          <fieldset className="ad-audience">
            <legend>Público <small>Opcional · +{Math.round(surcharge * 100)}% por pessoa alcançada</small></legend>
            <div className="province-chips" role="group" aria-label="Províncias">
              {provinceList.map(province => <button key={province} type="button" className="province-chip" aria-pressed={form.provinces.includes(province)} onClick={() => toggleProvince(province)}>{province}</button>)}
            </div>
            <div className="ad-budget">
              <label>Idade mínima<input type="number" min="13" max="100" placeholder="Qualquer" value={form.minAge} onChange={event => update("minAge", event.target.value)} /></label>
              <label>Idade máxima<input type="number" min="13" max="100" placeholder="Qualquer" value={form.maxAge} onChange={event => update("maxAge", event.target.value)} /></label>
            </div>
            <small className="muted">{targeted ? `Só vê quem ${form.provinces.length ? `está em ${form.provinces.join(", ")}` : "tem a idade indicada"}${form.provinces.length && (form.minAge || form.maxAge) ? " e tem a idade indicada" : ""} (quem indicou a província e a idade nas Definições).` : "Sem filtros: o Biva mostra a toda a gente."}</small>
          </fieldset>
          <p className="ad-review-note"><Icon name="shield" size={15} /> <span>Depois do pagamento, a equipa revê a promoção (normalmente em menos de 24 horas). Se for recusada, devolvemos o valor. Lê as <Link to="/publicidade">Regras de publicidade</Link>.</span></p>
        </div>

        <aside className="ad-form-preview" aria-label="Pré-visualização e resumo">
          <div className="ad-preview-head">
            <h3>Pré-visualização</h3>
            {form.kind === "boost" && <div className="ad-toggle" role="group" aria-label="Onde aparece">
              {placements.map(([key, label, available]) => <button key={key} type="button" aria-pressed={shownPlacement === key} disabled={!available}
                title={available ? undefined : key === "reels" ? "Os Reels só mostram vídeos" : "Os Stories precisam de imagem ou vídeo"} onClick={() => setPlacement(key)}>{label}</button>)}
            </div>}
          </div>
          {form.kind === "boost"
            ? selectedPost ? <BoostPreview post={selectedPost} user={user} placement={shownPlacement} /> : <p className="muted">Escolhe uma publicação para a veres aqui.</p>
            : <><p className="muted">Na coluna da direita da página inicial, em computador.</p><AdPreview ad={form} imageSrc={imagePreview} advertiser={user?.display_name || user?.username} /></>}

          <div className="ad-summary" aria-live="polite">
            <p className="ad-summary-reach"><strong>{formatCount(reach)}</strong><span>pessoas alcançadas, no máximo</span></p>
            <dl>
              <div><dt>Por dia</dt><dd>cerca de {formatPrice(Math.round(budget / Number(form.days)))}</dd></div>
              <div><dt>Duração</dt><dd>{dayLabel(form.days)}, até {endsOn} se for aprovada hoje</dd></div>
              <div><dt>Público</dt><dd>{targeted ? `Escolhido (+${Math.round(surcharge * 100)}%)` : "Toda a gente"}</dd></div>
              <div className="is-total"><dt>Total</dt><dd>{formatPrice(budget)}</dd></div>
            </dl>
            {formError && <p className="error" role="alert">{formError}</p>}
            <div className="ad-summary-actions">
              <button className="btn" type="submit">Pagar {formatPrice(budget)} e publicar</button>
              <button className="btn secondary" type="button" onClick={closeForm}>Cancelar</button>
            </div>
          </div>
        </aside>
      </form>}

      {error && <p className="error" role="alert">{error}</p>}
      {!ads && !error && <div className="creator-loading">A carregar...</div>}
      {ads && !ads.length && !creating && <div className="ads-empty">
        <span className="ad-kind-icon"><Icon name="bolt" size={22} /></span>
        <div><strong>Ainda não criaste nenhuma promoção</strong><p className="muted">Escolhe uma publicação de que gostas, define quanto queres gastar e o Biva mostra-a a mais pessoas.</p></div>
        <button className="btn" type="button" onClick={openForm}><Icon name="plus" size={16} /> Criar a primeira</button>
      </div>}
      {ads && ads.length > 0 && <>
        <div className="ad-filters" role="group" aria-label="Filtrar promoções">
          {AD_FILTERS.filter(([key]) => key === "all" || counts[key] > 0).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={activeFilter[0] === key} onClick={() => setFilter(key)}>{label} <span>{counts[key]}</span></button>)}
        </div>
        <ul className="ad-list">
          {visibleAds.map(ad => {
            const [statusLabel, statusClass] = AD_STATUS[ad.status] || AD_STATUS.ended;
            const spentRatio = Math.min(100, (ad.spent / ad.budget) * 100);
            const daysLeft = Math.max(0, Math.ceil((new Date(ad.ends_at) - Date.now()) / 86400000));
            const art = ad.post_id
              ? ad.post_media_url && ad.post_media_type === "image" ? <img src={`${API_BASE}${ad.post_media_url}`} alt="" /> : <Icon name={ad.post_media_type === "video" ? "reels" : "bolt"} size={22} />
              : ad.image_url ? <img src={`${API_BASE}${ad.image_url}`} alt="" /> : <Icon name="ad" size={22} />;
            const when = ad.status === "pending_payment" ? `${dayLabel(ad.days)} depois do pagamento`
              : ad.status === "in_review" ? `${dayLabel(ad.days)} depois da aprovação`
                : ad.status === "active" || ad.status === "paused" ? (daysLeft <= 1 ? "termina hoje" : `faltam ${dayLabel(daysLeft)}`)
                  : `terminou a ${new Date(ad.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`;
            const expanded = openResults === ad.id;
            return <li className={`ad-item${expanded ? " is-open" : ""}`} key={ad.id}>
              <span className="ad-item-art">{art}</span>
              <div className="ad-item-main">
                <div className="ad-item-title"><strong>{ad.title}</strong><span className={`status-pill ${statusClass}`}>{statusLabel}</span></div>
                <small>{ad.post_id ? "Publicação impulsionada" : "Anúncio"}{ad.target_provinces?.length ? ` · ${ad.target_provinces.join(", ")}` : ""}{ad.target_min_age || ad.target_max_age ? ` · ${ad.target_min_age || 13}–${ad.target_max_age || "100"} anos` : ""} · {when}</small>
                <div className="ad-budget-bar" role="progressbar" aria-label="Orçamento gasto" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(spentRatio)}><span style={{ width: `${spentRatio}%` }} /></div>
                <small>{formatPrice(ad.spent)} de {formatPrice(ad.budget)} gastos</small>
              </div>
              <dl className="ad-metrics">
                <div><dt>Pessoas</dt><dd>{formatCount(ad.reach ?? ad.impressions)}</dd></div>
                <div><dt>Cliques</dt><dd>{formatCount(ad.clicks)}</dd></div>
                <div><dt>Taxa de cliques</dt><dd>{percentOf(ad.clicks, ad.impressions)}</dd></div>
              </dl>
              <div className="ad-actions">
                {ad.status === "pending_payment" && <button className="btn" type="button" onClick={() => pay(ad)}>Pagar {formatPrice(ad.budget)}</button>}
                {ad.status === "rejected" && ad.review_note && <small className="review-note">Motivo: {ad.review_note}{ad.refund_status === "refunded" ? " · valor devolvido" : ad.refund_status === "manual" || ad.refund_status === "failed" ? " · devolução em curso" : ""}</small>}
                {ad.paid_at && ad.status !== "rejected" && ad.status !== "in_review" && <button className="btn secondary" type="button" aria-expanded={expanded} onClick={() => setOpenResults(expanded ? null : ad.id)}>
                  <Icon name="stats" size={15} /> {expanded ? "Fechar" : "Resultados"}</button>}
                {ad.status === "active" && <button className="btn secondary" type="button" onClick={() => setStatus(ad, "paused")}><Icon name="pause" size={15} /> Pausar</button>}
                {ad.status === "paused" && <button className="btn secondary" type="button" onClick={() => setStatus(ad, "active")}><Icon name="play" size={15} /> Retomar</button>}
                {(ad.status === "ended" || ad.status === "rejected") && <button className="btn secondary" type="button" onClick={() => repeat(ad)}><Icon name="copy" size={15} /> Repetir</button>}
                <button className="btn secondary icon-only" type="button" aria-label={`Apagar ${ad.title}`} title="Apagar" onClick={() => remove(ad)}><Icon name="trash" size={16} /></button>
              </div>
              {expanded && <AdResults ad={ad} />}
            </li>;
          })}
        </ul>
      </>}
    </section>
  </>;
}

function CreatorDashboard() {
  const { section = "" } = useParams();
  const { user, authReady } = useContext(UserContext);
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para abrires o painel do criador. <Link to="/login">Entrar</Link></div></div>;
  const views = { "": CreatorHome, insights: CreatorInsights, conteudo: CreatorContent, engajamento: CreatorEngagement, monetizacao: CreatorMonetization, ganhos: CreatorEarnings, parcerias: CreatorPartnerships, anuncios: CreatorAds };
  const View = views[section] || CreatorHome;
  return <div className="creator">
    <aside className="creator-nav" aria-label="Painel do criador">
      <h1>Painel do criador</h1>
      <nav>
        {CREATOR_SECTIONS.map(([slug, icon, label]) => <NavLink key={slug} end to={slug ? `/creator/${slug}` : "/creator"} className="creator-nav-link">
          <span className={`creator-nav-icon tone-${icon}`}><Icon name={icon} size={18} /></span><span>{label}</span>
        </NavLink>)}
      </nav>
      <Link className="btn creator-create" to="/create"><Icon name="create" size={16} /> Criar publicação</Link>
    </aside>
    <div className="creator-main">
      <View user={user} />
    </div>
  </div>;
}

// Espaço "Patrocinado" do feed: mostra um anúncio ativo; sem anúncios, convida a anunciar.
function SponsoredSlot() {
  const navigate = useNavigate();
  const [ad, setAd] = useState(undefined);
  const slotRef = useRef(null);
  useEffect(() => { api("/ads/serve").then(result => setAd(result.ad)).catch(() => setAd(null)); }, []);
  useSeenOnce(slotRef, Boolean(ad?.id), () => recordAdImpression(ad.id));
  if (ad === undefined) return null;
  if (!ad) return <Link className="home-sponsor" to="/creator/anuncios?novo=1">
    <span className="home-sponsor-art" aria-hidden="true"><img src="/biva-logo.png" alt="" /></span>
    <span><strong>Anuncia no Biva</strong><small>Mostra o teu perfil ou o teu negócio a mais pessoas. Cria um anúncio no painel do criador.</small></span>
  </Link>;
  const open = async event => {
    event.preventDefault();
    let url = ad.link_url;
    url = (await recordAdClick(ad.id)).url || url;
    if (url.startsWith("/")) navigate(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  return <a className="home-sponsor" ref={slotRef} href={ad.link_url} onClick={open} rel={ad.link_url.startsWith("/") ? undefined : "noopener noreferrer sponsored"}>
    <span className="home-sponsor-art" aria-hidden="true"><img src={ad.image_url ? `${API_BASE}${ad.image_url}` : "/biva-logo.png"} alt="" /></span>
    <span><strong>{ad.title}</strong><small>{ad.body || ad.advertiser}</small><small className="home-sponsor-by">{ad.advertiser}</small></span>
  </a>;
}

// ---------------------------------------------------------------------------------------------
// Crescimento e monetização: selo, Estrelas, marcas, desafios, convites, academia
// ---------------------------------------------------------------------------------------------

function VerifiedBadge({ show }) {
  if (!show) return null;
  return <span className="verified-badge" title="Parceiro verificado do Biva" aria-label="Parceiro verificado"><Icon name="verified" size={15} /></span>;
}

// Botão "Estrelas" numa publicação de outra pessoa: escolhe quantas oferecer.
function StarGiftButton({ post, onGifted }) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [amounts, setAmounts] = useState([1, 5, 10, 50, 100]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const boxRef = useRef(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(boxRef, open, close);
  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    setMessage("");
    if (opening) {
      try {
        const result = await api("/stars");
        setBalance(result.balance);
        setAmounts(result.gift_amounts);
      } catch (loadError) {
        setMessage(loadError.message);
      }
    }
  };
  const give = async amount => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/posts/${post.id}/stars`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
      setBalance(result.balance);
      onGifted(result.stars);
      setMessage(`Ofereceste ${amount} ${amount === 1 ? "estrela" : "estrelas"} a ${post.display_name}.`);
    } catch (giftError) {
      setMessage(giftError.message);
    } finally {
      setBusy(false);
    }
  };
  return <div className="star-gift" ref={boxRef}>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}><span className="post-star-icon" aria-hidden="true"><Icon name="star" size={18} /></span>Estrelas</button>
    {open && <div className="star-gift-panel" role="dialog" aria-label="Oferecer estrelas">
      <strong>Apoia {post.display_name}</strong>
      <small>{balance === null ? "A ver o teu saldo..." : `Tens ${formatCount(balance)} ${balance === 1 ? "estrela" : "estrelas"}.`}</small>
      <div className="star-gift-amounts">
        {amounts.map(amount => <button key={amount} type="button" disabled={busy || (balance !== null && balance < amount)} onClick={() => give(amount)}>
          <Icon name="star" size={14} /> {amount}
        </button>)}
      </div>
      {message && <p className="star-gift-message" role="status">{message}</p>}
      <Link className="star-gift-buy" to="/estrelas">Comprar estrelas</Link>
    </div>}
  </div>;
}

function StarsPage() {
  const { user, authReady } = useContext(UserContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);
  const load = () => api("/stars").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => {
    if (!user) return;
    load();
    const payment = searchParams.get("pagamento");
    if (payment) {
      setNotice(payment === "sucesso" ? "Pagamento recebido. As estrelas chegam ao teu saldo em poucos segundos." : "O pagamento foi cancelado.");
      setSearchParams({}, { replace: true });
      if (payment === "sucesso") window.setTimeout(load, 4000);
    }
  }, [user?.id]);
  const [paying, setPaying] = useState(null);
  const buy = pack => {
    setError("");
    setPaying({
      pack,
      onPay: choice => api("/stars/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack: pack.index, ...choice }) })
    });
  };
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para veres as tuas estrelas. <Link to="/login">Entrar</Link></div></div>;
  const kindLabel = item => ({
    purchase: "Compraste estrelas",
    gift_sent: `Ofereceste a ${item.display_name || "alguém"}`,
    gift_received: `Recebeste de ${item.display_name || "alguém"}`,
    referral_bonus: `Prémio por convidar ${item.display_name || "alguém"}`,
    challenge_prize: "Prémio de um desafio"
  })[item.kind] || "Movimento";
  return <div className="page narrow growth-page">
    <header className="growth-hero card">
      <span className="growth-hero-icon tone-star"><Icon name="star" size={28} /></span>
      <div><p className="feed-section-kicker">Estrelas Biva</p><h1>Apoia quem gostas</h1>
        <p>Oferece estrelas nas publicações dos teus criadores favoritos. Cada estrela vale {data ? formatPrice(data.price_kz) : "10 Kz"}; o criador recebe 70% e o Biva fica com 30%.</p></div>
      <div className="growth-balance"><small>O teu saldo</small><strong><Icon name="star" size={20} /> {data ? formatCount(data.balance) : "…"}</strong></div>
    </header>
    {paying && <PaymentDialog title={`Comprar ${formatCount(paying.pack.stars + paying.pack.bonus)} estrelas`} amountKz={paying.pack.price} onPay={paying.onPay}
      onDone={() => { setNotice(`${paying.pack.stars + paying.pack.bonus} estrelas adicionadas ao teu saldo.`); load(); }}
      onClose={() => { setPaying(null); load(); }} />}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {data?.payments === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Pagamentos em modo de demonstração: as compras não são cobradas.</p>}
    {data && <>
      <section className="creator-card" aria-labelledby="packs-title">
        <h2 id="packs-title">Comprar estrelas</h2>
        <div className="star-packs">{data.packs.map(pack => <button key={pack.index} type="button" className="star-pack" disabled={busy !== null} onClick={() => buy(pack)}>
          <strong><Icon name="star" size={18} /> {formatCount(pack.stars)}</strong>
          {pack.bonus > 0 && <span className="star-pack-bonus">+{pack.bonus} de bónus</span>}
          <span className="star-pack-price">{busy === pack.index ? "A preparar..." : formatPrice(pack.price)}</span>
        </button>)}</div>
      </section>
      {data.received.stars > 0 && <section className="creator-card">
        <h2>Estrelas que recebeste</h2>
        <p className="muted">As estrelas que recebes não entram no saldo para oferecer: valem dinheiro e aparecem em <Link to="/creator/ganhos">Painel do criador → Ganhos</Link>.</p>
        <div className="mini-stats"><div><strong>{formatCount(data.received.stars)}</strong><span>estrelas recebidas</span></div><div><strong>{formatPrice(data.received.value_kz)}</strong><span>a tua parte (70%)</span></div></div>
      </section>}
      <section className="creator-card" aria-labelledby="history-title">
        <h2 id="history-title">Movimentos</h2>
        {data.history.length ? <ul className="star-history">{data.history.map(item => <li key={item.id}>
          <span>{kindLabel(item)}<small>{relativeTime(item.created_at)}</small></span>
          <strong className={item.amount > 0 ? "is-in" : "is-out"}>{item.amount > 0 ? "+" : ""}{formatCount(item.amount)}</strong>
        </li>)}</ul> : <p className="muted">Ainda não tens movimentos.</p>}
      </section>
    </>}
  </div>;
}

function SupportersCard({ username }) {
  const [supporters, setSupporters] = useState([]);
  useEffect(() => { api(`/users/${encodeURIComponent(username)}/supporters`).then(result => setSupporters(result.supporters)).catch(() => {}); }, [username]);
  if (!supporters.length) return null;
  return <section className="profile-info-card card supporters-card">
    <h2><Icon name="trophy" size={18} /> Maiores apoiantes</h2>
    <ol className="supporters-list">{supporters.map((person, index) => <li key={person.username}>
      <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
      <Link to={`/u/${person.username}`}><Avatar user={person} size="tiny" /></Link>
      <Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link>
      <span className="supporter-stars"><Icon name="star" size={13} /> {formatCount(person.stars)}</span>
    </li>)}</ol>
  </section>;
}

// Público (privado): província e data de nascimento, usados só para promoções segmentadas.
function AudienceSettings() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ province: "", birthDate: "", showProvinceToBrands: false });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api("/auth/me/audience").then(result => { setData(result); setForm({ province: result.province || "", birthDate: result.birth_date || "", showProvinceToBrands: Boolean(result.show_province_to_brands) }); }).catch(loadError => setError(loadError.message));
  }, []);
  const save = async event => {
    event.preventDefault();
    setStatus("");
    setError("");
    try {
      await api("/auth/me/audience", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setStatus("Guardado.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };
  return <>
    {data && <form className="audience-form" onSubmit={save}>
      <div className="field-pair">
        <label className="field">Província<select value={form.province} onChange={event => setForm({ ...form, province: event.target.value })}>
          <option value="">Prefiro não dizer</option>
          {data.provinces.map(province => <option key={province} value={province}>{province}</option>)}
        </select></label>
        <label className="field">Data de nascimento<input type="date" value={form.birthDate} onChange={event => setForm({ ...form, birthDate: event.target.value })} /></label>
      </div>
      <label className="prefs-switch">
        <span className="prefs-row-text"><strong>Mostrar a minha província às marcas</strong><small>Só a província, nunca a idade. Podes desligar quando quiseres.</small></span>
        <input type="checkbox" role="switch" checked={form.showProvinceToBrands} disabled={!form.province}
          onChange={event => setForm({ ...form, showProvinceToBrands: event.target.checked })} />
        <span className="prefs-switch-track" aria-hidden="true"><i /></span>
      </label>
      <div className="prefs-form-foot">
        {status && <span className="prefs-saved" role="status"><Icon name="check" size={14} />{status}</span>}
        <button className="btn" type="submit">Guardar</button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

// Marketplace: marcas encontram criadores e propõem campanhas pagas.
function BrandsPage() {
  const { user } = useContext(UserContext);
  const [filters, setFilters] = useState({ province: "", area: "", minFollowers: "0" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [proposing, setProposing] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== "0"));
      api(`/creators?${query}`).then(setData).catch(loadError => setError(loadError.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.province, filters.area, filters.minFollowers]);
  return <div className="page growth-page brands-page">
    <header className="growth-hero card">
      <span className="growth-hero-icon tone-brand"><Icon name="brand" size={28} /></span>
      <div><p className="feed-section-kicker">Marketplace de marcas</p><h1>Encontra criadores para a tua marca</h1>
        <p>Filtra por província, área e número de seguidores e envia uma proposta de campanha. Pagas pelo Biva quando o criador aceitar; o Biva fica com 15%.</p></div>
    </header>
    <div className="brand-filters card" role="search">
      <label>Província<select value={filters.province} onChange={event => setFilters({ ...filters, province: event.target.value })}>
        <option value="">Todas</option>
        {(data?.provinces || []).map(province => <option key={province}>{province}</option>)}
      </select></label>
      <label>Área<input type="search" placeholder="Ex.: moda, música, culinária" value={filters.area} onChange={event => setFilters({ ...filters, area: event.target.value })} /></label>
      <label>Seguidores<select value={filters.minFollowers} onChange={event => setFilters({ ...filters, minFollowers: event.target.value })}>
        <option value="0">Qualquer número</option><option value="1000">1 000 ou mais</option><option value="10000">10 000 ou mais</option><option value="100000">100 000 ou mais</option>
      </select></label>
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A procurar criadores...</div>}
    {data && !data.creators.length && <div className="empty card">Nenhum criador corresponde aos filtros.</div>}
    {data && data.creators.length > 0 && <div className="creator-grid">{data.creators.map(creator => <article className="creator-tile card" key={creator.id}>
      <Link to={`/u/${creator.username}`}><Avatar user={creator} size="large" /></Link>
      <h2><Link to={`/u/${creator.username}`}>{creator.display_name}</Link><VerifiedBadge show={creator.is_verified} /></h2>
      <small>@{creator.username}{creator.province ? ` · ${creator.province}` : ""}</small>
      {creator.profession && <span className="content-tag">{creator.profession}</span>}
      <p>{creator.bio || "Ainda sem biografia."}</p>
      <div className="creator-tile-stats"><span><strong>{formatCount(creator.followers)}</strong> seguidores</span><span><strong>{formatCount(creator.posts)}</strong> publicações</span></div>
      {user ? <button className="btn" type="button" onClick={() => setProposing(creator)}><Icon name="brand" size={16} /> Propor campanha</button>
        : <Link className="btn" to="/login">Entrar para propor</Link>}
    </article>)}</div>}
    {proposing && <ProposalDialog creator={proposing} onClose={() => setProposing(null)} onSent={() => { setProposing(null); setNotice(`Proposta enviada a ${proposing.display_name}. Acompanha em Painel do criador → Parcerias.`); }} />}
  </div>;
}

function ProposalDialog({ creator, onClose, onSent }) {
  const [form, setForm] = useState({ title: "", brief: "", budget: "50000" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const budget = Number(form.budget) || 0;
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: creator.id, ...form }) });
      onSent();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card proposal-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-title" onSubmit={submit}>
      <h2 id="proposal-title">Proposta para {creator.display_name}</h2>
      <label>Título da campanha<input value={form.title} maxLength={100} required onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Lançamento da nova coleção" /></label>
      <label>O que pedes ao criador<textarea rows={5} value={form.brief} maxLength={2000} required onChange={event => setForm({ ...form, brief: event.target.value })} placeholder="Ex.: 1 vídeo de 30 s e 2 publicações a mostrar o produto, durante a próxima semana." /></label>
      <label>Orçamento (Kz)<input type="number" min="5000" step="1000" required value={form.budget} onChange={event => setForm({ ...form, budget: event.target.value })} /></label>
      <p className="muted proposal-split">O criador recebe {formatPrice(Math.round(budget * 0.85))}; o Biva fica com {formatPrice(Math.round(budget * 0.15))} (15%).</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy}>{busy ? "A enviar..." : "Enviar proposta"}</button>
      </div>
    </form>
  </div>, document.body);
}

const CAMPAIGN_STATUS = {
  proposed: ["Proposta", "is-warning"], accepted: ["Aceite — por pagar", "is-warning"], declined: ["Recusada", "is-off"],
  paid: ["Paga — em curso", "is-ok"], completed: ["Concluída", "is-ok"], cancelled: ["Cancelada", "is-off"]
};

function CreatorPartnerships() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api("/campaigns").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => {
    load();
    const payment = searchParams.get("pagamento");
    if (payment) {
      setNotice(payment === "sucesso" ? "Pagamento recebido. A campanha fica marcada como paga em poucos segundos." : "O pagamento foi cancelado.");
      setSearchParams({}, { replace: true });
      if (payment === "sucesso") window.setTimeout(load, 4000);
    }
  }, []);
  const [paying, setPaying] = useState(null);
  const act = async (campaign, action) => {
    setError("");
    if (action === "pay") {
      setPaying({ campaign, onPay: choice => api(`/campaigns/${campaign.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) }) });
      return;
    }
    try {
      const result = await api(`/campaigns/${campaign.id}/${action}`, { method: "POST" });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      if (result.demo) setNotice("Campanha paga em modo de demonstração (sem cobrança).");
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  };
  const row = (campaign, side) => {
    const [label, pill] = CAMPAIGN_STATUS[campaign.status];
    const other = side === "received"
      ? { username: campaign.brand_username, display_name: campaign.brand_name, avatar_url: campaign.brand_avatar }
      : { username: campaign.creator_username, display_name: campaign.creator_name, avatar_url: campaign.creator_avatar };
    return <li className="campaign-item" key={campaign.id}>
      <Link to={`/u/${other.username}`}><Avatar user={other} /></Link>
      <div className="campaign-main">
        <div className="ad-item-title"><strong>{campaign.title}</strong><span className={`status-pill ${pill}`}>{label}</span></div>
        <small>{side === "received" ? "De" : "Para"} {other.display_name} · {relativeTime(campaign.created_at)}</small>
        <p>{campaign.brief}</p>
        <small>{formatPrice(campaign.budget)} · {side === "received" ? `recebes ${formatPrice(campaign.net)}` : `o criador recebe ${formatPrice(campaign.net)}`} (comissão do Biva: {formatPrice(campaign.commission)})</small>
      </div>
      <div className="ad-actions">
        {side === "received" && campaign.status === "proposed" && <><button className="btn" type="button" onClick={() => act(campaign, "accept")}>Aceitar</button><button className="btn secondary" type="button" onClick={() => act(campaign, "decline")}>Recusar</button></>}
        {side === "sent" && campaign.status === "accepted" && <button className="btn" type="button" onClick={() => act(campaign, "pay")}>Pagar {formatPrice(campaign.budget)}</button>}
        {side === "sent" && ["proposed", "accepted"].includes(campaign.status) && <button className="btn secondary" type="button" onClick={() => act(campaign, "cancel")}>Cancelar</button>}
        {side === "sent" && campaign.status === "paid" && <button className="btn" type="button" onClick={() => act(campaign, "complete")}>Confirmar entrega</button>}
      </div>
    </li>;
  };
  return <>
    {paying && <PaymentDialog title={`Pagar a campanha «${paying.campaign.title}»`} amountKz={paying.campaign.budget} onPay={paying.onPay}
      onDone={() => { setNotice("Campanha paga. O criador já pode começar."); load(); }} onClose={() => { setPaying(null); load(); }} />}
    <section className="creator-card" aria-labelledby="partnerships-title">
      <div className="creator-card-head"><div><h2 id="partnerships-title">Parcerias com marcas</h2><p>Propostas de campanhas pagas. O Biva fica com 15% de cada campanha.</p></div>
        <Link className="btn secondary" to="/marcas"><Icon name="brand" size={16} /> Marketplace de marcas</Link></div>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <div className="creator-loading">A carregar...</div>}
      {data && <>
        <h3 className="campaign-heading">Recebidas</h3>
        {data.received.length ? <ul className="ad-list">{data.received.map(campaign => row(campaign, "received"))}</ul> : <p className="muted">Ainda não recebeste propostas. Ter o selo de Parceiro verificado ajuda as marcas a confiar em ti.</p>}
        <h3 className="campaign-heading">Enviadas</h3>
        {data.sent.length ? <ul className="ad-list">{data.sent.map(campaign => row(campaign, "sent"))}</ul> : <p className="muted">Não enviaste propostas. <Link to="/marcas">Encontrar criadores</Link></p>}
      </>}
    </section>
  </>;
}

function ChallengesPage() {
  const { challengeId } = useParams();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [myPosts, setMyPosts] = useState([]);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", prize: "", prizeStars: "0", sponsor: "Biva", days: "30" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadList = () => api("/challenges").then(result => setList(result.challenges)).catch(loadError => setError(loadError.message));
  const loadDetail = id => api(`/challenges/${id}`).then(setDetail).catch(loadError => setError(loadError.message));
  useEffect(() => { loadList(); }, [user?.id]);
  useEffect(() => { setDetail(null); if (challengeId) loadDetail(challengeId); }, [challengeId]);
  useEffect(() => { if (user) api("/creator/content").then(result => setMyPosts(result.posts.filter(canBoost))).catch(() => {}); }, [user?.id]);
  const current = list?.find(item => String(item.id) === String(challengeId));

  const join = async postId => {
    setError("");
    try {
      await api(`/challenges/${challengeId}/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId }) });
      setPicking(false);
      setNotice("Estás a participar! Partilha a tua publicação para recolher gostos.");
      await Promise.all([loadList(), loadDetail(challengeId)]);
    } catch (joinError) {
      setError(joinError.message);
    }
  };
  const create = async event => {
    event.preventDefault();
    setError("");
    try {
      const result = await api("/challenges", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, prizeStars: Number(form.prizeStars), days: Number(form.days) }) });
      setCreating(false);
      await loadList();
      navigate(`/desafios/${result.id}`);
    } catch (createError) {
      setError(createError.message);
    }
  };
  const close = async () => {
    if (!window.confirm("Encerrar o desafio? Ganha a participação com mais gostos e o prémio em estrelas é entregue automaticamente.")) return;
    try {
      const result = await api(`/challenges/${challengeId}/close`, { method: "POST" });
      setNotice(result.winner ? `Vencedor: ${result.winner.display_name}.` : "Desafio encerrado sem participações.");
      await Promise.all([loadList(), loadDetail(challengeId)]);
    } catch (closeError) {
      setError(closeError.message);
    }
  };
  const deadline = item => item.is_open ? `Termina ${new Date(item.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}` : "Terminado";

  return <div className="page growth-page challenges-page">
    <header className="growth-hero card">
      <span className="growth-hero-icon tone-trophy"><Icon name="trophy" size={28} /></span>
      <div><p className="feed-section-kicker">Desafios do mês</p><h1>Participa e ganha prémios</h1>
        <p>Escolhe uma das tuas publicações para entrar no desafio. Ganha quem tiver mais gostos quando o desafio terminar.</p></div>
      {user?.is_admin && !creating && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Novo desafio</button>}
    </header>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {creating && <form className="creator-card challenge-form" onSubmit={create}>
      <h2>Novo desafio</h2>
      <label>Título<input required maxLength={100} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex.: O melhor vídeo sobre a tua cidade" /></label>
      <label>Regras<textarea rows={3} maxLength={1000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      <div className="ad-budget">
        <label>Prémio (texto)<input maxLength={120} value={form.prize} onChange={event => setForm({ ...form, prize: event.target.value })} placeholder="Ex.: 50 000 Kz + destaque" /></label>
        <label>Prémio em estrelas<input type="number" min="0" value={form.prizeStars} onChange={event => setForm({ ...form, prizeStars: event.target.value })} /></label>
        <label>Patrocinador<input maxLength={80} value={form.sponsor} onChange={event => setForm({ ...form, sponsor: event.target.value })} /></label>
        <label>Duração (dias)<input type="number" min="1" max="62" value={form.days} onChange={event => setForm({ ...form, days: event.target.value })} /></label>
      </div>
      <div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setCreating(false)}>Cancelar</button><button className="btn" type="submit">Criar desafio</button></div>
    </form>}
    <div className="challenges-layout">
      <section className="challenge-list" aria-label="Desafios">
        {!list && <div className="empty card">A carregar...</div>}
        {list && !list.length && <div className="empty card">Ainda não há desafios. Volta em breve!</div>}
        {list?.map(item => <Link key={item.id} to={`/desafios/${item.id}`} className={`challenge-card card${String(item.id) === String(challengeId) ? " is-active" : ""}`}>
          <span className={`status-pill ${item.is_open ? "is-ok" : "is-off"}`}>{deadline(item)}</span>
          <strong>{item.title}</strong>
          {item.prize && <span className="challenge-prize"><Icon name="gift" size={14} /> {item.prize}{item.prize_stars ? ` · ${formatCount(item.prize_stars)} estrelas` : ""}</span>}
          <small>{item.sponsor !== "Biva" ? `Patrocinado por ${item.sponsor} · ` : ""}{formatCount(item.entries)} {item.entries === 1 ? "participação" : "participações"}{item.my_post_id ? " · estás a participar" : ""}</small>
        </Link>)}
      </section>
      <section className="challenge-detail" aria-label="Detalhe do desafio">
        {!challengeId && <div className="empty card">Escolhe um desafio para veres a classificação.</div>}
        {challengeId && !detail && <div className="empty card">A carregar...</div>}
        {detail && <div className="creator-card">
          <div className="creator-card-head">
            <div><h2>{detail.challenge.title}</h2><p>{detail.challenge.description}</p></div>
            {user?.is_admin && detail.challenge.closed_at === null && <button className="btn secondary" type="button" onClick={close}>Encerrar e premiar</button>}
          </div>
          {detail.challenge.is_open && user && !current?.my_post_id && (picking
            ? <div className="boost-picker"><p className="muted">Escolhe a publicação com que queres participar:</p>
              {myPosts.length ? <div className="boost-posts">{myPosts.slice(0, 12).map(post => <button key={post.id} type="button" className="boost-post" onClick={() => join(post.id)}><ContentThumb post={post} /><small>{post.excerpt || postKind(post)}</small></button>)}</div>
                : <p className="muted">Ainda não tens publicações públicas. <Link to="/create">Publica primeiro</Link>.</p>}</div>
            : <button className="btn" type="button" onClick={() => setPicking(true)}><Icon name="trophy" size={16} /> Participar</button>)}
          <h3 className="campaign-heading">Classificação</h3>
          {detail.ranking.length ? <ol className="challenge-ranking">{detail.ranking.map((entry, index) => <li key={entry.post_id} className={detail.challenge.winner_post_id === entry.post_id ? "is-winner" : ""}>
            <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
            <ContentThumb post={{ ...entry, views: entry.likes }} />
            <span className="challenge-entry-text"><Link className="post-author" to={`/u/${entry.username}`}>{entry.display_name}</Link><small>{entry.excerpt || postKind(entry)}</small></span>
            <span className="challenge-likes"><Icon name="like" size={14} /> {formatCount(entry.likes)}</span>
            {detail.challenge.winner_post_id === entry.post_id && <span className="status-pill is-ok"><Icon name="trophy" size={12} /> Vencedor</span>}
          </li>)}</ol> : <p className="muted">Ainda ninguém participou. Sê a primeira pessoa!</p>}
        </div>}
      </section>
    </div>
  </div>;
}

function InvitePage() {
  const { user, authReady } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (user) api("/referrals").then(setData).catch(() => {}); }, [user?.id]);
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para convidares amigos. <Link to="/login">Entrar</Link></div></div>;
  const link = `${window.location.origin}/register?convite=${encodeURIComponent(user.username)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };
  const share = () => navigator.share?.({ title: "Vem para o Biva", text: "Junta-te a mim no Biva!", url: link }).catch(() => {});
  return <div className="page narrow growth-page">
    <header className="growth-hero card">
      <span className="growth-hero-icon tone-gift"><Icon name="gift" size={28} /></span>
      <div><p className="feed-section-kicker">Convidar amigos</p><h1>Traz os teus amigos e ganha estrelas</h1>
        <p>Por cada pessoa que entrar com o teu convite, confirmar o email e fizer a primeira publicação, ganhas {data?.bonus ?? 50} estrelas.</p></div>
    </header>
    <section className="creator-card">
      <h2>O teu convite</h2>
      <div className="invite-link"><input readOnly value={link} aria-label="Ligação de convite" onFocus={event => event.target.select()} />
        <button className="btn" type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copiado" : "Copiar"}</button>
        {typeof navigator.share === "function" && <button className="btn secondary" type="button" onClick={share}><Icon name="share" size={16} /> Partilhar</button>}</div>
      {data && <div className="mini-stats"><div><strong>{formatCount(data.invited)}</strong><span>pessoas convidadas</span></div><div><strong>{formatCount(data.rewarded * data.bonus)}</strong><span>estrelas ganhas</span></div></div>}
    </section>
    {data?.people.length > 0 && <section className="creator-card"><h2>Quem entrou com o teu convite</h2>
      <ul className="person-list">{data.people.map(person => <PersonLine key={person.username} person={person} time={person.created_at}>
        <span className={`status-pill ${person.rewarded ? "is-ok" : "is-warning"}`}>{person.rewarded ? `+${data.bonus} estrelas` : "À espera da 1.ª publicação"}</span>
      </PersonLine>)}</ul></section>}
  </div>;
}

const ACADEMY_GUIDES = [
  ["Começa pelo teu perfil", "profile", ["Usa uma foto de perfil nítida, com o rosto visível.", "Escreve na biografia o que publicas e para quem.", "Indica a tua área (profissão) para as marcas te encontrarem no marketplace."]],
  ["Publica com regularidade", "create", ["Escolhe 3 a 4 dias por semana e cumpre-os.", "Os vídeos curtos (Reels) chegam a mais pessoas.", "Usa os Stories todos os dias para manteres os seguidores por perto."]],
  ["Conversa com a tua comunidade", "messages", ["Responde aos comentários nas primeiras horas.", "Faz perguntas no fim das publicações.", "Agradece as estrelas: os apoiantes gostam de ser vistos."]],
  ["Entra nos desafios do mês", "trophy", ["Os desafios trazem visitas novas ao teu perfil.", "Partilha a tua participação no perfil e em grupos.", "Mesmo sem ganhar, ganhas seguidores."]],
  ["Lê os teus Insights", "stats", ["No Painel do criador, vê que publicações tiveram mais visualizações.", "Repete os formatos que funcionam.", "Compara cada mês com o anterior."]],
  ["Rumo aos 10 mil", "spark", ["O Programa de Parceiros paga a partir de 10 000 seguidores e 10 000 visualizações em 28 dias.", "Impulsiona as publicações que já estão a ter sucesso.", "Com o selo verificado, as marcas confiam mais em ti."]]
];

function AcademyPage() {
  return <div className="page narrow growth-page">
    <header className="growth-hero card">
      <span className="growth-hero-icon tone-academy"><Icon name="academy" size={28} /></span>
      <div><p className="feed-section-kicker">Academia Biva</p><h1>Cresce como criador</h1>
        <p>Guias curtos para chegares aos 10 mil seguidores e entrares no Programa de Parceiros.</p></div>
    </header>
    <div className="academy-grid">{ACADEMY_GUIDES.map(([title, icon, tips], index) => <article className="creator-card academy-card" key={title}>
      <span className="academy-step">{index + 1}</span>
      <h2><Icon name={icon} size={18} /> {title}</h2>
      <ul>{tips.map(tip => <li key={tip}>{tip}</li>)}</ul>
    </article>)}</div>
    <section className="creator-card academy-links">
      <Link className="btn" to="/creator">Abrir o Painel do criador</Link>
      <Link className="btn secondary" to="/desafios">Ver desafios</Link>
      <Link className="btn secondary" to="/convidar">Convidar amigos</Link>
    </section>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Ganhos e levantamentos (criador) e área de administração (promoções, levantamentos, finanças)
// ---------------------------------------------------------------------------------------------

const ANGOLAN_BANKS = ["BAI", "BFA", "BIC", "BPC", "Millennium Atlântico", "Banco Sol", "BNI", "Standard Bank", "Banco Económico", "Banco Keve", "Banco Yetu", "Outro"];
const PAYOUT_STATUS = { requested: ["Em processamento", "is-warning"], paid: ["Pago", "is-ok"], rejected: ["Recusado", "is-off"] };

function CreatorEarnings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingAccount, setEditingAccount] = useState(false);
  const [account, setAccount] = useState({ holderName: "", bankName: "BAI", iban: "" });
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/payouts").then(result => { setData(result); setAmount(result.available >= result.min_withdrawal ? String(Math.floor(result.available)) : ""); })
    .catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);

  const saveAccount = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/payouts/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(account) });
      setEditingAccount(false);
      setAccount({ holderName: "", bankName: "BAI", iban: "" });
      setNotice("Conta bancária guardada.");
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async event => {
    event.preventDefault();
    if (!window.confirm(`Pedir o levantamento de ${formatPrice(Number(amount))} para a conta ${data.account.bank_name} ${data.account.iban}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/payouts/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(amount) }) });
      setNotice("Pedido enviado. A equipa faz a transferência e avisa-te quando estiver paga.");
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <section className="creator-card">{error ? <p className="error" role="alert">{error}</p> : <div className="creator-loading">A calcular os teus ganhos...</div>}</section>;
  const sources = [
    ["Programa de Parceiros", data.sources.partnerKz, "spark", data.accruing.partnerKz > 0 ? `+${formatPrice(data.accruing.partnerKz)} a acumular este mês` : "Meses já fechados"],
    ["Estrelas recebidas", data.sources.starsKz, "star", "70% do valor das estrelas"],
    ["Campanhas com marcas", data.sources.campaignsKz, "brand", "85% das campanhas concluídas"]
  ];
  const hasPending = data.requests.some(request => request.status === "requested");
  return <>
    <section className="creator-card" aria-labelledby="earnings-title">
      <div className="creator-card-head"><div><h2 id="earnings-title">Ganhos</h2><p>Tudo o que ganhaste no Biva e o que já podes levantar.</p></div></div>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="earnings-sources">{sources.map(([label, value, icon, hint]) => <div className="stat-box earnings-source" key={label}>
        <span><Icon name={icon} size={15} /> {label}</span><strong>{formatPrice(value)}</strong><small>{hint}</small>
      </div>)}</div>
      <div className="earnings-total">
        <div><small>Total ganho</small><strong>{formatPrice(data.earned)}</strong></div>
        <div><small>Já levantado ou em processamento</small><strong>{formatPrice(data.withdrawn)}</strong></div>
        <div className="is-available"><small>Disponível para levantar</small><strong>{formatPrice(data.available)}</strong></div>
      </div>
    </section>

    <section className="creator-card" aria-labelledby="bank-title">
      <div className="creator-card-head"><div><h2 id="bank-title">Conta para receber</h2><p>Os levantamentos são feitos por transferência bancária para um IBAN angolano. O IBAN é guardado cifrado.</p></div>
        {data.account && !editingAccount && <button className="btn secondary" type="button" onClick={() => setEditingAccount(true)}>Alterar</button>}</div>
      {!data.configured && <p className="info-draft" role="note"><Icon name="info" size={15} /> Os levantamentos ainda não estão configurados no servidor.</p>}
      {data.account && !editingAccount && <div className="bank-account"><Icon name="brand" size={20} /><span><strong>{data.account.holder_name}</strong><small>{data.account.bank_name} · IBAN {data.account.iban}</small></span></div>}
      {(!data.account || editingAccount) && data.configured && <form className="bank-form" onSubmit={saveAccount}>
        <label>Nome do titular<input required maxLength={120} value={account.holderName} onChange={event => setAccount({ ...account, holderName: event.target.value })} autoComplete="name" /></label>
        <label>Banco<select value={account.bankName} onChange={event => setAccount({ ...account, bankName: event.target.value })}>{ANGOLAN_BANKS.map(bank => <option key={bank}>{bank}</option>)}</select></label>
        <label className="bank-iban">IBAN<input required inputMode="numeric" autoComplete="off" placeholder="AO06 0000 0000 0000 0000 0000 0" value={account.iban}
          onChange={event => setAccount({ ...account, iban: event.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "") })} /></label>
        <div className="modal-actions">
          {editingAccount && <button className="btn secondary" type="button" onClick={() => setEditingAccount(false)}>Cancelar</button>}
          <button className="btn" type="submit" disabled={busy}>{busy ? "A guardar..." : "Guardar conta"}</button>
        </div>
      </form>}
    </section>

    <section className="creator-card" aria-labelledby="withdraw-title">
      <h2 id="withdraw-title">Levantar</h2>
      {hasPending ? <p className="muted">Tens um levantamento em processamento. Podes pedir outro quando esse estiver concluído.</p>
        : data.available < data.min_withdrawal ? <p className="muted">O levantamento mínimo é de {formatPrice(data.min_withdrawal)}. Faltam {formatPrice(data.min_withdrawal - data.available)}.</p>
          : !data.account ? <p className="muted">Adiciona primeiro a conta bancária.</p>
            : <form className="withdraw-form" onSubmit={withdraw}>
              <label>Valor (Kz)<input type="number" min={data.min_withdrawal} max={data.available} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
              <button className="btn" type="submit" disabled={busy}>Pedir levantamento</button>
            </form>}
      {data.requests.length > 0 && <ul className="ad-list payout-history">{data.requests.map(request => {
        const [label, pill] = PAYOUT_STATUS[request.status];
        return <li className="payout-item" key={request.id}>
          <span><strong>{formatPrice(request.amount)}</strong><small>{request.bank_name} · {request.iban} · {new Date(request.created_at).toLocaleDateString("pt-PT")}</small>
            {request.reference && <small>Referência: {request.reference}</small>}{request.note && <small>Motivo: {request.note}</small>}</span>
          <span className={`status-pill ${pill}`}>{label}</span>
        </li>;
      })}</ul>}
    </section>
  </>;
}

function AdminPage() {
  const { user, authReady } = useContext(UserContext);
  const { tab = "promocoes" } = useParams();
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user?.is_admin) return <div className="page narrow"><div className="empty card">Só a equipa do Biva tem acesso a esta área.</div></div>;
  const tabs = [["promocoes", "Promoções"], ["levantamentos", "Levantamentos"], ["financas", "Finanças"], ["musicas", "Músicas"]];
  return <div className="page growth-page admin-page">
    <header className="admin-head"><h1>Administração</h1>
      <nav className="feed-tabs" aria-label="Áreas da administração">{tabs.map(([slug, label]) => <NavLink key={slug} to={`/admin/${slug}`} className={({ isActive }) => isActive || (tab === slug) ? "is-active" : ""}>{label}</NavLink>)}
        <Link to="/moderation">Denúncias</Link></nav>
    </header>
    {tab === "promocoes" && <AdminPromotions />}
    {tab === "levantamentos" && <AdminPayouts />}
    {tab === "financas" && <AdminFinance />}
    {tab === "musicas" && <AdminMusic />}
  </div>;
}

// Biblioteca de músicas: a equipa carrega faixas com licença (ou aprova músicas das pessoas),
// esconde as que tenham problemas de direitos e organiza por género.
function AdminMusic() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ file: null, title: "", artist: "", genre: "afrobeat", license: "", busy: false });
  const fileInput = useRef(null);

  const load = () => api("/admin/music").then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);

  const pick = file => {
    if (!file) return;
    setForm(current => ({ ...current, file, title: current.title || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100) }));
  };
  const upload = async event => {
    event.preventDefault();
    setForm(current => ({ ...current, busy: true }));
    setError("");
    try {
      const duration = await audioDuration(form.file).catch(() => { throw new Error("Não foi possível ler este ficheiro de áudio."); });
      const body = new FormData();
      body.append("audio", form.file);
      body.append("title", form.title);
      body.append("artist", form.artist);
      body.append("genre", form.genre);
      body.append("license", form.license);
      body.append("duration", String(duration));
      body.append("library", "true");
      body.append("rightsConfirmed", "true");
      await api("/music", { method: "POST", body });
      setForm({ file: null, title: "", artist: "", genre: form.genre, license: form.license, busy: false });
      load();
    } catch (uploadError) {
      setError(uploadError.message);
      setForm(current => ({ ...current, busy: false }));
    }
  };
  const change = async (track, changes) => {
    setError("");
    try {
      const result = await api(`/admin/music/${track.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      setData(current => ({ ...current, tracks: current.tracks.map(item => item.id === track.id ? { ...item, ...result.track } : item) }));
    } catch (changeError) {
      setError(changeError.message);
    }
  };

  return <div className="admin-music">
    <form className="card admin-music-form" onSubmit={upload}>
      <h2>Adicionar à biblioteca</h2>
      <p className="muted">Só músicas que a Biva pode usar: compostas para a Biva, com autorização escrita do artista, ou com licença livre (por exemplo, Pixabay Music ou Creative Commons CC0). Regista sempre a licença.</p>
      <input ref={fileInput} className="sr-only" type="file" accept="audio/*" tabIndex={-1} aria-hidden="true" onChange={event => { pick(event.target.files?.[0]); event.target.value = ""; }} />
      <button type="button" className="music-upload-button" onClick={() => fileInput.current.click()}><Icon name="sound" size={16} />{form.file ? form.file.name : "Escolher ficheiro de áudio (até 15 MB)"}</button>
      <div className="admin-music-fields">
        <label>Nome<input required maxLength={100} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label>Artista<input maxLength={100} value={form.artist} onChange={event => setForm({ ...form, artist: event.target.value })} /></label>
        <label>Género<select value={form.genre} onChange={event => setForm({ ...form, genre: event.target.value })}>
          {Object.entries(MUSIC_GENRE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>Licença<input required maxLength={300} value={form.license} onChange={event => setForm({ ...form, license: event.target.value })} placeholder="Ex.: Pixabay Content License" /></label>
      </div>
      <button className="btn" type="submit" disabled={form.busy || !form.file || !form.title.trim() || !form.license.trim()}>{form.busy ? "A carregar..." : "Adicionar à biblioteca"}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A carregar músicas...</div>}
    {data && <div className="card admin-music-list">
      <h2>Todas as músicas <small>{data.tracks.length}</small></h2>
      {!data.tracks.length && <p className="muted">Ainda não há músicas.</p>}
      <ul>
        {data.tracks.map(track => <li key={track.id} className={track.hidden_at ? "is-hidden" : ""}>
          <span className="music-info">
            <strong>{track.title}{track.artist ? ` · ${track.artist}` : ""}</strong>
            <small>{[formatClock(track.duration), MUSIC_GENRE_LABELS[track.genre], `${track.uses} ${track.uses === 1 ? "vídeo" : "vídeos"}`, track.uploader ? `por @${track.uploader}` : null, track.license || "sem licença registada"].filter(Boolean).join(" · ")}</small>
          </span>
          <audio controls preload="none" src={`${API_BASE}${track.audio_url}`} />
          <span className="admin-music-actions">
            {track.is_library
              ? <button type="button" className="btn secondary" onClick={() => change(track, { library: false })}>Tirar da biblioteca</button>
              : <button type="button" className="btn secondary" disabled={!track.license} title={track.license ? "" : "Regista a licença primeiro"} onClick={() => change(track, { library: true })}>Pôr na biblioteca</button>}
            <button type="button" className={`btn ${track.hidden_at ? "secondary" : "danger"}`} onClick={() => change(track, { hidden: !track.hidden_at })}>{track.hidden_at ? "Mostrar" : "Esconder"}</button>
          </span>
        </li>)}
      </ul>
    </div>}
  </div>;
}

function AdminPromotions() {
  const [status, setStatus] = useState("in_review");
  const [ads, setAds] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/ads?status=${status}`).then(result => setAds(result.ads)).catch(loadError => setError(loadError.message));
  useEffect(() => { setAds(null); load(); }, [status]);
  const decide = async (ad, action) => {
    let note = "";
    if (action === "reject") {
      note = window.prompt(`Motivo da recusa de «${ad.title}» (o anunciante vai ver):`, "Não cumpre as Regras de publicidade");
      if (!note) return;
    }
    setError("");
    try {
      const result = await api(`/admin/ads/${ad.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      setNotice(action === "approve" ? `«${ad.title}» aprovada e no ar.`
        : `«${ad.title}» recusada. Reembolso: ${{ refunded: "feito automaticamente", not_needed: "não necessário (demonstração)", manual: "tem de ser feito à mão", failed: "falhou — fazer à mão" }[result.refund]}.`);
      setAds(current => current.filter(item => item.id !== ad.id));
    } catch (decideError) {
      setError(decideError.message);
    }
  };
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Promoções</h2><p>Aprova as promoções pagas antes de irem para o ar. Recusar devolve o dinheiro.</p></div>
      <label className="period-select"><select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="in_review">Em revisão</option><option value="active">No ar</option><option value="rejected">Recusadas</option><option value="all">Todas</option>
      </select><Icon name="chevronDown" size={16} /></label></div>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!ads && <div className="creator-loading">A carregar...</div>}
    {ads && !ads.length && <p className="muted">Nada para mostrar.</p>}
    {ads?.length > 0 && <ul className="ad-list">{ads.map(ad => <li className="review-item" key={ad.id}>
      <div className="review-media">
        {ad.post_id
          ? ad.post_media_url ? (ad.post_media_type === "video" ? <video src={`${API_BASE}${ad.post_media_url}`} controls /> : <img src={`${API_BASE}${ad.post_media_url}`} alt="" />) : <Icon name="bolt" size={26} />
          : ad.image_url ? <img src={`${API_BASE}${ad.image_url}`} alt="" /> : <Icon name="ad" size={26} />}
      </div>
      <div className="review-main">
        <div className="ad-item-title"><strong>{ad.title}</strong><span className="content-tag">{ad.post_id ? "Publicação impulsionada" : "Anúncio"}</span></div>
        <small>De <Link to={`/u/${ad.username}`}>{ad.display_name}</Link> · {formatPrice(ad.budget)} · {ad.days} {ad.days === 1 ? "dia" : "dias"}{ad.paid_at ? ` · pago ${relativeTime(ad.paid_at)}` : ""}</small>
        {(ad.post_body || ad.body) && <p>{ad.post_body || ad.body}</p>}
        {!ad.post_id && <small>Leva para: {ad.link_url}</small>}
        {(ad.target_provinces?.length > 0 || ad.target_min_age || ad.target_max_age) && <small>Público: {[ad.target_provinces?.join(", "), (ad.target_min_age || ad.target_max_age) && `${ad.target_min_age || 13}–${ad.target_max_age || 100} anos`].filter(Boolean).join(" · ")}</small>}
        {ad.review_note && <small>Motivo: {ad.review_note}{ad.refund_status ? ` · reembolso: ${ad.refund_status}` : ""}</small>}
      </div>
      {ad.status === "in_review" && <div className="ad-actions review-actions">
        <button className="btn" type="button" onClick={() => decide(ad, "approve")}><Icon name="check" size={15} /> Aprovar</button>
        <button className="btn secondary" type="button" onClick={() => decide(ad, "reject")}>Recusar e devolver</button>
      </div>}
    </li>)}</ul>}
  </section>;
}

function AdminPayouts() {
  const [status, setStatus] = useState("requested");
  const [payouts, setPayouts] = useState(null);
  const [error, setError] = useState("");
  const load = () => api(`/admin/payouts?status=${status}`).then(result => setPayouts(result.payouts)).catch(loadError => setError(loadError.message));
  useEffect(() => { setPayouts(null); load(); }, [status]);
  const settle = async (payout, action) => {
    const value = window.prompt(action === "paid" ? `Referência da transferência de ${formatPrice(payout.amount)} para ${payout.holder_name}:` : "Motivo da recusa (o criador vai ver):");
    if (!value) return;
    try {
      await api(`/admin/payouts/${payout.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "paid" ? { reference: value } : { note: value }) });
      setPayouts(current => current.filter(item => item.id !== payout.id));
    } catch (processError) {
      setError(processError.message);
    }
  };
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Levantamentos</h2><p>Faz a transferência no banco e depois marca o pedido como pago, com a referência.</p></div>
      <label className="period-select"><select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="requested">Por pagar</option><option value="paid">Pagos</option><option value="rejected">Recusados</option>
      </select><Icon name="chevronDown" size={16} /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!payouts && !error && <div className="creator-loading">A carregar...</div>}
    {payouts && !payouts.length && <p className="muted">Nada para mostrar.</p>}
    {payouts?.length > 0 && <ul className="ad-list">{payouts.map(payout => <li className="payout-item admin-payout" key={payout.id}>
      <span><strong>{formatPrice(payout.amount)}</strong> para {payout.display_name ? <Link to={`/u/${payout.username}`}>{payout.display_name}</Link> : "conta apagada"}
        <small>Titular: {payout.holder_name} · {payout.bank_name}</small>
        <small className="admin-iban">IBAN: {payout.iban}</small>
        <small>Pedido {relativeTime(payout.created_at)}{payout.reference ? ` · ref. ${payout.reference}` : ""}{payout.note ? ` · ${payout.note}` : ""}</small></span>
      {payout.status === "requested" && <div className="ad-actions">
        <button className="btn" type="button" onClick={() => settle(payout, "paid")}>Marcar como pago</button>
        <button className="btn secondary" type="button" onClick={() => settle(payout, "reject")}>Recusar</button>
      </div>}
    </li>)}</ul>}
  </section>;
}

function AdminFinance() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/admin/finance").then(setData).catch(loadError => setError(loadError.message)); }, []);
  if (error) return <section className="creator-card"><p className="error" role="alert">{error}</p></section>;
  if (!data) return <section className="creator-card"><div className="creator-loading">A calcular...</div></section>;
  const groups = [
    ["Entradas (pagas por clientes)", [["Promoções", data.income.promotions], ["Estrelas vendidas", data.income.stars], ["Campanhas pagas", data.income.campaigns]]],
    ["Parte do Biva", [["Promoções", data.biva_share.promotions], ["Estrelas (30% + não oferecidas)", data.biva_share.stars], ["Comissão de campanhas (15%)", data.biva_share.campaigns_commission]]],
    ["Criadores", [["Ganhos acumulados", data.creators.earned], [`Levantamentos por pagar (${data.creators.requested_count})`, data.creators.requested], ["Já pagos", data.creators.paid], ["Ainda em dívida", data.creators.still_owed]]]
  ];
  return <>
    {(data.promotions_in_review > 0 || data.creators.requested_count > 0 || data.refunds_to_do > 0) && <section className="creator-card admin-todo">
      <h2>Por fazer</h2>
      <ul>
        {data.promotions_in_review > 0 && <li><Link to="/admin/promocoes">{data.promotions_in_review} {data.promotions_in_review === 1 ? "promoção" : "promoções"} em revisão</Link></li>}
        {data.creators.requested_count > 0 && <li><Link to="/admin/levantamentos">{data.creators.requested_count} {data.creators.requested_count === 1 ? "levantamento" : "levantamentos"} por pagar ({formatPrice(data.creators.requested)})</Link></li>}
        {data.refunds_to_do > 0 && <li>Reembolsos a fazer à mão: {formatPrice(data.refunds_to_do)}</li>}
      </ul>
    </section>}
    {groups.map(([title, rows]) => <section className="creator-card" key={title}>
      <h2>{title}</h2>
      <div className="stat-grid">{rows.map(([label, value]) => <div className="stat-box" key={label}><span>{label}</span><strong>{formatPrice(value)}</strong></div>)}</div>
    </section>)}
    <p className="muted creator-footnote">Pagamentos: {{ stripe: "Stripe ativa", demo: "modo de demonstração (nada é cobrado)", off: "desligados" }[data.payments]}. Estes valores são de gestão e não substituem a faturação certificada.</p>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Pagamento: Multicaixa Express, Referência ou cartão — um só ecrã para todos os produtos
// ---------------------------------------------------------------------------------------------
const PAYMENT_METHODS = {
  express: ["Multicaixa Express", "Recebes o pedido na app do teu telemóvel.", "phone"],
  reference: ["Pagamento por Referência", "Paga no ATM, no Multicaixa Express ou no internet banking.", "reference"],
  card: ["Cartão", "Visa ou Mastercard.", "card"]
};

// onPay(choice) faz o pedido ao servidor e devolve a resposta (checkoutUrl, demo, express ou reference).
function PaymentDialog({ title, amountKz, onPay, onDone, onClose }) {
  const [methods, setMethods] = useState(null);
  const [mode, setMode] = useState("stripe");
  const [method, setMethod] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [state, setState] = useState("pending");

  useEffect(() => {
    api("/payments/methods").then(result => { setMethods(result.methods); setMode(result.mode); setMethod(result.methods[0] || ""); })
      .catch(() => { setMethods([]); setMode("off"); });
  }, []);

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Enquanto espera pela confirmação, pergunta ao servidor de poucos em poucos segundos.
  useEffect(() => {
    if (!pending || state !== "pending") return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await api(`/payments/${pending.paymentId}`);
        setState(result.status);
        if (result.status === "paid") onDone();
      } catch { /* tenta outra vez no próximo intervalo */ }
    }, pending.method === "express" ? 3000 : 8000);
    return () => window.clearInterval(timer);
  }, [pending, state]);

  const pay = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onPay(mode === "demo" ? {} : { method, ...(method === "express" && { phone }) });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      if (result.demo || result.activated) { setState("paid"); onDone(result); return; }
      if (result.method === "express" || result.method === "reference") { setPending(result); setState("pending"); return; }
      if (result.error) setError(result.error);
    } catch (payError) {
      setError(payError.message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    try { setState((await api(`/payments/${pending.paymentId}/simulate`, { method: "POST" })).status); } catch (simError) { setError(simError.message); }
  };

  const copy = text => navigator.clipboard?.writeText(String(text)).catch(() => {});
  const close = () => { if (!busy) onClose(); };

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal card payment-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="share-dialog-head">
        <h2 id="payment-title">{state === "paid" ? "Pagamento confirmado" : title}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={close}><Icon name="close" size={18} /></button>
      </div>
      <div className="payment-amount"><small>Valor a pagar</small><strong>{formatPrice(amountKz)}</strong></div>

      {state === "paid" ? <div className="payment-result is-ok">
        <span className="payment-result-icon"><Icon name="check" size={28} /></span>
        <p>Recebemos o teu pagamento. Obrigado!</p>
        <button className="btn" type="button" onClick={onClose}>Concluir</button>
      </div>

      : pending ? (pending.method === "express" ? <div className="payment-wait">
        <span className="payment-pulse" aria-hidden="true"><Icon name="phone" size={26} /></span>
        <h3>Confirma na app Multicaixa Express</h3>
        <p>Enviámos o pedido para o número {pending.phone}. Abre a app e aceita o pagamento.</p>
        {pending.qrCodeUrl && <figure className="payment-qr"><img src={pending.qrCodeUrl} alt="Código QR para pagar com o Multicaixa Express" /><figcaption>Ou lê este código com a app.</figcaption></figure>}
        {pending.deeplink && <a className="btn secondary" href={pending.deeplink}>Abrir a app</a>}
        <PaymentState state={state} />
      </div> : <div className="payment-wait">
        <h3>Paga com estes dados</h3>
        <dl className="payment-reference">
          <div><dt>Entidade</dt><dd>{pending.entity}</dd><button type="button" className="text-button" onClick={() => copy(pending.entity)}>Copiar</button></div>
          <div><dt>Referência</dt><dd>{String(pending.reference).replace(/(\d{3})(?=\d)/g, "$1 ")}</dd><button type="button" className="text-button" onClick={() => copy(pending.reference)}>Copiar</button></div>
          <div><dt>Valor</dt><dd>{formatPrice(pending.amount)}</dd></div>
        </dl>
        <p className="muted">No ATM, no Multicaixa Express ou no internet banking: escolhe <strong>Pagamentos → Pagamento por Referência</strong>. Válida até {new Date(pending.expiresAt).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}. Podes fechar esta janela: confirmamos sozinhos quando pagares.</p>
        {pending.sandbox && <button className="btn secondary" type="button" onClick={simulate}>Simular pagamento (teste)</button>}
        <PaymentState state={state} />
      </div>)

      : <form className="payment-form" onSubmit={pay}>
        {mode === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Modo de demonstração: o pagamento é aprovado sem cobrança.</p>}
        {mode === "off" && <p className="error">Os pagamentos ainda não estão disponíveis.</p>}
        {mode !== "demo" && methods && methods.length > 0 && <div className="payment-methods" role="radiogroup" aria-label="Método de pagamento">
          {methods.map(id => {
            const [label, hint, icon] = PAYMENT_METHODS[id];
            return <label key={id} className={`payment-method${method === id ? " is-selected" : ""}`}>
              <input type="radio" name="payment-method" checked={method === id} onChange={() => setMethod(id)} />
              <span className={`payment-method-icon is-${id}`}><Icon name={icon} size={20} /></span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </label>;
          })}
        </div>}
        {method === "express" && mode !== "demo" && <label className="payment-phone">Número do Multicaixa Express
          <span><b>+244</b><input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="9XX XXX XXX" maxLength={11} required value={phone}
            onChange={event => setPhone(event.target.value.replace(/[^\d ]/g, ""))} /></span></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={close} disabled={busy}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy || mode === "off" || !methods}>{busy ? "A preparar..." : `Pagar ${formatPrice(amountKz)}`}</button>
        </div>
      </form>}
    </div>
  </div>, document.body);
}

function PaymentState({ state }) {
  if (state === "pending") return <p className="payment-state"><span className="payment-spinner" aria-hidden="true" /> À espera da confirmação...</p>;
  if (state === "failed") return <p className="payment-state is-error" role="alert">O pagamento foi recusado ou cancelado. Podes tentar outra vez.</p>;
  if (state === "expired") return <p className="payment-state is-error" role="alert">O prazo para pagar terminou. Gera um novo pagamento.</p>;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Diretos (lives). Com servidor de vídeo (modo "cdn"): quem emite envia uma vez (WHIP ou OBS) e
// quem vê recebe HLS pela CDN, sem limite prático de espectadores. Sem ele (modo "p2p"): WebRTC
// direto entre quem emite e cada espectador, até 8 pessoas.
// ---------------------------------------------------------------------------------------------
let pendingHostStream = null; // a fonte aberta no estúdio passa para a sala sem pedir outra vez
let pendingHostSettings = null;

const liveDuration = since => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};

// Espera que o browser junte os caminhos de rede (ICE) para enviar a oferta/resposta completa.
const waitForIce = (pc, timeout = 3500) => new Promise(resolve => {
  if (pc.iceGatheringState === "complete") return resolve();
  const timer = window.setTimeout(resolve, timeout);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(timer); resolve(); } });
});

const sendSignal = (liveId, to, kind, payload = "") => api(`/lives/${liveId}/signals`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, kind, payload })
});

const LIVE_CATEGORY_LABELS = {
  conversa: "Conversa", musica: "Música", jogos: "Jogos", desporto: "Desporto", educacao: "Educação",
  negocios: "Negócios", fe: "Fé", arte: "Arte e criação", outro: "Outro"
};

// Qualidade de emissão do estúdio no browser. kbps = máximo enviado (quem vê recebe o mesmo).
const LIVE_QUALITIES = {
  "480p30": { label: "480p · poupa dados", width: 854, height: 480, fps: 30, kbps: 1200 },
  "720p30": { label: "720p · recomendado", width: 1280, height: 720, fps: 30, kbps: 2500 },
  "720p60": { label: "720p 60 fps · jogos e desporto", width: 1280, height: 720, fps: 60, kbps: 4000 },
  "1080p30": { label: "1080p · Full HD", width: 1920, height: 1080, fps: 30, kbps: 4500 }
};

// Câmaras (inclui placas de captura e a «OBS Virtual Camera») e microfones (inclui placas de som).
function useMediaDevices(active) {
  const [devices, setDevices] = useState({ video: [], audio: [] });
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return undefined;
    const load = () => navigator.mediaDevices.enumerateDevices().then(list => setDevices({
      video: list.filter(item => item.kind === "videoinput"),
      audio: list.filter(item => item.kind === "audioinput")
    })).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, [active]);
  return devices;
}

const audioConstraints = (deviceId, original) => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  // Placas de captura e música: som tal como chega (sem cancelar eco nem "limpar" ruído).
  echoCancellation: !original, noiseSuppression: !original, autoGainControl: !original,
  ...(original ? { channelCount: 2, sampleRate: 48000 } : {})
});

// Abre a fonte escolhida. Ecrã: vídeo do ecrã + microfone, misturado com o som do ecrã se existir.
async function openLiveSource({ kind, videoId, audioId, quality, originalAudio }) {
  const preset = LIVE_QUALITIES[quality] || LIVE_QUALITIES["720p30"];
  if (kind === "screen") {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este browser não permite partilhar o ecrã. Usa o Chrome ou o Edge num computador.");
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: preset.fps }, height: { ideal: preset.height } }, audio: true });
    let mic = null;
    let micError = null;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(audioId, originalAudio) }); } catch (error) { micError = error.name; }
    const sources = [screen, mic].filter(stream => stream?.getAudioTracks().length);
    let audioTracks = sources.flatMap(stream => stream.getAudioTracks());
    if (sources.length > 1) {
      const context = new AudioContext();
      keepAudioRunning(context);
      const destination = context.createMediaStreamDestination();
      sources.forEach(stream => context.createMediaStreamSource(stream).connect(destination));
      audioTracks = destination.stream.getAudioTracks();
      audioTracks[0].addEventListener("ended", () => context.close());
    }
    const combined = new MediaStream([...screen.getVideoTracks(), ...audioTracks]);
    combined.parts = [screen, mic].filter(Boolean); // para desligar tudo no fim
    combined.micError = micError;
    // Para o estúdio mostrar microfone e som do ecrã em separado.
    combined.isScreen = true;
    combined.micStream = mic;
    combined.screenAudio = screen.getAudioTracks().length ? new MediaStream(screen.getAudioTracks()) : null;
    return combined;
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este browser não permite usar a câmara. Usa o Chrome, Edge ou Safari atualizados.");
  const video = { ...(videoId ? { deviceId: { exact: videoId } } : {}), width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps } };
  let micError = null;
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: audioConstraints(audioId, originalAudio) });
  } catch (error) {
    if (!MISSING_DEVICE_ERRORS.includes(error.name) && error.name !== "NotAllowedError") throw error;
    micError = error.name;
  }
  // Sabe se o bloqueio é só do microfone: se a câmara sozinha também for recusada, o erro sobe tal como está.
  const withoutMic = async constraints => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.micError = micError === "NotAllowedError" ? "NotAllowedError" : "NotFoundError";
    return stream;
  };
  // Falta a câmara ou o microfone (ou o escolhido desligou-se): tenta só a imagem, com a câmara predefinida se for preciso.
  try {
    return await withoutMic({ video, audio: false });
  } catch (error) {
    if (!MISSING_DEVICE_ERRORS.includes(error.name)) throw error;
  }
  if (videoId) {
    try {
      return await withoutMic({ video: { ...video, deviceId: undefined }, audio: false });
    } catch (error) {
      if (!MISSING_DEVICE_ERRORS.includes(error.name)) throw error;
    }
  }
  const noCamera = new Error("Não encontrámos nenhuma câmara ligada a este computador. Liga uma webcam ou placa de captura, ou escolhe Ecrã ou OBS.");
  noCamera.name = "NoCameraError";
  throw noCamera;
}

// Erros do browser quando o dispositivo não existe ou já não está ligado.
const MISSING_DEVICE_ERRORS = ["NotFoundError", "OverconstrainedError", "DevicesNotFoundError"];

// Traduz os erros do browser ao abrir câmara, microfone ou ecrã.
function liveSourceError(error) {
  if (error.name === "NotAllowedError") return "O browser bloqueou o acesso. Carrega no cadeado ao lado do endereço, permite a câmara e o microfone, e tenta outra vez.";
  if (error.name === "NotReadableError") return "Esta câmara ou placa está a ser usada por outro programa. Fecha-o e tenta outra vez.";
  if (MISSING_DEVICE_ERRORS.includes(error.name)) return "Esse dispositivo não foi encontrado. Confirma que está ligado ou escolhe outro.";
  if (error.name === "AbortError") return "A partilha foi interrompida. Tenta outra vez.";
  return error.message || "Não foi possível abrir a fonte.";
}

// O Chrome só deixa o áudio da página correr logo após um clique. Se o AudioContext nascer
// "adormecido" (ex.: a pessoa demorou a escolher o ecrã), acorda-o já e no próximo clique ou tecla.
function keepAudioRunning(context) {
  const resume = () => { if (context.state === "suspended") context.resume().catch(() => {}); };
  const events = ["pointerdown", "keydown"];
  const stop = () => events.forEach(name => document.removeEventListener(name, resume, true));
  resume();
  events.forEach(name => document.addEventListener(name, resume, true));
  context.addEventListener("statechange", () => {
    if (context.state === "running" || context.state === "closed") stop();
  });
  return stop;
}

const stopStream = stream => {
  stream?.getTracks().forEach(track => track.stop());
  stream?.parts?.forEach(part => part.getTracks().forEach(track => track.stop()));
};

// Nível do microfone (0–1), para confirmar que o som está a entrar.
function useAudioLevel(stream) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof AudioContext !== "function") { setLevel(0); return undefined; }
    const context = new AudioContext();
    const stopWaking = keepAudioRunning(context);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    // Escala em decibéis (-60 dB a 0 dB), como nas mesas de mistura: uma voz baixa também se vê.
    const read = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -100;
      const next = Math.min(1, Math.max(0, (db + 60) / 60));
      setLevel(current => Math.max(next, current * 0.88));
      frame = window.requestAnimationFrame(read);
    };
    read();
    return () => { window.cancelAnimationFrame(frame); stopWaking(); context.close().catch(() => {}); };
  }, [stream]);
  return level;
}

// Barra do nível do som, com o nome do microfone e um aviso se não chegar som nenhum.
function AudioMeter({ stream, original = false }) {
  const level = useAudioLevel(stream);
  const track = stream?.getAudioTracks()[0];
  const [heard, setHeard] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [muted, setMuted] = useState(Boolean(track?.muted));
  useEffect(() => { setHeard(false); setQuiet(false); }, [track]);
  // "muted" = o sistema não está a entregar som (privacidade do Windows, botão de silêncio, outro programa).
  useEffect(() => {
    if (!track) return undefined;
    const update = () => setMuted(track.muted);
    update();
    track.addEventListener("mute", update);
    track.addEventListener("unmute", update);
    return () => { track.removeEventListener("mute", update); track.removeEventListener("unmute", update); };
  }, [track]);
  useEffect(() => { if (level > 0.2) { setHeard(true); setQuiet(false); } }, [level]);
  useEffect(() => {
    if (!track || heard) return undefined;
    const timer = window.setTimeout(() => setQuiet(true), 5000);
    return () => window.clearTimeout(timer);
  }, [track, heard]);
  const name = track?.label && !/^MediaStreamAudioDestinationNode/.test(track.label) ? track.label : "";
  return <span className="live-meter-wrap">
    <span className="live-meter" role="meter" aria-label="Nível do som" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <span style={{ transform: `scaleX(${Math.min(1, level * 1.6)})` }} />
    </span>
    <small className={`live-meter-note${quiet || muted ? " is-quiet" : ""}`}>
      {!track ? "Sem som"
        : muted ? `O Windows não está a deixar passar o som${name ? ` de «${name}»` : ""}. Em Definições do Windows → Privacidade → Microfone, permite o acesso às apps e ao Chrome, e confirma que o microfone não está em silêncio.`
          : quiet ? (original
            ? `Chega muito pouco som${name ? ` de «${name}»` : ""}. Desliga «Som original»: o volume do microfone passa a ser automático.`
            : `Não chega som${name ? ` de «${name}»` : ""}. Se não for o teu microfone, escolhe outro em «Som». Confirma também o volume em Definições do Windows → Sistema → Som → Entrada.`)
            : heard ? `A ouvir${name ? `: ${name}` : ""}` : `Fala para testar${name ? ` · ${name}` : ""}`}
    </small>
  </span>;
}

const MIC_ERROR_TEXT = {
  NotAllowedError: "O Chrome bloqueou o microfone. Carrega no ícone ao lado do endereço, permite o microfone e escolhe o ecrã outra vez.",
  NotFoundError: "Não encontrámos nenhum microfone ligado. Liga-o e escolhe o ecrã outra vez.",
  OverconstrainedError: "O microfone escolhido em «Som» já não está ligado. Escolhe outro.",
  NotReadableError: "O microfone está a ser usado por outro programa (por exemplo Discord, Zoom ou Teams). Fecha-o e escolhe o ecrã outra vez."
};

// Níveis do som do estúdio. No ecrã há duas fontes (microfone e som do ecrã), cada uma com a sua barra,
// para se perceber logo qual delas não está a entrar.
function LiveAudioMeters({ stream, original = false }) {
  if (!stream?.isScreen) return <div className="live-studio-level"><span>Nível do som</span><AudioMeter stream={stream} original={original} /></div>;
  return <div className="live-studio-level live-studio-levels">
    <div>
      <span><Icon name="mic" size={14} /> Microfone</span>
      {stream.micStream
        ? <AudioMeter stream={stream.micStream} original={original} />
        : <small className="live-meter-note is-quiet">{MIC_ERROR_TEXT[stream.micError] || "Não foi possível abrir o microfone. Escolhe o ecrã outra vez."}</small>}
    </div>
    <div>
      <span><Icon name="devices" size={14} /> Som do ecrã</span>
      {stream.screenAudio
        ? <AudioMeter stream={stream.screenAudio} />
        : <small className="live-meter-note">Sem som do ecrã. Para o incluir, escolhe um separador ou o ecrã inteiro e ativa «Partilhar áudio».</small>}
    </div>
  </div>;
}

// Enviar para o servidor de vídeo por WHIP (o mesmo protocolo que o OBS usa). Prefere H.264,
// que o HLS e todos os telemóveis tocam.
async function publishWhip(url, stream, kbps, iceServers) {
  const pc = new RTCPeerConnection({ iceServers: iceServers || [] });
  for (const track of stream.getTracks()) {
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly", streams: [stream],
      ...(track.kind === "video" ? { sendEncodings: [{ maxBitrate: kbps * 1000 }] } : {})
    });
    if (track.kind === "video" && RTCRtpSender.getCapabilities) {
      const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
      const h264 = codecs.filter(codec => codec.mimeType === "video/H264");
      if (h264.length && transceiver.setCodecPreferences) transceiver.setCodecPreferences([...h264, ...codecs.filter(codec => codec.mimeType !== "video/H264")]);
    }
  }
  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc, 2500);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
  if (!response.ok) { pc.close(); throw new Error(response.status === 401 ? "O servidor de vídeo recusou a emissão." : "Não foi possível ligar ao servidor de vídeo."); }
  await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  const location = response.headers.get("Location");
  return { pc, resource: location ? new URL(location, url).href : "" };
}

// Ver por HLS (hls.js, carregado só quando é preciso; Safari usa o leitor nativo).
function useHlsPlayback(videoRef, url, enabled, setState) {
  useEffect(() => {
    const video = videoRef.current;
    if (!url || !enabled || !video) return undefined;
    let hls = null;
    let retry = 0;
    let cancelled = false;
    const again = state => { setState(state); window.clearTimeout(retry); retry = window.setTimeout(start, 3000); };
    async function start() {
      if (cancelled) return;
      hls?.destroy();
      hls = null;
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 1 });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setState("live"); });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // 404: o servidor ainda não recebe o vídeo (OBS a ligar). Outro erro: rede; tenta de novo.
          again(data.response?.code === 404 ? "waiting" : "reconnecting");
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.onloadedmetadata = () => { video.play().catch(() => {}); setState("live"); };
        video.onerror = () => again("waiting");
      } else setState("unsupported");
    }
    setState("connecting");
    start();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      hls?.destroy();
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [url, enabled]);
}

const maskKey = key => key ? `${key.slice(0, 10)}${"•".repeat(14)}` : "";

function CopyField({ label, value, secret }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setShown(true); }
  };
  return <div className="copy-field">
    <span className="copy-field-label">{label}</span>
    <div className="copy-field-row">
      <code>{shown ? value : maskKey(value)}</code>
      {secret && <button type="button" className="btn secondary" onClick={() => setShown(value => !value)}>{shown ? "Esconder" : "Mostrar"}</button>}
      <button type="button" className="btn secondary" onClick={copy}><Icon name={copied ? "check" : "copy"} size={15} /> {copied ? "Copiado" : "Copiar"}</button>
    </div>
  </div>;
}

// Chave de transmissão para OBS, vMix, Streamlabs ou encoders e placas com saída RTMP.
function StreamKeyPanel() {
  const [info, setInfo] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [protocol, setProtocol] = useState("rtmp");
  useEffect(() => { api("/lives/stream-key").then(setInfo).catch(loadError => setError(loadError.message)); }, []);
  const generate = async () => {
    if (info?.hasKey && !window.confirm("Gerar uma chave nova? A antiga deixa de funcionar e uma emissão em curso com ela é cortada.")) return;
    setBusy(true);
    setError("");
    try { const result = await api("/lives/stream-key", { method: "POST" }); setInfo(result); setFresh(result); }
    catch (keyError) { setError(keyError.message); }
    finally { setBusy(false); }
  };
  if (!info) return <div className="creator-loading">{error || "A carregar..."}</div>;
  const data = fresh || info;
  return <div className="stream-key">
    <div className="ad-toggle" role="group" aria-label="Protocolo">
      <button type="button" aria-pressed={protocol === "rtmp"} onClick={() => setProtocol("rtmp")}>RTMP</button>
      {data.whip && <button type="button" aria-pressed={protocol === "whip"} onClick={() => setProtocol("whip")}>WHIP</button>}
    </div>
    {protocol === "rtmp" ? <>
      <CopyField label="Servidor" value={data.rtmp?.server || ""} />
      {fresh ? <CopyField label="Chave de transmissão" value={fresh.rtmp.streamKey} secret />
        : <p className="muted stream-key-hint">{info.hasKey ? "A tua chave está guardada de forma segura e não pode ser mostrada outra vez. Se a perdeste, gera uma nova." : "Ainda não tens chave. Gera uma para ligar o OBS."}</p>}
    </> : <>
      <CopyField label="Servidor (WHIP)" value={data.whip.url} />
      {fresh ? <CopyField label="Bearer token" value={fresh.whip.token} secret />
        : <p className="muted stream-key-hint">Usa a mesma chave como «Bearer token». Gera uma nova se não a tens.</p>}
    </>}
    {fresh && <p className="info-draft" role="status"><Icon name="lock" size={15} /> Copia a chave agora: por segurança só é mostrada uma vez. Nunca a mostres no ecrã do direto.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="btn secondary" onClick={generate} disabled={busy}><Icon name="reset" size={15} /> {busy ? "A gerar..." : info.hasKey ? "Gerar nova chave" : "Gerar chave"}</button>
    <details className="stream-key-help">
      <summary>Como configurar o OBS</summary>
      <ol>
        <li>No OBS: <strong>Definições → Transmissão</strong>, serviço <strong>Personalizado</strong> ({protocol === "rtmp" ? "RTMP" : "WHIP"}).</li>
        <li>Cola o servidor e a {protocol === "rtmp" ? "chave" : "bearer token"} acima.</li>
        <li><strong>Saída</strong>: H.264 (x264 ou NVENC), CBR, 2500–4500 kbps, intervalo de keyframes 2 s, áudio AAC 160 kbps.</li>
        <li><strong>Vídeo</strong>: 1280×720 a 30 fps (ou 1920×1080 com boa internet).</li>
        <li>Cria o direto aqui no Biva e depois carrega em <strong>Iniciar transmissão</strong> no OBS.</li>
      </ol>
      <p className="muted">A placa de captura (Elgato, AVerMedia...) entra no OBS como «Dispositivo de captura de vídeo». Também a podes escolher diretamente no estúdio do Biva, sem OBS.</p>
    </details>
  </div>;
}

// Sem servidor de vídeo (MEDIA_* no .env), o Biva não consegue receber o vídeo de programas externos.
function ObsUnavailable() {
  return <div className="obs-unavailable">
    <span className="ad-kind-icon"><Icon name="info" size={18} /></span>
    <div>
      <strong>A transmissão por OBS ainda não está ligada neste servidor</strong>
      <p className="muted">Para usar OBS, vMix ou Streamlabs com chave de transmissão, a equipa do Biva tem de ligar o servidor de vídeo (MediaMTX). Enquanto isso, podes emitir pelo browser: escolhe «Câmara ou placa» — a placa de captura e a câmara virtual do OBS aparecem lá.</p>
    </div>
  </div>;
}

// A chave também se vê e gera fora de um direto (como nas definições de transmissão de outras plataformas).
function StreamKeyDialog({ onClose }) {
  const [enabled, setEnabled] = useState(null);
  useEffect(() => { api("/lives/config").then(result => setEnabled(Boolean(result.obs))).catch(() => setEnabled(false)); }, []);
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal card stream-key-dialog" role="dialog" aria-modal="true" aria-labelledby="stream-key-title">
      <div className="share-dialog-head">
        <h2 id="stream-key-title">Chave de transmissão</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <p className="muted">Usa-a no OBS, vMix, Streamlabs ou numa placa/encoder com saída RTMP. Depois cria o direto no Biva com «OBS ou programa» e inicia a transmissão no programa.</p>
      {enabled === null ? <div className="creator-loading">A carregar...</div> : enabled ? <StreamKeyPanel /> : <ObsUnavailable />}
    </div>
  </div>, document.body);
}

function StartLiveDialog({ onClose }) {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState("camera");
  const [stream, setStream] = useState(null);
  const [videoId, setVideoId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [quality, setQuality] = useState("720p30");
  const [originalAudio, setOriginalAudio] = useState(false);
  const [details, setDetails] = useState({ title: "", description: "", category: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef(null);
  // Sem câmara: abre só o microfone, para a barra do som e a lista de microfones funcionarem na mesma.
  const [micPreview, setMicPreview] = useState(null);
  const micPreviewRef = useRef(null);
  const setMicOnly = next => {
    stopStream(micPreviewRef.current);
    micPreviewRef.current = next;
    setMicPreview(next);
  };
  const devices = useMediaDevices(Boolean(stream || micPreview));

  useEffect(() => { api("/lives/config").then(setConfig).catch(() => setConfig({ mode: "p2p", categories: Object.keys(LIVE_CATEGORY_LABELS) })); }, []);
  const replaceStream = next => {
    if (streamRef.current && streamRef.current !== pendingHostStream) stopStream(streamRef.current);
    streamRef.current = next;
    setStream(next);
    if (videoRef.current) videoRef.current.srcObject = next;
  };
  const open = async (kind = mode) => {
    setError("");
    setMicOnly(null);
    try {
      replaceStream(await openLiveSource({ kind, videoId, audioId, quality, originalAudio }));
    } catch (openError) {
      replaceStream(null);
      if (kind === "camera" && openError.name === "NoCameraError") {
        navigator.mediaDevices.getUserMedia({ audio: audioConstraints(audioId, originalAudio) })
          .then(setMicOnly)
          .catch(() => {});
      }
      // No ecrã, "NotAllowedError" quase sempre quer dizer que a pessoa fechou a janela de escolha.
      setError(kind === "screen" && openError.name === "NotAllowedError"
        ? "Não escolheste nenhum ecrã. Carrega em «Escolher ecrã ou janela» e escolhe um separador, janela ou ecrã inteiro."
        : liveSourceError(openError));
    }
  };
  // Câmara/placa: reabre ao mudar de dispositivo, qualidade ou tipo de som. Ecrã: só quando se carrega no botão.
  useEffect(() => { if (mode === "camera") open("camera"); }, [mode, videoId, audioId, quality, originalAudio]);
  useEffect(() => { setError(""); setMicOnly(null); if (mode !== "camera") replaceStream(null); }, [mode]);
  useEffect(() => () => { if (streamRef.current !== pendingHostStream) stopStream(streamRef.current); stopStream(micPreviewRef.current); }, []);

  const update = (key, value) => setDetails(current => ({ ...current, [key]: value }));
  const start = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/lives", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...details, source: mode === "obs" ? "obs" : "browser" }) });
      if (mode !== "obs") { pendingHostStream = stream; pendingHostSettings = { quality, videoId, audioId, originalAudio, kind: mode }; }
      navigate(`/live/${result.id}`);
    } catch (startError) {
      setError(startError.message);
      setBusy(false);
    }
  };
  const canStart = details.title.trim() && (mode === "obs" ? Boolean(config?.obs) : stream);
  const sources = [
    ["camera", "video", "Câmara ou placa", "Webcam, placa de captura ou câmara virtual do OBS"],
    ["screen", "devices", "Ecrã", "Uma janela, separador ou o ecrã inteiro"],
    ["obs", "live", "OBS ou programa", "Chave de transmissão RTMP ou WHIP"]
  ];

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card start-live-dialog live-studio" role="dialog" aria-modal="true" aria-labelledby="start-live-title" onSubmit={start}>
      <div className="share-dialog-head">
        <h2 id="start-live-title">Estúdio do direto</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="live-studio-grid">
        <div className="live-studio-media">
          <div className="ad-kind live-sources" role="radiogroup" aria-label="De onde vem o vídeo">
            {sources.map(([key, icon, label, hint]) => <label key={key} className={mode === key ? "is-selected" : ""}>
              <input type="radio" name="live-source" checked={mode === key} onChange={() => setMode(key)} />
              <span className="ad-kind-icon"><Icon name={icon} size={17} /></span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </label>)}
          </div>
          {mode === "obs" ? (config?.obs ? <StreamKeyPanel /> : <ObsUnavailable />) : <>
            <div className="start-live-preview">
              <video ref={videoRef} autoPlay muted playsInline />
              {!stream && (mode === "screen"
                ? <button type="button" className="btn" onClick={() => open("screen")}><Icon name="devices" size={16} /> Escolher ecrã ou janela</button>
                : error
                  ? <button type="button" className="btn secondary" onClick={() => open("camera")}><Icon name="reset" size={16} /> Tentar outra vez</button>
                  : <span>A abrir a câmara...</span>)}
              {stream && <LiveBadge small />}
              {stream && stream.getVideoTracks()[0] && <span className="live-studio-res">{(() => { const settings = stream.getVideoTracks()[0].getSettings(); return settings.height ? `${settings.width}×${settings.height}${settings.frameRate ? ` · ${Math.round(settings.frameRate)} fps` : ""}` : ""; })()}</span>}
            </div>
            <div className="live-studio-devices">
              {mode === "camera" && <label>Vídeo
                <select value={videoId} onChange={event => setVideoId(event.target.value)}>
                  <option value="">Câmara predefinida</option>
                  {devices.video.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmara ${index + 1}`}</option>)}
                </select>
              </label>}
              <label>Som
                <select value={audioId} onChange={event => setAudioId(event.target.value)}>
                  <option value="">Microfone predefinido</option>
                  {devices.audio.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
                </select>
              </label>
              <label>Qualidade
                <select value={quality} onChange={event => setQuality(event.target.value)}>
                  {Object.entries(LIVE_QUALITIES).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                </select>
              </label>
              <LiveAudioMeters stream={stream || micPreview} original={originalAudio} />
            </div>
            {stream && !stream.getAudioTracks().length && <p className="live-studio-nosound" role="status">
              <Icon name="micOff" size={16} />
              {stream.micError === "NotAllowedError"
                ? "O browser bloqueou o microfone, por isso o direto vai sem som. Carrega no cadeado ao lado do endereço, permite o microfone e volta a escolher a fonte."
                : `Não encontrámos nenhum microfone: o direto vai sem som. Liga um microfone e escolhe-o em «Som»${mode === "screen" ? ", ou partilha o som do separador ao escolher o ecrã" : ""}.`}
            </p>}
            <label className="live-switch">
              <input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} />
              <span><strong>Som original</strong><small>Para placas de captura, mesas de mistura e música: sem cancelamento de eco nem redução de ruído.</small></span>
            </label>
            {mode === "screen" && stream && <button type="button" className="btn secondary" onClick={() => open("screen")}>Escolher outro ecrã</button>}
          </>}
        </div>
        <div className="live-studio-details">
          <label>Título<input required maxLength={120} value={details.title} onChange={event => update("title", event.target.value)} placeholder="Ex.: Conversa sobre música angolana" /></label>
          <label><span className="ad-field-head">Descrição <CharCount value={details.description} max={500} /></span>
            <textarea rows={4} maxLength={500} value={details.description} onChange={event => update("description", event.target.value)} placeholder="Do que vais falar, convidados, horário..." /></label>
          <label>Categoria
            <select value={details.category} onChange={event => update("category", event.target.value)}>
              <option value="">Sem categoria</option>
              {(config?.categories || Object.keys(LIVE_CATEGORY_LABELS)).map(key => <option key={key} value={key}>{LIVE_CATEGORY_LABELS[key] || key}</option>)}
            </select>
          </label>
          <p className="muted create-page-note">{config?.mode === "cdn"
            ? "Quem te segue recebe uma notificação. O vídeo chega a todas as pessoas, mesmo a quem não tem conta."
            : "Quem te segue recebe uma notificação. Neste servidor o vídeo chega diretamente a até 8 pessoas; o chat e as estrelas funcionam para todos."}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn live-start-button" type="submit" disabled={busy || !canStart}><Icon name="live" size={16} /> {busy ? "A começar..." : mode === "obs" ? "Criar direto" : "Entrar em direto"}</button>
          </div>
        </div>
      </div>
    </form>
  </div>, document.body);
}

function LiveBadge({ small }) {
  return <span className={`live-badge${small ? " is-small" : ""}`}><span className="live-dot" aria-hidden="true" />Ao vivo</span>;
}

function LivePage() {
  const { liveId } = useParams();
  if (liveId) return <LiveRoom key={liveId} liveId={liveId} />;
  return <LiveList />;
}

function LiveList() {
  const { user } = useContext(UserContext);
  const [lives, setLives] = useState(null);
  const [starting, setStarting] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [, tick] = useState(0);
  const load = () => api("/lives").then(result => setLives(result.lives)).catch(() => setLives([]));
  usePolling(load, 15000, true);
  useEffect(() => { load(); const timer = window.setInterval(() => tick(value => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const mine = lives?.find(live => user && live.username === user.username);
  const categories = [...new Set((lives || []).map(live => live.category).filter(Boolean))];
  const shown = (lives || []).filter(live => !category || live.category === category);
  return <div className="pages-view live-list">
    <header className="pages-head">
      <div><h1>Diretos</h1><p>Vê quem está a emitir agora, conversa no chat e apoia com estrelas.</p></div>
      <div className="live-head-actions">
        {user && <button className="btn secondary" type="button" onClick={() => setKeyOpen(true)}><Icon name="lock" size={16} /> Chave para OBS</button>}
        {user ? (mine ? <Link className="btn live-start-button" to={`/live/${mine.id}`}><Icon name="live" size={16} /> Voltar ao teu direto</Link>
          : <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>)
          : <Link className="btn" to="/login">Entrar para emitir</Link>}
      </div>
    </header>
    {keyOpen && <StreamKeyDialog onClose={() => setKeyOpen(false)} />}
    {categories.length > 0 && <div className="ad-filters live-categories" role="group" aria-label="Categorias">
      <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>Todos <span>{lives.length}</span></button>
      {categories.map(key => <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>
        {LIVE_CATEGORY_LABELS[key] || key} <span>{lives.filter(live => live.category === key).length}</span></button>)}
    </div>}
    {!lives && <div className="empty card">A procurar diretos...</div>}
    {lives && !lives.length && <div className="empty card pages-empty live-empty">
      <span className="group-lock-icon live-empty-icon"><Icon name="live" size={26} /></span>
      <p>Ninguém está em direto neste momento. Sê a primeira pessoa: mostra o que estás a fazer, responde a perguntas, recebe estrelas.</p>
      {user && <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>}
    </div>}
    {shown.length > 0 && <div className="pages-grid">{shown.map(live => <Link key={live.id} to={`/live/${live.id}`} className="live-card card">
      <span className={`live-card-cover tone-page-${pageTone(live.username)}`}>
        <span className="live-card-avatar"><Avatar user={live} size="large" /></span>
        <LiveBadge small />
        <span className="live-card-viewers"><Icon name="eye" size={13} /> {formatCount(live.viewers)}</span>
      </span>
      <span className="live-card-body">
        <strong>{live.title}</strong>
        <small>{live.display_name}<VerifiedBadge show={live.is_verified} /> · há {liveDuration(live.started_at)}</small>
        {live.category && <small className="live-card-category">{LIVE_CATEGORY_LABELS[live.category] || live.category}</small>}
      </span>
    </Link>)}</div>}
    {starting && <StartLiveDialog onClose={() => setStarting(false)} />}
  </div>;
}

const LIVE_REACTIONS = [["heart", "Coração"], ["like", "Gosto"], ["spark", "Faísca"]];

// Moderadores: escolhidos por quem emite e válidos em todos os seus diretos.
function LiveModerators() {
  const [list, setList] = useState(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/lives/moderators").then(result => setList(result.moderators)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const add = async event => {
    event.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/lives/moderators", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      setUsername("");
      await load();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async person => {
    try {
      await api(`/lives/moderators/${person.id}`, { method: "DELETE" });
      setList(current => current.filter(item => item.id !== person.id));
    } catch (removeError) {
      setError(removeError.message);
    }
  };
  return <div className="live-mods">
    <h3>Moderadores</h3>
    <p className="muted">Podem apagar mensagens, fixar e silenciar pessoas no chat. Valem para todos os teus diretos.</p>
    <form className="live-mods-add" onSubmit={add}>
      <input value={username} onChange={event => setUsername(event.target.value)} placeholder="@nome_de_utilizador" aria-label="Nome de utilizador do moderador" />
      <button className="btn secondary" type="submit" disabled={busy || !username.trim()}>Adicionar</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {list?.length > 0 && <ul className="live-mods-list">{list.map(person => <li key={person.id}>
      <Avatar user={person} size="tiny" />
      <span><strong>{person.display_name}</strong><small>@{person.username}</small></span>
      <button type="button" className="btn secondary icon-only" aria-label={`Retirar ${person.display_name} dos moderadores`} title="Retirar" onClick={() => remove(person)}><Icon name="close" size={15} /></button>
    </li>)}</ul>}
  </div>;
}

function LiveRoom({ liveId }) {
  const { user } = useContext(UserContext);
  const [live, setLive] = useState(null);
  const [supporters, setSupporters] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [config, setConfig] = useState(null);
  const [videoState, setVideoState] = useState("connecting");
  const [muted, setMuted] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [panel, setPanel] = useState("chat");
  const [balance, setBalance] = useState(null);
  const [giftMessage, setGiftMessage] = useState("");
  const [feedPoll, setFeedPoll] = useState(2500);
  const [pinned, setPinned] = useState(null);
  const [roles, setRoles] = useState({ host: "", moderators: [] });
  const [floats, setFloats] = useState([]);
  const reactionTotals = useRef(null);
  const ownReactions = useRef({ heart: 0, like: 0, spark: 0 });
  const [beatMs, setBeatMs] = useState(30000);
  const [hostStream, setHostStream] = useState(null);
  const [studio, setStudio] = useState({ signal: null, stats: null });
  const [settings, setSettings] = useState(() => pendingHostSettings || { quality: "720p30", videoId: "", audioId: "", originalAudio: false, kind: "camera" });
  const [blocked, setBlocked] = useState(() => new Set());
  const [, tick] = useState(0);
  const videoRef = useRef(null);
  const chatRef = useRef(null);
  const streamRef = useRef(null);
  const whip = useRef(null);             // modo cdn: ligação WHIP de quem emite
  const peers = useRef(new Map());     // modo p2p: uma ligação por espectador
  const viewerPc = useRef(null);       // modo p2p: a ligação do espectador a quem emite
  const viewerSession = useRef("");
  const lastSignal = useRef(0);
  const isHost = Boolean(live?.is_host);
  const ended = live?.status === "ended";
  const cdn = config?.mode === "cdn";
  const fromObs = live?.source === "obs";

  const loadLive = async () => {
    try {
      const result = await api(`/lives/${liveId}`);
      setLive(result.live);
      setSupporters(result.supporters);
      if (result.live.signal) setStudio({ signal: result.live.signal, stats: result.live.stats });
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    loadLive();
    api("/lives/config").then(setConfig).catch(() => setConfig({ mode: "p2p", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], giftAmounts: [1, 5, 10, 50, 100] }));
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveId]);
  useEffect(() => { if (user) api("/blocks").then(result => setBlocked(new Set(result.blocked.map(person => person.username)))).catch(() => {}); }, [user?.id]);

  // ----- Quem emite pelo browser: abre a fonte e envia (WHIP em modo cdn) -----
  const startWhip = async stream => {
    whip.current?.pc.close();
    const { whip: url } = await api(`/lives/${liveId}/publish`, { method: "POST" });
    const preset = LIVE_QUALITIES[settings.quality] || LIVE_QUALITIES["720p30"];
    const connection = await publishWhip(url, stream, preset.kbps, config.iceServers);
    whip.current = connection;
    connection.pc.addEventListener("connectionstatechange", () => {
      if (connection.pc.connectionState === "failed" && whip.current === connection) {
        setVideoState("reconnecting");
        window.setTimeout(() => { if (whip.current === connection && streamRef.current) startWhip(streamRef.current).then(() => setVideoState("live")).catch(() => setVideoState("failed")); }, 2000);
      }
    });
  };

  useEffect(() => {
    if (!isHost || ended || fromObs || !config) return undefined;
    let cancelled = false;
    (async () => {
      let stream = pendingHostStream;
      pendingHostStream = null;
      pendingHostSettings = null;
      if (!stream) {
        try { stream = await openLiveSource({ ...settings, kind: settings.kind === "screen" ? "camera" : settings.kind }); }
        catch { setVideoState("no-camera"); return; }
      }
      if (cancelled) { stopStream(stream); return; }
      streamRef.current = stream;
      setHostStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      if (cdn) {
        setVideoState("publishing");
        try { await startWhip(stream); if (!cancelled) setVideoState("live"); }
        catch (publishError) { if (!cancelled) { setVideoState("failed"); setGiftMessage(publishError.message); } }
      } else setVideoState("live");
    })();
    return () => {
      cancelled = true;
      if (whip.current) {
        if (whip.current.resource) fetch(whip.current.resource, { method: "DELETE" }).catch(() => {});
        whip.current.pc.close();
        whip.current = null;
      }
      peers.current.forEach(pc => pc.close());
      peers.current.clear();
      stopStream(streamRef.current);
    };
  }, [isHost, ended, fromObs, Boolean(config)]);

  // Trocar de câmara/placa/microfone sem parar o direto: substitui as faixas em todas as ligações.
  const switchSource = async next => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    try {
      const stream = await openLiveSource(merged);
      const senders = [...(whip.current ? whip.current.pc.getSenders() : []), ...[...peers.current.values()].flatMap(pc => pc.getSenders())];
      for (const track of stream.getTracks()) {
        for (const sender of senders.filter(item => item.track?.kind === track.kind)) await sender.replaceTrack(track);
      }
      const previous = streamRef.current;
      streamRef.current = stream;
      setHostStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      setMicOn(true);
      setCamOn(true);
      stopStream(previous);
    } catch (switchError) {
      setGiftMessage(liveSourceError(switchError));
    }
  };
  const devices = useMediaDevices(isHost && !fromObs && Boolean(hostStream));

  // ----- Quem vê em modo cdn (e quem emite pelo OBS, para confirmar o que sai): HLS -----
  // Só depois de a configuração chegar é que o <video> existe (antes mostra «A abrir o direto...»).
  const watchHls = Boolean(live?.playback?.hls && config) && !ended && (!isHost || fromObs);
  useHlsPlayback(videoRef, live?.playback?.hls, watchHls, setVideoState);

  // ----- Modo p2p (sem servidor de vídeo) -----
  const answerOffer = async signal => {
    const viewerId = signal.from_user;
    peers.current.get(viewerId)?.close();
    if (peers.current.size >= (config.maxVideoViewers || 8) || !streamRef.current) {
      await sendSignal(liveId, viewerId, "bye", JSON.stringify({ session: JSON.parse(signal.payload).session, reason: "full" }));
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || "all" });
    peers.current.set(viewerId, pc);
    streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) { pc.close(); peers.current.delete(viewerId); }
    });
    const offer = JSON.parse(signal.payload);
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    await sendSignal(liveId, viewerId, "answer", JSON.stringify({ session: offer.session, sdp: pc.localDescription.sdp }));
  };

  const connectViewer = async () => {
    if (!live || isHost || ended || !user || cdn || !config || typeof RTCPeerConnection !== "function") return;
    viewerPc.current?.close();
    setVideoState("connecting");
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || "all" });
    viewerPc.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addEventListener("track", event => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; setVideoState("live"); });
    pc.addEventListener("connectionstatechange", () => { if (pc.connectionState === "failed") setVideoState("failed"); });
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    viewerSession.current = Math.random().toString(36).slice(2);
    await sendSignal(liveId, live.host_id, "offer", JSON.stringify({ session: viewerSession.current, sdp: pc.localDescription.sdp }));
  };

  useEffect(() => {
    if (config && !cdn && live && !isHost && !ended && user) connectViewer().catch(() => setVideoState("failed"));
    return () => {
      if (viewerPc.current && live && !isHost) { sendSignal(liveId, live.host_id, "bye").catch(() => {}); viewerPc.current.close(); viewerPc.current = null; }
    };
  }, [live?.id, isHost, ended, user?.id, cdn, Boolean(config)]);

  usePolling(async () => {
    if (!user || !live || ended) return;
    const result = await api(`/lives/${liveId}/signals?after=${lastSignal.current}`);
    for (const signal of result.signals) {
      lastSignal.current = Math.max(lastSignal.current, signal.id);
      if (isHost && signal.kind === "offer") await answerOffer(signal).catch(offerError => console.warn("Live offer:", offerError.message));
      if (isHost && signal.kind === "bye") { peers.current.get(signal.from_user)?.close(); peers.current.delete(signal.from_user); }
      if (!isHost && (signal.kind === "answer" || signal.kind === "bye")) {
        let data = {};
        try { data = JSON.parse(signal.payload || "{}"); } catch { data = {}; }
        if (data.session !== viewerSession.current) continue;
        if (signal.kind === "answer" && viewerPc.current?.signalingState === "have-local-offer") {
          await viewerPc.current.setRemoteDescription({ type: "answer", sdp: data.sdp }).catch(() => setVideoState("failed"));
        }
        if (signal.kind === "bye") setVideoState(data.reason === "full" ? "full" : "connecting");
      }
    }
  }, 1500, Boolean(user && live && !ended && config && !cdn));

  // Sinal de vida: quem emite a cada 8 s (mantém o direto e recebe o estado do vídeo); quem vê a cada 30–60 s (o servidor diz).
  usePolling(async () => {
    if (!user || !live || ended) return;
    const beat = await api(`/lives/${liveId}/heartbeat`, { method: "POST" });
    setLive(current => current && { ...current, viewers: beat.viewers, status: beat.status });
    if (isHost) setStudio({ signal: beat.signal, stats: beat.stats });
    else if (beat.next) setBeatMs(beat.next);
  }, isHost ? 8000 : beatMs, Boolean(user && live && !ended));
  useEffect(() => {
    if (!user || !live || isHost || ended) return undefined;
    api(`/lives/${liveId}/heartbeat`, { method: "POST" }).catch(() => {});
    // Ao sair da sala deixa logo de contar (sem esperar que o sinal de vida expire).
    return () => { api(`/lives/${liveId}/leave`, { method: "POST" }).catch(() => {}); };
  }, [live?.id, user?.id, isHost, ended]);

  // Chat, estrelas e audiência: um feed igual para todos (cacheável), lido com mais calma em diretos grandes.
  // Reações a subir no vídeo (no máximo 24 ao mesmo tempo, para não pesar em telemóveis).
  const spawnFloats = (kind, count) => {
    const fresh = Array.from({ length: count }, () => ({
      id: Math.random().toString(36).slice(2), kind, x: Math.round(Math.random() * 40), drift: Math.round(Math.random() * 50 - 25)
    }));
    setFloats(current => [...current, ...fresh].slice(-24));
    window.setTimeout(() => setFloats(current => current.filter(item => !fresh.includes(item))), 2600);
  };

  const applyFeed = feed => {
    setComments(current => {
      // O feed traz as últimas mensagens visíveis: as apagadas pela moderação desaparecem também aqui.
      const ids = new Set(feed.comments.map(comment => comment.id));
      const oldest = feed.comments[0]?.id ?? Infinity;
      const kept = current.filter(comment => comment.id < oldest || ids.has(comment.id));
      const last = kept.at(-1)?.id || 0;
      const fresh = feed.comments.filter(comment => comment.id > last);
      return fresh.length || kept.length !== current.length ? [...kept, ...fresh].slice(-150) : current;
    });
    setPinned(feed.pinned || null);
    setRoles({ host: feed.host || "", moderators: feed.moderators || [] });
    if (feed.reactions) {
      const previous = reactionTotals.current;
      reactionTotals.current = feed.reactions;
      if (previous) for (const [kind, total] of Object.entries(feed.reactions)) {
        const delta = Math.max(0, total - (previous[kind] || 0));
        const mine = Math.min(delta, ownReactions.current[kind] || 0);
        ownReactions.current[kind] = (ownReactions.current[kind] || 0) - mine;
        if (delta - mine > 0) spawnFloats(kind, Math.min(delta - mine, 8));
      }
    }
    setSupporters(feed.supporters);
    setFeedPoll(feed.poll || 2500);
    setLive(current => current && { ...current, stars: feed.stars, viewers: feed.viewers, status: feed.status === "ended" ? "ended" : current.status });
  };
  const loadFeed = () => api(`/lives/${liveId}/feed`).then(applyFeed);
  useEffect(() => { if (live?.id) loadFeed().catch(() => {}); }, [live?.id]);
  usePolling(loadFeed, feedPoll, Boolean(live && !ended));

  const visibleComments = blocked.size ? comments.filter(comment => !blocked.has(comment.username)) : comments;
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [visibleComments.length]);

  const react = async kind => {
    spawnFloats(kind, 1);
    ownReactions.current[kind] = (ownReactions.current[kind] || 0) + 1;
    try {
      const result = await api(`/lives/${liveId}/react`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!result.counted) ownReactions.current[kind] -= 1;
    } catch {
      ownReactions.current[kind] -= 1;
    }
  };

  const myRole = isHost ? "host" : user && roles.moderators.includes(user.username) ? "moderator" : null;
  const roleOf = username => username && username === roles.host ? "host" : roles.moderators.includes(username) ? "moderator" : null;
  const moderate = async (action, comment) => {
    setGiftMessage("");
    const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      if (action === "delete") {
        await api(`/lives/${liveId}/comments/${comment.id}`, { method: "DELETE" });
        setComments(current => current.filter(item => item.id !== comment.id));
      }
      if (action === "pin") await api(`/lives/${liveId}/pin`, json({ commentId: comment.id }));
      if (action === "unpin") await api(`/lives/${liveId}/pin`, json({ commentId: null }));
      if (action === "mute") {
        await api(`/lives/${liveId}/mute`, json({ username: comment.username, minutes: 10 }));
        setGiftMessage(`${comment.display_name} não pode escrever no chat durante 10 minutos.`);
      }
      loadFeed().catch(() => {});
    } catch (moderateError) {
      setGiftMessage(moderateError.message);
    }
  };

  const sendComment = async event => {
    event.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText("");
    try {
      await api(`/lives/${liveId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      loadFeed().catch(() => {});
    } catch (sendError) {
      setText(body);
      setGiftMessage(sendError.message);
    }
  };

  const gift = async amount => {
    setGiftMessage("");
    try {
      const result = await api(`/lives/${liveId}/stars`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
      setBalance(result.balance);
      loadFeed().catch(() => {});
    } catch (giftError) {
      setGiftMessage(giftError.message);
    }
  };

  const toggleTrack = kind => {
    const track = streamRef.current?.getTracks().find(item => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    kind === "audio" ? setMicOn(track.enabled) : setCamOn(track.enabled);
  };

  const endLive = async () => {
    if (!window.confirm("Terminar o direto para toda a gente?")) return;
    try {
      // Fecha primeiro a emissão WHIP (depois de terminar, o servidor já a teria cortado).
      if (whip.current) {
        const { pc, resource } = whip.current;
        whip.current = null;
        if (resource) await fetch(resource, { method: "DELETE" }).catch(() => {});
        pc.close();
      }
      await api(`/lives/${liveId}/end`, { method: "POST" });
      stopStream(streamRef.current);
      await loadLive();
    } catch (endError) {
      setError(endError.message);
    }
  };

  useEffect(() => { if (user && !isHost) api("/stars").then(result => setBalance(result.balance)).catch(() => {}); }, [user?.id, isHost]);

  if (error && !live) return <div className="page narrow"><div className="empty card">{error} <Link to="/live">Ver diretos</Link></div></div>;
  if (!live || !config) return <div className="page narrow"><div className="empty card">A abrir o direto...</div></div>;

  const needsLogin = !user && !cdn;
  const overlayText = {
    connecting: "A ligar ao direto...",
    publishing: "A enviar o vídeo para o servidor...",
    reconnecting: "A ligação falhou. A tentar outra vez...",
    waiting: isHost ? "À espera do sinal do OBS. Carrega em «Iniciar transmissão» no programa." : "À espera do vídeo de quem emite...",
    failed: isHost ? "Não foi possível enviar o vídeo. Verifica a internet e recarrega a página." : "Não foi possível receber o vídeo nesta rede. O chat e as estrelas continuam a funcionar.",
    full: "O vídeo chegou ao limite de espectadores deste servidor. Continua no chat.",
    unsupported: "Este browser não consegue tocar o direto. Atualiza-o ou usa o Chrome.",
    "no-camera": "Não foi possível abrir a câmara. Autoriza o acesso e recarrega a página."
  }[videoState];
  const signal = studio.signal;
  const stats = studio.stats;

  return <div className="live-room">
    <Link className="page-back" to="/live"><Icon name="previous" size={18} /> Todos os diretos</Link>
    <div className="live-layout">
      <section className="live-stage">
        <div className={`live-video${ended ? " is-ended" : ""}`}>
          <video ref={videoRef} autoPlay playsInline muted={(isHost && !fromObs) || muted} />
          {ended ? <div className="live-overlay is-ended">
            <Avatar user={live} size="large" />
            <strong>O direto terminou</strong>
            <span>{formatCount(live.peak_viewers)} {live.peak_viewers === 1 ? "pessoa viu" : "pessoas viram"} ao mesmo tempo · {formatCount(live.unique_viewers)} no total · {formatCount(live.stars)} estrelas</span>
            <Link className="btn" to={`/u/${live.username}`}>Ver perfil de {live.display_name}</Link>
          </div> : needsLogin ? <div className="live-overlay"><strong>Entra na tua conta para ver o direto.</strong><Link className="btn" to="/login">Entrar</Link></div>
            : overlayText && videoState !== "live" && <div className="live-overlay">{["connecting", "publishing", "reconnecting", "waiting"].includes(videoState) && <span className="payment-spinner" aria-hidden="true" />}<span>{overlayText}</span>
              {videoState === "failed" && !isHost && !cdn && <button className="btn secondary" type="button" onClick={() => connectViewer()}>Tentar outra vez</button>}</div>}
          {!ended && <div className="live-topbar">
            <LiveBadge />
            <span className="live-chip"><Icon name="eye" size={14} /> {formatCount(live.viewers)}</span>
            <span className="live-chip">{liveDuration(live.started_at)}</span>
            <span className="live-chip live-chip-stars"><Icon name="star" size={14} /> {formatCount(live.stars)}</span>
          </div>}
          <div className="live-floats" aria-hidden="true">
            {floats.map(item => <span key={item.id} className={`live-float is-${item.kind}`} style={{ "--x": `${item.x}px`, "--drift": `${item.drift}px` }}><Icon name={item.kind} size={26} /></span>)}
          </div>
          {!ended && user && !isHost && <div className="live-reactions" role="group" aria-label="Reagir">
            {LIVE_REACTIONS.map(([kind, label]) => <button key={kind} type="button" className={`is-${kind}`} aria-label={label} title={label} onClick={() => react(kind)}><Icon name={kind} size={22} /></button>)}
          </div>}
          {!ended && (!isHost || fromObs) && videoState === "live" && <button className="live-sound" type="button" onClick={() => setMuted(value => !value)} aria-pressed={!muted}>
            <Icon name={muted ? "volumeOff" : "volumeOn"} size={18} /> {muted ? "Ativar som" : "Som ligado"}</button>}
          {isHost && !ended && <div className="live-controls">
            {!fromObs && <>
              <button type="button" className={micOn ? "" : "is-off"} onClick={() => toggleTrack("audio")} aria-pressed={!micOn} aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}><Icon name={micOn ? "mic" : "micOff"} size={20} /></button>
              <button type="button" className={camOn ? "" : "is-off"} onClick={() => toggleTrack("video")} aria-pressed={!camOn} aria-label={camOn ? "Desligar câmara" : "Ligar câmara"}><Icon name={camOn ? "video" : "videoOff"} size={20} /></button>
            </>}
            <button type="button" className="live-end" onClick={endLive}><Icon name="stop" size={18} /> Terminar</button>
          </div>}
        </div>
        <div className="live-host">
          <Link to={`/u/${live.username}`}><Avatar user={live} size="large" /></Link>
          <div>
            <h1>{live.title}</h1>
            <p><Link className="post-author" to={`/u/${live.username}`}>{live.display_name}</Link><VerifiedBadge show={live.is_verified} />
              {live.category && <span className="live-category">{LIVE_CATEGORY_LABELS[live.category] || live.category}</span>}</p>
            {live.description && <p className="live-description">{live.description}</p>}
          </div>
        </div>
      </section>

      <aside className="live-side card">
        <div className="pages-tabs live-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat<span>{visibleComments.length}</span></button>
          <button type="button" role="tab" aria-selected={panel === "top"} onClick={() => setPanel("top")}>Apoiantes<span>{supporters.length}</span></button>
          {isHost && !ended && <button type="button" role="tab" aria-selected={panel === "studio"} onClick={() => setPanel("studio")}>Estúdio</button>}
        </div>
        {panel === "studio" && isHost ? <div className="live-studio-panel">
          <dl className="live-studio-stats">
            <div><dt>A ver agora</dt><dd>{formatCount(live.viewers)}</dd></div>
            <div><dt>Pico</dt><dd>{formatCount(stats?.peak ?? live.viewers)}</dd></div>
            <div><dt>Pessoas diferentes</dt><dd>{formatCount(stats?.unique ?? 0)}</dd></div>
            <div><dt>Estrelas</dt><dd>{formatCount(live.stars)}</dd></div>
          </dl>
          {cdn && <div className={`live-signal${signal?.ready ? " is-on" : ""}`}>
            <span className="live-dot" aria-hidden="true" />
            <span><strong>{signal?.ready ? "Sinal a chegar ao servidor" : "Sem sinal no servidor"}</strong>
              <small>{signal?.ready ? `${signal.width && signal.height ? `${signal.width}×${signal.height} · ` : ""}${formatCount(signal.kbps)} kbps` : fromObs ? "Inicia a transmissão no OBS." : "A ligar..."}</small></span>
          </div>}
          {fromObs ? <>
            <h3>Ligação do OBS</h3>
            <StreamKeyPanel />
          </> : <div className="live-studio-devices">
            <label>Vídeo
              <select value={settings.videoId} onChange={event => switchSource({ videoId: event.target.value, kind: "camera" })}>
                <option value="">Câmara predefinida</option>
                {devices.video.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Câmara ${index + 1}`}</option>)}
              </select>
            </label>
            <label>Som
              <select value={settings.audioId} onChange={event => switchSource({ audioId: event.target.value })}>
                <option value="">Microfone predefinido</option>
                {devices.audio.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}
              </select>
            </label>
            <LiveAudioMeters stream={hostStream} original={settings.originalAudio} />
            <label className="live-switch">
              <input type="checkbox" checked={settings.originalAudio} onChange={event => switchSource({ originalAudio: event.target.checked })} />
              <span><strong>Som original</strong><small>Sem cancelamento de eco nem redução de ruído.</small></span>
            </label>
            <button type="button" className="btn secondary" onClick={() => switchSource({ kind: "screen" })}><Icon name="devices" size={15} /> Partilhar ecrã</button>
            {settings.kind === "screen" && <button type="button" className="btn secondary" onClick={() => switchSource({ kind: "camera" })}><Icon name="video" size={15} /> Voltar à câmara</button>}
          </div>}
          <LiveModerators />
          {!cdn && <p className="muted">Neste servidor o vídeo vai diretamente do teu browser para até {config.maxVideoViewers || 8} pessoas. Com o servidor de vídeo configurado, não há limite.</p>}
        </div> : panel === "chat" ? <>
          {pinned && <div className="live-pinned">
            <Icon name="pin" size={15} />
            <span><strong>{pinned.display_name || "Alguém"}</strong> {pinned.body}</span>
            {myRole && !ended && <button type="button" className="live-chat-action" aria-label="Desafixar mensagem" title="Desafixar" onClick={() => moderate("unpin")}><Icon name="unpin" size={15} /></button>}
          </div>}
          <ol className="live-chat" ref={chatRef} aria-live="polite">
            {!visibleComments.length && <li className="live-chat-empty">Ainda não há mensagens. Diz olá!</li>}
            {visibleComments.map(comment => {
              const role = roleOf(comment.username);
              const canAct = myRole && !ended && !comment.stars && comment.username && (myRole === "host" || role !== "host");
              return <li key={comment.id} className={comment.stars ? "is-gift" : ""}>
                <Avatar user={comment} size="tiny" />
                <span><strong>{comment.display_name || "Alguém"}</strong>
                  {role && <span className={`live-role is-${role}`}>{role === "host" ? "Anfitrião" : "Moderador"}</span>}{" "}
                  {comment.stars ? <span className="live-gift-text"><Icon name="star" size={13} /> {comment.body}</span> : comment.body}</span>
                {canAct && <span className="live-chat-actions">
                  <button type="button" className="live-chat-action" aria-label={`Fixar mensagem de ${comment.display_name}`} title="Fixar" onClick={() => moderate("pin", comment)}><Icon name="pin" size={14} /></button>
                  <button type="button" className="live-chat-action" aria-label={`Apagar mensagem de ${comment.display_name}`} title="Apagar" onClick={() => moderate("delete", comment)}><Icon name="trash" size={14} /></button>
                  {!role && <button type="button" className="live-chat-action" aria-label={`Silenciar ${comment.display_name} durante 10 minutos`} title="Silenciar 10 min" onClick={() => moderate("mute", comment)}><Icon name="silence" size={14} /></button>}
                </span>}
              </li>;
            })}
          </ol>
          {!user && !ended && <p className="live-chat-login"><Link to="/login">Entra</Link> para conversar e oferecer estrelas.</p>}
          {user && !ended && <>
            {!isHost && <div className="live-gifts">
              {(config.giftAmounts || []).map(amount => <button key={amount} type="button" onClick={() => gift(amount)} disabled={balance !== null && balance < amount}><Icon name="star" size={13} /> {amount}</button>)}
              <Link to="/estrelas" className="live-balance">{balance === null ? "" : `Saldo: ${formatCount(balance)}`}</Link>
            </div>}
            {giftMessage && <p className="live-gift-message" role="status">{giftMessage}</p>}
            <form className="live-chat-form" onSubmit={sendComment}>
              <input value={text} maxLength={300} onChange={event => setText(event.target.value)} placeholder="Escreve no chat..." aria-label="Mensagem para o chat" />
              <button className="round-button" type="submit" aria-label="Enviar" disabled={!text.trim()}><Icon name="send" size={17} /></button>
            </form>
          </>}
        </> : <ol className="supporters-list live-top">
          {!supporters.length && <li className="live-chat-empty">Ainda ninguém ofereceu estrelas neste direto.</li>}
          {supporters.map((person, index) => <li key={person.username}>
            <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
            <Avatar user={person} size="tiny" />
            <Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link>
            <span className="supporter-stars"><Icon name="star" size={13} /> {formatCount(person.stars)}</span>
          </li>)}
        </ol>}
      </aside>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Amigos, Eventos e Notificações (mesma linguagem das Páginas e Grupos)
// ---------------------------------------------------------------------------------------------
function PeopleCard({ person, children, subtitle }) {
  return <article className="person-card card">
    <Link to={`/u/${person.username}`} className="person-card-avatar"><Avatar user={person} size="large" /></Link>
    <Link className="person-card-name" to={`/u/${person.username}`}>{person.display_name}</Link>
    <small>{subtitle || `@${person.username}`}</small>
    <div className="person-card-actions">{children}</div>
  </article>;
}

function Friends() {
  const { user } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("requests");
  const [sent, setSent] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);

  const load = async () => {
    try {
      const result = await api("/friends");
      setData(result);
      setError("");
      if (!result.requests.length) setTab(current => current === "requests" ? "suggestions" : current);
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { if (user) load(); }, [user?.id]);

  // Procurar pessoas por nome (com uma pequena pausa enquanto se escreve).
  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); return undefined; }
    const timer = window.setTimeout(() => api(`/users/search?q=${encodeURIComponent(term)}`).then(result => setResults(result.users)).catch(() => setResults([])), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const sendRequest = async person => {
    setSent(current => new Set(current).add(person.id));
    try {
      await api(`/friends/${person.id}/request`, { method: "POST" });
    } catch (requestError) {
      setSent(current => { const next = new Set(current); next.delete(person.id); return next; });
      setError(requestError.message);
    }
  };

  const answer = async (request, action) => {
    setData(current => ({
      ...current,
      requests: current.requests.filter(item => item.id !== request.id),
      friends: action === "accept" ? [...current.friends, { id: request.user_id, username: request.username, display_name: request.display_name, avatar_url: request.avatar_url }] : current.friends
    }));
    try {
      await api(`/friends/requests/${request.id}/${action}`, { method: "POST" });
    } catch (answerError) {
      setError(answerError.message);
      load();
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver os teus amigos. <Link to="/login">Entrar</Link></div></div>;

  const friendIds = new Set((data?.friends || []).map(friend => friend.id));
  const addButton = person => friendIds.has(person.id)
    ? <Link className="btn secondary" to={`/messages/${person.id}`}><Icon name="messages" size={15} /> Mensagem</Link>
    : sent.has(person.id)
      ? <button className="btn secondary" type="button" disabled><Icon name="check" size={15} /> Pedido enviado</button>
      : <button className="btn" type="button" onClick={() => sendRequest(person)}><Icon name="friends" size={15} /> Adicionar</button>;

  const tabs = [["requests", "Pedidos", data?.requests.length || 0], ["suggestions", "Sugestões", data?.suggestions.length || 0], ["friends", "Os teus amigos", data?.friends.length || 0]];

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Amigos</h1><p>Responde a pedidos, encontra pessoas que conheces e fala com os teus amigos.</p></div>
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Amigos">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={!results && tab === id} onClick={() => { setTab(id); setQuery(""); }}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar pessoas" aria-label="Procurar pessoas" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A carregar...</div>}
    {results && (results.length
      ? <div className="people-grid">{results.map(person => <PeopleCard key={person.id} person={person}>{addButton(person)}</PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ninguém com esse nome. Experimenta o nome de utilizador (sem @).</p></div>)}
    {!results && data && tab === "requests" && (data.requests.length
      ? <div className="people-grid">{data.requests.map(request => <PeopleCard key={request.id} person={request} subtitle={`Pediu ${relativeTime(request.created_at)}`}>
        <button className="btn" type="button" onClick={() => answer(request, "accept")}><Icon name="check" size={15} /> Confirmar</button>
        <button className="btn secondary" type="button" onClick={() => answer(request, "reject")}>Recusar</button>
      </PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Não tens pedidos de amizade por responder.</p><button className="btn secondary" type="button" onClick={() => setTab("suggestions")}>Ver sugestões</button></div>)}
    {!results && data && tab === "suggestions" && (data.suggestions.length
      ? <div className="people-grid">{data.suggestions.map(person => <PeopleCard key={person.id} person={person}>{addButton(person)}</PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ainda não há sugestões. Convida os teus amigos para o Biva.</p><Link className="btn" to="/convidar"><Icon name="gift" size={15} /> Convidar amigos</Link></div>)}
    {!results && data && tab === "friends" && (data.friends.length
      ? <div className="people-grid">{data.friends.map(person => <PeopleCard key={person.id} person={person}>
        <Link className="btn secondary" to={`/messages/${person.id}`}><Icon name="messages" size={15} /> Mensagem</Link>
      </PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ainda não tens amigos no Biva. Começa pelas sugestões.</p><button className="btn" type="button" onClick={() => setTab("suggestions")}>Ver sugestões</button></div>)}
  </div>;
}

// ----- Eventos -----
const eventDay = value => new Date(value).toLocaleDateString("pt-PT", { day: "2-digit" });
const eventMonth = value => SHORT_MONTHS[new Date(value).getMonth()];
const eventWhen = value => new Date(value).toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function EventDate({ value }) {
  return <span className="event-date-tile" aria-hidden="true"><strong>{eventDay(value)}</strong><small>{eventMonth(value)}</small></span>;
}

function CreateEventDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", startsAt: "", location: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated();
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const minDate = new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-event-title">Criar evento</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Feira de artesanato no Benfica" /></label>
          <label>Quando<input required type="datetime-local" min={minDate} value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} /></label>
          <label>Onde<input maxLength={160} value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Ex.: Mercado do Benfica, Luanda" /></label>
          <label>Detalhes <small>{form.description.length}/2000</small><textarea rows={3} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="O que vai acontecer e o que as pessoas devem levar." /></label>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="event-card card is-preview">
            {form.startsAt ? <EventDate value={form.startsAt} /> : <span className="event-date-tile" aria-hidden="true"><strong>--</strong><small>mês</small></span>}
            <div className="event-card-body"><strong>{form.name || "Nome do evento"}</strong><small>{form.startsAt ? eventWhen(form.startsAt) : "Data e hora"}</small>{form.location && <small><Icon name="location" size={13} /> {form.location}</small>}</div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.startsAt}>{busy ? "A criar..." : "Criar evento"}</button>
      </div>
    </form>
  </div>, document.body);
}

function Events() {
  const { user } = useContext(UserContext);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("upcoming");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setEvents((await api("/events")).events);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { load(); }, [user?.id]);

  const toggleRsvp = async item => {
    const going = !item.is_attending;
    const apply = (value, delta) => setEvents(current => current.map(event => event.id === item.id ? { ...event, is_attending: value, attendee_count: event.attendee_count + delta } : event));
    apply(going, going ? 1 : -1);
    try {
      await api(`/events/${item.id}/rsvp`, { method: "POST" });
    } catch (rsvpError) {
      apply(!going, going ? -1 : 1);
      setError(rsvpError.message);
    }
  };

  const deleteEvent = async item => {
    if (!window.confirm(`Apagar o evento «${item.name}»? Os participantes deixam de o ver.`)) return;
    try {
      await api(`/events/${item.id}`, { method: "DELETE" });
      setEvents(current => current.filter(event => event.id !== item.id));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const all = events || [];
  const going = all.filter(item => item.is_attending);
  const mine = all.filter(item => user && String(item.creator_id) === String(user.id));
  const tabs = [["upcoming", "Próximos", all.length], ...(user ? [["going", "Vou", going.length], ["mine", "Organizados por ti", mine.length]] : [])];
  const visible = tab === "going" ? going : tab === "mine" ? mine : all;

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Eventos</h1><p>Descobre o que acontece perto de ti, confirma presença ou organiza o teu.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button> : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que eventos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!events && !error && <div className="empty card">A carregar eventos...</div>}
    {events && !visible.length && <div className="empty card pages-empty">
      <p>{tab === "going" ? "Ainda não confirmaste presença em nenhum evento." : tab === "mine" ? "Ainda não organizaste nenhum evento." : "Não há eventos marcados para os próximos dias."}</p>
      {user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button>}
    </div>}
    {visible.length > 0 && <div className="event-list">{visible.map(item => <article className="event-card card" key={item.id}>
      <EventDate value={item.starts_at} />
      <div className="event-card-body">
        <h2>{item.name}</h2>
        <small><Icon name="events" size={13} /> {eventWhen(item.starts_at)}</small>
        {item.location && <small><Icon name="location" size={13} /> {item.location}</small>}
        {item.description && <p>{item.description}</p>}
        <small className="event-meta">{formatCount(item.attendee_count)} {item.attendee_count === 1 ? "pessoa vai" : "pessoas vão"} · organizado por <Link to={`/u/${item.creator_username}`}>{item.creator_name}</Link></small>
      </div>
      {user && <div className="event-card-actions">
        <button className={`btn${item.is_attending ? " secondary page-following" : ""}`} type="button" aria-pressed={item.is_attending} onClick={() => toggleRsvp(item)}>
          {item.is_attending ? <><Icon name="check" size={15} /><span className="when-idle">Vou</span><span className="when-hover">Já não vou</span></> : <><Icon name="plus" size={15} /> Vou participar</>}
        </button>
        {String(item.creator_id) === String(user.id) && <button className="btn secondary danger-text icon-only" type="button" aria-label={`Apagar ${item.name}`} title="Apagar" onClick={() => deleteEvent(item)}><Icon name="trash" size={16} /></button>}
      </div>}
    </article>)}</div>}
    {creating && <CreateEventDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("mine"); load(); }} />}
  </div>;
}

// ----- Notificações -----
const NOTIFICATION_ICONS = {
  like: ["heart", "coral"], comment: ["messages", "ceu"], message: ["messages", "ceu"], friend_request: ["friends", "lagoa"], friend_accept: ["friends", "lagoa"],
  follow: ["profile", "lagoa"], group_join: ["groups", "lagoa"], event_rsvp: ["events", "coral"], share: ["share", "ceu"],
  stars: ["star", "coral"], campaign: ["brand", "lagoa"], challenge: ["trophy", "coral"], referral: ["gift", "coral"],
  ad: ["ad", "coral"], payout: ["gift", "lagoa"], live: ["live", "coral"], moderation: ["shield", "tinta"]
};

function notificationGroup(value) {
  const date = new Date(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (today - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000;
  return diff <= 0 ? "Hoje" : diff === 1 ? "Ontem" : diff < 7 ? "Esta semana" : "Antes";
}

function Notifications() {
  const { user, refreshUser } = useContext(UserContext);
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = async () => {
    try {
      setNotifications((await api("/notifications")).notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { if (user) load(); }, [user?.id]);

  const open = async item => {
    if (!item.read) {
      setNotifications(current => current.map(entry => entry.id === item.id ? { ...entry, read: true } : entry));
      api(`/notifications/${item.id}/read`, { method: "POST" }).then(refreshUser).catch(() => {});
    }
    if (item.type === "live" && item.actor_username) return navigate("/live");
    if (["campaign"].includes(item.type)) return navigate("/creator/parcerias");
    if (["payout"].includes(item.type)) return navigate("/creator/ganhos");
    if (["ad"].includes(item.type)) return navigate("/creator/anuncios");
    if (["stars", "referral", "challenge"].includes(item.type)) return navigate("/estrelas");
    if (item.actor_username) navigate(`/u/${item.actor_username}`);
  };

  const markAllRead = async () => {
    setNotifications(current => current.map(entry => ({ ...entry, read: true })));
    try {
      await api("/notifications/read-all", { method: "POST" });
      await refreshUser();
    } catch (readError) {
      setError(readError.message);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver as notificações. <Link to="/login">Entrar</Link></div></div>;
  const unread = (notifications || []).filter(item => !item.read).length;
  const visible = (notifications || []).filter(item => !onlyUnread || !item.read);
  const groups = visible.reduce((list, item) => {
    const label = notificationGroup(item.created_at);
    const group = list.find(entry => entry.label === label);
    group ? group.items.push(item) : list.push({ label, items: [item] });
    return list;
  }, []);

  return <div className="pages-view notifications-view">
    <header className="pages-head">
      <div><h1>Notificações</h1><p>{unread ? `Tens ${formatCount(unread)} ${unread === 1 ? "notificação por ler" : "notificações por ler"}.` : "Estás em dia."}</p></div>
      {unread > 0 && <button className="btn secondary" type="button" onClick={markAllRead}><Icon name="check" size={15} /> Marcar todas como lidas</button>}
    </header>
    <div className="pages-tabs notification-tabs" role="tablist" aria-label="Filtrar notificações">
      <button type="button" role="tab" aria-selected={!onlyUnread} onClick={() => setOnlyUnread(false)}>Todas<span>{(notifications || []).length}</span></button>
      <button type="button" role="tab" aria-selected={onlyUnread} onClick={() => setOnlyUnread(true)}>Por ler<span>{unread}</span></button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!notifications && !error && <div className="empty card">A carregar...</div>}
    {notifications && !visible.length && <div className="empty card pages-empty"><span className="group-lock-icon"><Icon name="notifications" size={26} /></span><p>{onlyUnread ? "Não tens notificações por ler." : "Ainda não tens notificações. Quando alguém interagir contigo, aparece aqui."}</p></div>}
    {groups.map(group => <section key={group.label} className="notification-group card" aria-label={group.label}>
      <h2>{group.label}</h2>
      <ul>{group.items.map(item => {
        const [icon, tone] = NOTIFICATION_ICONS[item.type] || ["notifications", "lagoa"];
        return <li key={item.id}>
          <button type="button" className={`notification-row${item.read ? "" : " is-unread"}`} onClick={() => open(item)}>
            <span className="notification-avatar">
              <Avatar user={{ display_name: item.actor_name || "Biva", avatar_url: item.actor_avatar }} />
              <span className={`notification-type tone-page-${tone}`}><Icon name={icon} size={12} /></span>
            </span>
            <span className="notification-text"><span><strong>{item.actor_name || "Biva"}</strong> {item.text}</span><small>{relativeTime(item.created_at)}</small></span>
            {!item.read && <span className="notification-unread-dot" aria-label="Por ler" />}
          </button>
        </li>;
      })}</ul>
    </section>)}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Páginas informativas
// ---------------------------------------------------------------------------------------------

const INFO_LINKS = [["/about", "Sobre"], ["/help", "Ajuda"], ["/terms", "Termos"], ["/privacy", "Privacidade"], ["/publicidade", "Publicidade"]];

function InfoLinks() {
  return <nav className="info-links" aria-label="Informação">
    {INFO_LINKS.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
    <span>© {new Date().getFullYear()} Biva</span>
  </nav>;
}

function InfoPage({ kicker, title, intro, draft, children }) {
  useEffect(() => { window.scrollTo(0, 0); }, [title]);
  return <article className="page narrow info-page">
    <header className="info-header">
      <p className="feed-section-kicker">{kicker}</p>
      <h1>{title}</h1>
      {intro && <p className="info-intro">{intro}</p>}
      {draft && <p className="info-draft" role="note"><Icon name="info" size={15} /> Rascunho: este texto tem de ser revisto por um jurista antes de o Biva abrir ao público.</p>}
    </header>
    <div className="info-body card">{children}</div>
    <InfoLinks />
  </article>;
}

function About() {
  return <InfoPage kicker="Sobre" title="Conecta. Partilha. Vive."
    intro="O Biva é o lugar para estares perto de quem importa: as tuas pessoas, as tuas ideias e a tua comunidade, num espaço seguro e teu.">
    <img className="about-logo" src="/biva-logo-full.png" alt="Biva — conecta, partilha, vive" />
    <h2>O que podes fazer no Biva</h2>
    <ul>
      <li><strong>Partilhar momentos</strong> com texto, fotografias, vídeos e stories que desaparecem em 24 horas.</li>
      <li><strong>Estar perto de quem importa</strong>: amigos, pessoas que segues, grupos, páginas e eventos.</li>
      <li><strong>Conversar</strong> em mensagens privadas.</li>
      <li><strong>Apoiar criadores</strong> com subscrições mensais que dão acesso a conteúdo exclusivo.</li>
    </ul>
    <h2>Como cuidamos do bairro</h2>
    <p>Qualquer pessoa pode bloquear contas e denunciar publicações, comentários ou perfis. A equipa de moderação analisa as denúncias e pode esconder conteúdo ou suspender contas que não respeitem os <Link to="/terms">Termos</Link>.</p>
    <p>Os teus dados são teus: podes descarregá-los ou apagar a conta a qualquer momento em <Link to="/settings/conta">Definições → Conta</Link>. Lê a <Link to="/privacy">Política de Privacidade</Link> para saber o que guardamos.</p>
  </InfoPage>;
}

const HELP_TOPICS = [
  ["Conta", [
    ["Não recebi o email de confirmação.", "Procura na pasta de spam. No ecrã de entrada, depois de tentares iniciar sessão, aparece a opção «Reenviar confirmação de email». A ligação é válida durante 1 hora."],
    ["Esqueci-me da palavra-passe.", "Em «Entrar», escolhe «Esqueceste-te da palavra-passe?». Recebes uma ligação válida durante 1 hora. Ao mudar a palavra-passe, todas as sessões abertas noutros dispositivos terminam."],
    ["Como mudo a foto de perfil ou a capa?", "Em Definições → A tua conta, usa «Foto de perfil» e «Capa do perfil». Aceitamos JPG, PNG, WebP e GIF até 8 MB."],
    ["Como apago a minha conta?", "Em Definições → A tua conta → Apagar conta. Pedimos a palavra-passe para confirmar. Apagamos o perfil, publicações, comentários, mensagens e os grupos e páginas que criaste, e cancelamos as subscrições pagas. Antes disso, podes descarregar os teus dados."]
  ]],
  ["Publicações e feed", [
    ["Qual é a diferença entre «Para ti» e «Amigos e quem segues»?", "«Para ti» mostra publicações de toda a comunidade. «Amigos e quem segues» mostra só as tuas, as dos teus amigos, as de quem segues e as das páginas e grupos de que fazes parte."],
    ["Posso editar uma publicação?", "Sim: no menu (⋯) da tua publicação, escolhe «Editar». A publicação passa a mostrar «editado»."],
    ["Quem vê as publicações exclusivas?", "Só quem tem uma subscrição ativa do criador. Os criadores marcam «Só para subscritores» ao publicar."]
  ]],
  ["Segurança", [
    ["O que acontece quando bloqueio alguém?", "Deixam de ser amigos e de se seguir. Não veem as publicações, comentários e stories um do outro, e não podem trocar mensagens. A pessoa não é avisada. Podes desbloquear em Definições."],
    ["Como denuncio conteúdo?", "Usa o menu (⋯) de uma publicação, o ícone de bandeira num comentário ou o menu de um perfil. Quem é denunciado não sabe quem fez a denúncia."],
    ["Alguém está em perigo.", "Se houver perigo imediato, contacta as autoridades locais primeiro. Depois denuncia o conteúdo para a equipa de moderação o analisar."]
  ]],
  ["Subscrições", [
    ["Como cancelo uma subscrição?", "No perfil do criador, escolhe «Cancelar renovação». Manténs o acesso até ao fim do período que já pagaste."],
    ["Como defino o meu preço como criador?", "No teu perfil, toca em Editar perfil e indica o preço mensal em kwanzas (entre 500 Kz e 500 000 Kz)."]
  ]]
];

function Help() {
  return <InfoPage kicker="Ajuda" title="Como podemos ajudar?" intro="Respostas rápidas às perguntas mais comuns.">
    {HELP_TOPICS.map(([topic, questions]) => <section key={topic} className="help-topic">
      <h2>{topic}</h2>
      {questions.map(([question, answer]) => <details key={question}>
        <summary>{question}</summary>
        <p>{answer}</p>
      </details>)}
    </section>)}
  </InfoPage>;
}

function Terms() {
  return <InfoPage kicker="Termos" title="Termos de utilização" draft
    intro="As regras para vivermos bem no bairro. Ao criar uma conta, aceitas estes termos.">
    <h2>1. A tua conta</h2>
    <p>Precisas de um email válido, de dados verdadeiros e de ter pelo menos 13 anos. És responsável pela segurança da tua palavra-passe e pelo que é publicado com a tua conta. Não podes fazer-te passar por outra pessoa nem criar contas para obter vantagens (por exemplo, prémios de convites).</p>
    <h2>2. O teu conteúdo</h2>
    <p>O que publicas continua a ser teu. Ao publicar, dás ao Biva autorização para alojar e mostrar esse conteúdo às pessoas que o podem ver, enquanto ele estiver publicado — incluindo quando alguém o partilha. Só podes publicar conteúdo sobre o qual tens direitos.</p>
    <h2>3. O que não é permitido</h2>
    <ul>
      <li>Assédio, ameaças, discurso de ódio ou incitamento à violência.</li>
      <li>Conteúdo sexual envolvendo menores, em qualquer circunstância.</li>
      <li>Conteúdo sexual explícito fora de contextos permitidos, ou partilhado sem consentimento.</li>
      <li>Spam, burlas, publicidade enganosa ou contas falsas.</li>
      <li>Comprar ou trocar gostos, seguidores ou visualizações, ou manipular desafios.</li>
      <li>Partilhar dados pessoais de outras pessoas sem autorização.</li>
      <li>Tentar aceder a contas ou dados de terceiros, ou perturbar o funcionamento do serviço.</li>
    </ul>
    <h2>4. Moderação</h2>
    <p>Podemos esconder conteúdo, apagar comentários ou suspender contas que violem estes termos. As decisões são tomadas pela equipa de moderação a partir das denúncias da comunidade.</p>
    <h2>5. Pagamentos</h2>
    <p>Os pagamentos são processados por prestadores de pagamento externos; o Biva nunca vê os dados do teu cartão. Os preços são em kwanzas (Kz).</p>
    <ul>
      <li><strong>Subscrições:</strong> mensais, renovam-se automaticamente até serem canceladas. Ao cancelar, manténs o acesso até ao fim do período pago. O conteúdo exclusivo é da responsabilidade de cada criador.</li>
      <li><strong>Estrelas:</strong> compram-se em pacotes e servem para apoiar criadores. As estrelas compradas não são reembolsáveis nem convertíveis em dinheiro por quem as comprou.</li>
      <li><strong>Promoções e anúncios:</strong> pagas antes de serem revistas. Se a equipa recusar uma promoção, o valor é devolvido. O orçamento é gasto à medida que as pessoas veem a promoção; o que não for gasto até ao fim do prazo não é devolvido. Aplicam-se as <Link to="/publicidade">Regras de publicidade</Link>.</li>
      <li><strong>Campanhas com marcas:</strong> a marca paga através do Biva quando o criador aceita a proposta. O Biva fica com 15%.</li>
    </ul>
    <h2>6. Ganhos dos criadores</h2>
    <p>Os criadores podem ganhar dinheiro com o Programa de Parceiros (a partir de 10 000 seguidores e 10 000 visualizações em 28 dias), com as estrelas recebidas (70% do valor) e com campanhas de marcas (85% do valor). Os ganhos podem ser levantados por transferência bancária a partir de 5 000 Kz. Ganhos obtidos com fraude (visualizações, seguidores ou estrelas falsas) podem ser anulados, e a conta suspensa.</p>
    <h2>7. Fim da conta</h2>
    <p>Podes apagar a conta quando quiseres, em Definições. Podemos encerrar contas que violem estes termos de forma grave ou repetida. Os registos de pagamentos e levantamentos são guardados durante o prazo exigido pela lei, mesmo depois de a conta ser apagada.</p>
    <h2>8. Alterações</h2>
    <p>Se mudarmos estes termos, avisamos na aplicação antes de as alterações entrarem em vigor.</p>
  </InfoPage>;
}

function Privacy() {
  return <InfoPage kicker="Privacidade" title="Política de privacidade" draft
    intro="O que guardamos, para quê e como podes controlar os teus dados.">
    <h2>Dados que recolhemos</h2>
    <ul>
      <li><strong>Conta:</strong> email, nome de utilizador, nome público e palavra-passe (guardada apenas como hash, nunca em texto).</li>
      <li><strong>Perfil:</strong> biografia, foto, capa, profissão, localidade e site, se os preencheres. São públicos.</li>
      <li><strong>Província e data de nascimento</strong> (opcionais): só servem para te mostrar promoções da tua zona e idade. Nunca são públicas. A província só é mostrada às marcas no marketplace se o autorizares, e a data de nascimento nunca é mostrada a ninguém — quem anuncia só escolhe uma faixa etária e nunca sabe quem viu a promoção.</li>
      <li><strong>Conteúdo e atividade:</strong> publicações, partilhas, comentários, gostos, stories, amizades, seguidores, grupos, páginas, eventos e mensagens privadas.</li>
      <li><strong>Visualizações:</strong> guardamos uma visita por dia quando vês um perfil ou uma publicação com sessão iniciada. Quem é visto só vê os números, nunca quem viu.</li>
      <li><strong>Denúncias e bloqueios</strong> que fazes ou de que és alvo.</li>
      <li><strong>Pagamentos:</strong> os dados do cartão são tratados pelo prestador de pagamentos e nunca passam pelos nossos servidores. Guardamos o estado de cada pagamento, as estrelas, as promoções e as campanhas.</li>
      <li><strong>Dados bancários dos criadores:</strong> o titular e o IBAN para receber levantamentos. O IBAN é guardado cifrado e só é visto, completo, pela equipa financeira no momento de fazer a transferência.</li>
    </ul>
    <h2>Para que os usamos</h2>
    <p>Para prestar o serviço (mostrar o teu perfil e conteúdo, entregar mensagens e notificações), para manter a comunidade segura (moderação e prevenção de fraude), para te mostrar as tuas estatísticas, para mostrar promoções e para pagar aos criadores. Não vendemos dados pessoais.</p>
    <h2>Promoções</h2>
    <p>As promoções que vês são escolhidas pelo orçamento de quem anuncia e, se o indicaste, pela tua província e idade. Quem anuncia vê apenas números agregados (alcance e cliques), nunca quem viu ou clicou.</p>
    <h2>Armazenamento no teu dispositivo</h2>
    <p>Guardamos no browser apenas a tua sessão e preferências (tema claro/escuro e o separador do feed). Não usamos cookies de publicidade nem de rastreio.</p>
    <h2>Quem vê o quê</h2>
    <p>O perfil e as publicações públicas são visíveis para a comunidade. As publicações de grupos só são visíveis para os membros, e as exclusivas só para subscritores. As mensagens privadas só são visíveis para quem participa na conversa.</p>
    <h2>Os teus direitos</h2>
    <ul>
      <li><strong>Acesso e portabilidade:</strong> Definições → Descarregar dados.</li>
      <li><strong>Retificação:</strong> Editar perfil (no teu perfil) e Definições → Privacidade → Província e idade.</li>
      <li><strong>Apagamento:</strong> Definições → Apagar conta. A conta e o conteúdo são apagados de imediato. Os registos de pagamentos e levantamentos são guardados durante o prazo legal. Podem ficar cópias de segurança durante um período limitado.</li>
    </ul>
    <h2>Contacto</h2>
    <p>Para questões de privacidade, contacta a equipa responsável pelo Biva. (Falta indicar aqui o contacto, o responsável pelo tratamento e o registo na Agência de Proteção de Dados.)</p>
  </InfoPage>;
}

function AdRules() {
  return <InfoPage kicker="Publicidade" title="Regras de publicidade" draft
    intro="O que pode e não pode ser promovido no Biva. Todas as promoções são revistas pela equipa antes de aparecerem.">
    <h2>Como funciona a revisão</h2>
    <p>Depois de pagares, a promoção fica <strong>em revisão</strong> (normalmente menos de 24 horas). Se for aprovada, entra no ar e o prazo começa a contar. Se for recusada, explicamos o motivo e devolvemos o valor pago.</p>
    <h2>Não é permitido promover</h2>
    <ul>
      <li>Tudo o que os <Link to="/terms">Termos de utilização</Link> já proíbem.</li>
      <li>Produtos ou serviços ilegais em Angola, armas, drogas, medicamentos sujeitos a receita, tabaco e produtos de vaping.</li>
      <li>Jogos de fortuna e azar e apostas sem licença válida em Angola.</li>
      <li>Esquemas de dinheiro fácil, pirâmides, "investimentos" com retornos garantidos e empréstimos sem condições claras.</li>
      <li>Bebidas alcoólicas dirigidas a menores de 18 anos (usa a segmentação por idade).</li>
      <li>Promessas de saúde ou de resultados que não podes provar.</li>
      <li>Imitar outra marca ou pessoa, ou usar logótipos sem autorização.</li>
    </ul>
    <h2>Boas práticas</h2>
    <ul>
      <li>Diz claramente o que estás a vender e o preço, quando existir.</li>
      <li>A ligação tem de levar à página prometida no anúncio.</li>
      <li>Usa imagens tuas ou com autorização.</li>
    </ul>
    <h2>Preço</h2>
    <p>Pagas pelo alcance: 500 Kz por cada 1000 pessoas alcançadas (mais 20% se escolheres província ou idade). Cada pessoa conta uma vez por dia, e só quando a promoção aparece mesmo no ecrã.</p>
  </InfoPage>;
}

const MODERATION_ACTION_LABELS = {
  dismiss: "Arquivar sem ação",
  hide_post: "Esconder publicação",
  restore_post: "Repor publicação",
  delete_comment: "Apagar comentário",
  suspend_user: "Suspender conta",
  unsuspend_user: "Reativar conta"
};

function Moderation() {
  const { user, authReady } = useContext(UserContext);
  const [status, setStatus] = useState("open");
  const [reports, setReports] = useState(null);
  const [reasons, setReasons] = useState({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setError("");
    try {
      const result = await api(`/admin/reports?status=${status}`);
      setReports(result.reports);
      setReasons(result.reasons);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { if (user?.is_admin) load(); }, [status, user?.is_admin]);

  const resolve = async (report, action) => {
    if (action === "suspend_user" && !window.confirm(`Suspender @${report.target_username}? A conta deixa de conseguir entrar.`)) return;
    setBusyId(report.id);
    setError("");
    try {
      await api(`/admin/reports/${report.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await load();
    } catch (resolveError) {
      setError(resolveError.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user?.is_admin) return <div className="page narrow"><div className="empty card">Esta área é só para a equipa de moderação.</div></div>;

  const actionsFor = report => {
    const list = ["dismiss"];
    if (report.target_type === "post") list.push(report.target_hidden ? "restore_post" : "hide_post");
    if (report.target_type === "comment" && report.target_excerpt !== null) list.push("delete_comment");
    if (report.target_user_id) list.push(report.target_suspended ? "unsuspend_user" : "suspend_user");
    return list;
  };

  return <div className="page narrow">
    <div className="feed-heading"><h1>Moderação</h1><p>Denúncias da comunidade. Resolver uma denúncia resolve todas as que estão abertas sobre o mesmo conteúdo.</p></div>
    <div className="moderation-tabs" role="group" aria-label="Estado das denúncias">
      {[["open", "Abertas"], ["resolved", "Resolvidas"], ["dismissed", "Arquivadas"]].map(([id, label]) =>
        <button key={id} className="btn secondary" type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {reports === null && !error && <div className="empty card">A carregar denúncias...</div>}
    {reports?.length === 0 && <div className="empty card">Não há denúncias {status === "open" ? "por analisar" : "neste estado"}.</div>}
    {reports?.map(report => <article className="report-card card" key={report.id}>
      <header>
        <strong>{{ post: "Publicação", comment: "Comentário", user: "Conta" }[report.target_type]} de {report.target_username ? <Link to={`/u/${report.target_username}`}>@{report.target_username}</Link> : "conta apagada"}</strong>
        <span className="meta">{new Date(report.created_at).toLocaleString("pt-PT")}</span>
      </header>
      <div className="meta">
        Motivo: <strong>{reasons[report.reason] || report.reason}</strong>
        {report.open_reports_on_target > 1 && <> · {report.open_reports_on_target} denúncias abertas sobre este conteúdo</>}
        {report.reporter_username && <> · denunciado por @{report.reporter_username}</>}
        {report.target_hidden && <> · <span className="hidden-badge">Escondida</span></>}
        {report.target_suspended && <> · <span className="hidden-badge">Conta suspensa</span></>}
      </div>
      {report.target_excerpt !== null && report.target_excerpt !== undefined
        ? <blockquote>{report.target_excerpt || "(sem texto)"}</blockquote>
        : <p className="meta">O conteúdo já não existe.</p>}
      {report.details && <p><strong>Detalhes:</strong> {report.details}</p>}
      {report.status === "open"
        ? <div className="report-actions">
          {actionsFor(report).map(action => <button key={action} type="button"
            className={`btn ${action === "dismiss" ? "secondary" : action === "suspend_user" ? "danger" : ""}`}
            disabled={busyId === report.id} onClick={() => resolve(report, action)}>{MODERATION_ACTION_LABELS[action]}</button>)}
        </div>
        : <p className="meta">Decisão: {MODERATION_ACTION_LABELS[report.action] || report.action} · {report.resolved_at && new Date(report.resolved_at).toLocaleString("pt-PT")}</p>}
    </article>)}
  </div>;
}

// Exportar dados (RGPD) e apagar conta.
function AccountDataControls() {
  const { refreshUser } = useContext(UserContext);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const exportData = async () => {
    setBusy("export");
    setError("");
    try {
      const response = await fetch(`${API}/auth/me/export`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível exportar os dados.");
      const blob = await response.blob();
      const match = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = match?.[1] || "biva-dados.json";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setBusy("");
    }
  };

  const deleteAccount = async event => {
    event.preventDefault();
    setBusy("delete");
    setError("");
    try {
      await api("/auth/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      localStorage.removeItem("token");
      await refreshUser();
      navigate("/", { replace: true });
    } catch (deleteError) {
      setError(deleteError.message);
      setBusy("");
    }
  };

  return <div className="prefs-stack">
    <div className="prefs-row">
      <span className="prefs-row-icon"><Icon name="layers" /></span>
      <span><strong>Descarregar uma cópia</strong><small>Descarrega um ficheiro com o teu perfil, publicações, comentários, mensagens e ligações.</small></span>
      <button className="prefs-link" type="button" disabled={!!busy} onClick={exportData}>{busy === "export" ? "A preparar..." : "Descarregar dados"}</button>
    </div>
    <div className="prefs-row">
      <span className="prefs-row-icon danger"><Icon name="trash" /></span>
      <span><strong>Apagar conta</strong><small>Apaga o perfil, publicações, comentários, mensagens, grupos e páginas que criaste. Cancela as subscrições pagas. Não pode ser desfeito.</small></span>
      {!confirming && <button className="prefs-link danger-text" type="button" onClick={() => setConfirming(true)}>Apagar conta</button>}
    </div>
    {confirming && <form className="prefs-form" onSubmit={deleteAccount}>
      <label>Escreve a tua palavra-passe para confirmar
        <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
      </label>
      <div className="prefs-form-foot">
        <button className="btn danger" type="submit" disabled={busy === "delete" || !password}>{busy === "delete" ? "A apagar..." : "Apagar definitivamente"}</button>
        <button className="btn secondary" type="button" disabled={busy === "delete"} onClick={() => { setConfirming(false); setPassword(""); setError(""); }}>Cancelar</button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

// Verificação em dois passos: estado → (ligar) QR + código → ativa → (desligar) palavra-passe + código.
function TwoFactorSettings() {
  const [status, setStatus] = useState(null);       // { enabled, required }
  const [setup, setSetup] = useState(null);         // { qr, secret } enquanto se configura
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { api("/auth/2fa").then(setStatus).catch(() => {}); }, []);

  const run = async action => {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); } catch (actionError) { setError(actionError.message); } finally { setBusy(false); }
  };

  const start = () => run(async () => { setSetup(await api("/auth/2fa/setup", { method: "POST" })); setCode(""); });
  const confirm = event => {
    event.preventDefault();
    run(async () => {
      const result = await api("/auth/2fa/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      setSetup(null);
      setStatus(current => ({ ...current, enabled: true }));
      setNotice(result.message);
    });
  };
  const turnOff = event => {
    event.preventDefault();
    run(async () => {
      const result = await api("/auth/2fa/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, code }) });
      setDisabling(false);
      setPassword("");
      setCode("");
      setStatus(current => ({ ...current, enabled: false }));
      setNotice(result.message);
    });
  };
  const codeInput = <label>Código de 6 dígitos<input className="two-factor-input" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}
    value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>;

  if (!status) return null;
  return <div className="two-factor">
    <div className="prefs-row">
      <span className={`prefs-row-icon${status.enabled ? " is-on" : ""}`}><Icon name="shield" /></span>
      <span>
        <strong>Verificação em dois passos {status.enabled && <em className="two-factor-on">Ativa</em>}</strong>
        <small>{status.enabled
          ? "Ao entrar, pedimos a palavra-passe e um código da tua app de autenticação."
          : status.required
            ? "Obrigatória para administradores: sem ela não abres o painel de administração."
            : "Mesmo que alguém descubra a tua palavra-passe, não entra sem o código do teu telemóvel."}</small>
      </span>
      {status.enabled
        ? <button className="prefs-link" type="button" onClick={() => { setDisabling(!disabling); setError(""); setCode(""); }}>{disabling ? "Cancelar" : "Desligar"}</button>
        : !setup && <button className="prefs-link" type="button" disabled={busy} onClick={start}>{busy ? "A preparar..." : "Ativar"} <Icon name="shield" size={14} /></button>}
    </div>
    {setup && <form className="prefs-form two-factor-setup" onSubmit={confirm}>
      <img className="two-factor-qr" src={setup.qr} width="180" height="180" alt="Código QR para adicionar o Biva à app de autenticação" />
      <div className="two-factor-steps">
        <p><strong>1.</strong> Instala uma app de autenticação no telemóvel: Google Authenticator, Microsoft Authenticator ou Authy.</p>
        <p><strong>2.</strong> Na app, toca em adicionar e lê este código QR. Se não conseguires, escreve esta chave:</p>
        <code className="two-factor-secret">{setup.secret.match(/.{1,4}/g).join(" ")}</code>
        <p><strong>3.</strong> Escreve o código que a app mostra para confirmar.</p>
        {codeInput}
        <div className="prefs-form-foot">
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>{busy ? "A confirmar..." : "Confirmar e ativar"}</button>
          <button className="btn secondary" type="button" onClick={() => setSetup(null)}>Cancelar</button>
        </div>
      </div>
    </form>}
    {disabling && <form className="prefs-form" onSubmit={turnOff}>
      <label>Palavra-passe<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {codeInput}
      <div className="prefs-form-foot"><button className="btn danger" type="submit" disabled={busy || code.length !== 6}>{busy ? "A desligar..." : "Desligar verificação"}</button></div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
  </div>;
}

// Segurança da conta: mudar a palavra-passe e terminar sessões abertas noutros dispositivos.
// O servidor devolve um token novo; guardamo-lo para este dispositivo continuar com sessão iniciada.
function SecuritySettings() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const keepSession = result => {
    if (result?.token) localStorage.setItem("token", result.token);
    setNotice(result?.message || "Feito.");
  };

  const changePassword = async event => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (form.newPassword !== form.confirm) return setError("As duas palavras-passe novas não são iguais.");
    setBusy("password");
    try {
      keepSession(await api("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      }));
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setOpen(false);
    } catch (changeError) {
      setError(changeError.message);
    } finally {
      setBusy("");
    }
  };

  const logoutEverywhere = async () => {
    if (!window.confirm("Terminar a sessão em todos os outros dispositivos? Este continua com sessão iniciada.")) return;
    setError("");
    setNotice("");
    setBusy("logout");
    try {
      keepSession(await api("/auth/logout-all", { method: "POST" }));
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setBusy("");
    }
  };

  return <div className="security-settings">
    <div className="prefs-row">
      <span className="prefs-row-icon"><Icon name="lock" /></span>
      <span><strong>Palavra-passe</strong><small>Ao mudá-la, as sessões abertas noutros dispositivos terminam.</small></span>
      <button className="prefs-link" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setError(""); setNotice(""); }}>
        {open ? "Cancelar" : "Mudar palavra-passe"} <Icon name={open ? "close" : "create"} size={14} />
      </button>
    </div>
    {open && <form className="prefs-form security-password-form" onSubmit={changePassword}>
      <label>Palavra-passe atual<input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={event => setForm({ ...form, currentPassword: event.target.value })} /></label>
      <label>Nova palavra-passe <small>Pelo menos {PASSWORD_MIN} caracteres</small><input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={form.newPassword} onChange={event => setForm({ ...form, newPassword: event.target.value })} /></label>
      <label>Repete a nova palavra-passe<input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={form.confirm} onChange={event => setForm({ ...form, confirm: event.target.value })} /></label>
      <div className="prefs-form-foot"><button className="btn" type="submit" disabled={busy === "password"}>{busy === "password" ? "A guardar..." : "Mudar palavra-passe"}</button></div>
    </form>}
    <TwoFactorSettings />
    <div className="prefs-row">
      <span className="prefs-row-icon"><Icon name="devices" /></span>
      <span><strong>Sessões abertas</strong><small>Perdeste o telemóvel ou entraste num computador de outra pessoa? Termina todas as outras sessões.</small></span>
      <button className="prefs-link" type="button" disabled={busy === "logout"} onClick={logoutEverywhere}>
        {busy === "logout" ? "A terminar..." : "Terminar outras sessões"} <Icon name="logout" size={14} />
      </button>
    </div>
    <div className="prefs-row">
      <span className="prefs-row-icon"><Icon name="mail" /></span>
      <span><strong>Esqueceste a palavra-passe?</strong><small>Recebe uma ligação segura no teu email.</small></span>
      <Link className="prefs-link" to="/forgot-password">Recuperar acesso <Icon name="externalLink" size={14} /></Link>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
  </div>;
}

// Definições: cada área tem a sua página (/settings/<área>). No computador a lista fica ao lado;
// no telemóvel, /settings mostra só a lista e cada área abre em ecrã próprio com "voltar".
// O perfil público não vive aqui: edita-se em /profile/edit, a partir do próprio perfil.
const SETTINGS_GROUPS = [
  { label: "Conta e segurança", items: [
    { id: "conta", icon: "mail", label: "Conta", hint: "Email, tipo de conta e os teus dados", intro: "Os dados com que entras no Biva e o que podes fazer com eles.", private: true },
    { id: "seguranca", icon: "shield", label: "Segurança", hint: "Palavra-passe, dois passos e sessões", intro: "Protege o acesso à tua conta, mesmo que alguém descubra a tua palavra-passe.", private: true },
    { id: "privacidade", icon: "lock", label: "Privacidade", hint: "Mensagens, comentários e bloqueios", intro: "Decide quem te pode contactar e o que as marcas podem saber sobre ti.", private: true }
  ] },
  { label: "Preferências", items: [
    { id: "notificacoes", icon: "notifications", label: "Notificações", hint: "Escolhe o que te avisamos", intro: "Escolhe sobre o que queres ser avisado. Avisos de dinheiro e segurança chegam sempre.", private: true },
    { id: "aparencia", icon: "sun", label: "Aparência", hint: "Tema, tamanho do texto e vídeos", intro: "Escolhe como o Biva aparece e se comporta neste dispositivo." }
  ] },
  { label: "Suporte", items: [
    { id: "ajuda", icon: "help", label: "Ajuda e informação", hint: "Perguntas frequentes, termos e privacidade", intro: "Respostas rápidas e as regras que valem para todos no Biva." }
  ] }
];
const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap(group => group.items);

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function Settings() {
  const { section } = useParams();
  const { user } = useContext(UserContext);
  const wide = useMediaQuery("(min-width: 900px)");
  const current = SETTINGS_SECTIONS.find(item => item.id === section);
  useEffect(() => { if (current) window.scrollTo(0, 0); }, [current?.id]);
  if (section && !current) return <Navigate to="/settings" replace />;
  if (!section && wide) return <Navigate to="/settings/conta" replace />;
  const Panel = current && SETTINGS_PANELS[current.id];

  return <section className={`page prefs${current ? " has-section" : " is-root"}`}>
    <aside className="prefs-nav">
      <h1 className="prefs-title">Definições</h1>
      {SETTINGS_GROUPS.map(group => <nav key={group.label} className="prefs-nav-group" aria-label={group.label}>
        <h2>{group.label}</h2>
        {group.items.map(item => <NavLink key={item.id} to={`/settings/${item.id}`} className="prefs-nav-item">
          <span className="prefs-nav-icon"><Icon name={item.icon} size={18} /></span>
          <span className="prefs-nav-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
          <span className="prefs-nav-chevron"><Icon name="next" size={16} /></span>
        </NavLink>)}
      </nav>)}
      <InfoLinks />
    </aside>
    {current && <div className="prefs-main">
      <Link className="prefs-back" to="/settings"><Icon name="previous" size={18} />Definições</Link>
      <header className="prefs-head">
        <span className="prefs-head-icon"><Icon name={current.icon} size={22} /></span>
        <div><h2>{current.label}</h2><p>{current.intro}</p></div>
      </header>
      {current.private && !user
        ? <div className="prefs-card prefs-guest">
          <span className="prefs-row-icon"><Icon name="profile" /></span>
          <div><strong>Inicia sessão para ver esta área</strong><p>Depois de entrares, podes gerir a tua conta, a segurança e a privacidade.</p></div>
          <Link className="btn" to="/login">Iniciar sessão</Link>
        </div>
        : <Panel />}
    </div>}
  </section>;
}

// Uma linha de definição: ícone, título e explicação, e a ação à direita.
function PrefsRow({ icon, title, children, action, tone }) {
  return <div className={`prefs-row${tone ? ` tone-${tone}` : ""}`}>
    <span className="prefs-row-icon"><Icon name={icon} /></span>
    <span className="prefs-row-text"><strong>{title}</strong>{children && <small>{children}</small>}</span>
    {action && <span className="prefs-row-action">{action}</span>}
  </div>;
}

function PrefsCard({ title, note, children, tone }) {
  return <section className={`prefs-card${tone ? ` tone-${tone}` : ""}`}>
    {title && <header className="prefs-card-head"><h3>{title}</h3>{note && <p>{note}</p>}</header>}
    {children}
  </section>;
}

// Preferências guardadas na conta (servidor). Gravam logo que mudam; se falhar, volta atrás.
function useAccountPreferences() {
  const [preferences, setPreferences] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api("/auth/me/preferences").then(result => setPreferences(result.preferences)).catch(loadError => setError(loadError.message));
  }, []);
  useEffect(() => {
    if (!saved) return undefined;
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);
  const save = async patch => {
    const previous = preferences;
    setPreferences(current => ({ ...current, ...patch, notify: { ...current.notify, ...(patch.notify || {}) } }));
    setError("");
    try {
      const result = await api("/auth/me/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setPreferences(result.preferences);
      setSaved(true);
    } catch (saveError) {
      setPreferences(previous);
      setError(saveError.message);
    }
  };
  return { preferences, save, error, saved };
}

// Interruptor numa linha de definição.
function PrefsToggle({ icon, title, children, checked, onChange, disabled }) {
  return <label className={`prefs-row prefs-toggle${disabled ? " is-disabled" : ""}`}>
    <span className="prefs-row-icon"><Icon name={icon} /></span>
    <span className="prefs-row-text"><strong>{title}</strong>{children && <small>{children}</small>}</span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="prefs-switch-track" aria-hidden="true"><i /></span>
  </label>;
}

// Escolha única em lista (botões de opção com aspeto de linha).
function PrefsChoice({ name, legend, options, value, onChange }) {
  return <fieldset className="prefs-choice">
    <legend className="visually-hidden">{legend}</legend>
    {options.map(option => <label key={option.value} className={`prefs-choice-item${value === option.value ? " is-selected" : ""}`}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span className="prefs-choice-dot" aria-hidden="true" />
      <span className="prefs-row-text"><strong>{option.label}</strong><small>{option.hint}</small></span>
      <Icon name={option.icon} size={18} />
    </label>)}
  </fieldset>;
}

function PrefsStatus({ error, saved }) {
  if (error) return <p className="error prefs-status" role="alert">{error}</p>;
  return <p className={`prefs-saved prefs-status${saved ? " is-visible" : ""}`} role="status" aria-live="polite">
    {saved && <><Icon name="check" size={14} />Guardado</>}
  </p>;
}

function SettingsAccount() {
  const { user } = useContext(UserContext);
  const [resend, setResend] = useState({ busy: false, message: "", error: "" });
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" }) : "";
  const resendEmail = async () => {
    setResend({ busy: true, message: "", error: "" });
    try {
      const result = await api("/auth/verify-email/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email }) });
      setResend({ busy: false, message: "Enviámos uma nova ligação para o teu email.", error: "" });
      if (result.verificationUrl) console.info("Ligação de confirmação (desenvolvimento):", result.verificationUrl);
    } catch (resendError) {
      setResend({ busy: false, message: "", error: resendError.message });
    }
  };
  return <>
    <PrefsCard title="Dados da conta">
      <PrefsRow icon="mail" title="Email" action={user.email_verified
        ? <span className="prefs-pill is-good"><Icon name="check" size={13} />Confirmado</span>
        : <button className="prefs-link" type="button" disabled={resend.busy} onClick={resendEmail}>{resend.busy ? "A enviar..." : "Reenviar confirmação"}</button>}>
        <span className="prefs-value">{user.email}</span>
        {!user.email_verified && <span className="prefs-hint-warn">Ainda não confirmaste este email. Sem ele não consegues recuperar a conta.</span>}
      </PrefsRow>
      {(resend.message || resend.error) && <p className={resend.error ? "error prefs-status" : "prefs-saved prefs-status is-visible"} role="status">
        {resend.message && <Icon name="check" size={14} />}{resend.message || resend.error}</p>}
      <PrefsRow icon="reference" title="Nome de utilizador"><span className="prefs-value">@{user.username}</span></PrefsRow>
      <PrefsRow icon={user.is_creator ? "star" : "friends"} title="Tipo de conta"
        action={user.is_creator && <Link className="prefs-link" to="/creator">Painel do criador <Icon name="next" size={14} /></Link>}>
        {user.is_creator ? "Criador: podes ter subscritores, receber estrelas e fazer anúncios." : "Membro da comunidade."}
      </PrefsRow>
      {memberSince && <PrefsRow icon="events" title="No Biva desde"><span className="prefs-value">{memberSince}</span></PrefsRow>}
      <PrefsRow icon="globe" title="Idioma e região"><span className="prefs-value">Português · Angola (Kz)</span></PrefsRow>
    </PrefsCard>
    <PrefsCard title="Os teus dados" note="Os teus dados são teus. Podes levá-los contigo ou apagar tudo.">
      <AccountDataControls />
    </PrefsCard>
  </>;
}

function SettingsSecurity() {
  return <PrefsCard><SecuritySettings /></PrefsCard>;
}

const REACH_OPTIONS = {
  messages: [
    { value: "everyone", label: "Toda a gente", hint: "Qualquer pessoa no Biva te pode escrever.", icon: "globe" },
    { value: "following", label: "Só quem eu sigo", hint: "As outras pessoas não conseguem começar uma conversa contigo.", icon: "friends" },
    { value: "nobody", label: "Ninguém", hint: "Só recebes respostas em conversas que tu começaste.", icon: "lock" }
  ],
  comments: [
    { value: "everyone", label: "Toda a gente", hint: "Quem vê a publicação pode comentar.", icon: "globe" },
    { value: "following", label: "Só quem eu sigo", hint: "Os outros veem a publicação mas não comentam.", icon: "friends" },
    { value: "nobody", label: "Ninguém", hint: "Os comentários ficam fechados em todas as tuas publicações.", icon: "lock" }
  ]
};

function SettingsPrivacy() {
  const { preferences, save, error, saved } = useAccountPreferences();
  return <>
    <PrefsStatus error={error} saved={saved} />
    <PrefsCard title="Quem te pode enviar mensagens" note="Bloquear alguém continua a ser a forma de cortar o contacto com uma pessoa específica.">
      {preferences
        ? <PrefsChoice name="messages" legend="Quem te pode enviar mensagens" options={REACH_OPTIONS.messages} value={preferences.messages} onChange={value => save({ messages: value })} />
        : <p className="prefs-loading">A carregar...</p>}
    </PrefsCard>
    <PrefsCard title="Quem pode comentar nas tuas publicações" note="Vale para as publicações e Reels que já fizeste e para as próximas. Os comentários que já lá estão ficam.">
      {preferences
        ? <PrefsChoice name="comments" legend="Quem pode comentar" options={REACH_OPTIONS.comments} value={preferences.comments} onChange={value => save({ comments: value })} />
        : <p className="prefs-loading">A carregar...</p>}
    </PrefsCard>
    <PrefsCard><BlockedAccounts /></PrefsCard>
    <PrefsCard title="Província e idade" note="Só servem para te mostrar promoções da tua zona e idade. Não aparecem no teu perfil.">
      <AudienceSettings />
    </PrefsCard>
    <PrefsCard title="O que é público" note="O teu perfil, as publicações e os Stories são visíveis para quem está no Biva. Os Stories desaparecem ao fim de 24 horas.">
      <PrefsRow icon="block" title="Bloquear alguém">Abre o perfil da pessoa e escolhe Bloquear. Deixa de te ver e de te poder contactar.</PrefsRow>
      <PrefsRow icon="report" title="Denunciar conteúdo">Em qualquer publicação, comentário ou perfil, no menu de opções.</PrefsRow>
    </PrefsCard>
  </>;
}

const NOTIFY_OPTIONS = [
  { key: "interactions", icon: "heart", title: "Gostos, comentários e partilhas", hint: "Quando alguém reage ao que publicas." },
  { key: "people", icon: "friends", title: "Seguidores e amizades", hint: "Novos seguidores, pedidos de amizade e pedidos aceites." },
  { key: "messages", icon: "messages", title: "Mensagens", hint: "Um aviso por cada mensagem nova. O número no ícone de mensagens aparece sempre." },
  { key: "lives", icon: "live", title: "Diretos", hint: "Quando alguém que segues começa um direto." },
  { key: "community", icon: "groups", title: "Grupos, páginas e eventos", hint: "Quando alguém entra no teu grupo, segue a tua página ou vai ao teu evento." }
];

function SettingsNotifications() {
  const { preferences, save, error, saved } = useAccountPreferences();
  const allOn = preferences && NOTIFY_OPTIONS.every(option => preferences.notify[option.key]);
  return <>
    <PrefsStatus error={error} saved={saved} />
    <PrefsCard title="O que te avisamos" note="O que desligares deixa de aparecer nas notificações a partir de agora.">
      {preferences
        ? <>
          {NOTIFY_OPTIONS.map(option => <PrefsToggle key={option.key} icon={option.icon} title={option.title}
            checked={preferences.notify[option.key]} onChange={value => save({ notify: { [option.key]: value } })}>{option.hint}</PrefsToggle>)}
          <div className="prefs-card-foot">
            <button className="prefs-link" type="button" onClick={() => save({ notify: Object.fromEntries(NOTIFY_OPTIONS.map(option => [option.key, !allOn])) })}>
              {allOn ? "Desligar tudo" : "Ligar tudo"}
            </button>
          </div>
        </>
        : <p className="prefs-loading">A carregar...</p>}
    </PrefsCard>
    <PrefsCard title="Avisos que chegam sempre">
      <PrefsRow icon="card" title="Dinheiro e pagamentos">Estrelas, subscrições, levantamentos e campanhas pagas.</PrefsRow>
      <PrefsRow icon="ad" title="Promoções e anúncios">Quando uma promoção tua é aprovada ou recusada.</PrefsRow>
      <PrefsRow icon="shield" title="Segurança da conta">Emails sobre a palavra-passe e o acesso à tua conta.</PrefsRow>
    </PrefsCard>
    <PrefsCard>
      <PrefsRow icon="notifications" title="Centro de notificações" action={<Link className="btn secondary" to="/notifications">Abrir</Link>}>
        As notificações ficam guardadas aqui até as leres.
      </PrefsRow>
    </PrefsCard>
  </>;
}

const THEME_OPTIONS = [
  { value: "light", label: "Claro", hint: "Fundo branco", icon: "sun" },
  { value: "dark", label: "Escuro", hint: "Fundo preto, menos brilho", icon: "moon" },
  { value: "system", label: "Automático", hint: "Segue o teu dispositivo", icon: "devices" }
];

const TEXT_SIZES = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Grande" },
  { value: "larger", label: "Maior" }
];

function SettingsAppearance() {
  const { themePreference, setTheme } = useContext(ThemeContext);
  const [device, setDevice] = useState(readDevicePrefs);
  const change = patch => setDevice(saveDevicePrefs({ ...device, ...patch }));
  return <>
    <PrefsCard title="Tema" note="Fica guardado neste dispositivo.">
      <fieldset className="prefs-themes">
        <legend className="visually-hidden">Tema da aplicação</legend>
        {THEME_OPTIONS.map(option => <label key={option.value} className={`prefs-theme${themePreference === option.value ? " is-selected" : ""}`}>
          <input type="radio" name="theme" value={option.value} checked={themePreference === option.value} onChange={() => setTheme(option.value)} />
          <span className={`prefs-theme-preview preview-${option.value}`} aria-hidden="true">
            <span className="ptp-half"><i /><i /><i /></span>
            {option.value === "system" && <span className="ptp-half ptp-dark"><i /><i /><i /></span>}
          </span>
          <span className="prefs-theme-label">
            <Icon name={option.icon} size={16} />
            <span><strong>{option.label}</strong><small>{option.hint}</small></span>
            <span className="prefs-theme-check"><Icon name="check" size={13} /></span>
          </span>
        </label>)}
      </fieldset>
    </PrefsCard>
    <PrefsCard title="Tamanho do texto" note="Aumenta o texto e os botões em todo o Biva, neste dispositivo.">
      <div className="prefs-segment" role="radiogroup" aria-label="Tamanho do texto">
        {TEXT_SIZES.map((size, index) => <label key={size.value} className={device.textSize === size.value ? "is-selected" : ""}>
          <input type="radio" name="text-size" value={size.value} checked={device.textSize === size.value} onChange={() => change({ textSize: size.value })} />
          <span className="prefs-segment-sample" style={{ fontSize: `${15 + index * 3}px` }} aria-hidden="true">Aa</span>
          {size.label}
        </label>)}
      </div>
      <p className="prefs-sample">Assim fica uma publicação: «Hoje o pôr do sol na Ilha estava incrível.»</p>
    </PrefsCard>
    <PrefsCard title="Vídeo e movimento" note="Ficam guardados neste dispositivo.">
      <PrefsToggle icon="play" title="Reproduzir vídeos automaticamente" checked={device.autoplay} onChange={value => change({ autoplay: value })}>
        Os vídeos começam sozinhos quando aparecem no ecrã. Desliga para poupar dados móveis.
      </PrefsToggle>
      <PrefsToggle icon="effects" title="Reduzir animações" checked={device.reduceMotion} onChange={value => change({ reduceMotion: value })}>
        Menos movimento ao abrir janelas, nas reações dos diretos e nas transições.
      </PrefsToggle>
    </PrefsCard>
  </>;
}

function SettingsHelp() {
  const links = [
    ["/help", "help", "Centro de ajuda", "Perguntas frequentes sobre a conta, pagamentos e criadores."],
    ["/about", "info", "Sobre o Biva", "O que é o Biva e como cuidamos da comunidade."],
    ["/terms", "pages", "Termos", "As regras que todos aceitamos ao usar o Biva."],
    ["/privacy", "lock", "Política de Privacidade", "O que guardamos e porquê."],
    ["/publicidade", "ad", "Publicidade", "Como funcionam os anúncios e promoções."]
  ];
  return <PrefsCard>
    {links.map(([to, icon, title, hint]) => <Link key={to} to={to} className="prefs-row is-link">
      <span className="prefs-row-icon"><Icon name={icon} /></span>
      <span className="prefs-row-text"><strong>{title}</strong><small>{hint}</small></span>
      <span className="prefs-row-action"><Icon name="next" size={16} /></span>
    </Link>)}
  </PrefsCard>;
}

const SETTINGS_PANELS = {
  conta: SettingsAccount,
  seguranca: SettingsSecurity,
  privacidade: SettingsPrivacy,
  notificacoes: SettingsNotifications,
  aparencia: SettingsAppearance,
  ajuda: SettingsHelp
};

// Editar o perfil público: capa e foto com pré-visualização, e os campos que aparecem no perfil.
function EditProfile() {
  const { user, refreshUser, authReady } = useContext(UserContext);
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [imageBusy, setImageBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || form) return;
    setForm({
      displayName: user.display_name || "",
      bio: user.bio || "",
      location: user.location || "",
      profession: user.profession || "",
      website: user.website || "",
      subscriptionPrice: Number(user.subscription_price) > 0 ? String(Number(user.subscription_price)) : ""
    });
  }, [user]);

  if (authReady && !user) return <Navigate to="/login" replace />;
  if (!user || !form) return <section className="page narrow"><div className="empty card">A carregar...</div></section>;
  const set = field => event => setForm({ ...form, [field]: event.target.value });

  const save = async event => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName,
          bio: form.bio,
          location: form.location,
          profession: form.profession,
          website: form.website,
          ...(user.is_creator && form.subscriptionPrice !== "" && { subscriptionPrice: Number(form.subscriptionPrice) })
        })
      });
      await refreshUser();
      setNotice("Perfil guardado.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const changeImage = async (kind, file) => {
    setError("");
    setNotice("");
    setImageBusy(kind);
    try {
      if (file) {
        const formData = new FormData();
        formData.append("image", file);
        await api(`/auth/me/${kind}`, { method: "POST", body: formData });
      } else {
        await api(`/auth/me/${kind}`, { method: "DELETE" });
      }
      await refreshUser();
      setNotice(kind === "avatar" ? "Foto de perfil atualizada." : "Capa atualizada.");
    } catch (imageError) {
      setError(imageError.message);
    } finally {
      setImageBusy("");
    }
  };
  const imageInput = kind => <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!!imageBusy}
    onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) changeImage(kind, file); }} />;

  return <section className="page narrow edit-profile">
    <header className="edit-profile-top">
      <Link className="prefs-back is-always" to={`/u/${user.username}`}><Icon name="previous" size={18} />Voltar ao perfil</Link>
      <h1>Editar perfil</h1>
      <p>O que escreves aqui é público: aparece no teu perfil para toda a gente.</p>
    </header>
    <div className="edit-profile-media">
      <div className="edit-profile-cover" style={user.cover_url ? { backgroundImage: `url(${API_BASE}${user.cover_url})` } : undefined}>
        <div className="edit-profile-cover-actions">
          <label className={`edit-media-btn${imageBusy === "cover" ? " is-busy" : ""}`}>
            <Icon name="camera" size={15} />{imageBusy === "cover" ? "A enviar..." : user.cover_url ? "Trocar capa" : "Adicionar capa"}{imageInput("cover")}
          </label>
          {user.cover_url && <button className="edit-media-btn is-icon" type="button" disabled={!!imageBusy} onClick={() => changeImage("cover", null)} aria-label="Remover capa"><Icon name="trash" size={15} /></button>}
        </div>
      </div>
      <div className="edit-profile-identity">
        <div className="edit-profile-avatar">
          <Avatar user={user} size="large" />
          <label className={`edit-avatar-btn${imageBusy === "avatar" ? " is-busy" : ""}`} title="Mudar foto de perfil">
            <Icon name="camera" size={16} /><span className="visually-hidden">Mudar foto de perfil</span>{imageInput("avatar")}
          </label>
        </div>
        <div className="edit-profile-name">
          <strong>{form.displayName || user.display_name}</strong>
          <small>@{user.username}</small>
          {user.avatar_url && <button className="text-button" type="button" disabled={!!imageBusy} onClick={() => changeImage("avatar", null)}>Remover foto</button>}
        </div>
      </div>
      <p className="edit-profile-media-hint">Fotos em JPG, PNG, WebP ou GIF, até 8 MB. A foto fica melhor quadrada e a capa na horizontal.</p>
    </div>
    <form className="edit-profile-form" onSubmit={save}>
      <PrefsCard title="Sobre ti">
        <label className="field">Nome público<input autoComplete="name" maxLength={100} required value={form.displayName} onChange={set("displayName")} /></label>
        <label className="field">Biografia <small className="field-count">{form.bio.length}/500</small>
          <textarea maxLength={500} rows={4} value={form.bio} onChange={set("bio")} placeholder="Conta em poucas palavras quem és e o que partilhas." /></label>
        <div className="field-pair">
          <label className="field">Profissão<input maxLength={100} autoComplete="organization-title" value={form.profession} onChange={set("profession")} placeholder="Ex.: fotógrafa, estudante" /></label>
          <label className="field">Localidade<input maxLength={100} autoComplete="address-level2" value={form.location} onChange={set("location")} placeholder="Ex.: Luanda" /></label>
        </div>
        <label className="field">Site ou link<input maxLength={200} type="text" inputMode="url" autoComplete="url" value={form.website} onChange={set("website")} placeholder="Ex.: instagram.com/o_teu_nome" /></label>
      </PrefsCard>
      {user.is_creator && <PrefsCard title="Subscrição" note="O valor mensal que os teus subscritores pagam pelo conteúdo exclusivo.">
        <label className="field">Preço por mês (Kz) <small>Entre 500 Kz e 500 000 Kz</small>
          <input type="number" inputMode="decimal" min="500" max="500000" step="0.01" value={form.subscriptionPrice} onChange={set("subscriptionPrice")} placeholder="Ex.: 2500" /></label>
      </PrefsCard>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="edit-profile-actions">
        {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
        <button className="btn secondary" type="button" disabled={saving} onClick={() => navigate(`/u/${user.username}`)}>Ver perfil</button>
        <button className="btn" type="submit" disabled={saving}>{saving ? "A guardar..." : "Guardar perfil"}</button>
      </div>
    </form>
  </section>;
}

function Create() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exclusive, setExclusive] = useState(false);

  const submit = async event => {
    event.preventDefault();
    if (!token()) return navigate("/login");
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 2048, 2048));
    if (exclusive) formData.append("isExclusive", "true");
    setBusy(true);
    try {
      await api("/posts", { method: "POST", body: formData });
      navigate("/");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="page narrow"><form className="panel card" onSubmit={submit}><div className="composer-top"><Avatar user={user} /><textarea required={!file} placeholder="Em que estás a pensar?" value={body} onChange={event => setBody(event.target.value)} /></div><label className="file-label">Fotografia/vídeo<input type="file" accept="image/*,video/*" onChange={event => setFile(event.target.files?.[0] || null)} /></label><ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />{error && <p className="error">{error}</p>}<button className="btn" disabled={busy}>{busy ? "A publicar..." : "Publicar"}</button></form></div>;
}

// Valores em kwanzas: "2 500 Kz" (sem cêntimos quando o valor é inteiro).
const formatPrice = value => {
  const amount = Number(value) || 0;
  // O símbolo "Kz" é acrescentado à mão: alguns browsers mostrariam "AOA".
  return `${amount.toLocaleString("pt-PT", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} Kz`;
};
const formatDate = value => new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });

function SubscriptionPanel({ profile, isOwnProfile, busy, onSubscribe, onCancel }) {
  const price = `${formatPrice(profile.subscription_price)}/mês`;
  let status;
  let action = null;
  if (isOwnProfile) {
    status = <>A tua subscrição custa <strong>{price}</strong>. As publicações marcadas como exclusivas só são visíveis para subscritores.</>;
  } else if (profile.is_subscribed && profile.subscription_canceling) {
    status = <>A tua subscrição termina a <strong>{formatDate(profile.subscription_period_end)}</strong> e não vai renovar.</>;
    action = <button className="btn" type="button" disabled={busy} onClick={onSubscribe}>{busy ? "A atualizar..." : "Retomar subscrição"}</button>;
  } else if (profile.is_subscribed) {
    status = <>Subscrito · renova a <strong>{formatDate(profile.subscription_period_end)}</strong> ({price}).</>;
    action = <button className="btn secondary" type="button" disabled={busy} onClick={onCancel}>{busy ? "A cancelar..." : "Cancelar renovação"}</button>;
  } else {
    status = <>Subscreve para veres as publicações exclusivas de {profile.display_name}.</>;
    action = <button className="btn" type="button" disabled={busy} onClick={onSubscribe}>{busy ? "A abrir pagamento..." : `Subscrever por ${price}`}</button>;
  }
  return <div className="subscription-panel">
    <span className="rail-icon"><Icon name="spark" /></span>
    <p>{status}</p>
    {action}
  </div>;
}

// Link externo de um perfil: mostra só o domínio e abre num separador novo sem passar o referrer.
function WebsiteLink({ href }) {
  let label = href;
  try {
    const url = new URL(href);
    label = (url.hostname.replace(/^www\./, "") + url.pathname).replace(/\/$/, "");
  } catch {
    return null;
  }
  return <a className="profile-website" href={href} target="_blank" rel="noopener noreferrer nofollow ugc">{label}</a>;
}

const formatCount = value => Number(value || 0).toLocaleString("pt-PT");

function ProfileStats({ profile }) {
  const stats = [
    ["publicações", profile.posts],
    ["seguidores", profile.followers],
    ["a seguir", profile.following],
    ["amigos", profile.friends],
    ["gostos recebidos", profile.likes_received],
    ["comentários recebidos", profile.comments_received],
    ...(profile.subscribers !== null && profile.subscribers !== undefined ? [["subscritores ativos", profile.subscribers]] : [])
  ];
  return <dl className="profile-stats-grid">
    {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatCount(value)}</dd></div>)}
  </dl>;
}

// Botão de câmara sobre a foto de perfil ou a capa. Sem imagem abre logo o seletor;
// com imagem mostra um menu (carregar nova, editar/reposicionar, remover). Antes de guardar
// abre sempre o editor: recorte e filtros na foto de perfil, posição na capa.
function ProfilePhotoControl({ kind, profile, onUpdated }) {
  const isAvatar = kind === "avatar";
  const currentUrl = isAvatar ? profile.avatar_url : profile.cover_url;
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState(null); // { src, file?, objectUrl? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeMenu = useMemo(() => () => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);
  const label = isAvatar ? "Alterar foto de perfil" : "Alterar capa";

  const closeEditor = () => {
    if (editor?.objectUrl) URL.revokeObjectURL(editor.objectUrl);
    setEditor(null);
    setError("");
  };

  const pickFile = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return onUpdated(null, "Escolhe um ficheiro de imagem.");
    const objectUrl = URL.createObjectURL(file);
    setEditor({ src: objectUrl, objectUrl, file });
  };

  const openPicker = () => { setMenuOpen(false); inputRef.current?.click(); };
  const editCurrent = () => { setMenuOpen(false); setEditor({ src: `${API_BASE}${currentUrl}` }); };

  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm(isAvatar ? "Remover a foto de perfil?" : "Remover a capa?")) return;
    try {
      const result = await api(`/auth/me/${kind}`, { method: "DELETE" });
      onUpdated(result.user, isAvatar ? "Foto de perfil removida." : "Capa removida.");
    } catch (removeError) {
      onUpdated(null, removeError.message);
    }
  };

  // Foto de perfil: o editor devolve um ficheiro já recortado (640×640).
  const saveAvatar = async file => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const result = await api("/auth/me/avatar", { method: "POST", body: formData });
      closeEditor();
      onUpdated(result.user, "Foto de perfil atualizada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  // Capa: imagem nova é reduzida no browser e enviada com a posição; a atual só muda a posição.
  const saveCover = async position => {
    setBusy(true);
    setError("");
    try {
      let result;
      if (editor.file) {
        const formData = new FormData();
        formData.append("image", await downscaleImage(editor.file, 1920, 6000));
        formData.append("position", String(position));
        result = await api("/auth/me/cover", { method: "POST", body: formData });
      } else {
        result = await api("/auth/me/cover-position", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position })
        });
      }
      closeEditor();
      onUpdated(result.user, "Capa atualizada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className={`photo-control photo-control-${kind}`} ref={menuRef}>
    <button className={`photo-change photo-change-${kind}`} type="button" title={label} aria-label={label}
      aria-haspopup={currentUrl ? "menu" : undefined} aria-expanded={currentUrl ? menuOpen : undefined}
      onClick={() => (currentUrl ? setMenuOpen(open => !open) : openPicker())}>
      <Icon name="camera" size={isAvatar ? 18 : 17} />
      {!isAvatar && <span>Editar capa</span>}
    </button>
    <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" tabIndex={-1} aria-hidden="true" onChange={pickFile} />
    {menuOpen && <div className="post-menu-list photo-menu" role="menu">
      <button type="button" role="menuitem" onClick={openPicker}><Icon name="image" size={15} /> Carregar nova foto</button>
      <button type="button" role="menuitem" onClick={editCurrent}><Icon name={isAvatar ? "create" : "move"} size={15} /> {isAvatar ? "Editar foto atual" : "Reposicionar"}</button>
      <button type="button" role="menuitem" className="danger" onClick={remove}><Icon name="trash" size={15} /> {isAvatar ? "Remover foto" : "Remover capa"}</button>
    </div>}
    {editor && (isAvatar
      ? <AvatarEditor src={editor.src} busy={busy} error={error} onSave={saveAvatar} onCancel={closeEditor} />
      : <CoverEditor src={editor.src} initialPosition={profile.cover_position} busy={busy} error={error} onSave={saveCover} onCancel={closeEditor} />)}
  </div>;
}

function Profile() {
  const { username } = useParams();
  const { user, refreshUser } = useContext(UserContext);
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const isAboutPage = location.pathname === `/u/${username}/about`;
  const isOwnProfile = user?.username === username;

  useEffect(() => {
    const result = searchParams.get("subscription");
    if (!result) return;
    setMessage(result === "success"
      ? "Pagamento recebido. A subscrição fica ativa assim que a confirmação chegar — pode demorar alguns segundos."
      : "O pagamento foi cancelado. Não foi feita nenhuma cobrança.");
    setSearchParams({}, { replace: true });
    if (result === "success") {
      const timer = window.setTimeout(() => load(), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [searchParams]);

  const subscribe = async () => {
    if (!token()) return setMessage("Entra na tua conta para subscrever.");
    setSubscriptionBusy(true);
    try {
      const result = await api(`/subscriptions/${profile.id}`, { method: "POST" });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      setMessage(result.message);
      await load();
    } catch (actionError) {
      setMessage(actionError.message);
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const cancelSubscription = async () => {
    setSubscriptionBusy(true);
    try {
      await api(`/subscriptions/${profile.id}`, { method: "DELETE" });
      await load();
      setMessage("A subscrição não vai renovar. Manténs o acesso até ao fim do período pago.");
    } catch (actionError) {
      setMessage(actionError.message);
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const load = async () => {
    setProfile(null);
    setPosts([]);
    setError("");
    try {
      const userResult = await api(`/users/${username}`);
      setProfile(userResult.user);
      if (isAboutPage) {
        setPosts([]);
      } else {
        const postResult = await api(`/posts?username=${encodeURIComponent(username)}`);
        setPosts(postResult.posts);
      }
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, [username, isAboutPage]);

  // Depois de apagar uma publicação ou bloquear alguém: atualiza só a lista, sem esvaziar a página.
  const reloadProfilePosts = async () => {
    try {
      const [userResult, postResult] = await Promise.all([api(`/users/${username}`), api(`/posts?username=${encodeURIComponent(username)}`)]);
      setProfile(userResult.user);
      setPosts(postResult.posts);
    } catch (reloadError) {
      setError(reloadError.message);
    }
  };

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [reportingProfile, setReportingProfile] = useState(false);
  const photoUpdated = async (updatedUser, text) => {
    if (updatedUser) {
      setProfile(current => ({ ...current, avatar_url: updatedUser.avatar_url, cover_url: updatedUser.cover_url, cover_position: updatedUser.cover_position }));
      await refreshUser();
    }
    setMessage(text);
  };

  const toggleBlock = async () => {
    const blocking = !profile.is_blocked;
    if (blocking && !window.confirm(`Bloquear @${profile.username}? Deixam de ser amigos, de se seguir e de poder trocar mensagens.`)) return;
    try {
      await api(`/users/${profile.id}/block`, { method: blocking ? "POST" : "DELETE" });
      setMessage(blocking ? `Bloqueaste @${profile.username}.` : `Desbloqueaste @${profile.username}.`);
      await load();
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  const toggleFollow = async () => {
    if (!token()) return setMessage("Entra na tua conta para seguir pessoas.");
    try {
      const result = await api(`/users/${profile.id}/follow`, { method: "POST" });
      setProfile(current => ({
        ...current,
        is_following: result.following,
        followers: current.followers + (result.following ? 1 : -1)
      }));
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  const addFriend = async () => {
    if (!token()) return setMessage("Entra na tua conta para adicionar amigos.");
    try {
      await api(`/friends/${profile.id}/request`, { method: "POST" });
      setMessage("Pedido de amizade enviado.");
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  if (error) return <div className="page narrow"><div className="empty card error">{error}</div></div>;
  if (!profile) return <div className="page narrow"><div className="empty card">A carregar perfil...</div></div>;

  return <div className="page profile-page">
    <section className="profile-card profile-hero card">
      <div className={`profile-cover${profile.cover_url ? " has-image" : ""}`}>
        {profile.cover_url && <img className="profile-cover-image" src={`${API_BASE}${profile.cover_url}`} alt="" style={{ objectPosition: `50% ${profile.cover_position ?? 50}%` }} />}
        {!isAboutPage && !profile.cover_url && <>
          <span className="profile-cover-kicker">BIVA <i /> ESPAÇO DE CRIAÇÃO</span>
          <span className="profile-cover-message">Histórias que<br /><em>nos aproximam.</em></span>
          <span className="profile-cover-mark" aria-hidden="true">B</span>
          <span className="profile-cover-orbit profile-cover-orbit-one" />
          <span className="profile-cover-orbit profile-cover-orbit-two" />
        </>}
        {isOwnProfile && <ProfilePhotoControl kind="cover" profile={profile} onUpdated={photoUpdated} />}
      </div>
      <div className="profile-identity">
        <div className="profile-avatar-wrap">
          <Avatar user={profile} size="large" />
          {isOwnProfile && <ProfilePhotoControl kind="avatar" profile={profile} onUpdated={photoUpdated} />}
        </div>
        <div className="profile-identity-copy">
          <p className="profile-kicker">{isAboutPage ? "Perfil pessoal" : isOwnProfile ? "O teu espaço na comunidade" : "Espaço da comunidade"}</p>
          <h1>{profile.display_name}<VerifiedBadge show={profile.is_verified} /></h1>
          <p className="handle">@{profile.username}</p>
        </div>
        {!isAboutPage && <div className="profile-identity-actions">
          {isOwnProfile
            ? <><Link className="btn secondary" to="/profile/edit"><Icon name="create" size={15} /> Editar perfil</Link><Link className="btn secondary" to="/creator"><Icon name="stats" size={15} /> Painel do criador</Link></>
            : <>
              {!profile.is_blocked && <>
                <button className={profile.is_following ? "btn secondary" : "btn"} type="button" aria-pressed={profile.is_following} onClick={toggleFollow}>{profile.is_following ? "A seguir" : "Seguir"}</button>
                {profile.is_friend
                  ? <Link className="btn secondary" to={`/messages/${profile.id}`}>Enviar mensagem</Link>
                  : <button className="btn secondary" type="button" onClick={addFriend}>Adicionar amigo <Icon name="plus" size={14} /></button>}
              </>}
              {user && <div className="post-menu">
                <button className="btn secondary icon-only" type="button" aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label="Mais opções" title="Mais opções" onClick={() => setProfileMenuOpen(open => !open)}><Icon name="more" size={18} /></button>
                {profileMenuOpen && <div className="post-menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); setReportingProfile(true); }}><Icon name="report" size={15} /> Denunciar conta</button>
                  <button type="button" role="menuitem" className={profile.is_blocked ? "" : "danger"} onClick={() => { setProfileMenuOpen(false); toggleBlock(); }}><Icon name="block" size={15} /> {profile.is_blocked ? "Desbloquear" : "Bloquear"}</button>
                </div>}
              </div>}
            </>}
        </div>}
      </div>
      {!isAboutPage && profile.is_creator && Number(profile.subscription_price) > 0 && <SubscriptionPanel
        profile={profile}
        isOwnProfile={isOwnProfile}
        busy={subscriptionBusy}
        onSubscribe={subscribe}
        onCancel={cancelSubscription}
      />}
      {profile.is_blocked && <div className="blocked-banner">
        <Icon name="block" />
        <p>Bloqueaste @{profile.username}. Não vês as publicações desta conta e não podem trocar mensagens.</p>
        <button className="btn secondary" type="button" onClick={toggleBlock}>Desbloquear</button>
      </div>}
      {message && <p className="success" role="status">{message}</p>}
      {reportingProfile && <ReportDialog targetType="user" targetId={profile.id} onClose={() => setReportingProfile(false)} />}
    </section>
    <nav className="profile-tabs" aria-label="Navegação do perfil">
      <Link to={`/u/${username}`} className={!isAboutPage ? "active" : undefined} aria-current={!isAboutPage ? "page" : undefined}>Publicações</Link>
      <Link to={`/u/${username}/about`} className={isAboutPage ? "active" : undefined} aria-current={isAboutPage ? "page" : undefined}>Sobre</Link>
    </nav>
    {isAboutPage ? <section className="profile-about-page card" aria-labelledby="profile-about-heading">
      <h2 id="profile-about-heading">Sobre {profile.display_name}</h2>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Biografia</h3><p>{profile.bio || "Este utilizador ainda não adicionou uma biografia."}</p></div>
      </div>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Nome</h3><p>{profile.display_name}</p></div>
      </div>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Nome de utilizador</h3><p>@{profile.username}</p></div>
      </div>
      {profile.profession && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="spark" /></span>
        <div><h3>Profissão</h3><p>{profile.profession}</p></div>
      </div>}
      {profile.location && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="location" /></span>
        <div><h3>Localidade</h3><p>{profile.location}</p></div>
      </div>}
      {profile.website && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="externalLink" /></span>
        <div><h3>Site</h3><p><WebsiteLink href={profile.website} /></p></div>
      </div>}
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="events" /></span>
        <div><h3>No Biva desde</h3><p>{formatDate(profile.created_at)}</p></div>
      </div>
      <ProfileStats profile={profile} />
    </section> : <div className="profile-content-grid">
      <aside className="profile-about-column" id="profile-about">
        <section className="profile-info-card card">
          <h2>Sobre</h2>
          <p className="profile-about-bio">{profile.bio || "Ainda não adicionou uma biografia."}</p>
          <div className="profile-detail-line"><span className="rail-icon"><Icon name="profile" /></span><span><small>Perfil</small><strong>@{profile.username}</strong></span></div>
          <div className="profile-detail-line"><span className="rail-icon"><Icon name={profile.is_creator ? "spark" : "groups"} /></span><span><small>No Biva</small><strong>{profile.is_creator ? "Criador" : "Membro da comunidade"}</strong></span></div>
          {profile.profession && <div className="profile-detail-line"><span className="rail-icon"><Icon name="spark" /></span><span><small>Profissão</small><strong>{profile.profession}</strong></span></div>}
          {profile.location && <div className="profile-detail-line"><span className="rail-icon"><Icon name="location" /></span><span><small>Localidade</small><strong>{profile.location}</strong></span></div>}
          {profile.website && <div className="profile-detail-line"><span className="rail-icon"><Icon name="externalLink" /></span><span><small>Site</small><strong><WebsiteLink href={profile.website} /></strong></span></div>}
        </section>
        <section className="profile-info-card profile-stats-card card">
          <h2>Atividade</h2>
          <ProfileStats profile={profile} />
        </section>
        <SupportersCard username={profile.username} />
      </aside>
      <section className="profile-feed-column" id="profile-posts">
        {isOwnProfile && <div className="profile-share-prompt card">
          <Avatar user={profile} />
          <Link to="/create">Partilha um momento com a comunidade...</Link>
          <Link className="profile-share-action" to="/create" aria-label="Criar publicação" title="Criar publicação"><Icon name="create" /></Link>
        </div>}
        <div className="profile-posts-heading">
          <div><p className="feed-section-kicker">{isOwnProfile ? "O teu espaço na comunidade" : `Publicações de @${profile.username}`}</p><h2>Publicações</h2></div>
          {isOwnProfile && <Link to="/create">Criar publicação <Icon name="externalLink" size={14} /></Link>}
        </div>
        {posts.length ? posts.map(post => <PostCard key={post.id} post={post} onChanged={reloadProfilePosts} />) : <div className="empty card">Ainda não há publicações neste perfil.</div>}
      </section>
    </div>}
  </div>;
}

// Repete `callback` a cada `ms` enquanto o separador do browser estiver visível.
function usePolling(callback, ms, enabled = true) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => { if (document.visibilityState === "visible") Promise.resolve(saved.current()).catch(() => {}); };
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}

const formatMessageTime = value => {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function Messages() {
  const { userId } = useParams();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(null);
  const [canMessage, setCanMessage] = useState(true);
  const chatEnd = useRef(null);
  const selected = conversations.find(item => String(item.id) === userId)
    || contacts.find(item => String(item.id) === userId)
    || results.find(item => String(item.id) === userId)
    || (person && String(person.id) === userId ? person : null);

  const loadConversations = async () => {
    if (!token()) return;
    try {
      const [messageResult, friendResult] = await Promise.all([api("/messages"), api("/friends")]);
      setConversations(messageResult.conversations);
      setContacts(friendResult.friends);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    setMessages([]);
    setPerson(null);
    setCanMessage(true);
    if (!userId || !token()) return;
    api(`/messages/${userId}`).then(result => {
      setMessages(result.messages);
      setPerson(result.person);
      setCanMessage(result.canMessage);
    }).catch(loadError => setError(loadError.message));
  }, [userId]);

  // Mensagens novas na conversa aberta (só pede as que vieram depois da última).
  usePolling(async () => {
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    try {
      const result = await api(`/messages/${userId}${lastId ? `?after=${lastId}` : ""}`);
      setCanMessage(result.canMessage);
      if (result.messages.length) {
        setMessages(current => [...current, ...result.messages.filter(message => !current.some(existing => existing.id === message.id))]);
        loadConversations();
      }
    } catch { /* tenta outra vez no próximo ciclo */ }
  }, 4000, !!userId && !!user);

  // Lista de conversas (novas conversas e contadores de não lidas).
  usePolling(loadConversations, 15000, !!user);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const searchUsers = async event => {
    event.preventDefault();
    if (!search.trim()) return setResults([]);
    setError("");
    try {
      const result = await api(`/users/search?q=${encodeURIComponent(search.trim())}`);
      setResults(result.users);
    } catch (searchError) {
      setError(searchError.message);
    }
  };

  const sendMessage = async event => {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/messages/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      setMessages([...messages, { ...result.message, sender_id: user?.id }]);
      setBody("");
      await loadConversations();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para usar as mensagens. <Link to="/login">Entrar</Link></div></div>;

  const personRow = item => <button className={`conversation-row ${String(item.id) === userId ? "selected" : ""}${item.unread ? " unread" : ""}`} key={item.id} onClick={() => navigate(`/messages/${item.id}`)}>
    <Avatar user={item} />
    <span><strong>{item.display_name}</strong><small>{item.latest_message || `@${item.username}`}</small></span>
    {item.unread > 0 && <span className="unread-count" aria-label={`${item.unread} mensagens por ler`}>{item.unread}</span>}
  </button>;

  return <div className="page messages-layout card">
    <aside className="conversation-list">
      <h1>Mensagens</h1>
      <form className="search-form pages-search" onSubmit={searchUsers}><Icon name="search" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Procurar pessoas" aria-label="Procurar pessoas para conversar" /></form>
      {results.map(personRow)}
      {conversations.map(personRow)}
      {!conversations.length && !results.length && <p className="muted">Procura uma pessoa para iniciar uma conversa.</p>}
    </aside>
    <section className="chat-panel">
      {selected ? <>
        <header className="chat-header"><Avatar user={selected} /><div><strong>{selected.display_name}</strong><small>@{selected.username}</small></div></header>
        <div className="chat-messages" aria-live="polite">
          {messages.map(message => {
            const mine = String(message.sender_id) === String(user.id);
            return <div className={`message-bubble ${mine ? "mine" : ""}`} key={message.id}>
              {message.body}
              <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}{mine && message.read_at ? " · lida" : ""}</time>
            </div>;
          })}
          <div ref={chatEnd} />
        </div>
        {canMessage
          ? <form className="chat-form" onSubmit={sendMessage}><input value={body} onChange={event => setBody(event.target.value)} placeholder="Escreve uma mensagem..." maxLength="4000" /><button className="round-button chat-send" aria-label="Enviar mensagem" title="Enviar" disabled={busy || !body.trim()}><Icon name="send" size={18} /></button></form>
          : <p className="chat-blocked muted">Não é possível enviar mensagens para esta conta.</p>}
      </> : <div className="empty chat-empty"><span className="group-lock-icon chat-empty-icon"><Icon name="messages" size={26} /></span><strong>As tuas conversas</strong><span>Escolhe uma conversa ou procura alguém para enviar uma mensagem.</span></div>}
      {error && <p className="error">{error}</p>}
    </section>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Grupos: descobrir, participar, criar e conversar em grupo (mesma linguagem das Páginas)
// ---------------------------------------------------------------------------------------------
function GroupLogo({ group, size = "" }) {
  return <span className={`page-logo group-logo tone-page-${pageTone(group.name)} ${size}`} aria-hidden="true">{pageMonogram(group.name)}</span>;
}

function MemberStack({ members = [], total }) {
  if (!members.length) return null;
  return <span className="member-stack" aria-label={`${formatCount(total)} ${total === 1 ? "membro" : "membros"}`}>
    {members.slice(0, 4).map(member => <Avatar key={member.username} user={member} size="tiny" />)}
    {total > 4 && <span className="member-stack-more">+{formatCount(total - 4)}</span>}
  </span>;
}

function JoinGroupButton({ group, user, busy, onJoin, onLeave }) {
  if (!user) return <Link className="btn" to="/login">Entrar para participar</Link>;
  if (group.owner_username === user.username) return <Link className="btn secondary" to={`/groups/${group.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  return group.is_member
    ? <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onLeave(group)}>
      <Icon name="check" size={15} /><span className="when-idle">Membro</span><span className="when-hover">Sair do grupo</span></button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onJoin(group)}><Icon name="plus" size={15} /> Participar</button>;
}

function GroupCard({ group, user, busy, onJoin, onLeave }) {
  return <article className="page-card card">
    <Link className={`page-card-cover tone-page-${pageTone(group.name)}`} to={`/groups/${group.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/groups/${group.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><GroupLogo group={group} /></Link>
      <h2><Link to={`/groups/${group.id}`}>{group.name}</Link></h2>
      <p className="page-card-description">{group.description || "Um espaço para a comunidade."}</p>
      <div className="group-card-meta">
        <MemberStack members={group.member_preview} total={group.member_count} />
        <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"} · {formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
      </div>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${group.owner_username}`}><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>{group.owner_name}</span></Link>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} />
      </div>
    </div>
  </article>;
}

function CreateGroupDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated(result.group);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { name: form.name || "Nome do grupo" };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-group-title">Criar grupo</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Fotógrafos de Luanda" /></label>
          <label>Sobre o que é <small>{form.description.length}/2000</small><textarea rows={5} maxLength={2000} value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Diz quem deve participar e o que se partilha aqui." /></label>
          <p className="muted create-page-note">Só os membros veem e publicam no grupo. Tu ficas como administrador.</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.name)}`} />
            <div className="page-card-body">
              <GroupLogo group={preview} />
              <h2>{preview.name}</h2>
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim()}>{busy ? "A criar..." : "Criar grupo"}</button>
      </div>
    </form>
  </div>, document.body);
}

function Groups() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [groups, setGroups] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const group = groups?.find(item => String(item.id) === groupId);
  const ownsGroup = Boolean(group && user && group.owner_username === user.username);

  const loadGroups = async () => {
    try {
      const result = await api("/groups");
      setGroups(result.groups);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  const loadPosts = id => api(`/posts?groupId=${encodeURIComponent(id)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

  useEffect(() => { loadGroups(); }, [user?.id]);
  // As publicações de um grupo só são visíveis para os membros.
  useEffect(() => {
    setPosts(null);
    if (groupId && group?.is_member) loadPosts(groupId);
    if (groupId) window.scrollTo(0, 0);
  }, [groupId, group?.is_member]);

  const setMembership = async (target, joining) => {
    setError("");
    const apply = (value, delta) => setGroups(current => current.map(item => item.id === target.id
      ? { ...item, is_member: value, member_count: item.member_count + delta } : item));
    apply(joining, joining ? 1 : -1);
    try {
      await api(`/groups/${target.id}/${joining ? "join" : "leave"}`, { method: "POST" });
    } catch (membershipError) {
      apply(!joining, joining ? -1 : 1);
      setError(membershipError.message);
    }
  };

  const deleteGroup = async () => {
    if (!window.confirm(`Apagar o grupo «${group.name}» e todas as publicações dele? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api(`/groups/${group.id}`, { method: "DELETE" });
      setGroups(current => current.filter(item => item.id !== group.id));
      navigate("/groups");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };

  // ----- Grupo individual -----
  if (groupId) {
    if (!groups && !error) return <div className="page narrow"><div className="empty card">A carregar grupo...</div></div>;
    if (!group) return <div className="page narrow"><div className="empty card">Este grupo não existe ou foi apagado. <Link to="/groups">Ver todos os grupos</Link></div></div>;
    return <div className="pages-view page-detail">
      <Link className="page-back" to="/groups"><Icon name="previous" size={18} /> Todos os grupos</Link>
      <section className="page-hero card">
        <div className={`page-hero-cover tone-page-${pageTone(group.name)}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(group.name)}</span></div>
        <div className="page-hero-body">
          <GroupLogo group={group} size="large" />
          <div className="page-hero-text">
            <h1>{group.name}</h1>
            <p><span className="page-category"><Icon name="groups" size={13} /> Grupo</span>
              <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"}</span>
              <span>{formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
              <MemberStack members={group.member_preview} total={group.member_count} /></p>
          </div>
          <div className="page-hero-actions">
            {ownsGroup
              ? <button className="btn secondary danger-text" type="button" disabled={busy} onClick={deleteGroup}><Icon name="trash" size={15} /> Apagar grupo</button>
              : <JoinGroupButton group={group} user={user} busy={busy} onJoin={item => setMembership(item, true)} onLeave={item => setMembership(item, false)} />}
          </div>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="page-detail-grid">
        <aside className="page-about card">
          <h2>Sobre</h2>
          <p>{group.description || "Um espaço para a comunidade."}</p>
          <ul>
            <li><Icon name="shield" size={16} /><span>Só os membros veem e publicam</span></li>
            <li><Icon name="profile" size={16} /><span>Criado por <Link to={`/u/${group.owner_username}`}>{group.owner_name}</Link></span></li>
            <li><Icon name="events" size={16} /><span>Desde {new Date(group.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
          </ul>
        </aside>
        <section className="page-posts" aria-label="Publicações do grupo">
          {group.is_member ? <>
            <Composer target={{ type: "group", id: group.id }} onPosted={() => { loadPosts(group.id); loadGroups(); }} />
            {!posts && <div className="empty card">A carregar publicações...</div>}
            {posts?.map(post => <PostCard key={post.id} post={post} onChanged={() => loadPosts(group.id)} />)}
            {posts && !posts.length && <div className="empty card page-empty"><GroupLogo group={group} /><p>Ainda não há conversa neste grupo. Começa tu: apresenta-te ou faz uma pergunta.</p></div>}
          </> : <div className="empty card page-empty group-locked">
            <span className="group-lock-icon"><Icon name="shield" size={26} /></span>
            <p>As publicações deste grupo só são visíveis para os membros.</p>
            <JoinGroupButton group={group} user={user} busy={busy} onJoin={item => setMembership(item, true)} onLeave={item => setMembership(item, false)} />
          </div>}
        </section>
      </div>
    </div>;
  }

  // ----- Lista de grupos -----
  const all = groups || [];
  const mine = all.filter(item => user && item.owner_username === user.username);
  const joined = all.filter(item => item.is_member && !(user && item.owner_username === user.username));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["joined", "Participas", joined.length], ["mine", "Criados por ti", mine.length]] : [])];
  const source = tab === "mine" ? mine : tab === "joined" ? joined : all;
  const term = query.trim().toLowerCase();
  const visible = source.filter(item => !term || `${item.name} ${item.description} ${item.owner_name}`.toLowerCase().includes(term));

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Grupos</h1><p>Junta-te a pessoas com os mesmos interesses e conversa num espaço só para membros.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>
        : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que grupos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar grupos" aria-label="Procurar grupos" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!groups && !error && <div className="empty card">A carregar grupos...</div>}
    {groups && !visible.length && <div className="empty card pages-empty">
      {term ? <p>Nenhum grupo corresponde à pesquisa.</p>
        : tab === "mine" ? <><p>Ainda não criaste nenhum grupo. Junta pessoas à volta de um tema que gostas.</p><button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar o primeiro grupo</button></>
          : tab === "joined" ? <><p>Ainda não participas em nenhum grupo.</p><button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir grupos</button></>
            : <><p>Ainda não há grupos. Cria o primeiro e convida os teus amigos.</p>{user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>}</>}
    </div>}
    {visible.length > 0 && <div className="pages-grid">{visible.map(item => <GroupCard key={item.id} group={item} user={user} busy={busy}
      onJoin={target => setMembership(target, true)} onLeave={target => setMembership(target, false)} />)}</div>}
    {creating && <CreateGroupDialog onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadGroups().then(() => navigate(`/groups/${created.id}`)); }} />}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Páginas: descobrir, seguir, criar e ver páginas
// ---------------------------------------------------------------------------------------------
const PAGE_CATEGORIES = ["Comunidade", "Negócio local", "Marca", "Artista", "Música", "Desporto", "Educação", "Tecnologia",
  "Moda e beleza", "Comida e bebida", "Notícias", "Entretenimento", "Organização sem fins lucrativos"];

// Cada categoria fica sempre com a mesma família de cor (lagoa, céu, coral ou tinta).
const pageTone = category => {
  const text = (category || "Comunidade").toLowerCase();
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["lagoa", "ceu", "coral", "tinta"][hash % 4];
};

// Monograma: iniciais das duas primeiras palavras ("Loja da Rita" → "LR").
const pageMonogram = name => (name || "?").split(/\s+/).filter(word => word.length > 2 || /^[A-ZÁ-Ú]/.test(word))
  .slice(0, 2).map(word => word.charAt(0).toUpperCase()).join("") || (name || "?").charAt(0).toUpperCase();

function PageLogo({ page, size = "" }) {
  return <span className={`page-logo tone-page-${pageTone(page.category)} ${size}`} aria-hidden="true">{pageMonogram(page.name)}</span>;
}

function FollowPageButton({ page, user, busy, onFollow, onUnfollow }) {
  if (!user) return <Link className="btn" to="/login">Entrar para seguir</Link>;
  if (page.owner_username === user.username) return <Link className="btn secondary" to={`/pages/${page.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  return page.is_following
    ? <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onUnfollow(page)}>
      <Icon name="check" size={15} /><span className="when-idle">A seguir</span><span className="when-hover">Deixar de seguir</span></button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onFollow(page)}><Icon name="plus" size={15} /> Seguir</button>;
}

function PageCard({ page, user, busy, onFollow, onUnfollow }) {
  return <article className="page-card card">
    <Link className={`page-card-cover tone-page-${pageTone(page.category)}`} to={`/pages/${page.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/pages/${page.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><PageLogo page={page} /></Link>
      <h2><Link to={`/pages/${page.id}`}>{page.name}</Link></h2>
      <span className="page-category">{page.category}</span>
      <p className="page-card-description">{page.description || "Ainda sem descrição."}</p>
      <dl className="page-card-stats">
        <div><dt>Seguidores</dt><dd>{formatCount(page.follower_count)}</dd></div>
        <div><dt>Publicações</dt><dd>{formatCount(page.post_count)}</dd></div>
      </dl>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${page.owner_username}`}><Avatar user={{ display_name: page.owner_name, avatar_url: page.owner_avatar }} size="tiny" /><span>{page.owner_name}</span></Link>
        <FollowPageButton page={page} user={user} busy={busy} onFollow={onFollow} onUnfollow={onUnfollow} />
      </div>
    </div>
  </article>;
}

function CreatePageDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", category: "Comunidade", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated(result.page);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { ...form, name: form.name || "Nome da página", follower_count: 1, post_count: 0 };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-page-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-page-title">Criar página</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Loja da Rita" /></label>
          <label>Categoria<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
            {PAGE_CATEGORIES.map(category => <option key={category}>{category}</option>)}
          </select></label>
          <label>Descrição <small>{form.description.length}/2000</small><textarea rows={4} maxLength={2000} value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Conta às pessoas o que vão encontrar nesta página." /></label>
          <p className="muted create-page-note">És tu quem publica na página. As pessoas que a seguem veem as publicações no feed.</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.category)}`} />
            <div className="page-card-body">
              <PageLogo page={preview} />
              <h2>{preview.name}</h2>
              <span className="page-category">{preview.category}</span>
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim()}>{busy ? "A criar..." : "Criar página"}</button>
      </div>
    </form>
  </div>, document.body);
}

function Pages() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [pages, setPages] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const page = pages?.find(item => String(item.id) === pageId);
  const ownsPage = Boolean(page && user && page.owner_username === user.username);

  const loadPages = async () => {
    try {
      const result = await api("/pages");
      setPages(result.pages);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadPages(); }, [user?.id]);
  useEffect(() => {
    setPosts(null);
    if (!pageId) return;
    api(`/posts?pageId=${encodeURIComponent(pageId)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));
    window.scrollTo(0, 0);
  }, [pageId]);

  // Seguir/deixar de seguir muda logo no ecrã; se o servidor falhar, volta atrás.
  const setFollowing = async (target, following) => {
    setError("");
    const apply = (value, delta) => setPages(current => current.map(item => item.id === target.id
      ? { ...item, is_following: value, follower_count: item.follower_count + delta } : item));
    apply(following, following ? 1 : -1);
    try {
      await api(`/pages/${target.id}/follow`, { method: following ? "POST" : "DELETE" });
    } catch (followError) {
      apply(!following, following ? -1 : 1);
      setError(followError.message);
    }
  };

  const deletePage = async () => {
    if (!window.confirm(`Apagar a página «${page.name}» e todas as publicações dela? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api(`/pages/${page.id}`, { method: "DELETE" });
      setPages(current => current.filter(item => item.id !== page.id));
      navigate("/pages");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };

  const reloadPosts = () => api(`/posts?pageId=${page.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

  // ----- Página individual -----
  if (pageId) {
    if (!pages && !error) return <div className="page narrow"><div className="empty card">A carregar página...</div></div>;
    if (!page) return <div className="page narrow"><div className="empty card">Esta página não existe ou foi apagada. <Link to="/pages">Ver todas as páginas</Link></div></div>;
    const tone = pageTone(page.category);
    return <div className="pages-view page-detail">
      <Link className="page-back" to="/pages"><Icon name="previous" size={18} /> Todas as páginas</Link>
      <section className="page-hero card">
        <div className={`page-hero-cover tone-page-${tone}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(page.name)}</span></div>
        <div className="page-hero-body">
          <PageLogo page={page} size="large" />
          <div className="page-hero-text">
            <h1>{page.name}</h1>
            <p><span className="page-category">{page.category}</span><span>{formatCount(page.follower_count)} {page.follower_count === 1 ? "seguidor" : "seguidores"}</span><span>{formatCount(page.post_count)} {page.post_count === 1 ? "publicação" : "publicações"}</span></p>
          </div>
          <div className="page-hero-actions">
            {ownsPage
              ? <button className="btn secondary danger-text" type="button" disabled={busy} onClick={deletePage}><Icon name="trash" size={15} /> Apagar página</button>
              : <FollowPageButton page={page} user={user} busy={busy} onFollow={item => setFollowing(item, true)} onUnfollow={item => setFollowing(item, false)} />}
          </div>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="page-detail-grid">
        <aside className="page-about card">
          <h2>Sobre</h2>
          <p>{page.description || "Esta página ainda não tem descrição."}</p>
          <ul>
            <li><Icon name="pages" size={16} /><span>{page.category}</span></li>
            <li><Icon name="profile" size={16} /><span>Criada por <Link to={`/u/${page.owner_username}`}>{page.owner_name}</Link></span></li>
            <li><Icon name="events" size={16} /><span>Desde {new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
          </ul>
        </aside>
        <section className="page-posts" aria-label="Publicações da página">
          {ownsPage && <Composer target={{ type: "page", id: page.id }} onPosted={() => { reloadPosts(); loadPages(); }} />}
          {!posts && <div className="empty card">A carregar publicações...</div>}
          {posts?.map(post => <PostCard key={post.id} post={post} onChanged={reloadPosts} />)}
          {posts && !posts.length && <div className="empty card page-empty">
            <PageLogo page={page} />
            <p>{ownsPage ? "A tua página ainda não tem publicações. Escreve a primeira acima — quem te segue vai vê-la no feed." : "Esta página ainda não publicou nada. Segue-a para veres as novidades no teu feed."}</p>
          </div>}
        </section>
      </div>
    </div>;
  }

  // ----- Lista de páginas -----
  const all = pages || [];
  const mine = all.filter(item => user && item.owner_username === user.username);
  const followed = all.filter(item => item.is_following && !(user && item.owner_username === user.username));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["mine", "As tuas páginas", mine.length], ["following", "A seguir", followed.length]] : [])];
  const source = tab === "mine" ? mine : tab === "following" ? followed : all;
  const categories = [...new Set(all.map(item => item.category))].sort((a, b) => a.localeCompare(b, "pt"));
  const term = query.trim().toLowerCase();
  const visible = source.filter(item => (!category || item.category === category)
    && (!term || `${item.name} ${item.description} ${item.category} ${item.owner_name}`.toLowerCase().includes(term)));

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Páginas</h1><p>Segue negócios, artistas e projetos da tua comunidade, ou cria a tua.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar página</button>
        : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que páginas mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar páginas" aria-label="Procurar páginas" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {categories.length > 1 && <div className="province-chips pages-categories" role="group" aria-label="Categorias">
      <button type="button" className="province-chip" aria-pressed={!category} onClick={() => setCategory("")}>Todas</button>
      {categories.map(item => <button key={item} type="button" className="province-chip" aria-pressed={category === item} onClick={() => setCategory(category === item ? "" : item)}>{item}</button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!pages && !error && <div className="empty card">A carregar páginas...</div>}
    {pages && !visible.length && <div className="empty card pages-empty">
      {tab === "mine" && !term && !category
        ? <><p>Ainda não criaste nenhuma página. Uma página serve para o teu negócio, projeto ou arte ter o seu próprio espaço.</p><button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar a primeira página</button></>
        : tab === "following" && !term && !category
          ? <><p>Ainda não segues nenhuma página.</p><button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir páginas</button></>
          : <p>Nenhuma página corresponde à pesquisa.</p>}
    </div>}
    {visible.length > 0 && <div className="pages-grid">{visible.map(item => <PageCard key={item.id} page={item} user={user} busy={busy}
      onFollow={target => setFollowing(target, true)} onUnfollow={target => setFollowing(target, false)} />)}</div>}
    {creating && <CreatePageDialog onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadPages().then(() => navigate(`/pages/${created.id}`)); }} />}
  </div>;
}

function App() {
  return <Layout><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/reels" element={<Reels />} />
    <Route path="/login" element={<Auth key="login" mode="login" />} />
    <Route path="/register" element={<Auth key="register" mode="register" />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/create" element={<Create />} />
    <Route path="/friends" element={<Friends />} />
    <Route path="/messages" element={<Messages />} />
    <Route path="/messages/:userId" element={<Messages />} />
    <Route path="/groups" element={<Groups />} />
    <Route path="/groups/:groupId" element={<Groups />} />
    <Route path="/pages" element={<Pages />} />
    <Route path="/pages/:pageId" element={<Pages />} />
    <Route path="/events" element={<Events />} />
    <Route path="/notifications" element={<Notifications />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/settings/:section" element={<Settings />} />
    <Route path="/profile/edit" element={<EditProfile />} />
    <Route path="/moderation" element={<Moderation />} />
    <Route path="/stats" element={<Navigate to="/creator/insights" replace />} />
    <Route path="/creator" element={<CreatorDashboard />} />
    <Route path="/estrelas" element={<StarsPage />} />
    <Route path="/marcas" element={<BrandsPage />} />
    <Route path="/desafios" element={<ChallengesPage />} />
    <Route path="/desafios/:challengeId" element={<ChallengesPage />} />
    <Route path="/convidar" element={<InvitePage />} />
    <Route path="/academia" element={<AcademyPage />} />
    <Route path="/live" element={<LivePage />} />
    <Route path="/live/:liveId" element={<LivePage />} />
    <Route path="/publicidade" element={<AdRules />} />
    <Route path="/admin" element={<AdminPage />} />
    <Route path="/admin/:tab" element={<AdminPage />} />
    <Route path="/creator/:section" element={<CreatorDashboard />} />
    <Route path="/about" element={<About />} />
    <Route path="/help" element={<Help />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/u/:username/about" element={<Profile />} />
    <Route path="/u/:username" element={<Profile />} />
  </Routes></Layout>;
}

applyDevicePrefs(readDevicePrefs());
createRoot(document.getElementById("root")).render(<BrowserRouter><App /></BrowserRouter>);
