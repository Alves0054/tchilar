import { useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon, UserContext, api } from "./core.jsx";
import { InfoLinks } from "./shared.jsx";

export const PASSWORD_MIN = 8;
export const USERNAME_PATTERN = /^[a-z0-9._]{3,40}$/;
// Força estimada da palavra-passe (0–4). É uma ajuda visual; o servidor só exige o mínimo.
export function passwordStrength(password) {
  if (password.length < PASSWORD_MIN) return 0;
  let score = 1;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}
export const STRENGTH_LABELS = ["Demasiado curta", "Fraca", "Razoável", "Boa", "Forte"];
// "Ana Sofia" + "Gonçalves" → "ana.sofia.goncalves"
export function suggestUsername(firstName, lastName) {
  return `${firstName} ${lastName}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
}
// Campo com a etiqueta dentro da caixa: fica no lugar do texto enquanto está vazio
// e sobe quando se escreve. A etiqueta é sempre um <label> real (acessível).
export function EntryInput({ id, label, invalid, describedBy, prefix, children, ...inputProps }) {
  return <div className={`entry-control${prefix ? " has-prefix" : ""}`}>
    <input id={id} placeholder=" " aria-invalid={invalid || undefined} aria-describedby={describedBy} {...inputProps} />
    <label htmlFor={id}>{label}</label>
    {prefix && <span className="entry-prefix" aria-hidden="true">{prefix}</span>}
    {children}
  </div>;
}
export function PasswordField({ id, label, value, onChange, autoComplete, invalid, describedBy, children }) {
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
export function SwapLink({ to, onClick, ...props }) {
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
export function EntryShowcase({ mode }) {
  return <div className="entry-showcase">
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
  </div>;
}
export function Auth({ mode }) {
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
export function VerifyEmail() {
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
export function ForgotPassword() {
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
export function ResetPassword() {
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
