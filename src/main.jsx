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
  Zap
} from "lucide-react";
import "@fontsource-variable/nunito";
import "@fontsource-variable/bricolage-grotesque";
import { AvatarEditor, CoverEditor, downscaleImage } from "./PhotoEditors.jsx";
import "./styles.css";

const API_BASE = (import.meta.env.DEV ? "" : import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API = `${API_BASE}/api`;
const UserContext = createContext({ user: null, refreshUser: () => {} });
const ThemeContext = createContext({ theme: "light", setTheme: () => {} });
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
// As edições (corte, velocidade, efeito, texto, som) vêm do servidor em post.video_edit e são
// aplicadas aqui, no leitor; o ficheiro original não é alterado.
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
const DEFAULT_VIDEO_EDIT = { start: 0, end: null, speed: 1, filter: "none", muted: false, text: "", textPosition: "bottom", textStyle: "clean" };

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
// barra de progresso que se pode arrastar. Começa sozinho quando aparece no ecrã e pára quando sai.
function VideoPlayer({ src, edit, className = "", autoPlay = true, label = "Vídeo" }) {
  const settings = { ...DEFAULT_VIDEO_EDIT, ...(edit || {}) };
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
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

  // No editor, mudar o corte leva logo o vídeo para o novo início.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (video.currentTime < clipStart || video.currentTime > clipEnd()) video.currentTime = clipStart;
  }, [clipStart, settings.end, duration]);

  useEffect(() => {
    reelSoundListeners.add(setSoundOn);
    return () => reelSoundListeners.delete(setSoundOn);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = settings.muted || !soundOn;
    video.playbackRate = settings.speed;
  }, [soundOn, settings.muted, settings.speed]);

  // Começa quando pelo menos 60% do vídeo está visível; pára quando sai do ecrã.
  useEffect(() => {
    const video = videoRef.current;
    if (!autoPlay || !video) return undefined;
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
    if (settings.muted) return;
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
    } else if (video.currentTime < clipStart - 0.2) {
      video.currentTime = clipStart;
    }
    const length = end - clipStart;
    setProgress(length > 0 ? Math.min(1, Math.max(0, (video.currentTime - clipStart) / length)) : 0);
  };

  const remaining = clipLength * (1 - progress);
  return <div ref={wrapRef} className={`video-player ${fullscreen ? "is-fullscreen" : ""} ${playing ? "is-playing" : "is-paused"} ${className}`}
    role="button" tabIndex={0} aria-label={`${label}. ${playing ? "Toca para pausar" : "Toca para ver"}`}
    onClick={togglePlay} onKeyDown={onKey}>
    <video ref={videoRef} src={src} playsInline loop={false} preload="metadata"
      style={{ filter: VIDEO_FILTER_CSS[settings.filter] || "none" }}
      onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onWaiting={() => setLoading(true)} onPlaying={() => { setLoading(false); setPlaying(true); }}
      onPause={() => setPlaying(false)} onEnded={() => { const video = videoRef.current; video.currentTime = clipStart; video.play().catch(() => {}); }} />
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
      <span className="video-time">{formatClock(Math.ceil(playing || progress ? remaining : clipLength))}</span>
      <button type="button" className={`video-control ${soundOn && !settings.muted ? "is-on" : ""}`} disabled={settings.muted}
        aria-label={settings.muted ? "Vídeo sem som" : soundOn ? "Tirar o som" : "Ativar o som"} aria-pressed={soundOn && !settings.muted} onClick={toggleSound}>
        <Icon name={soundOn && !settings.muted ? "volumeOn" : "volumeOff"} size={18} />
        {!soundOn && !settings.muted && <span className="video-sound-hint">Ativar som</span>}
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
  move: Move,
  report: Flag,
  shield: ShieldCheck,
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
  const [theme, setTheme] = useState(() => (localStorage.getItem("biva-theme") || localStorage.getItem("nova-theme")) === "dark" ? "dark" : "light");
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [authReady, setAuthReady] = useState(!token());
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("biva-theme", theme);
    localStorage.removeItem("nova-theme");
  }, [theme]);

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
  return <ThemeContext.Provider value={{ theme, setTheme }}><UserContext.Provider value={{ user, refreshUser, authReady }}>
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
      ? <VideoPlayer className="media" src={`${API_BASE}${post.media_url}`} edit={post.video_edit} label={`Vídeo de ${post.display_name}`} />
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
  ["speed", "speed", "Velocidade"],
  ["effects", "effects", "Efeitos"],
  ["text", "text", "Texto"],
  ["sound", "sound", "Som"]
];

