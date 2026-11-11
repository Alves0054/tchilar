import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bell,
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
      throw new Error("Não foi possível contactar o servidor da NOVA+. Confirma que a API está em execução com «npm.cmd run dev».");
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir o pedido.");
  return data;
}

function Avatar({ user, size = "" }) {
  const initial = (user?.display_name || user?.username || "?").trim().charAt(0).toUpperCase();
  return user?.avatar_url
    ? <img className={`avatar ${size}`} src={`${API_BASE}${user.avatar_url}`} alt="" />
    : <span className={`avatar ${size}`}>{initial}</span>;
}

const ICONS = {
  ad: Megaphone,
  bolt: Zap,
  camera: Camera,
  check: Check,
  close: X,
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
  const [theme, setTheme] = useState(() => localStorage.getItem("nova-theme") === "dark" ? "dark" : "light");
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [authReady, setAuthReady] = useState(!token());
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nova-theme", theme);
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
      const notificationResult = await api("/notifications");
      setUnreadCount(notificationResult.unreadCount);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthReady(true);
    }
  };

  useEffect(() => { refreshUser(); }, [location.pathname]);

  const authPage = !user && ["/", "/login", "/register", "/verify-email", "/forgot-password", "/reset-password"].includes(location.pathname);
  return <ThemeContext.Provider value={{ theme, setTheme }}><UserContext.Provider value={{ user, refreshUser, authReady }}>
    <div className={`app ${authPage ? "app-public" : "app-community"}`}>
      {!authPage && <header className="topbar">
        <Link className="logo" to="/" aria-label="NOVA+ início">
          <img src="/nova-plus-logo.png" alt="" />
          <span className="logo-wordmark">NOVA<span>+</span></span>
        </Link>
        <nav className="main-nav">
          <NavLink to="/" end aria-label="Feed" title="Feed"><Icon name="home" size={20} /></NavLink>
          <NavLink to="/reels" aria-label="Reels" title="Reels"><Icon name="reels" size={20} /></NavLink>
          <NavLink to="/messages" aria-label="Mensagens" title="Mensagens"><Icon name="messages" size={20} /></NavLink>
        </nav>
        <div className="topbar-actions">
          {user
            ? <><Link className="notification-link" aria-label="Notificações" title="Notificações" to="/notifications"><Icon name="notifications" />{unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}</Link><Link className="topbar-settings" to="/settings" aria-label="Definições" title="Definições"><Icon name="settings" /></Link><Link className="user-link" to={`/u/${user.username}`} aria-label="O meu perfil" title="O meu perfil"><Avatar user={user} /></Link><button className="topbar-logout" aria-label="Sair" title="Sair" onClick={() => { localStorage.removeItem("token"); setUser(null); setUnreadCount(0); }}><Icon name="logout" /></button></>
            : <Link className="topbar-login-icon" to="/login" aria-label="Entrar" title="Entrar"><Icon name="profile" /></Link>}
        </div>
      </header>}
      {authError && !authPage && <p className="global-error">{authError}</p>}
      <main className={authPage ? "auth-page-main" : ""}>{children}</main>
    </div>
  </UserContext.Provider></ThemeContext.Provider>;
}

function Home() {
  const { user, authReady } = useContext(UserContext);
  if (!authReady) return <div className="auth-loading" role="status">A preparar a tua comunidade...</div>;
  return user ? <Feed /> : <Auth mode="login" />;
}

function SocialPreview() {
  const [reaction, setReaction] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const reactions = [
    { icon: "heart", label: "Carinho" },
    { icon: "spark", label: "Inspiração" },
    { icon: "bolt", label: "Energia" }
  ];

  const share = async () => {
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "NOVA+",
          text: "Vem partilhar momentos e descobrir a tua comunidade na NOVA+.",
          url: window.location.origin
        });
      } else {
        await navigator.clipboard.writeText(window.location.origin);
        setShareStatus("Ligação copiada. Partilha com os teus amigos!");
      }
    } catch (error) {
      if (error.name !== "AbortError") setShareStatus("Não foi possível partilhar agora.");
    }
  };

  return <section className="community-pulse" aria-label="Descobre como é a comunidade NOVA+">
    <div className="pulse-heading">
      <span className="pulse-mark" aria-hidden="true">N<span>+</span></span>
      <p className="pulse-kicker">IDEIAS QUE NOS APROXIMAM</p>
    </div>
    <h3>Uma reação pode ser o início de algo.</h3>
    <p className="pulse-description">Celebra, conversa e convida alguém para descobrir a tua comunidade.</p>
    <div className="pulse-reactions" aria-label="Escolhe uma reação">
      {reactions.map(item => <button
        key={item.label}
        type="button"
        className={reaction === item.label ? "selected" : ""}
        aria-pressed={reaction === item.label}
        onClick={() => setReaction(current => current === item.label ? "" : item.label)}
      ><span aria-hidden="true"><Icon name={item.icon} size={12} /></span>{item.label}</button>)}
    </div>
    {reaction && <p className="pulse-reaction-status" role="status">Partilhaste {reaction.toLowerCase()} com a comunidade.</p>}
    <div className="pulse-tools">
      <button className="pulse-conversation" type="button" aria-expanded={showComments} onClick={() => setShowComments(value => !value)}>
        <span aria-hidden="true"><Icon name="messages" size={13} /></span>{showComments ? "Fechar conversa" : "Abrir conversa"}
      </button>
      <button className="pulse-invite" type="button" onClick={share} aria-label="Convidar alguém para a NOVA+">
        Convidar alguém <span aria-hidden="true"><Icon name="share" size={13} /></span>
      </button>
    </div>
    {showComments && <div className="pulse-conversation-panel">
      <p className="pulse-kicker">UMA CONVERSA PODE COMEÇAR ASSIM</p>
      <blockquote>“Adorei este momento. Fez-me lembrar os meus amigos.”</blockquote>
      <Link to="/register">Traz a tua voz para a NOVA+</Link>
    </div>}
    {shareStatus && <p className="pulse-share-status" role="status">{shareStatus}</p>}
  </section>;
}

