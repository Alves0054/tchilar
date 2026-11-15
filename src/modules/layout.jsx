import { useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Icon, ThemeContext, UserContext, api, token } from "./core.jsx";
import { InfoLinks, usePolling } from "./shared.jsx";
import { MessagesPanel, NotificationsPanel } from "./topbar-panels.jsx";
import { IncomingCall } from "./group-call.jsx";

export function Layout({ children }) {
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
  const navigateTo = useNavigate();

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
      {!authPage && <TopBar user={user} unreadCount={unreadCount} unreadMessages={unreadMessages} onBadgesChange={refreshBadges}
        onLogout={() => {
          // Termina a sessão no servidor (o token deixa de valer) e depois limpa este browser.
          api("/auth/logout", { method: "POST" }).catch(() => {});
          localStorage.removeItem("token"); setUser(null); setUnreadCount(0); setUnreadMessages(0);
        }} />}
      {authError && !authPage && <p className="global-error">{authError}</p>}
      {user && !location.pathname.startsWith("/calls/") && <IncomingCall user={user} onAnswer={call => navigateTo(`/calls/${call.id}`)} />}
      <main className={authPage ? "auth-page-main" : ""}>{children}</main>
    </div>
  </UserContext.Provider></ThemeContext.Provider>;
}
// Fecha um menu ao clicar fora dele ou ao carregar em Escape.
export function useDismiss(ref, open, close) {
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
export function SearchBox({ user }) {
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
  // Enter (ou "Ver todos os resultados") abre a página de pesquisa com publicações, hashtags, grupos e páginas.
  const searchAll = () => {
    const term = query.trim();
    if (!term) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  return <div className="topbar-search" ref={box}>
    <Icon name="search" size={17} />
    <input type="search" aria-label="Pesquisar no Tchilar" placeholder="Pesquisar no Tchilar" value={query}
      onChange={event => { setQuery(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={event => { if (event.key === "Enter") searchAll(); }} />
    {open && query.trim().length >= 2 && <div className="topbar-dropdown search-results" role="listbox" aria-label="Resultados da pesquisa">
      {!user && <p className="muted">Entra na tua conta para pesquisar pessoas.</p>}
      {user && !results.length && <p className="muted">Nenhuma pessoa com «{query.trim()}».</p>}
      {results.map(person => <button type="button" role="option" aria-selected="false" key={person.id} onClick={() => go(person)}>
        <Avatar user={person} size="tiny" />
        <span><strong>{person.display_name}</strong><small>@{person.username}</small></span>
      </button>)}
      {user && <button type="button" className="search-all" onClick={searchAll}><Icon name="search" size={16} />
        <span><strong>Ver todos os resultados</strong><small>Publicações, hashtags, grupos e páginas</small></span></button>}
    </div>}
  </div>;
}
export const NAV_ITEMS = [
  ["/", "home", "Início"],
  ["/reels", "reels", "Reels"],
  ["/live", "live", "Diretos"],
  ["/friends", "friends", "Amigos"],
  ["/groups", "groups", "Grupos"],
  ["/events", "events", "Eventos"]
];
export function TopBar({ user, unreadCount, unreadMessages, onBadgesChange, onLogout }) {
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
      <Link className="logo" to="/" aria-label="Tchilar, início"><img src="/tchilar-logo.png" alt="" /></Link>
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
              ["/academia", "academy", "Academia Tchilar", "Cresce como criador"], ["/help", "help", "Ajuda", "Perguntas frequentes"]]
              .map(([to, icon, label, hint]) => <Link key={to} to={to} role="menuitem"><span className={`menu-icon tone-${icon}`}><Icon name={icon} size={18} /></span><span><strong>{label}</strong><small>{hint}</small></span></Link>)}
          </div>}
        </div>
        <div className="topbar-menu">
          <button className={`round-button${openMenu === "messages" ? " is-open" : ""}`} type="button" aria-haspopup="dialog" aria-expanded={openMenu === "messages"} onClick={() => toggle("messages")}
            aria-label={unreadMessages ? `Mensagens, ${unreadMessages} por ler` : "Mensagens"} title="Mensagens">
            <Icon name="messages" size={20} />{unreadMessages > 0 && <span className="notification-badge">{unreadMessages > 99 ? "99+" : unreadMessages}</span>}
          </button>
          {openMenu === "messages" && <MessagesPanel onClose={close} />}
        </div>
        <div className="topbar-menu">
          <button className={`round-button${openMenu === "notifications" ? " is-open" : ""}`} type="button" aria-haspopup="dialog" aria-expanded={openMenu === "notifications"} onClick={() => toggle("notifications")}
            aria-label={unreadCount ? `Notificações, ${unreadCount} por ler` : "Notificações"} title="Notificações">
            <Icon name="notifications" size={20} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 20 ? "20+" : unreadCount}</span>}
          </button>
          {openMenu === "notifications" && <NotificationsPanel onChange={onBadgesChange} onClose={close} />}
        </div>
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