function ShareReelDialog({ onClose, onPosted }) {
  const { user } = useContext(UserContext);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [edit, setEdit] = useState(DEFAULT_VIDEO_EDIT);
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
  // Vídeo novo: edição do zero; vídeos com mais de 3 minutos ficam logo cortados nos primeiros 3.
  useEffect(() => {
    setEdit({ ...DEFAULT_VIDEO_EDIT, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null });
  }, [duration]);

  const update = changes => setEdit(current => ({ ...current, ...changes }));
  const end = edit.end ?? duration;
  const clipSeconds = Math.max(0, end - edit.start);
  const edited = edit.start > 0 || (edit.end !== null && edit.end < duration - 0.05) || edit.speed !== 1 || edit.filter !== "none" || edit.muted || edit.text.trim();

  const choose = picked => {
    setError("");
    if (!picked) return;
    if (!picked.type.startsWith("video/")) return setError("Escolhe um ficheiro de vídeo.");
    if (picked.size > MAX_VIDEO_BYTES) return setError("O vídeo tem mais de 100 MB. Escolhe um mais curto.");
    setFile(picked);
    setTool("trim");
  };

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
      const { text, textPosition, textStyle, ...rest } = edit;
      formData.append("videoEdit", JSON.stringify({ ...rest, ...(text.trim() && { text: text.trim(), textPosition, textStyle }) }));
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
            <VideoPlayer key={preview} src={preview} edit={edit} label="Pré-visualização do teu vídeo" />
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
                className={tool === id ? "active" : ""} onClick={() => setTool(id)}><Icon name={icon} size={18} /><span>{label}</span></button>)}
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
                  <span>Duração <strong>{formatClock(clipSeconds / edit.speed)}</strong></span>
                </p>
                {duration > MAX_CLIP_SECONDS && <p className="reel-hint">Os reels podem ter até 3 minutos. Arrasta para escolher a melhor parte.</p>}
              </>}

              {tool === "speed" && <div className="reel-chips" role="radiogroup" aria-label="Velocidade">
                {VIDEO_SPEEDS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={edit.speed === value}
                  className={edit.speed === value ? "active" : ""} onClick={() => update({ speed: value })}>{label}</button>)}
                <p className="reel-hint">{edit.speed < 1 ? "Câmara lenta: ótimo para danças e momentos especiais." : edit.speed > 1 ? "Acelerado: bom para receitas, viagens e tutoriais." : "Velocidade normal."}</p>
              </div>}

              {tool === "effects" && <div className="reel-effects" role="radiogroup" aria-label="Efeitos">
                {VIDEO_FILTERS.map(([id, label, css]) => <button key={id} type="button" role="radio" aria-checked={edit.filter === id}
                  className={edit.filter === id ? "active" : ""} onClick={() => update({ filter: id })}>
                  <span className="reel-effect-thumb">{thumb ? <img src={thumb} alt="" style={{ filter: css }} /> : <i style={{ filter: css }} />}</span>
                  <small>{label}</small>
                </button>)}
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

              {tool === "sound" && <label className="reel-sound-toggle">
                <input type="checkbox" checked={!edit.muted} onChange={event => update({ muted: !event.target.checked })} />
                <span className="entry-switch-track" aria-hidden="true"><i /></span>
                <span><strong>Som original</strong><small>{edit.muted ? "O vídeo vai ser publicado sem som." : "Quem vê ouve o som do vídeo quando ativa o som."}</small></span>
              </label>}
            </div>
            {edited && <button type="button" className="reel-reset" onClick={() => setEdit({ ...DEFAULT_VIDEO_EDIT, end: duration > MAX_CLIP_SECONDS ? MAX_CLIP_SECONDS : null })}>
              <Icon name="reset" size={14} />Repor o original</button>}
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

  return <div className="settings-action-row settings-blocked">
    <span className="settings-action-mark"><Icon name="block" /></span>
    <span>
      <strong>Contas bloqueadas</strong>
      <small>{blocked === null ? "A carregar..." : blocked.length ? "Estas contas não te veem nem te podem contactar." : "Não bloqueaste nenhuma conta."}</small>
      {!!blocked?.length && <div className="blocked-list">
        {blocked.map(person => <div key={person.id}>
          <Avatar user={person} size="tiny" />
          <span><strong>{person.display_name}</strong> <small>@{person.username}</small></span>
          <button className="settings-account-link" type="button" onClick={() => unblock(person.id)}>Desbloquear</button>
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
        <Link className="btn secondary" to="/settings"><Icon name="settings" size={16} /> {data.price > 0 ? "Alterar preço" : "Definir preço"}</Link>
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

function AdPreview({ ad, imageSrc }) {
  return <div className="home-sponsor ad-preview" aria-label="Pré-visualização do anúncio">
    <span className="home-sponsor-art">{imageSrc ? <img src={imageSrc} alt="" /> : <img src="/biva-logo.png" alt="" />}</span>
    <span><strong>{ad.title || "Título do anúncio"}</strong><small>{ad.body || "O texto do teu anúncio aparece aqui."}</small></span>
  </div>;
}

const EMPTY_AD = { kind: "boost", postId: "", title: "", body: "", destination: "profile", linkUrl: "", budget: "5000", days: "7", provinces: [], minAge: "", maxAge: "" };

// Só publicações públicas tuas podem ser impulsionadas.
const canBoost = post => !post.is_exclusive && !post.group_id && !post.hidden_at && !post.shared_post_id;

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
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

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
  const reach = Math.floor((Number(form.budget) || 0) / (cost * (targeted ? 1 + surcharge : 1)));
  const toggleProvince = province => update("provinces", form.provinces.includes(province) ? form.provinces.filter(item => item !== province) : [...form.provinces, province]);
  const selectedPost = posts.find(post => String(post.id) === String(form.postId));

  const [paying, setPaying] = useState(null);
  const paidNotice = "Pagamento recebido. A promoção fica em revisão e entra no ar assim que a equipa a aprovar (normalmente em menos de 24 horas).";

  // Criar: abre o ecrã de pagamento; a promoção só é criada quando se escolhe como pagar.
  const submit = async event => {
    event.preventDefault();
    if (form.kind === "boost" && !form.postId) return setFormError("Escolhe a publicação que queres impulsionar.");
    setFormError("");
    let createdId = null;
    setPaying({
      title: form.kind === "boost" ? "Pagar publicação impulsionada" : "Pagar anúncio",
      amount: Number(form.budget) || 0,
      onPay: async choice => {
        // Segunda tentativa (por exemplo, outro método): paga a promoção já criada.
        if (createdId) return api(`/ads/${createdId}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) });
        const data = await buildAdForm();
        Object.entries(choice).forEach(([key, value]) => data.append(key, value));
        const result = await api("/ads", { method: "POST", body: data });
        createdId = result.id;
        setCreating(false);
        setForm(EMPTY_AD);
        setImage(null);
        return result;
      }
    });
  };

  const buildAdForm = async () => {
    {
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
    }
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

  return <>
    {paying && <PaymentDialog title={paying.title} amountKz={paying.amount} onPay={paying.onPay}
      onDone={() => { setNotice(paidNotice); load(); }} onClose={() => { setPaying(null); load(); }} />}
    <section className="creator-card" aria-labelledby="ads-full-title">
      <div className="creator-card-head">
        <div><h2 id="ads-full-title">Anúncios e publicações impulsionadas</h2>
          <p>Pagas uma vez e o Biva mostra a tua promoção automaticamente a quem ainda não a viu: {formatPrice(cost * 1000)} por cada 1000 pessoas alcançadas.</p></div>
        {!creating && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar promoção</button>}
      </div>
      {notice && <p className="success" role="status">{notice}</p>}
      {payments === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Pagamentos em modo de demonstração: as promoções ficam ativas sem cobrança. Configura a Stripe para cobrar.</p>}

      {creating && <form className="ad-form" onSubmit={submit}>
        <div className="ad-form-fields">
          <div className="ad-kind" role="radiogroup" aria-label="Tipo de promoção">
            <label className={form.kind === "boost" ? "is-selected" : ""}>
              <input type="radio" name="kind" checked={form.kind === "boost"} onChange={() => update("kind", "boost")} />
              <span className="ad-kind-icon"><Icon name="bolt" size={18} /></span>
              <span><strong>Impulsionar publicação</strong><small>Um vídeo, fotografia ou trabalho teu aparece no feed de mais pessoas.</small></span>
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
            <label>Título <small>{form.title.length}/80</small><input value={form.title} maxLength={80} required onChange={event => update("title", event.target.value)} placeholder="Ex.: Novas peças na loja da Rita" /></label>
            <label>Texto <small>{form.body.length}/200</small><textarea rows={3} value={form.body} maxLength={200} onChange={event => update("body", event.target.value)} placeholder="Diz em poucas palavras o que estás a promover." /></label>
            <label className="ad-image-field">Imagem <small>Opcional</small>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImage(event.target.files?.[0] || null)} />
            </label>
            <fieldset className="ad-destination">
              <legend>Quando alguém clica, vai para…</legend>
              <label><input type="radio" name="destination" checked={form.destination === "profile"} onChange={() => update("destination", "profile")} /> O teu perfil (@{user?.username})</label>
              <label><input type="radio" name="destination" checked={form.destination === "link"} onChange={() => update("destination", "link")} /> Um site</label>
              {form.destination === "link" && <input type="url" inputMode="url" placeholder="https://" value={form.linkUrl} required onChange={event => update("linkUrl", event.target.value)} aria-label="Endereço do site" />}
            </fieldset>
          </>}

          <div className="ad-budget">
            <label>Orçamento total (Kz) <input type="number" min="1000" max="10000000" step="500" required value={form.budget} onChange={event => update("budget", event.target.value)} /></label>
            <label>Duração <select value={form.days} onChange={event => update("days", event.target.value)}>
              {[1, 3, 7, 14, 30].map(value => <option key={value} value={value}>{value} {value === 1 ? "dia" : "dias"}</option>)}
            </select></label>
          </div>
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
          <p className="ad-review-note"><Icon name="shield" size={15} /> Depois do pagamento, a equipa revê a promoção (normalmente em menos de 24 horas). Se for recusada, devolvemos o valor. Lê as <Link to="/publicidade">Regras de publicidade</Link>.</p>
          <p className="ad-estimate"><Icon name="friends" size={16} /> Alcance estimado: até <strong>{formatCount(reach)}</strong> pessoas em {form.days} {form.days === "1" ? "dia" : "dias"} · cerca de {formatPrice(Math.round((Number(form.budget) || 0) / Number(form.days)))} por dia.</p>
          {formError && <p className="error" role="alert">{formError}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setFormError(""); }}>Cancelar</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? "A preparar..." : `Pagar ${formatPrice(Number(form.budget) || 0)} e publicar`}</button>
          </div>
        </div>
        <div className="ad-form-preview">
          <h3>Pré-visualização</h3>
          {form.kind === "boost"
            ? <><p className="muted">Aparece no feed com a etiqueta «Patrocinado».</p>
              {selectedPost ? <div className="boost-preview"><span className="boost-preview-label"><Icon name="spark" size={13} /> Patrocinado</span><ContentThumb post={selectedPost} /></div>
                : <p className="muted">Escolhe uma publicação.</p>}</>
            : <><p className="muted">Assim aparece em «Patrocinado».</p><AdPreview ad={form} imageSrc={imagePreview} /></>}
        </div>
      </form>}

      {error && <p className="error" role="alert">{error}</p>}
      {!ads && !error && <div className="creator-loading">A carregar...</div>}
      {ads && !ads.length && !creating && <p className="muted">Ainda não criaste nenhuma promoção.</p>}
      {ads && ads.length > 0 && <ul className="ad-list">
        {ads.map(ad => {
          const [statusLabel, statusClass] = AD_STATUS[ad.status] || AD_STATUS.ended;
          const ctr = ad.impressions ? ((ad.clicks / ad.impressions) * 100).toFixed(1).replace(".", ",") : "0";
          const spentRatio = Math.min(100, (ad.spent / ad.budget) * 100);
          const art = ad.post_id
            ? ad.post_media_url && ad.post_media_type === "image" ? <img src={`${API_BASE}${ad.post_media_url}`} alt="" /> : <Icon name="bolt" size={22} />
            : ad.image_url ? <img src={`${API_BASE}${ad.image_url}`} alt="" /> : <Icon name="ad" size={22} />;
          return <li className="ad-item" key={ad.id}>
            <span className="ad-item-art">{art}</span>
            <div className="ad-item-main">
              <div className="ad-item-title"><strong>{ad.title}</strong><span className={`status-pill ${statusClass}`}>{statusLabel}</span></div>
              <small>{ad.post_id ? "Publicação impulsionada" : "Anúncio"}{ad.target_provinces?.length ? ` · ${ad.target_provinces.join(", ")}` : ""}{ad.target_min_age || ad.target_max_age ? ` · ${ad.target_min_age || 13}–${ad.target_max_age || "100"} anos` : ""} · {ad.status === "pending_payment" ? `${ad.days} ${ad.days === 1 ? "dia" : "dias"} depois do pagamento` : `${ad.status === "ended" ? "terminou" : "termina"} a ${new Date(ad.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`}</small>
              <div className="ad-budget-bar" role="progressbar" aria-label="Orçamento gasto" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(spentRatio)}><span style={{ width: `${spentRatio}%` }} /></div>
              <small>{formatPrice(ad.spent)} de {formatPrice(ad.budget)} gastos</small>
            </div>
            <dl className="ad-metrics">
              <div><dt>Alcance</dt><dd>{formatCount(ad.impressions)}</dd></div>
              <div><dt>Cliques</dt><dd>{formatCount(ad.clicks)}</dd></div>
              <div><dt>Taxa de cliques</dt><dd>{ctr}%</dd></div>
            </dl>
            <div className="ad-actions">
              {ad.status === "pending_payment" && <button className="btn" type="button" onClick={() => pay(ad)}>Pagar {formatPrice(ad.budget)}</button>}
              {ad.status === "rejected" && ad.review_note && <small className="review-note">Motivo: {ad.review_note}{ad.refund_status === "refunded" ? " · valor devolvido" : ad.refund_status === "manual" || ad.refund_status === "failed" ? " · devolução em curso" : ""}</small>}
              {ad.status === "active" && <button className="btn secondary" type="button" onClick={() => setStatus(ad, "paused")}><Icon name="pause" size={15} /> Pausar</button>}
              {ad.status === "paused" && <button className="btn secondary" type="button" onClick={() => setStatus(ad, "active")}><Icon name="play" size={15} /> Retomar</button>}
              <button className="btn secondary icon-only" type="button" aria-label={`Apagar ${ad.title}`} title="Apagar" onClick={() => remove(ad)}><Icon name="trash" size={16} /></button>
            </div>
          </li>;
        })}
      </ul>}
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
  return <section className="settings-section card" id="audience" aria-labelledby="audience-heading">
    <div className="settings-section-heading">
      <span className="settings-option-icon"><Icon name="location" /></span>
      <div><p className="settings-section-kicker">Privado</p><h2 id="audience-heading">Província e idade</h2><p>Só servem para te mostrar promoções da tua zona e idade. Não aparecem no teu perfil, e a província só é vista pelas marcas se o autorizares.</p></div>
    </div>
    {data && <form className="audience-form" onSubmit={save}>
      <label>Província<select value={form.province} onChange={event => setForm({ ...form, province: event.target.value })}>
        <option value="">Prefiro não dizer</option>
        {data.provinces.map(province => <option key={province} value={province}>{province}</option>)}
      </select></label>
      <label>Data de nascimento<input type="date" value={form.birthDate} onChange={event => setForm({ ...form, birthDate: event.target.value })} /></label>
      <label className="audience-optin"><input type="checkbox" checked={form.showProvinceToBrands} disabled={!form.province}
        onChange={event => setForm({ ...form, showProvinceToBrands: event.target.checked })} />
        <span>Mostrar a minha província às marcas no marketplace <small>Só a província, nunca a idade. Podes desligar quando quiseres.</small></span></label>
      <button className="btn" type="submit">Guardar</button>
      {status && <span className="success" role="status">{status}</span>}
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
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
  const tabs = [["promocoes", "Promoções"], ["levantamentos", "Levantamentos"], ["financas", "Finanças"]];
  return <div className="page growth-page admin-page">
    <header className="admin-head"><h1>Administração</h1>
      <nav className="feed-tabs" aria-label="Áreas da administração">{tabs.map(([slug, label]) => <NavLink key={slug} to={`/admin/${slug}`} className={({ isActive }) => isActive || (tab === slug) ? "is-active" : ""}>{label}</NavLink>)}
        <Link to="/moderation">Denúncias</Link></nav>
    </header>
    {tab === "promocoes" && <AdminPromotions />}
    {tab === "levantamentos" && <AdminPayouts />}
    {tab === "financas" && <AdminFinance />}
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
// Diretos (lives): vídeo por WebRTC entre quem emite e cada espectador, chat e estrelas
// ---------------------------------------------------------------------------------------------
let pendingHostStream = null; // a câmara aberta no diálogo passa para a sala sem pedir outra vez

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

function LiveBadge({ small }) {
  return <span className={`live-badge${small ? " is-small" : ""}`}><span className="live-dot" aria-hidden="true" />Ao vivo</span>;
}

function StartLiveDialog({ onClose }) {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = null;
    if (!navigator.mediaDevices?.getUserMedia) { setError("Este browser não permite usar a câmara. Usa o Chrome, Edge ou Safari atualizados."); return undefined; }
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then(media => { current = media; setStream(media); if (videoRef.current) videoRef.current.srcObject = media; })
      .catch(() => setError("Não foi possível abrir a câmara e o microfone. Autoriza o acesso no browser e tenta outra vez."));
    return () => { if (current && current !== pendingHostStream) current.getTracks().forEach(track => track.stop()); };
  }, []);
  const start = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/lives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      pendingHostStream = stream;
      navigate(`/live/${result.id}`);
    } catch (startError) {
      setError(startError.message);
      setBusy(false);
    }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card start-live-dialog" role="dialog" aria-modal="true" aria-labelledby="start-live-title" onSubmit={start}>
      <div className="share-dialog-head">
        <h2 id="start-live-title">Começar um direto</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="start-live-preview">
        <video ref={videoRef} autoPlay muted playsInline />
        {!stream && !error && <span>A abrir a câmara...</span>}
        {stream && <LiveBadge small />}
      </div>
      <label className="start-live-title">Título do direto<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: Conversa sobre música angolana" /></label>
      <p className="muted create-page-note">Quem te segue recebe uma notificação. O vídeo chega diretamente a até 8 pessoas; o chat e as estrelas funcionam para todos.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn live-start-button" type="submit" disabled={busy || !stream || !title.trim()}><Icon name="live" size={16} /> {busy ? "A começar..." : "Entrar em direto"}</button>
      </div>
    </form>
  </div>, document.body);
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
  const [, tick] = useState(0);
  const load = () => api("/lives").then(result => setLives(result.lives)).catch(() => setLives([]));
  usePolling(load, 15000, true);
  useEffect(() => { load(); const timer = window.setInterval(() => tick(value => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const mine = lives?.find(live => user && live.username === user.username);
  return <div className="pages-view live-list">
    <header className="pages-head">
      <div><h1>Diretos</h1><p>Vê quem está a emitir agora, conversa no chat e apoia com estrelas.</p></div>
      {user ? (mine ? <Link className="btn live-start-button" to={`/live/${mine.id}`}><Icon name="live" size={16} /> Voltar ao teu direto</Link>
        : <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>)
        : <Link className="btn" to="/login">Entrar para emitir</Link>}
    </header>
    {!lives && <div className="empty card">A procurar diretos...</div>}
    {lives && !lives.length && <div className="empty card pages-empty live-empty">
      <span className="group-lock-icon live-empty-icon"><Icon name="live" size={26} /></span>
      <p>Ninguém está em direto neste momento. Sê a primeira pessoa: mostra o que estás a fazer, responde a perguntas, recebe estrelas.</p>
      {user && <button className="btn live-start-button" type="button" onClick={() => setStarting(true)}><Icon name="live" size={16} /> Começar um direto</button>}
    </div>}
    {lives?.length > 0 && <div className="pages-grid">{lives.map(live => <Link key={live.id} to={`/live/${live.id}`} className="live-card card">
      <span className={`live-card-cover tone-page-${pageTone(live.username)}`}>
        <span className="live-card-avatar"><Avatar user={live} size="large" /></span>
        <LiveBadge small />
        <span className="live-card-viewers"><Icon name="eye" size={13} /> {formatCount(live.viewers)}</span>
      </span>
      <span className="live-card-body">
        <strong>{live.title}</strong>
        <small>{live.display_name}<VerifiedBadge show={live.is_verified} /> · há {liveDuration(live.started_at)}</small>
      </span>
    </Link>)}</div>}
    {starting && <StartLiveDialog onClose={() => setStarting(false)} />}
  </div>;
}

function LiveRoom({ liveId }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [live, setLive] = useState(null);
  const [supporters, setSupporters] = useState([]);
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [config, setConfig] = useState({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], giftAmounts: [1, 5, 10, 50, 100] });
  const [videoState, setVideoState] = useState("connecting");
  const [muted, setMuted] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [panel, setPanel] = useState("chat");
  const [balance, setBalance] = useState(null);
  const [giftMessage, setGiftMessage] = useState("");
  const [, tick] = useState(0);
  const videoRef = useRef(null);
  const chatRef = useRef(null);
  const streamRef = useRef(null);
  const peers = useRef(new Map());     // quem emite: uma ligação por espectador
  const viewerPc = useRef(null);       // espectador: a ligação a quem emite
  const viewerSession = useRef("");    // identifica o pedido atual (ignora respostas antigas)
  const lastSignal = useRef(0);
  const lastComment = useRef(0);
  const isHost = Boolean(live?.is_host);
  const ended = live?.status === "ended";

  const loadLive = async () => {
    try {
      const result = await api(`/lives/${liveId}`);
      setLive(result.live);
      setSupporters(result.supporters);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    loadLive();
    api("/lives/config").then(setConfig).catch(() => {});
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveId]);

  // ----- Quem emite: câmara + uma ligação WebRTC por espectador -----
  useEffect(() => {
    if (!isHost || ended) return undefined;
    let cancelled = false;
    (async () => {
      let stream = pendingHostStream;
      pendingHostStream = null;
      if (!stream) {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }); }
        catch { setVideoState("no-camera"); return; }
      }
      if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setVideoState("live");
    })();
    return () => {
      cancelled = true;
      peers.current.forEach(pc => pc.close());
      peers.current.clear();
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, [isHost, ended]);

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

  // ----- Espectador: pede o vídeo a quem emite -----
  const connectViewer = async () => {
    if (!live || isHost || ended || !user || typeof RTCPeerConnection !== "function") return;
    viewerPc.current?.close();
    setVideoState("connecting");
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy || "all" });
    viewerPc.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addEventListener("track", event => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; setVideoState("live"); });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") setVideoState("failed");
    });
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    viewerSession.current = Math.random().toString(36).slice(2);
    await sendSignal(liveId, live.host_id, "offer", JSON.stringify({ session: viewerSession.current, sdp: pc.localDescription.sdp }));
  };

  useEffect(() => {
    if (live && !isHost && !ended && user) connectViewer().catch(() => setVideoState("failed"));
    return () => {
      if (viewerPc.current && live && !isHost) { sendSignal(liveId, live.host_id, "bye").catch(() => {}); viewerPc.current.close(); viewerPc.current = null; }
    };
  }, [live?.id, isHost, ended, user?.id]);

  // Sinais (ofertas para quem emite; respostas para quem vê), sinal de vida e chat.
  usePolling(async () => {
    if (!user || !live || ended) return;
    const result = await api(`/lives/${liveId}/signals?after=${lastSignal.current}`);
    for (const signal of result.signals) {
      lastSignal.current = Math.max(lastSignal.current, signal.id);
      if (isHost && signal.kind === "offer") await answerOffer(signal).catch(error => console.warn("Live offer:", error.message));
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
  }, 1500, Boolean(user && live && !ended));

  usePolling(async () => {
    if (!user || !live || ended) return;
    const beat = await api(`/lives/${liveId}/heartbeat`, { method: "POST" });
    setLive(current => current && { ...current, viewers: beat.viewers, stars: beat.stars, status: beat.status });
  }, 8000, Boolean(user && live && !ended));

  usePolling(async () => {
    const result = await api(`/lives/${liveId}/comments?after=${lastComment.current}`);
    if (!result.comments.length) return;
    lastComment.current = result.comments[result.comments.length - 1].id;
    setComments(current => [...current, ...result.comments].slice(-150));
    if (result.comments.some(comment => comment.stars)) loadLive();
  }, 2500, Boolean(live));

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); }, [comments.length]);

  const sendComment = async event => {
    event.preventDefault();
    if (!text.trim()) return;
    const body = text;
    setText("");
    try {
      await api(`/lives/${liveId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
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
      await api(`/lives/${liveId}/end`, { method: "POST" });
      streamRef.current?.getTracks().forEach(track => track.stop());
      await loadLive();
    } catch (endError) {
      setError(endError.message);
    }
  };

  useEffect(() => { if (user && !isHost) api("/stars").then(result => setBalance(result.balance)).catch(() => {}); }, [user?.id, isHost]);

  if (error && !live) return <div className="page narrow"><div className="empty card">{error} <Link to="/live">Ver diretos</Link></div></div>;
  if (!live) return <div className="page narrow"><div className="empty card">A abrir o direto...</div></div>;

  const overlayText = {
    connecting: "A ligar ao direto...",
    failed: "Não foi possível receber o vídeo nesta rede. O chat e as estrelas continuam a funcionar.",
    full: "O vídeo chegou ao limite de espectadores. Continua no chat — o vídeo para muitas pessoas chega em breve.",
    "no-camera": "Não foi possível abrir a câmara. Autoriza o acesso e recarrega a página."
  }[videoState];

  return <div className="live-room">
    <Link className="page-back" to="/live"><Icon name="previous" size={18} /> Todos os diretos</Link>
    <div className="live-layout">
      <section className="live-stage">
        <div className={`live-video${ended ? " is-ended" : ""}`}>
          <video ref={videoRef} autoPlay playsInline muted={isHost || muted} />
          {ended ? <div className="live-overlay is-ended">
            <Avatar user={live} size="large" />
            <strong>O direto terminou</strong>
            <span>{formatCount(live.peak_viewers)} {live.peak_viewers === 1 ? "pessoa viu" : "pessoas viram"} ao mesmo tempo · {formatCount(live.stars)} estrelas recebidas</span>
            <Link className="btn" to={`/u/${live.username}`}>Ver perfil de {live.display_name}</Link>
          </div> : !user ? <div className="live-overlay"><strong>Entra na tua conta para ver o direto.</strong><Link className="btn" to="/login">Entrar</Link></div>
            : overlayText && videoState !== "live" && <div className="live-overlay">{videoState === "connecting" && <span className="payment-spinner" aria-hidden="true" />}<span>{overlayText}</span>
              {videoState === "failed" && <button className="btn secondary" type="button" onClick={() => connectViewer()}>Tentar outra vez</button>}</div>}
          {!ended && <div className="live-topbar">
            <LiveBadge />
            <span className="live-chip"><Icon name="eye" size={14} /> {formatCount(live.viewers)}</span>
            <span className="live-chip">{liveDuration(live.started_at)}</span>
            <span className="live-chip live-chip-stars"><Icon name="star" size={14} /> {formatCount(live.stars)}</span>
          </div>}
          {!ended && !isHost && user && videoState === "live" && <button className="live-sound" type="button" onClick={() => setMuted(value => !value)} aria-pressed={!muted}>
            <Icon name={muted ? "volumeOff" : "volumeOn"} size={18} /> {muted ? "Ativar som" : "Som ligado"}</button>}
          {isHost && !ended && <div className="live-controls">
            <button type="button" className={micOn ? "" : "is-off"} onClick={() => toggleTrack("audio")} aria-pressed={!micOn} aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}><Icon name={micOn ? "mic" : "micOff"} size={20} /></button>
            <button type="button" className={camOn ? "" : "is-off"} onClick={() => toggleTrack("video")} aria-pressed={!camOn} aria-label={camOn ? "Desligar câmara" : "Ligar câmara"}><Icon name={camOn ? "video" : "videoOff"} size={20} /></button>
            <button type="button" className="live-end" onClick={endLive}><Icon name="stop" size={18} /> Terminar</button>
          </div>}
        </div>
        <div className="live-host">
          <Link to={`/u/${live.username}`}><Avatar user={live} size="large" /></Link>
          <div><h1>{live.title}</h1><p><Link className="post-author" to={`/u/${live.username}`}>{live.display_name}</Link><VerifiedBadge show={live.is_verified} /></p></div>
        </div>
      </section>

      <aside className="live-side card">
        <div className="pages-tabs live-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>Chat<span>{comments.length}</span></button>
          <button type="button" role="tab" aria-selected={panel === "top"} onClick={() => setPanel("top")}>Apoiantes<span>{supporters.length}</span></button>
        </div>
        {panel === "chat" ? <>
          <ol className="live-chat" ref={chatRef} aria-live="polite">
            {!comments.length && <li className="live-chat-empty">Ainda não há mensagens. Diz olá!</li>}
            {comments.map(comment => <li key={comment.id} className={comment.stars ? "is-gift" : ""}>
              <Avatar user={comment} size="tiny" />
              <span><strong>{comment.display_name || "Alguém"}</strong> {comment.stars ? <span className="live-gift-text"><Icon name="star" size={13} /> {comment.body}</span> : comment.body}</span>
            </li>)}
          </ol>
          {user && !ended && <>
            {!isHost && <div className="live-gifts">
              {config.giftAmounts.map(amount => <button key={amount} type="button" onClick={() => gift(amount)} disabled={balance !== null && balance < amount}><Icon name="star" size={13} /> {amount}</button>)}
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
    <p>Os teus dados são teus: podes descarregá-los ou apagar a conta a qualquer momento em <Link to="/settings">Definições</Link>. Lê a <Link to="/privacy">Política de Privacidade</Link> para saber o que guardamos.</p>
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
    ["Como defino o meu preço como criador?", "Em Definições → Editar perfil, indica o preço mensal em kwanzas (entre 500 Kz e 500 000 Kz)."]
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
      <li><strong>Retificação:</strong> Definições → Editar perfil, e Definições → Província e idade.</li>
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

  return <div className="settings-danger-zone">
    <div className="settings-action-row">
      <span className="settings-action-mark"><Icon name="layers" /></span>
      <span><strong>Os teus dados</strong><small>Descarrega um ficheiro com o teu perfil, publicações, comentários, mensagens e ligações.</small></span>
      <button className="settings-account-link" type="button" disabled={!!busy} onClick={exportData}>{busy === "export" ? "A preparar..." : "Descarregar dados"}</button>
    </div>
    <div className="settings-action-row">
      <span className="settings-action-mark danger"><Icon name="trash" /></span>
      <span><strong>Apagar conta</strong><small>Apaga o perfil, publicações, comentários, mensagens, grupos e páginas que criaste. Cancela as subscrições pagas. Não pode ser desfeito.</small></span>
      {!confirming && <button className="settings-account-link danger-text" type="button" onClick={() => setConfirming(true)}>Apagar conta</button>}
    </div>
    {confirming && <form className="settings-delete-form" onSubmit={deleteAccount}>
      <label>Escreve a tua palavra-passe para confirmar
        <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
      </label>
      <div className="settings-form-actions">
        <button className="btn danger" type="submit" disabled={busy === "delete" || !password}>{busy === "delete" ? "A apagar..." : "Apagar definitivamente"}</button>
        <button className="btn secondary" type="button" disabled={busy === "delete"} onClick={() => { setConfirming(false); setPassword(""); setError(""); }}>Cancelar</button>
      </div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

function ImagePicker({ label, hint, busy, hasImage, onPick, onRemove }) {
  return <div className="image-picker">
    <span><strong>{label}</strong><small>{hint}</small></span>
    <label className={`btn secondary${busy ? " is-busy" : ""}`}>
      {busy ? "A enviar..." : hasImage ? "Trocar" : "Escolher imagem"}
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPick(file); }} />
    </label>
    {hasImage && <button className="text-button" type="button" disabled={busy} onClick={onRemove}>Remover</button>}
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
    <div className="settings-action-row settings-security-row">
      <span className={`settings-action-mark${status.enabled ? " is-on" : ""}`}><Icon name="shield" /></span>
      <span>
        <strong>Verificação em dois passos {status.enabled && <em className="two-factor-on">Ativa</em>}</strong>
        <small>{status.enabled
          ? "Ao entrar, pedimos a palavra-passe e um código da tua app de autenticação."
          : status.required
            ? "Obrigatória para administradores: sem ela não abres o painel de administração."
            : "Mesmo que alguém descubra a tua palavra-passe, não entra sem o código do teu telemóvel."}</small>
      </span>
      {status.enabled
        ? <button className="settings-account-link" type="button" onClick={() => { setDisabling(!disabling); setError(""); setCode(""); }}>{disabling ? "Cancelar" : "Desligar"}</button>
        : !setup && <button className="settings-account-link" type="button" disabled={busy} onClick={start}>{busy ? "A preparar..." : "Ativar"} <Icon name="shield" size={14} /></button>}
    </div>
    {setup && <form className="settings-profile-form two-factor-setup" onSubmit={confirm}>
      <img className="two-factor-qr" src={setup.qr} width="180" height="180" alt="Código QR para adicionar o Biva à app de autenticação" />
      <div className="two-factor-steps">
        <p><strong>1.</strong> Instala uma app de autenticação no telemóvel: Google Authenticator, Microsoft Authenticator ou Authy.</p>
        <p><strong>2.</strong> Na app, toca em adicionar e lê este código QR. Se não conseguires, escreve esta chave:</p>
        <code className="two-factor-secret">{setup.secret.match(/.{1,4}/g).join(" ")}</code>
        <p><strong>3.</strong> Escreve o código que a app mostra para confirmar.</p>
        {codeInput}
        <div className="settings-form-actions">
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>{busy ? "A confirmar..." : "Confirmar e ativar"}</button>
          <button className="btn secondary" type="button" onClick={() => setSetup(null)}>Cancelar</button>
        </div>
      </div>
    </form>}
    {disabling && <form className="settings-profile-form" onSubmit={turnOff}>
      <label>Palavra-passe<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {codeInput}
      <div className="settings-form-actions"><button className="btn danger" type="submit" disabled={busy || code.length !== 6}>{busy ? "A desligar..." : "Desligar verificação"}</button></div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="settings-form-success" role="status"><Icon name="check" size={14} />{notice}</p>}
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
    <div className="settings-action-row settings-security-row">
      <span className="settings-action-mark"><Icon name="lock" /></span>
      <span><strong>Palavra-passe</strong><small>Ao mudá-la, as sessões abertas noutros dispositivos terminam.</small></span>
      <button className="settings-account-link" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setError(""); setNotice(""); }}>
        {open ? "Cancelar" : "Mudar palavra-passe"} <Icon name={open ? "close" : "create"} size={14} />
      </button>
    </div>
    {open && <form className="settings-profile-form security-password-form" onSubmit={changePassword}>
      <label>Palavra-passe atual<input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={event => setForm({ ...form, currentPassword: event.target.value })} /></label>
      <label>Nova palavra-passe <small>Pelo menos {PASSWORD_MIN} caracteres</small><input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={form.newPassword} onChange={event => setForm({ ...form, newPassword: event.target.value })} /></label>
      <label>Repete a nova palavra-passe<input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={form.confirm} onChange={event => setForm({ ...form, confirm: event.target.value })} /></label>
      <div className="settings-form-actions"><button className="btn" type="submit" disabled={busy === "password"}>{busy === "password" ? "A guardar..." : "Mudar palavra-passe"}</button></div>
    </form>}
    <TwoFactorSettings />
    <div className="settings-action-row settings-security-row">
      <span className="settings-action-mark"><Icon name="devices" /></span>
      <span><strong>Sessões abertas</strong><small>Perdeste o telemóvel ou entraste num computador de outra pessoa? Termina todas as outras sessões.</small></span>
      <button className="settings-account-link" type="button" disabled={busy === "logout"} onClick={logoutEverywhere}>
        {busy === "logout" ? "A terminar..." : "Terminar outras sessões"} <Icon name="logout" size={14} />
      </button>
    </div>
    <div className="settings-action-row settings-security-row">
      <span className="settings-action-mark"><Icon name="mail" /></span>
      <span><strong>Esqueceste a palavra-passe?</strong><small>Recebe uma ligação segura no teu email.</small></span>
      <Link className="settings-account-link" to="/forgot-password">Recuperar acesso <Icon name="externalLink" size={14} /></Link>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="settings-form-success" role="status"><Icon name="check" size={14} />{notice}</p>}
  </div>;
}

function Settings() {
  const { user, refreshUser } = useContext(UserContext);
  const { theme, setTheme } = useContext(ThemeContext);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ displayName: "", bio: "", location: "", profession: "", website: "", subscriptionPrice: "" });
  const [imageBusy, setImageBusy] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const startProfileEdit = () => {
    setProfileForm({
      displayName: user?.display_name || "",
      bio: user?.bio || "",
      location: user?.location || "",
      profession: user?.profession || "",
      website: user?.website || "",
      subscriptionPrice: Number(user?.subscription_price) > 0 ? String(Number(user.subscription_price)) : ""
    });
    setProfileError("");
    setProfileNotice("");
    setEditingProfile(true);
  };

  const saveProfile = async event => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    setProfileNotice("");
    try {
      await api("/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profileForm.displayName,
          bio: profileForm.bio,
          location: profileForm.location,
          profession: profileForm.profession,
          website: profileForm.website,
          ...(user?.is_creator && profileForm.subscriptionPrice !== "" && { subscriptionPrice: Number(profileForm.subscriptionPrice) })
        })
      });
      await refreshUser();
      setEditingProfile(false);
      setProfileNotice("O teu perfil foi atualizado.");
    } catch (error) {
      setProfileError(error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const changeImage = async (kind, file) => {
    setProfileError("");
    setProfileNotice("");
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
      setProfileNotice(kind === "avatar" ? "Foto de perfil atualizada." : "Capa atualizada.");
    } catch (error) {
      setProfileError(error.message);
    } finally {
      setImageBusy("");
    }
  };

  return <section className="page narrow settings-page">
    <h1 className="settings-page-title">Definições</h1>
    <p className="settings-page-intro">Gere a tua experiência, consulta a tua conta e encontra rapidamente as áreas principais do Biva.</p>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Secções das definições">
        <p>Gerir preferências</p>
        <a href="#appearance" className="active"><span><Icon name="sun" /></span>Aparência</a>
        <a href="#notifications"><span><Icon name="notifications" /></span>Notificações</a>
        <a href="#privacy"><span><Icon name="settings" /></span>Privacidade</a>
        <a href="#account"><span><Icon name="profile" /></span>A tua conta</a>
        <a href="#shortcuts"><span><Icon name="layers" /></span>Atalhos</a>
        <div className="settings-nav-note"><Icon name="spark" size={16} /><span>O modo de cor fica guardado neste dispositivo.</span></div>
      </nav>
      <div className="settings-content">
        <section className="settings-section card" id="appearance" aria-labelledby="appearance-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="sun" /></span>
            <div><p className="settings-section-kicker">Personalização</p><h2 id="appearance-heading">Escolhe o teu ambiente</h2><p>Encontra o tema mais confortável para ti.</p></div>
          </div>
          <fieldset className="settings-theme-grid">
            <legend className="visually-hidden">Tema da aplicação</legend>
            <label className={`settings-theme-card ${theme === "light" ? "selected" : ""}`}>
              <input className="settings-theme-radio" type="radio" name="theme" value="light" checked={theme === "light"} onChange={() => setTheme("light")} />
              <span className="settings-theme-visual light-preview" aria-hidden="true">
                <span className="theme-preview-top"><i /><i /><i /></span>
                <span className="theme-preview-layout"><i /><i /><i /></span>
                <span className="theme-preview-post"><i /><i /><i /><i /></span>
                <span className="theme-preview-chip"><Icon name="sun" size={13} /></span>
              </span>
              <span className="settings-theme-details"><span><strong>Modo claro</strong><small>Leve, luminoso e familiar</small></span><i className="settings-theme-check"><Icon name="check" size={14} /></i></span>
            </label>
            <label className={`settings-theme-card ${theme === "dark" ? "selected" : ""}`}>
              <input className="settings-theme-radio" type="radio" name="theme" value="dark" checked={theme === "dark"} onChange={() => setTheme("dark")} />
              <span className="settings-theme-visual dark-preview" aria-hidden="true">
                <span className="theme-preview-top"><i /><i /><i /></span>
                <span className="theme-preview-layout"><i /><i /><i /></span>
                <span className="theme-preview-post"><i /><i /><i /><i /></span>
                <span className="theme-preview-chip"><Icon name="moon" size={13} /></span>
              </span>
              <span className="settings-theme-details"><span><strong>Modo escuro</strong><small>Mais conforto em pouca luz</small></span><i className="settings-theme-check"><Icon name="check" size={14} /></i></span>
            </label>
          </fieldset>
          <p className="settings-save-note" role="status"><Icon name="check" size={14} /> A tua preferência é guardada automaticamente.</p>
        </section>
        <section className="settings-section card" id="notifications" aria-labelledby="notification-settings-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="notifications" /></span>
            <div><p className="settings-section-kicker">Atividade</p><h2 id="notification-settings-heading">Notificações</h2><p>Acompanha novidades e interações da comunidade.</p></div>
          </div>
          <div className="settings-action-row">
            <span className="settings-action-mark"><Icon name="notifications" /></span>
            <span><strong>Centro de notificações</strong><small>Consulta respostas, reações e outras novidades da tua conta.</small></span>
            <Link className="settings-account-link" to="/notifications">Abrir notificações <Icon name="externalLink" size={14} /></Link>
          </div>
          <div className="settings-detail-grid settings-notification-types">
            <div><span className="settings-detail-dot" /><span><strong>Interações</strong><small>Gostos e comentários nas tuas publicações</small></span></div>
            <div><span className="settings-detail-dot" /><span><strong>Comunidade</strong><small>Pedidos de amizade e novos seguidores</small></span></div>
            <div><span className="settings-detail-dot" /><span><strong>Atividade</strong><small>Novidades de grupos, páginas e eventos</small></span></div>
          </div>
        </section>
        <AudienceSettings />
        <section className="settings-section card" id="privacy" aria-labelledby="privacy-settings-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="profile" /></span>
            <div><p className="settings-section-kicker">Controlo</p><h2 id="privacy-settings-heading">Privacidade e visibilidade</h2><p>Confirma o que partilhas com as outras pessoas.</p></div>
          </div>
          <div className="settings-info-panel">
            <span className="settings-info-mark"><Icon name="friends" /></span>
            <div><strong>O teu perfil faz parte da comunidade</strong><p>O teu perfil e as publicações que partilhas podem ser vistos por outras pessoas no Biva.</p></div>
            {user && <Link className="settings-account-link" to={`/u/${user.username}`}>Ver perfil <Icon name="externalLink" size={14} /></Link>}
          </div>
          <div className="settings-detail-grid settings-privacy-details">
            <div><span className="settings-detail-icon"><Icon name="profile" /></span><span><strong>Perfil</strong><small>Nome, identificador e biografia ajudam as pessoas a reconhecer-te.</small></span></div>
            <div><span className="settings-detail-icon"><Icon name="create" /></span><span><strong>Publicações</strong><small>O conteúdo que publicas aparece no teu espaço e no feed.</small></span></div>
            <div><span className="settings-detail-icon"><Icon name="camera" /></span><span><strong>Stories</strong><small>Os Stories partilhados ficam disponíveis durante 24 horas.</small></span></div>
          </div>
          <p className="settings-section-footnote">As opções de audiência e visibilidade avançada ainda não estão disponíveis.</p>
        </section>
        <section className="settings-section card" id="account" aria-labelledby="account-settings-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="profile" /></span>
            <div><p className="settings-section-kicker">Perfil</p><h2 id="account-settings-heading">A tua conta</h2><p>As informações que partilhas com a comunidade.</p></div>
          </div>
          {user
            ? <>
              <div className="settings-account-row">
                <Avatar user={user} size="large" />
                <span><strong>{user.display_name}</strong><small>@{user.username}</small></span>
                <div className="settings-account-actions">
                  <button className="settings-account-link" type="button" onClick={startProfileEdit}>Editar perfil <Icon name="create" size={14} /></button>
                  <Link className="settings-account-link" to={`/u/${user.username}`}>Ver perfil <Icon name="externalLink" size={14} /></Link>
                </div>
              </div>
              <div className="settings-images">
                <ImagePicker label="Foto de perfil" hint="Quadrada, até 8 MB" busy={imageBusy === "avatar"} hasImage={!!user.avatar_url}
                  onPick={file => changeImage("avatar", file)} onRemove={() => changeImage("avatar", null)} />
                <ImagePicker label="Capa do perfil" hint="Horizontal, até 8 MB" busy={imageBusy === "cover"} hasImage={!!user.cover_url}
                  onPick={file => changeImage("cover", file)} onRemove={() => changeImage("cover", null)} />
              </div>
              {profileNotice && <p className="settings-form-success" role="status"><Icon name="check" size={14} />{profileNotice}</p>}
              {editingProfile && <form className="settings-profile-form" onSubmit={saveProfile}>
                <div className="settings-form-heading"><div><strong>Editar perfil público</strong><p>Estas informações ajudam as pessoas a reconhecer-te no Biva.</p></div><span>Visível no teu perfil</span></div>
                <label>Nome público<input autoComplete="name" maxLength={100} required value={profileForm.displayName} onChange={event => setProfileForm({ ...profileForm, displayName: event.target.value })} /></label>
                <label>Biografia <small>{profileForm.bio.length}/500</small><textarea maxLength={500} rows={4} value={profileForm.bio} onChange={event => setProfileForm({ ...profileForm, bio: event.target.value })} placeholder="Conta um pouco sobre ti..." /></label>
                <label>Profissão<input maxLength={100} autoComplete="organization-title" value={profileForm.profession} onChange={event => setProfileForm({ ...profileForm, profession: event.target.value })} placeholder="Ex.: Fotógrafa, estudante, empreendedor" /></label>
                <label>Localidade<input maxLength={100} autoComplete="address-level2" value={profileForm.location} onChange={event => setProfileForm({ ...profileForm, location: event.target.value })} placeholder="Ex.: Luanda, Angola" /></label>
                <label>Site ou link<input maxLength={200} type="text" inputMode="url" autoComplete="url" value={profileForm.website} onChange={event => setProfileForm({ ...profileForm, website: event.target.value })} placeholder="Ex.: instagram.com/o_teu_nome" /></label>
                {user.is_creator && <label>Preço da subscrição mensal (Kz) <small>Entre 500 Kz e 500 000 Kz</small><input type="number" inputMode="decimal" min="500" max="500000" step="0.01" value={profileForm.subscriptionPrice} onChange={event => setProfileForm({ ...profileForm, subscriptionPrice: event.target.value })} placeholder="Ex.: 2500" /></label>}
                {profileError && <p className="error" role="alert">{profileError}</p>}
                <div className="settings-form-actions"><button className="btn" type="submit" disabled={savingProfile}>{savingProfile ? "A guardar..." : "Guardar alterações"}</button><button className="btn secondary" type="button" disabled={savingProfile} onClick={() => setEditingProfile(false)}>Cancelar</button></div>
              </form>}
              <div className="settings-detail-grid settings-account-details">
                <div><span className="settings-detail-icon"><Icon name="messages" /></span><span><small>Email da conta</small><strong>{user.email}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="profile" /></span><span><small>Tipo de conta</small><strong>{user.is_creator ? "Criador" : "Membro da comunidade"}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="check" /></span><span><small>Estado do email</small><strong className={`settings-verification ${user.email_verified ? "verified" : "pending"}`}>{user.email_verified ? "Email confirmado" : "Confirmação pendente"}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="create" /></span><span><small>Biografia</small><strong>{user.bio?.trim() || "Ainda não adicionaste uma biografia."}</strong></span></div>
              </div>
              <SecuritySettings />
              <BlockedAccounts />
              <AccountDataControls />
            </>
            : <div className="settings-guest-card"><span className="settings-action-mark"><Icon name="profile" /></span><div><strong>Inicia sessão para gerir a tua conta</strong><p>Depois de entrares, podes consultar os teus dados e abrir o teu perfil.</p></div><Link className="settings-account-link" to="/login">Iniciar sessão <Icon name="externalLink" size={14} /></Link></div>}
        </section>
        <section className="settings-section card" id="shortcuts" aria-labelledby="settings-shortcuts-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="layers" /></span>
            <div><p className="settings-section-kicker">Biva</p><h2 id="settings-shortcuts-heading">Acede rapidamente</h2><p>Continua a explorar e a participar na comunidade.</p></div>
          </div>
          <div className="settings-shortcuts-grid">
            <Link to="/friends"><Icon name="friends" /><span><strong>Amigos</strong><small>Encontra pessoas</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/messages"><Icon name="messages" /><span><strong>Mensagens</strong><small>Fala em privado</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/groups"><Icon name="groups" /><span><strong>Grupos</strong><small>Partilha interesses</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/events"><Icon name="events" /><span><strong>Eventos</strong><small>Descobre atividades</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/creator"><Icon name="stats" /><span><strong>Painel do criador</strong><small>Insights, conteúdo, subscrições e anúncios</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/help"><Icon name="help" /><span><strong>Ajuda</strong><small>Perguntas frequentes</small></span><Icon name="externalLink" size={14} /></Link>
          </div>
          <InfoLinks />
        </section>
      </div>
    </div>
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
            ? <><Link className="btn secondary" to="/settings"><Icon name="settings" size={15} /> Editar perfil</Link><Link className="btn secondary" to="/creator"><Icon name="stats" size={15} /> Painel do criador</Link></>
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

createRoot(document.getElementById("root")).render(<BrowserRouter><App /></BrowserRouter>);
