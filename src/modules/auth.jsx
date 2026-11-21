import { useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon, UserContext, api } from "./core.jsx";
import { InfoLinks, StoreButtons } from "./shared.jsx";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, PHONE_ERROR, PhoneInput, SMS_CHANNEL_LABELS, formatPhone, parsePhone, useSmsChannels } from "./phones.jsx";
import { DatePicker } from "./date-picker.jsx";

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
// Logótipo completo (com o texto "Tchilar"): versão preta no tema claro e branca no escuro.
export function BrandLogo() {
  return <>
    <img className="brand-logo is-light" src="/tchilar-logo-full.png" alt="" />
    <img className="brand-logo is-dark" src="/tchilar-logo-full-dark.png" alt="" />
  </>;
}
export function EntryShowcase({ mode }) {
  return <div className="entry-showcase">
    <Link className="entry-logo" to="/" aria-label="Tchilar, página inicial"><BrandLogo /></Link>
    <div className="entry-collage" aria-hidden="true">
      <figure className="entry-card entry-card-story">
        <span className="entry-story-bars"><i /><i /><i /></span>
        <img src="/tchilar-community-selfie.jpg" alt="" />
        <span className="entry-chip entry-chip-time"><Icon name="events" size={14} /> 19:30</span>
      </figure>
      <figure className="entry-card entry-card-photo">
        <span className="entry-card-badge"><Icon name="camera" size={14} /></span>
        <img src="/tchilar-community-friends.jpg" alt="" />
      </figure>
      <figure className="entry-card entry-card-post">
        <span className="entry-card-badge entry-card-badge-accent"><Icon name="groups" size={14} /></span>
        <img src="/tchilar-community-join.jpg" alt="" />
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
// Idade em anos completos numa data AAAA-MM-DD (null se a data for inválida).
export function ageFromBirthDate(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age;
}
const MIN_SIGNUP_AGE = 13;
const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function Auth({ mode }) {
  const isLogin = mode === "login";
  const navigate = useNavigate();
  const { refreshUser } = useContext(UserContext);
  const [form, setForm] = useState({ firstName: "", lastName: "", username: "", birthDate: "", email: "", phone: "", phoneCountry: DEFAULT_PHONE_COUNTRY, password: "", isCreator: false });
  const [authParams] = useSearchParams();
  const invite = (authParams.get("convite") || "").trim().toLowerCase();
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState("idle");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const location = useLocation();
  // Mensagem vinda de outro ecrã (por exemplo, palavra-passe mudada pelo telemóvel).
  const [notice, setNotice] = useState(() => (typeof location.state?.notice === "string" ? location.state.notice : ""));
  const [actionUrl, setActionUrl] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // Entrar com email ou telemóvel: fica lembrado neste browser.
  const [loginWith, setLoginWith] = useState(() => {
    try { return localStorage.getItem("tchilar-login-with") === "phone" ? "phone" : "email"; } catch { return "email"; }
  });
  const chooseLoginWith = value => {
    setLoginWith(value);
    setFieldErrors({});
    try { localStorage.setItem("tchilar-login-with", value); } catch { /* sem armazenamento: só nesta visita */ }
  };
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
      const age = ageFromBirthDate(form.birthDate);
      if (age === null) errors.birthDate = "Indica a tua data de nascimento.";
      else if (age < MIN_SIGNUP_AGE) errors.birthDate = `Tens de ter pelo menos ${MIN_SIGNUP_AGE} anos para criar uma conta.`;
      else if (age > 120) errors.birthDate = "Confirma o ano de nascimento.";
      if (!parsePhone(form.phone, form.phoneCountry)) errors.phone = `${PHONE_ERROR} Exemplo: ${PHONE_COUNTRIES.find(item => item.code === form.phoneCountry)?.example}.`;
      if (form.password.length < PASSWORD_MIN) errors.password = `A palavra-passe precisa de pelo menos ${PASSWORD_MIN} caracteres.`;
    } else if (!form.password) {
      errors.password = "Escreve a tua palavra-passe.";
    }
    // Entrar com o telemóvel: país escolhido na lista + número (só serve um número confirmado por SMS).
    if (isLogin && loginWith === "phone") {
      if (!parsePhone(form.phone, form.phoneCountry)) errors.phone = `${PHONE_ERROR} Exemplo: ${PHONE_COUNTRIES.find(item => item.code === form.phoneCountry)?.example}.`;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Escreve um email válido, por exemplo nome@exemplo.com.";
    setFieldErrors(errors);
    const first = ["firstName", "username", "birthDate", "email", "phone", "password"].find(key => errors[key]);
    if (first) {
      const ids = { firstName: "first-name", username: "username", birthDate: "birth-date", email: "email", phone: "phone", password: "password" };
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
          body: JSON.stringify({
            identifier: loginWith === "phone" ? parsePhone(form.phone, form.phoneCountry).e164 : form.email.trim(),
            password: form.password, ...(needsCode && { code: twoFactorCode })
          })
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
          birthDate: form.birthDate,
          ...(form.phone.trim() && { phone: form.phone.trim(), phoneCountry: form.phoneCountry }),
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

  const heading = sentTo ? "Confirma o teu email" : isLogin ? "Entrar no Tchilar" : "Criar conta no Tchilar";

  return <section className={`entry entry-${mode}`}>
    <EntryShowcase mode={mode} />
    <div className="entry-main">
      <div className="entry-panel">
        <Link className="entry-mobile-logo" to="/" aria-label="Tchilar, página inicial"><BrandLogo /></Link>
        {!sentTo && <nav className="entry-switch" data-mode={mode} aria-label="Entrar ou criar conta">
          <span className="entry-switch-pill" aria-hidden="true" />
          <SwapLink to="/login" aria-current={isLogin ? "page" : undefined}>Entrar</SwapLink>
          <SwapLink to="/register" aria-current={isLogin ? undefined : "page"}>Criar conta</SwapLink>
        </nav>}
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
          : <form key={mode} className={`entry-form entry-form-${mode}`} onSubmit={submit} noValidate>
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
                  {usernameMessage ? usernameMessage[0] : "É o teu endereço no Tchilar."}
                </p>}
            </div>}

            {!isLogin && <div className="entry-field">
              <span className="entry-static-label" id="birth-date-label">Data de nascimento</span>
              <DatePicker id="birth-date" mode="date" required shortcuts={false} min="1900-01-01" max={isoDay(new Date())}
                className={`entry-date${fieldErrors.birthDate ? " is-invalid" : ""}`} placeholder="Escolhe o dia, o mês e o ano"
                value={form.birthDate} onChange={event => update("birthDate", event.target.value)} aria-label="Data de nascimento" />
              {fieldErrors.birthDate ? fieldError("birthDate")
                : <p className="entry-hint" id="birth-date-help">Não aparece no teu perfil. Decide o acesso a conteúdos para maiores de 18 e não pode ser mudada depois.</p>}
            </div>}

            {isLogin && <div className="entry-switch" role="radiogroup" aria-label="Entrar com">
              {[["email", "Email", "mail"], ["phone", "Telemóvel", "phone"]].map(([key, label, icon]) => <button key={key} type="button" role="radio"
                aria-checked={loginWith === key} onClick={() => chooseLoginWith(key)}><Icon name={icon} size={15} /> {label}</button>)}
            </div>}

            {isLogin && loginWith === "phone"
              ? <div className="entry-field">
                <PhoneInput id="phone" required country={form.phoneCountry} onCountryChange={code => update("phoneCountry", code)}
                  value={form.phone} onChange={event => update("phone", event.target.value)}
                  invalid={!!fieldErrors.phone} describedBy={fieldErrors.phone ? "phone-error" : "login-phone-help"} />
                {fieldErrors.phone ? fieldError("phone")
                  : <p className="entry-hint" id="login-phone-help">Só funciona com o número confirmado (Definições → Conta).</p>}
              </div>
              : <div className="entry-field">
                <EntryInput id="email" label="Email" required type="email" autoComplete={isLogin ? "username" : "email"} inputMode="email"
                  autoCapitalize="none" spellCheck="false"
                  value={form.email} onChange={event => update("email", event.target.value)}
                  invalid={!!fieldErrors.email} describedBy={fieldErrors.email ? "email-error" : undefined} />
                {fieldError("email")}
              </div>}

            {!isLogin && <div className="entry-field">
              <PhoneInput id="phone" required country={form.phoneCountry} onCountryChange={code => update("phoneCountry", code)}
                value={form.phone} onChange={event => update("phone", event.target.value)}
                invalid={!!fieldErrors.phone} describedBy={fieldErrors.phone ? "phone-error" : "phone-help"} />
              {fieldErrors.phone ? fieldError("phone") : <p className="entry-hint" id="phone-help">Não aparece no teu perfil. Se quiseres entrar com o telemóvel, confirma-o depois em Definições → Conta (opcional).</p>}
            </div>}

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
              <p className="entry-hint" id="two-factor-help">Abre a tua app de autenticação (Google Authenticator, Authy...) e escreve o código do Tchilar.</p>
            </div>}

            {!isLogin && <label className="entry-creator">
              <input type="checkbox" checked={form.isCreator} onChange={event => update("isCreator", event.target.checked)} />
              <span className="entry-switch-track" aria-hidden="true"><i /></span>
              <span><strong>Também quero publicar como criador</strong><small>Podes ter subscritores e conteúdo exclusivo. O preço define-se depois, nas Definições.</small></span>
            </label>}

            {error && <div className="entry-alert" role="alert">
              <p>{error}</p>
              {needsVerification && loginWith === "email" && <button className="text-button" type="button" disabled={busy || !form.email} onClick={() => resend(form.email.trim())}>Reenviar email de confirmação</button>}
            </div>}
            {notice && <div className="entry-notice" role="status"><p>{notice}</p>{actionUrl && <a href={actionUrl}>Confirmar email agora</a>}</div>}

            {!isLogin && <p className="entry-legal">Ao criar conta, aceitas os <Link to="/terms">Termos de utilização</Link> e a <Link to="/privacy">Política de privacidade</Link>.</p>}

            <button className="entry-btn entry-btn-primary" type="submit" disabled={busy}>
              {busy ? (isLogin ? "A entrar..." : "A criar conta...") : isLogin ? "Entrar" : "Criar conta"}
            </button>

            {isLogin && <Link className="entry-link" to="/forgot-password">Esqueceste-te da palavra-passe?</Link>}

          </form>}

        <footer className="entry-foot">
          <span className="entry-wordmark"><BrandLogo /></span>
          <StoreButtons />
          <InfoLinks />
        </footer>
      </div>
    </div>
  </section>;
}
const VERIFY_VIEWS = {
  checking: { icon: "mail", title: "A confirmar o teu email", text: "Só um momento..." },
  done: { icon: "check", title: "Email confirmado", text: "A tua conta está ativa. Já podes entrar e começar a partilhar." },
  failed: { icon: "close", title: "Esta ligação já não serve", text: "As ligações de confirmação só funcionam uma vez e durante uma hora. Pede uma nova abaixo." },
  // Demasiados pedidos (429): a ligação pode estar boa, por isso não se diz que expirou.
  limited: { icon: "events", title: "Tenta daqui a pouco", text: "Fizeste vários pedidos seguidos. Espera alguns minutos e abre a ligação outra vez." }
};
export function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState("checking");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const requested = useRef("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("A ligação de confirmação está incompleta.");
      setState("failed");
      return;
    }
    // O token só vale uma vez: em modo estrito o React corre o efeito duas vezes, e o segundo pedido falharia.
    if (requested.current === token) return;
    requested.current = token;
    api("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    }).then(() => setState("done")).catch(verifyError => {
      if (verifyError.status === 429) return setState("limited");
      setError(verifyError.status === 400 ? "" : verifyError.message);
      setState("failed");
    });
  }, [searchParams]);

  const resend = async event => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await api("/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      setNotice(result.message);
    } catch (resendError) {
      setNotice(resendError.message);
    } finally {
      setBusy(false);
    }
  };

  const view = VERIFY_VIEWS[state];
  return <section className="entry entry-login">
    <EntryShowcase mode="login" />
    <div className="entry-main">
      <div className="entry-panel">
        <Link className="entry-mobile-logo" to="/" aria-label="Tchilar, página inicial"><img src="/tchilar-logo-full.png" alt="Tchilar" /></Link>
        <div className={`entry-form entry-sent entry-verify entry-verify-${state}`} role="status" aria-live="polite" aria-busy={state === "checking"}>
          <span className="entry-sent-icon" aria-hidden="true"><Icon name={view.icon} size={30} /></span>
          <h1>{view.title}</h1>
          <p className="entry-sub">{view.text}</p>
          {state === "done" && <Link className="entry-btn entry-btn-primary" to="/login">Entrar no Tchilar</Link>}
          {state === "limited" && <Link className="entry-btn entry-btn-outline" to="/login">Voltar a entrar</Link>}
          {state === "failed" && <form className="entry-verify-resend" onSubmit={resend}>
            {error && <p className="entry-hint entry-hint-error">{error}</p>}
            <EntryInput id="verify-email" label="Email da conta" required type="email" autoComplete="email" inputMode="email"
              value={email} onChange={event => setEmail(event.target.value)} />
            <button className="entry-btn entry-btn-primary" type="submit" disabled={busy || !email.trim()}>{busy ? "A enviar..." : "Enviar nova ligação"}</button>
            {notice && <p className="entry-notice">{notice}</p>}
            <Link className="entry-link" to="/login">Voltar a entrar</Link>
          </form>}
        </div>
        <footer className="entry-foot">
          <span className="entry-wordmark"><BrandLogo /></span>
          <InfoLinks />
        </footer>
      </div>
    </div>
  </section>;
}
// Recuperar o acesso: por email (ligação) ou pelo telemóvel confirmado (código por SMS + nova palavra-passe aqui mesmo).
export function ForgotPassword() {
  const navigate = useNavigate();
  const [method, setMethod] = useState("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState({ country: DEFAULT_PHONE_COUNTRY, number: "" });
  const [sms, setSms] = useState(null);         // { phone } depois de pedir o código
  const smsChannels = useSmsChannels();
  const [chosenChannel, setSmsChannel] = useState(null);
  const smsChannel = smsChannels.includes(chosenChannel) ? chosenChannel : smsChannels[0];
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const choose = value => { setMethod(value); setError(""); setNotice(""); setSms(null); setResetUrl(""); };
  const request = async (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResetUrl("");
    try {
      if (method === "email") {
        const result = await request("/auth/forgot-password", { email });
        setNotice(result.message);
        setResetUrl(result.resetUrl || "");
      } else if (!sms) {
        const parsed = parsePhone(phone.number, phone.country);
        if (!parsed) throw new Error(`${PHONE_ERROR} Exemplo: ${PHONE_COUNTRIES.find(item => item.code === phone.country)?.example}.`);
        const result = await request("/auth/forgot-password/phone", { phone: parsed.e164, channel: smsChannel });
        setSms({ phone: result.phone || parsed.e164 });
        setNotice(result.message);
        if (result.devCode) setCode(result.devCode);
      } else {
        if (password.length < PASSWORD_MIN) throw new Error(`A palavra-passe precisa de pelo menos ${PASSWORD_MIN} caracteres.`);
        const result = await request("/auth/reset-password/phone", { phone: sms.phone, code: code.trim(), password });
        navigate("/login", { replace: true, state: { notice: result.message } });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="auth page"><form className="auth-card" onSubmit={submit}>
    <div className="eyebrow">TCHILAR</div>
    <h1>Recuperar acesso.</h1>
    <div className="entry-switch" role="radiogroup" aria-label="Recuperar por">
      {[["email", "Email", "mail"], ["phone", "Telemóvel", "phone"]].map(([key, label, icon]) => <button key={key} type="button" role="radio"
        aria-checked={method === key} onClick={() => choose(key)} disabled={busy}><Icon name={icon} size={15} /> {label}</button>)}
    </div>
    {method === "email" && <>
      <p className="muted">Indica o email da tua conta para receber uma ligação de redefinição.</p>
      <input required type="email" placeholder="Email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />
    </>}
    {method === "phone" && !sms && <>
      <p className="muted">Enviamos um código para o número confirmado da tua conta. Se ainda tens acesso ao email, usa o email: é mais rápido.</p>
      {smsChannels.length > 1 && <div className="entry-switch is-small" role="radiogroup" aria-label="Receber o código por">
        {smsChannels.map(channel => <button key={channel} type="button" role="radio" aria-checked={smsChannel === channel}
          onClick={() => setSmsChannel(channel)} disabled={busy}>{SMS_CHANNEL_LABELS[channel]}</button>)}
      </div>}
      <PhoneInput id="recover-phone" required country={phone.country} onCountryChange={country => setPhone(current => ({ ...current, country }))}
        value={phone.number} onChange={event => setPhone(current => ({ ...current, number: event.target.value }))} />
    </>}
    {method === "phone" && sms && <>
      <p className="muted">Escreve o código que recebeste em {formatPhone(sms.phone)} e a nova palavra-passe.</p>
      <input required inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="Código do SMS" value={code}
        onChange={event => setCode(event.target.value.replace(/\D/g, ""))} />
      <input required type="password" autoComplete="new-password" minLength={PASSWORD_MIN} placeholder={`Nova palavra-passe (mín. ${PASSWORD_MIN})`}
        value={password} onChange={event => setPassword(event.target.value)} />
      <button className="text-button" type="button" disabled={busy} onClick={() => { setSms(null); setCode(""); setNotice(""); }}>Mudar de número ou pedir outro código</button>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {resetUrl && <a className="btn full" href={resetUrl}>Redefinir palavra-passe</a>}
    <button className="btn full" disabled={busy}>{busy ? "A enviar..." : method === "email" ? "Enviar ligação" : sms ? "Guardar nova palavra-passe" : `Enviar código por ${SMS_CHANNEL_LABELS[smsChannel] || "SMS"}`}</button>
    <p className="muted"><Link to="/login">Voltar ao início de sessão</Link></p>
  </form></section>;
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

  return <section className="auth page"><form className="auth-card" onSubmit={submit}><div className="eyebrow">TCHILAR</div><h1>Nova palavra-passe.</h1><input required minLength={PASSWORD_MIN} type="password" autoComplete="new-password" placeholder="Nova palavra-passe" value={password} onChange={event => setPassword(event.target.value)} />{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<button className="btn full" disabled={busy}>{busy ? "A guardar..." : "Atualizar palavra-passe"}</button></form></section>;
}