function Auth({ mode }) {
  const navigate = useNavigate();
  const { refreshUser } = useContext(UserContext);
  const [form, setForm] = useState({ firstName: "", lastName: "", username: "", email: "", password: "", isCreator: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const { firstName, lastName, ...registrationForm } = form;
    try {
      const result = await api(mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login"
          ? form
          : { ...registrationForm, displayName: `${firstName} ${lastName}`.trim() })
      });
      if (mode === "register") {
        setNotice(result.message);
        setActionUrl(result.verificationUrl || "");
        setForm({ ...form, password: "" });
        return;
      }
      localStorage.setItem("token", result.token);
      await refreshUser();
      navigate("/");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === "login";
  return <section className={`auth page ${isLogin ? "auth-login" : "auth-register"}`}>
    {isLogin && <div className="auth-showcase">
      <Link className="auth-brand" to="/" aria-label="NOVA+ início">
        <img src="/nova-plus-logo.png" alt="" />
        <span>NOVA<span>+</span></span>
      </Link>
      <div className="auth-showcase-copy">
        <p className="auth-kicker">A tua comunidade começa aqui</p>
        <h2>Descobre o que te inspira.<br /><span>Partilha o que crias.</span></h2>
        <p>Encontra pessoas, ideias e momentos que fazem parte da tua história.</p>
      </div>
      <div className="community-photos" aria-label="Pessoas a partilhar momentos">
        <img className="community-photo community-photo-main" src="/nova-community-selfie.jpg" alt="Amigos a sorrir numa selfie" />
        <img className="community-photo community-photo-secondary" src="/nova-community-friends.jpg" alt="Duas amigas a passear juntas" />
      </div>
      <SocialPreview />
      <p className="auth-showcase-footer">Um lugar para seres tu.</p>
    </div>}
    {!isLogin && <aside className="auth-register-showcase">
      <img src="/nova-community-join.jpg" alt="Amigas a partilhar um momento juntas" />
      <div className="auth-register-image-shade" />
      <Link className="auth-brand auth-register-brand" to="/" aria-label="NOVA+ início">
        <img src="/nova-plus-logo.png" alt="" />
        <span>NOVA<span>+</span></span>
      </Link>
      <div className="auth-register-caption">
        <p className="auth-kicker">O teu espaço, à tua maneira</p>
        <h2>As melhores histórias começam com uma ligação.</h2>
        <p>Descobre pessoas, partilha momentos e faz parte de conversas que te inspiram.</p>
        <div className="auth-register-perks" aria-label="O que podes fazer na NOVA+">
          <span><Icon name="friends" size={14} /> Encontrar pessoas</span>
          <span><Icon name="spark" size={14} /> Partilhar ideias</span>
          <span><Icon name="messages" size={14} /> Conversar</span>
        </div>
      </div>
    </aside>}
    <div className="auth-panel">
      <form className={`auth-card ${isLogin ? "auth-login-card" : "auth-register-card"}`} onSubmit={submit}>
        {!isLogin && <Link className="auth-register-back" to="/login" aria-label="Voltar ao início de sessão">‹</Link>}
        <div className="eyebrow">{isLogin ? "BEM-VINDO À NOVA+" : "JUNTA-TE À NOVA+"}</div>
        <h1>{notice ? "Confirma o teu email." : isLogin ? "Inicia sessão" : "Cria a tua conta NOVA+"}</h1>
        {!isLogin && !notice && <>
          <p className="auth-register-intro">Cria o teu perfil e começa a descobrir pessoas e comunidades de que gostas.</p>
          <ol className="auth-register-steps" aria-label="Etapas para criar a conta">
            <li className="current"><span>1</span> Perfil</li>
            <li><span>2</span> Acesso</li>
            <li><span>3</span> Confirmação</li>
          </ol>
          <p className="auth-register-section-title">Os teus dados</p>
        </>}
        {notice ? <><p className="success">{notice}</p>{actionUrl && <a className="btn full" href={actionUrl}>Confirmar email</a>}<p className="muted"><Link to="/login">Voltar ao início de sessão</Link></p></> : <>
        {mode === "register" && <>
          <label className="auth-field-label">Nome
            <span className="auth-name-fields">
              <input required autoComplete="given-name" maxLength="50" placeholder="Nome próprio" aria-label="Nome próprio" value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} />
              <input required autoComplete="family-name" maxLength="50" placeholder="Apelido" aria-label="Apelido" value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} />
            </span>
            <span className="auth-field-hint">O nome que será apresentado no teu perfil.</span>
          </label>
          <label className="auth-field-label">Nome de utilizador
            <input required autoComplete="username" minLength="3" maxLength="40" placeholder="Nome de utilizador" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} />
            <span className="auth-field-hint">O teu endereço público. Usa 3–40 letras, números, pontos ou underscores.</span>
          </label>
        </>}
        <label className={isLogin ? "auth-login-input-label" : "auth-field-label"}>E-mail
          <input required autoComplete="email" placeholder="E-mail" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
          {!isLogin && <span className="auth-field-hint">Enviaremos uma ligação para confirmares o teu endereço.</span>}
        </label>
        <label className={isLogin ? "auth-login-input-label" : "auth-field-label"}>Palavra-passe
          <input required minLength="6" autoComplete={isLogin ? "current-password" : "new-password"} placeholder="Palavra-passe" type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
          {!isLogin && <span className="auth-field-hint">Escolhe uma palavra-passe com pelo menos 6 caracteres.</span>}
        </label>
        {!isLogin && <div className="auth-register-details">
          <label className="auth-register-creator">
            <input type="checkbox" checked={form.isCreator} onChange={event => setForm({ ...form, isCreator: event.target.checked })} />
            <span className="auth-register-creator-copy"><strong>Quero criar conteúdo</strong><span>Assinala se também queres publicar como criador na NOVA+.</span></span>
          </label>
          <p className="auth-register-privacy">Ao criares a conta, vais receber uma ligação de confirmação no endereço de email indicado.</p>
        </div>}
        {error && <p className="error">{error}</p>}
        <button className="btn full" disabled={busy}>{busy ? "A aguardar..." : isLogin ? "Entrar na NOVA+" : "Criar conta"}</button>
        {isLogin && <><p className="auth-forgot"><Link to="/forgot-password">Esqueceste-te da palavra-passe?</Link></p>{error.includes("Confirma o teu email") && <button className="text-button" type="button" disabled={busy || !form.email} onClick={async () => { setBusy(true); try { const result = await api("/auth/verify-email/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) }); setNotice(result.message); setActionUrl(result.verificationUrl || ""); setError(""); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } }}>Reenviar confirmação de email</button>}</>}
        {!isLogin && <p className="auth-register-login">Já tens conta? <Link to="/login">Inicia sessão</Link></p>}
        </>}
      </form>
      {isLogin && !notice && <div className="auth-create-account"><Link to="/register">Criar nova conta</Link><p>Ao continuar, estás a entrar na comunidade NOVA+.</p></div>}
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

  return <section className="auth page"><div className="auth-card"><div className="eyebrow">NOVA+</div><h1>Confirmação de email</h1>{error ? <p className="error">{error}</p> : <p className="success">{status}</p>}<Link className="btn full" to="/login">Ir para iniciar sessão</Link></div></section>;
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

  return <section className="auth page"><form className="auth-card" onSubmit={submit}><div className="eyebrow">NOVA+</div><h1>Recuperar acesso.</h1><p className="muted">Indica o email da tua conta para receber uma ligação de redefinição.</p><input required type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} />{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}{resetUrl && <a className="btn full" href={resetUrl}>Redefinir palavra-passe</a>}<button className="btn full" disabled={busy}>{busy ? "A enviar..." : "Enviar ligação"}</button><p className="muted"><Link to="/login">Voltar ao início de sessão</Link></p></form></section>;
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

  return <section className="auth page"><form className="auth-card" onSubmit={submit}><div className="eyebrow">NOVA+</div><h1>Nova palavra-passe.</h1><input required minLength="6" type="password" placeholder="Nova palavra-passe" value={password} onChange={event => setPassword(event.target.value)} />{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<button className="btn full" disabled={busy}>{busy ? "A guardar..." : "Atualizar palavra-passe"}</button></form></section>;
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async event => {
    event.preventDefault();
    if (!token()) return navigate("/login");
    if (!body.trim() && !file) return setError("Escreve uma mensagem ou escolhe uma fotografia/vídeo.");
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", file);
    if (target?.type === "group") formData.append("groupId", target.id);
    if (target?.type === "page") formData.append("pageId", target.id);
    if (!target && exclusive) formData.append("isExclusive", "true");
    try {
      await api("/posts", { method: "POST", body: formData });
      setBody("");
      setFile(null);
      setExclusive(false);
      onPosted?.();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <form className="composer card" onSubmit={submit}>
    <div className="composer-top"><Avatar user={user} /><textarea aria-label="Nova publicação" rows="2" placeholder={user ? `Em que estás a pensar, ${user.display_name}?` : "Partilha uma publicação..."} value={body} onChange={event => setBody(event.target.value)} /></div>
    {file && <p className="muted">Ficheiro selecionado: {file.name}</p>}
    {error && <p className="error">{error}</p>}
    <div className="composer-footer"><label className="file-label">Fotografia/vídeo<input type="file" accept="image/*,video/*" onChange={event => setFile(event.target.files?.[0] || null)} /></label>{!target && <ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />}<button className="btn" disabled={busy}>{busy ? "A publicar..." : "Publicar"}</button></div>
  </form>;
}

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

  const toggleLike = async () => {
    if (!token()) return navigate("/login");
    setError("");
    try {
      await api(`/posts/${post.id}/like`, { method: "POST" });
      onChanged();
    } catch (actionError) {
      setError(actionError.message);
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
      setComments([...comments, { ...result.comment, username: user?.username, display_name: user?.display_name }]);
      setCommentText("");
      onChanged();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/u/${post.username}`);
      setError("Ligação copiada.");
    } catch {
      setError("Não foi possível copiar a ligação neste browser.");
    }
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

  return <article className="post card">
    <div className="post-head">
      <Link to={`/u/${post.username}`}><Avatar user={post} /></Link>
      <div className="post-byline"><Link className="post-author" to={`/u/${post.username}`}>{post.display_name}</Link><span className="post-meta"><span>@{post.username}</span><span aria-hidden="true">·</span><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString("pt-PT")}</time></span></div>
      {(post.is_creator || ownsPost) && <div className="post-head-tools">
        {post.is_creator && <span className="creator-badge">Criador</span>}
        {post.is_exclusive && <span className="exclusive-badge">Exclusivo</span>}
        {ownsPost && (confirmDelete
          ? <div className="post-delete-confirm" role="group" aria-label="Confirmar eliminação da publicação">
            <span>Apagar publicação?</span>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancelar</button>
            <button className="confirm" type="button" onClick={deletePost} disabled={deleting}>{deleting ? "A apagar..." : "Apagar"}</button>
          </div>
          : <button className="post-delete-button" type="button" onClick={() => { setError(""); setConfirmDelete(true); }} aria-label="Apagar publicação" title="Apagar publicação"><Icon name="trash" size={20} /></button>)}
      </div>}
    </div>
    {post.body && <p className="post-body">{post.body}</p>}
    {post.media_url && (post.media_type === "video"
      ? <video className="media" controls src={`${API_BASE}${post.media_url}`} />
      : <img className="media" src={`${API_BASE}${post.media_url}`} alt="Publicação" />)}
    <div className="post-counts"><span><span className="post-count-mark" aria-hidden="true"><Icon name="heart" size={11} /></span>{post.likes} apoios</span><button className="text-button" onClick={toggleComments}>{post.comments} conversas</button></div>
    <div className="post-actions">
      <button className={post.liked ? "active" : ""} onClick={toggleLike}><span aria-hidden="true"><Icon name="heart" size={16} /></span>{post.liked ? "Apoiou" : "Apoiar"}</button>
      <button onClick={toggleComments}><span aria-hidden="true"><Icon name="messages" size={16} /></span>Conversar</button>
      <button onClick={share}><span aria-hidden="true"><Icon name="share" size={16} /></span>Partilhar</button>
    </div>
    {showComments && <div className="comments">
      {comments.map(comment => <div className="comment" key={comment.id}><Avatar user={comment} size="tiny" /><p><strong>{comment.display_name || comment.username}</strong> {comment.body}</p></div>)}
      {user && <form className="comment-form" onSubmit={addComment}><Avatar user={user} size="tiny" /><input value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Escreve um comentário..." maxLength="2000" /><button className="text-button" disabled={busy}>Publicar</button></form>}
    </div>}
    {error && <p className={error === "Ligação copiada." ? "success" : "error"}>{error}</p>}
  </article>;
}

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
  const activeGroup = storyGroups.find(group => group.user_id === activeGroupId);
  const activeStory = activeGroup?.stories[activeStoryIndex];

  useEffect(() => {
    if (!activeStory) return undefined;
    const handleKeyDown = event => {
      if (event.key === "Escape") setActiveGroupId(null);
      if (event.key === "ArrowRight") {
        if (activeStoryIndex < activeGroup.stories.length - 1) setActiveStoryIndex(index => index + 1);
        else setActiveGroupId(null);
      }
      if (event.key === "ArrowLeft") setActiveStoryIndex(index => Math.max(0, index - 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeStory, activeGroup, activeStoryIndex]);

  const createStory = async event => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", file);
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

  const moveStory = direction => {
    const nextIndex = activeStoryIndex + direction;
    if (nextIndex < 0) {
      setActiveGroupId(null);
    } else if (nextIndex >= activeGroup.stories.length) {
      setActiveGroupId(null);
    } else {
      setActiveStoryIndex(nextIndex);
    }
  };

  return <section className="story-zone" aria-label="Stories da comunidade">
    <div className="story-strip">
      <button className="story-card story-create-card" type="button" onClick={() => { setError(""); setShowComposer(true); }}>
        <span className="story-create-image"><Avatar user={user} size="large" /><span className="story-add-mark"><Icon name="plus" size={17} /></span></span>
        <span className="story-create-caption"><strong>Criar story</strong><small><Icon name="camera" size={12} />Partilha um momento</small></span>
      </button>
      {storyGroups.map(group => <button
        className="story-card story-person-card"
        type="button"
        key={group.user_id}
        onClick={() => { setActiveStoryIndex(0); setActiveGroupId(group.user_id); }}
      >
        <span className="story-cover">
          {group.stories[0].media_url
            ? group.stories[0].media_type === "video"
              ? <video src={`${API_BASE}${group.stories[0].media_url}`} muted playsInline />
              : <img src={`${API_BASE}${group.stories[0].media_url}`} alt="" />
            : <span className={`story-text-cover story-cover-tone-${group.user_id % 4}`}><span>{group.stories[0].body}</span></span>}
          <span className="story-cover-shade" />
          <Avatar user={group} size="tiny" />
          {group.stories.length > 1 && <span className="story-count"><Icon name="layers" size={11} />{group.stories.length}</span>}
          {group.stories[0].media_url && <span className="story-media-kind"><Icon name={group.stories[0].media_type === "video" ? "video" : "camera"} size={13} /></span>}
          <span className="story-person-name">{group.display_name}</span>
        </span>
      </button>)}
      {!storyGroups.length && <div className="story-empty-note"><span className="story-empty-icon"><Icon name="spark" size={19} /></span><p>Sê a primeira pessoa a partilhar um momento de hoje.</p></div>}
    </div>
    {notice && <p className="story-notice" role="status">{notice}</p>}
    {error && <p className="story-error" role="alert">{error}</p>}
    {showComposer && <div className="story-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowComposer(false); }}>
      <form className="story-composer-modal" onSubmit={createStory} aria-label="Criar story">
        <button className="story-modal-close" type="button" aria-label="Fechar" onClick={() => setShowComposer(false)}><Icon name="close" size={17} /></button>
        <p className="feed-section-kicker">UM MOMENTO, À TUA MANEIRA</p>
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
      <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`Story de ${activeGroup.display_name}`}>
        <div className="story-viewer-top">
          <div className="story-progress-row">{activeGroup.stories.map((story, index) => <span className={index <= activeStoryIndex ? "active" : ""} key={story.id}><i /></span>)}</div>
          <div className="story-viewer-author"><Avatar user={activeGroup} size="tiny" /><span className="story-viewer-meta"><strong>{activeGroup.display_name}</strong><small>{new Date(activeStory.created_at).toLocaleString("pt-PT")}</small></span><button type="button" aria-label="Fechar story" onClick={() => setActiveGroupId(null)}><Icon name="close" size={17} /></button></div>
        </div>
        {activeStory.media_url && (activeStory.media_type === "video"
          ? <video className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} controls autoPlay />
          : <img className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} alt={`Story de ${activeGroup.display_name}`} />)}
        {activeStory.body && <p className={`story-viewer-body ${activeStory.media_url ? "" : `story-cover-tone-${activeStory.user_id % 4}`}`}>{activeStory.body}</p>}
        <button className="story-viewer-nav previous" type="button" aria-label="Story anterior" onClick={() => moveStory(-1)}><Icon name="previous" size={20} /></button>
        <button className="story-viewer-nav next" type="button" aria-label="Próximo story" onClick={() => moveStory(1)}><Icon name="next" size={20} /></button>
      </section>
    </div>}
  </section>;
}

function Feed() {
  const { user } = useContext(UserContext);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError("");
    try {
      const result = await api("/posts");
      setPosts(result.posts);
    } catch (loadError) {
      setError(loadError.message === "Failed to fetch" ? "Não foi possível ligar à API. Confirma que o servidor está em execução." : loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return <div className="page feed-layout">
    <aside className="left-rail">
      <div className="rail-section-label">A TUA COMUNIDADE</div>
      <Link className="rail-link" to="/reels"><span className="rail-icon"><Icon name="reels" /></span>Reels</Link>
      <Link className="rail-link" to="/friends"><span className="rail-icon"><Icon name="friends" /></span>Amigos</Link>
      <Link className="rail-link" to="/messages"><span className="rail-icon"><Icon name="messages" /></span>Mensagens</Link>
      <Link className="rail-link" to="/groups"><span className="rail-icon"><Icon name="groups" /></span>Grupos</Link>
      <Link className="rail-link" to="/pages"><span className="rail-icon"><Icon name="pages" /></span>Páginas</Link>
      <Link className="rail-link" to="/events"><span className="rail-icon"><Icon name="events" /></span>Eventos</Link>
      <div className="rail-section-label">PARTILHA ALGO</div>
      <Link className="rail-link rail-create-link" to="/create"><span className="rail-icon"><Icon name="create" /></span>Criar publicação</Link>
      <div className="side-card rail-note"><span className="rail-note-mark">N+</span><h3>Um lugar para seres tu.</h3><p>Partilha ideias, acompanha conversas e encontra pessoas com os mesmos interesses.</p><Link to="/create">Começar a partilhar <Icon name="externalLink" size={14} /></Link></div>
    </aside>
    <section className="feed-column">
      <StoryZone />
      <Composer onPosted={load} />
      {loading && <div className="empty card">A carregar publicações...</div>}
      {error && <div className="empty card error">{error}</div>}
      {!loading && !error && !posts.length && <div className="empty card">Ainda não há publicações. Sê a primeira pessoa a partilhar algo.</div>}
      {posts.map(post => <PostCard key={post.id} post={post} onChanged={load} />)}
    </section>
    <aside className="right-rail">
      <section className="side-card ad-slot ad-slot-feature" aria-label="Espaço para publicidade">
        <p className="ad-label"><Icon name="ad" size={13} /> PUBLICIDADE</p>
        <div className="ad-placeholder-art" aria-hidden="true"><span>N+</span><i /><i /><i /></div>
        <h3>O teu projeto pode chegar mais longe.</h3>
        <p>Este espaço está reservado para publicidade da comunidade.</p>
      </section>
      <section className="side-card ad-slot ad-slot-secondary" aria-label="Segundo espaço para publicidade">
        <p className="ad-label"><Icon name="ad" size={13} /> PUBLICIDADE</p>
        <div className="ad-placeholder-banner" aria-hidden="true"><span /><span /><span /></div>
        <h3>Mais espaço para marcas e ideias.</h3>
      </section>
      <p className="ad-rail-footer">Anúncios relevantes, com espaço próprio.</p>
    </aside>
  </div>;
}

function Reels() {
  const [posts, setPosts] = useState([]);
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

  return <section className="page narrow reels-page">
    <header className="reels-heading">
      <span className="reels-heading-icon"><Icon name="reels" size={22} /></span>
      <div><p className="feed-section-kicker">VÍDEOS DA COMUNIDADE</p><h1>Reels</h1><p>Momentos em vídeo partilhados por quem está na NOVA+.</p></div>
      <Link className="reels-create-link" to="/create"><Icon name="camera" size={16} />Partilhar vídeo</Link>
    </header>
    {loading && <div className="empty card">A carregar vídeos...</div>}
    {error && <div className="empty card error">{error}</div>}
    {!loading && !error && !posts.length && <div className="reels-empty card"><span className="reels-empty-icon"><Icon name="video" size={25} /></span><h2>Ainda não há Reels</h2><p>Quando alguém partilhar um vídeo, vais encontrá-lo aqui. Também podes ser a primeira pessoa a publicar.</p><Link className="btn" to="/create">Criar publicação</Link></div>}
    {!loading && !error && <div className="reels-list">{posts.map(post => <PostCard key={post.id} post={post} onChanged={load} />)}</div>}
  </section>;
}

function Settings() {
  const { user, refreshUser } = useContext(UserContext);
  const { theme, setTheme } = useContext(ThemeContext);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ displayName: "", bio: "", subscriptionPrice: "" });
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const startProfileEdit = () => {
    setProfileForm({
      displayName: user?.display_name || "",
      bio: user?.bio || "",
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

  return <section className="page narrow settings-page">
    <h1 className="settings-page-title">Definições</h1>
    <p className="settings-page-intro">Gere a tua experiência, consulta a tua conta e encontra rapidamente as áreas principais da NOVA+.</p>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Secções das definições">
        <p>GERIR PREFERÊNCIAS</p>
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
            <div><p className="settings-section-kicker">PERSONALIZAÇÃO</p><h2 id="appearance-heading">Escolhe o teu ambiente</h2><p>Encontra o tema mais confortável para ti.</p></div>
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
            <div><p className="settings-section-kicker">ATIVIDADE</p><h2 id="notification-settings-heading">Notificações</h2><p>Acompanha novidades e interações da comunidade.</p></div>
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
        <section className="settings-section card" id="privacy" aria-labelledby="privacy-settings-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="profile" /></span>
            <div><p className="settings-section-kicker">CONTROLO</p><h2 id="privacy-settings-heading">Privacidade e visibilidade</h2><p>Confirma o que partilhas com as outras pessoas.</p></div>
          </div>
          <div className="settings-info-panel">
            <span className="settings-info-mark"><Icon name="friends" /></span>
            <div><strong>O teu perfil faz parte da comunidade</strong><p>O teu perfil e as publicações que partilhas podem ser vistos por outras pessoas na NOVA+.</p></div>
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
            <div><p className="settings-section-kicker">PERFIL</p><h2 id="account-settings-heading">A tua conta</h2><p>As informações que partilhas com a comunidade.</p></div>
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
              {profileNotice && <p className="settings-form-success" role="status"><Icon name="check" size={14} />{profileNotice}</p>}
              {editingProfile && <form className="settings-profile-form" onSubmit={saveProfile}>
                <div className="settings-form-heading"><div><strong>Editar perfil público</strong><p>Estas informações ajudam as pessoas a reconhecer-te na NOVA+.</p></div><span>Visível no teu perfil</span></div>
                <label>Nome público<input autoComplete="name" maxLength={100} required value={profileForm.displayName} onChange={event => setProfileForm({ ...profileForm, displayName: event.target.value })} /></label>
                <label>Biografia <small>{profileForm.bio.length}/500</small><textarea maxLength={500} rows={4} value={profileForm.bio} onChange={event => setProfileForm({ ...profileForm, bio: event.target.value })} placeholder="Conta um pouco sobre ti..." /></label>
                {user.is_creator && <label>Preço da subscrição mensal (€) <small>Entre 1 € e 1000 €</small><input type="number" inputMode="decimal" min="1" max="1000" step="0.01" value={profileForm.subscriptionPrice} onChange={event => setProfileForm({ ...profileForm, subscriptionPrice: event.target.value })} placeholder="Ex.: 4,99" /></label>}
                {profileError && <p className="error" role="alert">{profileError}</p>}
                <div className="settings-form-actions"><button className="btn" type="submit" disabled={savingProfile}>{savingProfile ? "A guardar..." : "Guardar alterações"}</button><button className="btn secondary" type="button" disabled={savingProfile} onClick={() => setEditingProfile(false)}>Cancelar</button></div>
              </form>}
              <div className="settings-detail-grid settings-account-details">
                <div><span className="settings-detail-icon"><Icon name="messages" /></span><span><small>Email da conta</small><strong>{user.email}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="profile" /></span><span><small>Tipo de conta</small><strong>{user.is_creator ? "Criador" : "Membro da comunidade"}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="check" /></span><span><small>Estado do email</small><strong className={`settings-verification ${user.email_verified ? "verified" : "pending"}`}>{user.email_verified ? "Email confirmado" : "Confirmação pendente"}</strong></span></div>
                <div><span className="settings-detail-icon"><Icon name="create" /></span><span><small>Biografia</small><strong>{user.bio?.trim() || "Ainda não adicionaste uma biografia."}</strong></span></div>
              </div>
              <div className="settings-action-row settings-security-row">
                <span className="settings-action-mark"><Icon name="settings" /></span>
                <span><strong>Segurança e acesso</strong><small>Se precisares de alterar a palavra-passe, pede uma ligação segura de recuperação.</small></span>
                <Link className="settings-account-link" to="/forgot-password">Recuperar acesso <Icon name="externalLink" size={14} /></Link>
              </div>
            </>
            : <div className="settings-guest-card"><span className="settings-action-mark"><Icon name="profile" /></span><div><strong>Inicia sessão para gerir a tua conta</strong><p>Depois de entrares, podes consultar os teus dados e abrir o teu perfil.</p></div><Link className="settings-account-link" to="/login">Iniciar sessão <Icon name="externalLink" size={14} /></Link></div>}
        </section>
        <section className="settings-section card" id="shortcuts" aria-labelledby="settings-shortcuts-heading">
          <div className="settings-section-heading">
            <span className="settings-option-icon"><Icon name="layers" /></span>
            <div><p className="settings-section-kicker">NOVA+</p><h2 id="settings-shortcuts-heading">Acede rapidamente</h2><p>Continua a explorar e a participar na comunidade.</p></div>
          </div>
          <div className="settings-shortcuts-grid">
            <Link to="/friends"><Icon name="friends" /><span><strong>Amigos</strong><small>Encontra pessoas</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/messages"><Icon name="messages" /><span><strong>Mensagens</strong><small>Fala em privado</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/groups"><Icon name="groups" /><span><strong>Grupos</strong><small>Partilha interesses</small></span><Icon name="externalLink" size={14} /></Link>
            <Link to="/events"><Icon name="events" /><span><strong>Eventos</strong><small>Descobre atividades</small></span><Icon name="externalLink" size={14} /></Link>
          </div>
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
    if (file) formData.append("media", file);
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

function Friends() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [data, setData] = useState({ friends: [], requests: [], suggestions: [] });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    if (!token()) return;
    try {
      setData(await api("/friends"));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, []);

  const sendRequest = async id => {
    if (!token()) return navigate("/login");
    setBusyId(id);
    setError("");
    try {
      await api(`/friends/${id}/request`, { method: "POST" });
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  };

  const acceptRequest = async id => {
    setBusyId(id);
    setError("");
    try {
      await api(`/friends/requests/${id}/accept`, { method: "POST" });
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  };

  const rejectRequest = async id => {
    setBusyId(id);
    setError("");
    try {
      await api(`/friends/requests/${id}/reject`, { method: "POST" });
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver os teus amigos. <Link to="/login">Entrar</Link></div></div>;

  const personRow = (person, action) => <div className="person-row" key={person.id || person.user_id}><Link className="person-info" to={`/u/${person.username}`}><Avatar user={person} /><span><strong>{person.display_name}</strong><small>@{person.username}</small></span></Link>{action}</div>;

  return <div className="page narrow">
    <div className="feed-heading"><h1>Amigos</h1><p>Encontra pessoas e liga-te à tua comunidade.</p></div>
    {error && <p className="error">{error}</p>}
    {!!data.requests.length && <section className="section-card card"><h2>Pedidos recebidos</h2>{data.requests.map(request => personRow(request, <div className="profile-buttons"><button className="btn" disabled={busyId === request.id} onClick={() => acceptRequest(request.id)}>Aceitar</button><button className="btn secondary" disabled={busyId === request.id} onClick={() => rejectRequest(request.id)}>Recusar</button></div>))}</section>}
    <section className="section-card card"><h2>Sugestões de amizade</h2>{data.suggestions.length ? data.suggestions.map(person => personRow(person, <button className="btn secondary" disabled={busyId === person.id} onClick={() => sendRequest(person.id)}>Adicionar amigo</button>)) : <p className="muted">Ainda não há sugestões.</p>}</section>
    <section className="section-card card"><h2>Os teus amigos · {data.friends.length}</h2>{data.friends.length ? data.friends.map(person => personRow(person, <Link className="btn secondary" to={`/messages/${person.id}`}>Mensagem</Link>)) : <p className="muted">Os teus amigos aparecerão aqui.</p>}</section>
  </div>;
}

const formatPrice = value => Number(value).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
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

function Profile() {
  const { username } = useParams();
  const { user } = useContext(UserContext);
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
      <div className="profile-cover">
        {!isAboutPage && <>
          <span className="profile-cover-kicker">NOVA+ <i /> ESPAÇO DE CRIAÇÃO</span>
          <span className="profile-cover-message">Histórias que<br /><em>nos aproximam.</em></span>
          <span className="profile-cover-mark" aria-hidden="true">N<span>+</span></span>
          <span className="profile-cover-orbit profile-cover-orbit-one" />
          <span className="profile-cover-orbit profile-cover-orbit-two" />
        </>}
      </div>
      <div className="profile-identity">
        <Avatar user={profile} size="large" />
        <div className="profile-identity-copy">
          <p className="profile-kicker">{isAboutPage ? "PERFIL PESSOAL" : isOwnProfile ? "O TEU ESPAÇO NA COMUNIDADE" : "ESPAÇO DA COMUNIDADE"}</p>
          <h1>{profile.display_name}</h1>
          <p className="handle">@{profile.username}</p>
        </div>
        {!isAboutPage && <div className="profile-identity-actions">
          {isOwnProfile
            ? <Link className="btn secondary" to="/settings"><Icon name="settings" size={15} /> Editar perfil</Link>
            : profile.is_friend
              ? <Link className="btn secondary" to={`/messages/${profile.id}`}>Enviar mensagem</Link>
              : <button className="btn" onClick={addFriend}>Adicionar amigo <Icon name="plus" size={14} /></button>}
        </div>}
      </div>
      {!isAboutPage && profile.is_creator && Number(profile.subscription_price) > 0 && <SubscriptionPanel
        profile={profile}
        isOwnProfile={isOwnProfile}
        busy={subscriptionBusy}
        onSubscribe={subscribe}
        onCancel={cancelSubscription}
      />}
      {message && <p className="success" role="status">{message}</p>}
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
    </section> : <div className="profile-content-grid">
      <aside className="profile-about-column" id="profile-about">
        <section className="profile-info-card card">
          <h2>Sobre</h2>
          <p className="profile-about-bio">{profile.bio || "Ainda não adicionou uma biografia."}</p>
          <div className="profile-detail-line"><span className="rail-icon"><Icon name="profile" /></span><span><small>Perfil</small><strong>@{profile.username}</strong></span></div>
          <div className="profile-detail-line"><span className="rail-icon"><Icon name={profile.is_creator ? "spark" : "groups"} /></span><span><small>Na NOVA+</small><strong>{profile.is_creator ? "Criador" : "Membro da comunidade"}</strong></span></div>
        </section>
        <section className="profile-info-card profile-stats-card card">
          <h2>Atividade</h2>
          <div className="profile-stat-row"><strong>{profile.posts}</strong><span>publicações</span></div>
          <div className="profile-stat-row"><strong>{profile.followers}</strong><span>seguidores</span></div>
        </section>
      </aside>
      <section className="profile-feed-column" id="profile-posts">
        {isOwnProfile && <div className="profile-share-prompt card">
          <Avatar user={profile} />
          <Link to="/create">Partilha um momento com a comunidade...</Link>
          <Link className="profile-share-action" to="/create" aria-label="Criar publicação" title="Criar publicação"><Icon name="create" /></Link>
        </div>}
        <div className="profile-posts-heading">
          <div><p className="feed-section-kicker">{isOwnProfile ? "O TEU ESPAÇO NA COMUNIDADE" : `PUBLICAÇÕES DE @${profile.username}`}</p><h2>Publicações</h2></div>
          {isOwnProfile && <Link to="/create">Criar publicação <Icon name="externalLink" size={14} /></Link>}
        </div>
        {posts.length ? posts.map(post => <PostCard key={post.id} post={post} onChanged={load} />) : <div className="empty card">Ainda não há publicações neste perfil.</div>}
      </section>
    </div>}
  </div>;
}

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
  const selected = conversations.find(person => String(person.id) === userId)
    || contacts.find(person => String(person.id) === userId)
    || results.find(person => String(person.id) === userId);

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
    if (!userId || !token()) return;
    api(`/messages/${userId}`).then(result => setMessages(result.messages)).catch(loadError => setError(loadError.message));
  }, [userId]);

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

  const personRow = person => <button className={`conversation-row ${String(person.id) === userId ? "selected" : ""}`} key={person.id} onClick={() => navigate(`/messages/${person.id}`)}><Avatar user={person} /><span><strong>{person.display_name}</strong><small>{person.latest_message || `@${person.username}`}</small></span></button>;

  return <div className="page messages-layout card">
    <aside className="conversation-list">
      <h1>Mensagens</h1>
      <form className="search-form" onSubmit={searchUsers}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Procurar pessoas" /><button className="btn small">Pesquisar</button></form>
      {results.map(personRow)}
      {conversations.map(personRow)}
      {!conversations.length && !results.length && <p className="muted">Procura uma pessoa para iniciar uma conversa.</p>}
    </aside>
    <section className="chat-panel">
      {selected ? <>
        <header className="chat-header"><Avatar user={selected} /><div><strong>{selected.display_name}</strong><small>@{selected.username}</small></div></header>
        <div className="chat-messages">{messages.map(message => <div className={`message-bubble ${String(message.sender_id) === String(user.id) ? "mine" : ""}`} key={message.id}>{message.body}</div>)}</div>
        <form className="chat-form" onSubmit={sendMessage}><input value={body} onChange={event => setBody(event.target.value)} placeholder="Escreve uma mensagem..." maxLength="4000" /><button className="btn" disabled={busy || !body.trim()}>{busy ? "A enviar..." : "Enviar"}</button></form>
      </> : <div className="empty chat-empty">Escolhe uma conversa ou procura alguém para enviar uma mensagem.</div>}
      {error && <p className="error">{error}</p>}
    </section>
  </div>;
}

function Groups() {
  const { groupId } = useParams();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [posts, setPosts] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const group = groups.find(item => String(item.id) === groupId);

  const loadGroups = async () => {
    try {
      const result = await api("/groups");
      setGroups(result.groups);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadGroups(); }, []);
  useEffect(() => {
    if (!groupId) {
      setPosts([]);
      return;
    }
    api(`/posts?groupId=${encodeURIComponent(groupId)}`)
      .then(result => setPosts(result.posts))
      .catch(loadError => setError(loadError.message));
  }, [groupId]);

  const createGroup = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description })
      });
      setName("");
      setDescription("");
      await loadGroups();
      navigate(`/groups/${result.group.id}`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async id => {
    setBusy(true);
    setError("");
    try {
      await api(`/groups/${id}/join`, { method: "POST" });
      await loadGroups();
    } catch (joinError) {
      setError(joinError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="page narrow">
    <div className="feed-heading"><h1>Grupos</h1><p>Junta-te a pessoas com interesses em comum.</p></div>
    {!user && <p className="muted">Entra na tua conta para criar grupos e participar.</p>}
    {user && <form className="section-card card entity-form" onSubmit={createGroup}><h2>Criar grupo</h2><input required maxLength="100" value={name} onChange={event => setName(event.target.value)} placeholder="Nome do grupo" /><textarea maxLength="2000" rows="3" value={description} onChange={event => setDescription(event.target.value)} placeholder="Sobre o que é este grupo?" /><button className="btn" disabled={busy}>{busy ? "A criar..." : "Criar grupo"}</button></form>}
    {error && <p className="error">{error}</p>}
    <div className="entity-list">{groups.map(item => <article className="section-card card entity-card" key={item.id}>
      <div><h2><Link to={`/groups/${item.id}`}>{item.name}</Link></h2><p>{item.description || "Um espaço para a comunidade."}</p><small>{item.member_count} membros · criado por {item.owner_name}</small></div>
      {user && !item.is_member && <button className="btn secondary" disabled={busy} onClick={() => joinGroup(item.id)}>Participar</button>}
      {user && item.is_member && <span className="success">Membro</span>}
    </article>)}</div>
    {groupId && group && <section className="entity-detail">
      <div className="feed-heading"><h2>{group.name}</h2><p>{group.description}</p></div>
      {group.is_member
        ? <Composer target={{ type: "group", id: group.id }} onPosted={() => api(`/posts?groupId=${group.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message))} />
        : <div className="section-card card"><p>Participa no grupo para criar publicações.</p>{user && <button className="btn" onClick={() => joinGroup(group.id)}>Participar</button>}</div>}
      {posts.map(post => <PostCard key={post.id} post={post} onChanged={() => api(`/posts?groupId=${group.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message))} />)}
      {!posts.length && group.is_member && <div className="empty card">Ainda não há publicações neste grupo.</div>}
    </section>}
    {groupId && !group && !error && <div className="empty card">A carregar grupo...</div>}
  </div>;
}

function Pages() {
  const { pageId } = useParams();
  const { user } = useContext(UserContext);
  const [pages, setPages] = useState([]);
  const [posts, setPosts] = useState([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Comunidade");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const page = pages.find(item => String(item.id) === pageId);
  const ownsPage = page && page.owner_username === user?.username;

  const loadPages = async () => {
    try {
      const result = await api("/pages");
      setPages(result.pages);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadPages(); }, []);
  useEffect(() => {
    if (!pageId) {
      setPosts([]);
      return;
    }
    api(`/posts?pageId=${encodeURIComponent(pageId)}`)
      .then(result => setPosts(result.posts))
      .catch(loadError => setError(loadError.message));
  }, [pageId]);

  const createPage = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, description })
      });
      setName("");
      setDescription("");
      await loadPages();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  const followPage = async id => {
    setBusy(true);
    setError("");
    try {
      await api(`/pages/${id}/follow`, { method: "POST" });
      await loadPages();
    } catch (followError) {
      setError(followError.message);
    } finally {
      setBusy(false);
    }
  };

  const reloadPosts = () => api(`/posts?pageId=${page.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

  return <div className="page narrow">
    <div className="feed-heading"><h1>Páginas</h1><p>Segue criadores, projetos e comunidades.</p></div>
    {!user && <p className="muted">Entra na tua conta para criar páginas e segui-las.</p>}
    {user && <form className="section-card card entity-form" onSubmit={createPage}><h2>Criar página</h2><input required maxLength="100" value={name} onChange={event => setName(event.target.value)} placeholder="Nome da página" /><input maxLength="60" value={category} onChange={event => setCategory(event.target.value)} placeholder="Categoria" /><textarea maxLength="2000" rows="3" value={description} onChange={event => setDescription(event.target.value)} placeholder="Descrição" /><button className="btn" disabled={busy}>{busy ? "A criar..." : "Criar página"}</button></form>}
    {error && <p className="error">{error}</p>}
    <div className="entity-list">{pages.map(item => <article className="section-card card entity-card" key={item.id}>
      <div><h2><Link to={`/pages/${item.id}`}>{item.name}</Link></h2><small>{item.category} · {item.follower_count} seguidores · por {item.owner_name}</small><p>{item.description}</p></div>
      {user && !item.is_following && <button className="btn secondary" disabled={busy} onClick={() => followPage(item.id)}>Seguir</button>}
      {user && item.is_following && <span className="success">A seguir</span>}
    </article>)}</div>
    {pageId && page && <section className="entity-detail">
      <div className="feed-heading"><h2>{page.name}</h2><p>{page.category} · {page.description}</p></div>
      {ownsPage && <Composer target={{ type: "page", id: page.id }} onPosted={reloadPosts} />}
      {posts.map(post => <PostCard key={post.id} post={post} onChanged={reloadPosts} />)}
      {!posts.length && <div className="empty card">{ownsPage ? "Ainda não há publicações nesta página." : "Esta página ainda não publicou conteúdo."}</div>}
    </section>}
    {pageId && !page && !error && <div className="empty card">A carregar página...</div>}
  </div>;
}

function Events() {
  const { user } = useContext(UserContext);
  const [events, setEvents] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const result = await api("/events");
      setEvents(result.events);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, []);

  const createEvent = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, location, startsAt })
      });
      setName("");
      setDescription("");
      setLocation("");
      setStartsAt("");
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRsvp = async id => {
    setBusy(true);
    setError("");
    try {
      await api(`/events/${id}/rsvp`, { method: "POST" });
      await load();
    } catch (rsvpError) {
      setError(rsvpError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="page narrow">
    <div className="feed-heading"><h1>Eventos</h1><p>Descobre o que acontece e combina encontros.</p></div>
    {user
      ? <form className="section-card card entity-form" onSubmit={createEvent}><h2>Criar evento</h2><input required maxLength="120" value={name} onChange={event => setName(event.target.value)} placeholder="Nome do evento" /><input maxLength="160" value={location} onChange={event => setLocation(event.target.value)} placeholder="Localização" /><input required type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /><textarea maxLength="2000" rows="3" value={description} onChange={event => setDescription(event.target.value)} placeholder="Descrição" /><button className="btn" disabled={busy}>{busy ? "A criar..." : "Criar evento"}</button></form>
      : <p className="muted">Entra na tua conta para criar eventos e confirmar presença.</p>}
    {error && <p className="error">{error}</p>}
    <div className="entity-list">{events.map(item => <article className="section-card card event-card" key={item.id}>
      <div className="event-date"><strong>{new Date(item.starts_at).toLocaleDateString("pt-PT", { day: "2-digit" })}</strong><span>{new Date(item.starts_at).toLocaleDateString("pt-PT", { month: "short" })}</span></div>
      <div className="event-info"><h2>{item.name}</h2><p>{new Date(item.starts_at).toLocaleString("pt-PT")} {item.location && `· ${item.location}`}</p><small>Organizado por {item.creator_name} · {item.attendee_count} participantes</small>{item.description && <p>{item.description}</p>}</div>
      {user && <button className={`btn ${item.is_attending ? "secondary" : ""}`} disabled={busy} onClick={() => toggleRsvp(item.id)}>{item.is_attending ? "Vou participar" : "Participar"}</button>}
    </article>)}</div>
    {!events.length && !error && <div className="empty card">Ainda não há eventos próximos.</div>}
  </div>;
}

function Notifications() {
  const { user, refreshUser } = useContext(UserContext);
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const result = await api("/notifications");
      setNotifications(result.notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const markRead = async id => {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      await load();
      await refreshUser();
    } catch (readError) {
      setError(readError.message);
    }
  };

  const markAllRead = async () => {
    try {
      await api("/notifications/read-all", { method: "POST" });
      await load();
      await refreshUser();
    } catch (readError) {
      setError(readError.message);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver as notificações. <Link to="/login">Entrar</Link></div></div>;
  return <div className="page narrow">
    <div className="feed-heading notification-heading"><div><h1>Notificações</h1><p>Atividade recente da tua conta.</p></div><button className="text-button" onClick={markAllRead}>Marcar todas como lidas</button></div>
    {error && <p className="error">{error}</p>}
    <div className="notification-list">{notifications.map(item => <button className={`notification-item ${item.read ? "" : "unread"}`} key={item.id} onClick={() => !item.read && markRead(item.id)}>
      <span className="notification-dot">{item.read ? "○" : "●"}</span><span><strong>{item.actor_name || "NOVA+"}</strong> {item.text}<small>{new Date(item.created_at).toLocaleString("pt-PT")}</small></span>
    </button>)}</div>
    {!notifications.length && !error && <div className="empty card">Não tens notificações.</div>}
  </div>;
}

function App() {
  return <Layout><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/reels" element={<Reels />} />
    <Route path="/login" element={<Auth mode="login" />} />
    <Route path="/register" element={<Auth mode="register" />} />
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
    <Route path="/u/:username/about" element={<Profile />} />
    <Route path="/u/:username" element={<Profile />} />
  </Routes></Layout>;
}

createRoot(document.getElementById("root")).render(<BrowserRouter><App /></BrowserRouter>);
