import { useContext, useEffect, useState } from "react";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { PASSWORD_MIN } from "./auth.jsx";
import { API, API_BASE, Avatar, Icon, ThemeContext, UserContext, api, readDevicePrefs, saveDevicePrefs, token } from "./core.jsx";
import { InfoLinks } from "./shared.jsx";
import { PHONE_COUNTRIES, PHONE_ERROR, PhoneInput, SMS_CHANNEL_LABELS, formatPhone, maskPhone, parsePhone, splitPhone, useSmsChannels } from "./phones.jsx";
import { SettingsPayments } from "./payments.jsx";
import { disableWebPush, enableWebPush, webPushStatus } from "./web-push.js";
import { Select } from "./select.jsx";
import { DatePicker } from "./date-picker.jsx";

export function BlockedAccounts() {
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
// Público (privado): província e data de nascimento, usados só para promoções segmentadas.
export function AudienceSettings() {
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
        <label className="field">Província<Select value={form.province} onChange={event => setForm({ ...form, province: event.target.value })}>
          <option value="">Prefiro não dizer</option>
          {data.provinces.map(province => <option key={province} value={province}>{province}</option>)}
        </Select></label>
        <label className="field">Data de nascimento<DatePicker mode="date" shortcuts={false} value={form.birthDate} disabled={Boolean(data.birth_date)}
          min="1900-01-01" max={new Date().toISOString().slice(0, 10)} placeholder="Escolhe a data" aria-label="Data de nascimento"
          onChange={event => setForm({ ...form, birthDate: event.target.value })} /></label>
      </div>
      <p className="muted field-note" id="birth-date-note">{data.birth_date
        ? "A data de nascimento fica fixa depois de indicada, porque decide o acesso aos grupos para maiores de 18. Se está errada, contacta o suporte."
        : "Só a podes indicar uma vez. É necessária para entrar ou criar grupos secretos (+18)."}</p>
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
// Exportar dados (RGPD) e apagar conta.
export function AccountDataControls() {
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
      link.download = match?.[1] || "tchilar-dados.json";
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
// Pedidos sobre dados pessoais tratados pela equipa (quando a pessoa precisa de ajuda ou quer corrigir algo).
const DATA_REQUEST_STATUS = { open: "Em análise", done: "Tratado", rejected: "Recusado" };
export function DataRequests() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ kind: "export", details: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api("/data-requests").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/data-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setNotice("Pedido enviado. Vais receber a resposta nas notificações.");
      setForm({ kind: "export", details: "" });
      await load();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };
  const needsDetails = ["correct", "other"].includes(form.kind);
  return <div className="prefs-stack">
    {data && <form className="prefs-form" onSubmit={submit}>
      <label>O que precisas?
        <Select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}>
          {Object.entries(data.kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select>
      </label>
      <label>Detalhes {needsDetails ? "" : <small>Opcional</small>}
        <textarea rows={3} maxLength={1000} required={needsDetails} value={form.details} onChange={event => setForm({ ...form, details: event.target.value })}
          placeholder={form.kind === "correct" ? "Que dado está errado e qual é o certo?" : "Algo que a equipa deva saber"} />
      </label>
      <div className="prefs-form-foot"><button className="btn" type="submit" disabled={busy}>{busy ? "A enviar..." : "Enviar pedido"}</button></div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {data?.requests.map(request => <div className="prefs-row" key={request.id}>
      <span className="prefs-row-icon"><Icon name="lock" /></span>
      <span className="prefs-row-text"><strong>{data.kinds[request.kind]} · {DATA_REQUEST_STATUS[request.status]}</strong>
        <small>{new Date(request.created_at).toLocaleDateString("pt-PT")}{request.answer ? ` · ${request.answer}` : ""}</small></span>
    </div>)}
  </div>;
}
// Verificação em dois passos: estado → (ligar) QR + código → ativa → (desligar) palavra-passe + código.
export function TwoFactorSettings() {
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
      <img className="two-factor-qr" src={setup.qr} width="180" height="180" alt="Código QR para adicionar o Tchilar à app de autenticação" />
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
// Aparelhos com sessão aberta: cada um pode ser terminado à parte (o telemóvel perdido, o computador do trabalho...).
function DeviceSessions({ busy, onEndOthers }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const load = () => api("/auth/sessions").then(result => setSessions(result.sessions)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const end = async session => {
    if (!window.confirm(`Terminar a sessão em "${session.device || "aparelho desconhecido"}"?`)) return;
    try {
      await api(`/auth/sessions/${session.id}`, { method: "DELETE" });
      setSessions(list => list.filter(item => item.id !== session.id));
    } catch (endError) { setError(endError.message); }
  };
  const seen = value => {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 10) return "Ativo agora";
    if (minutes < 60) return `Ativo há ${minutes} min`;
    if (minutes < 60 * 24) return `Ativo há ${Math.round(minutes / 60)} h`;
    return `Ativo a ${new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`;
  };
  const others = (sessions || []).filter(session => !session.current).length;
  return <div className="device-sessions">
    <div className="prefs-row">
      <span className="prefs-row-icon"><Icon name="devices" /></span>
      <span><strong>Onde tens sessão iniciada</strong><small>Se não reconheces um aparelho, termina essa sessão e muda a palavra-passe.</small></span>
      {others > 1 && <button className="prefs-link" type="button" disabled={busy} onClick={async () => { await onEndOthers(); load(); }}>
        {busy ? "A terminar..." : "Terminar todas as outras"} <Icon name="logout" size={14} />
      </button>}
    </div>
    {sessions === null && !error && <p className="device-empty">A carregar...</p>}
    {sessions && <ul className="device-list">
      {sessions.map(session => <li key={session.id} className={session.current ? "is-current" : ""}>
        <span className="device-icon"><Icon name={session.client === "app" ? "phone" : "devices"} size={20} /></span>
        <span className="device-text">
          <strong>{session.device || (session.client === "app" ? "App Tchilar" : "Browser")}</strong>
          <small>{session.client === "app" ? "App" : "Site"} · {session.current ? "Ativo agora" : seen(session.last_seen_at)}</small>
        </span>
        {session.current ? <span className="device-badge"><i aria-hidden="true" /> Este aparelho</span>
          : <button type="button" className="device-end" onClick={() => end(session)}>Terminar</button>}
      </li>)}
    </ul>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function SecuritySettings() {
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
    <DeviceSessions busy={busy === "logout"} onEndOthers={logoutEverywhere} />
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
export const SETTINGS_GROUPS = [
  { label: "Conta e segurança", items: [
    { id: "conta", icon: "mail", label: "Conta", hint: "Email, tipo de conta e os teus dados", intro: "Os dados com que entras no Tchilar e o que podes fazer com eles.", private: true },
    { id: "seguranca", icon: "shield", label: "Segurança", hint: "Palavra-passe, dois passos e sessões", intro: "Protege o acesso à tua conta, mesmo que alguém descubra a tua palavra-passe.", private: true },
    { id: "pagamentos", icon: "card", label: "Pagamentos e recibos", hint: "O que pagaste e os recibos", intro: "Tudo o que pagaste no Tchilar, com o recibo de cada pagamento.", private: true },
    { id: "privacidade", icon: "lock", label: "Privacidade", hint: "Mensagens, comentários e bloqueios", intro: "Decide quem te pode contactar e o que as marcas podem saber sobre ti.", private: true }
  ] },
  { label: "Preferências", items: [
    { id: "notificacoes", icon: "notifications", label: "Notificações", hint: "Escolhe o que te avisamos", intro: "Escolhe sobre o que queres ser avisado. Avisos de dinheiro e segurança chegam sempre.", private: true },
    { id: "aparencia", icon: "sun", label: "Aparência", hint: "Tema, tamanho do texto e vídeos", intro: "Escolhe como o Tchilar aparece e se comporta neste dispositivo." }
  ] },
  { label: "Suporte", items: [
    { id: "ajuda", icon: "help", label: "Ajuda e informação", hint: "Perguntas frequentes, termos e privacidade", intro: "Respostas rápidas e as regras que valem para todos no Tchilar." }
  ] }
];
export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap(group => group.items);
export function useMediaQuery(query) {
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
export function Settings() {
  const { section } = useParams();
  const { user } = useContext(UserContext);
  const wide = useMediaQuery("(min-width: 900px)");
  const current = SETTINGS_SECTIONS.find(item => item.id === section);
  useEffect(() => { if (current) window.scrollTo(0, 0); }, [current?.id]);
  if (section && !current) return <Navigate to="/settings" replace />;
  if (!section && wide) return <Navigate to="/settings/conta" replace />;
  const Panel = current && SETTINGS_PANELS[current.id];

  return <section className={`page prefs${current ? " has-section" : " is-root"}`}>
    <div className="prefs-nav">
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
    </div>
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
export function PrefsRow({ icon, title, children, action, tone }) {
  return <div className={`prefs-row${tone ? ` tone-${tone}` : ""}`}>
    <span className="prefs-row-icon"><Icon name={icon} /></span>
    <span className="prefs-row-text"><strong>{title}</strong>{children && <small>{children}</small>}</span>
    {action && <span className="prefs-row-action">{action}</span>}
  </div>;
}
// level: nível do título (3 dentro das Definições, onde a área já é um h2; 2 em páginas próprias).
export function PrefsCard({ title, note, children, tone, level = 3 }) {
  const Heading = `h${level}`;
  return <section className={`prefs-card${tone ? ` tone-${tone}` : ""}`}>
    {title && <header className="prefs-card-head"><Heading>{title}</Heading>{note && <p>{note}</p>}</header>}
    {children}
  </section>;
}
// Preferências guardadas na conta (servidor). Gravam logo que mudam; se falhar, volta atrás.
export function useAccountPreferences() {
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
export function PrefsToggle({ icon, title, children, checked, onChange, disabled }) {
  return <label className={`prefs-row prefs-toggle${disabled ? " is-disabled" : ""}`}>
    <span className="prefs-row-icon"><Icon name={icon} /></span>
    <span className="prefs-row-text"><strong>{title}</strong>{children && <small>{children}</small>}</span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="prefs-switch-track" aria-hidden="true"><i /></span>
  </label>;
}
// Escolha única em lista (botões de opção com aspeto de linha).
export function PrefsChoice({ name, legend, options, value, onChange }) {
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
export function PrefsStatus({ error, saved }) {
  if (error) return <p className="error prefs-status" role="alert">{error}</p>;
  return <p className={`prefs-saved prefs-status${saved ? " is-visible" : ""}`} role="status" aria-live="polite">
    {saved && <><Icon name="check" size={14} />Guardado</>}
  </p>;
}
// Telemóvel da conta: privado (só tu e a equipa o veem). Serve para entrar no Tchilar em vez do email e,
// se for angolano, preenche o Multicaixa Express nos pagamentos. Um número só pode estar numa conta.
// Depois de guardado fica só para ler; alterar ou remover pede a palavra-passe (o servidor também a exige).

function PhoneSetting() {
  const { user, refreshUser } = useContext(UserContext);
  const initial = splitPhone(user.phone);
  const [mode, setMode] = useState(user.phone ? "view" : "edit");   // view · edit · remove
  const [country, setCountry] = useState(initial.country);
  const [value, setValue] = useState(initial.national);
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ busy: false, message: "", error: "" });
  const hasPhone = Boolean(user.phone);
  const reset = () => {
    const current = splitPhone(user.phone);
    setCountry(current.country);
    setValue(current.national);
    setPassword("");
    setState({ busy: false, message: "", error: "" });
    setMode(user.phone ? "view" : "edit");
  };
  const save = async phone => {
    if (phone && !parsePhone(phone, country)) {
      setState({ busy: false, message: "", error: `${PHONE_ERROR} Exemplo: ${PHONE_COUNTRIES.find(item => item.code === country)?.example}.` });
      return;
    }
    setState({ busy: true, message: "", error: "" });
    try {
      const result = await api("/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, phoneCountry: country, ...(hasPhone ? { password } : {}) }) });
      await refreshUser();
      const saved = splitPhone(result.user?.phone);
      setCountry(saved.country);
      setValue(saved.national);
      setPassword("");
      setMode(result.user?.phone ? "view" : "edit");
      setState({ busy: false, message: phone ? "Telemóvel guardado." : "Telemóvel removido.", error: "" });
    } catch (saveError) {
      setState({ busy: false, message: "", error: saveError.message });
    }
  };
  const status = (state.message || state.error) && <p className={state.error ? "error prefs-status" : "prefs-saved prefs-status is-visible"} role="status">
    {state.message && <Icon name="check" size={14} />}{state.message || state.error}</p>;
  const passwordField = <label className="phone-password">
    Confirma com a tua palavra-passe
    <input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}
      placeholder="A tua palavra-passe" disabled={state.busy} />
  </label>;

  // ----- Guardado: só para ler -----
  if (mode === "view") return <div className="prefs-phone">
    <div className="phone-saved">
      <span className="phone-saved-icon" aria-hidden="true"><Icon name="phone" size={18} /></span>
      <span className="phone-saved-text">
        <strong>{maskPhone(user.phone)}</strong>
        <small>{user.phone_verified_at ? <span className="phone-tag is-ok"><Icon name="verified" size={12} /> Confirmado</span>
          : <span className="phone-tag is-pending"><Icon name="info" size={12} /> Por confirmar</span>} Só tu e a equipa o veem.</small>
      </span>
      <span className="phone-saved-actions">
        <button className="btn secondary" type="button" onClick={() => { setState({ busy: false, message: "", error: "" }); setMode("edit"); }}><Icon name="create" size={15} /> Alterar</button>
        <button className="text-button phone-remove" type="button" onClick={() => { setState({ busy: false, message: "", error: "" }); setMode("remove"); }}>Remover</button>
      </span>
    </div>
    {status}
    {!user.phone_verified_at && <PhoneVerification />}
  </div>;

  // ----- Remover: pede a palavra-passe -----
  if (mode === "remove") return <form className="prefs-phone" onSubmit={event => { event.preventDefault(); save(""); }}>
    <p className="phone-confirm-text">Vais remover <strong>{formatPhone(user.phone)}</strong>. Deixas de poder entrar com ele e de recuperar a conta por SMS.</p>
    {passwordField}
    <div className="prefs-actions">
      <button className="btn danger" type="submit" disabled={state.busy || !password}>{state.busy ? "A remover..." : "Remover número"}</button>
      <button className="btn secondary" type="button" disabled={state.busy} onClick={reset}>Cancelar</button>
    </div>
    {status}
  </form>;

  // ----- Adicionar ou alterar -----
  return <form className="prefs-phone" onSubmit={event => { event.preventDefault(); save(value.trim()); }}>
    <PhoneInput id="settings-phone" label={hasPhone ? "Novo número de telemóvel" : "Número de telemóvel"} country={country} onCountryChange={setCountry} disabled={state.busy}
      value={value} onChange={event => setValue(event.target.value)} invalid={Boolean(state.error)} describedBy="phone-note" />
    <p className="entry-hint" id="phone-note">Não aparece no perfil. Podes usá-lo para entrar no Tchilar em vez do email. Se for angolano, também preenche o Multicaixa Express nos pagamentos.{hasPhone ? " O número novo fica por confirmar até receberes o código por SMS." : ""}</p>
    {hasPhone && passwordField}
    <div className="prefs-actions">
      <button className="btn primary" type="submit" disabled={state.busy || !value.trim() || (hasPhone && !password)}>{state.busy ? "A guardar..." : "Guardar"}</button>
      {hasPhone && <button className="btn secondary" type="button" disabled={state.busy} onClick={reset}>Cancelar</button>}
    </div>
    {status}
  </form>;
}

// Confirmar o número com o código por SMS (Twilio). Só um número confirmado serve para entrar e recuperar a conta.
function PhoneVerification() {
  const { user, refreshUser } = useContext(UserContext);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState({ busy: false, message: "", error: "" });
  const channels = useSmsChannels();
  useEffect(() => { setSent(false); setCode(""); }, [user.phone]);
  if (user.phone_verified_at) {
    return <p className="phone-verified"><Icon name="verified" size={15} /> Número confirmado: podes usá-lo para entrar e para recuperar a conta.</p>;
  }
  const call = async (path, body, after) => {
    setState({ busy: true, message: "", error: "" });
    try {
      const result = await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await after(result);
    } catch (callError) {
      setState({ busy: false, message: "", error: callError.message });
    }
  };
  const sendCode = channel => call("/auth/phone/send-code", { channel }, result => {
    setSent(result.channel || channel);
    if (result.devCode) setCode(result.devCode);
    setState({ busy: false, message: `Enviámos um código por ${SMS_CHANNEL_LABELS[result.channel || channel] || "SMS"} para ${formatPhone(user.phone)}.`, error: "" });
  });
  const confirm = () => call("/auth/phone/verify", { code: code.trim() }, async result => {
    await refreshUser();
    setState({ busy: false, message: result.message, error: "" });
  });
  return <div className="phone-verify" role="group" aria-labelledby="phone-verify-title">
    {/* Opcional: o email continua a servir para entrar e recuperar a conta. Cada código custa dinheiro ao Tchilar. */}
    <p id="phone-verify-title"><Icon name="info" size={16} /><span><strong>Confirmar o número é opcional.</strong> Só precisas se quiseres
      entrar com o telemóvel ou recuperar a conta sem o email. O teu email continua a servir para tudo.</span></p>
    {sent && <input inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="Código recebido" aria-label="Código recebido"
      value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} />}
    <div className="prefs-actions">
      {sent
        ? <>
          <button className="btn primary" type="button" disabled={state.busy || code.length < 4} onClick={confirm}>{state.busy ? "A confirmar..." : "Confirmar número"}</button>
          <button className="btn secondary" type="button" disabled={state.busy} onClick={() => sendCode(sent)}>Enviar outro código</button>
        </>
        : channels.map((channel, index) => <button key={channel} className={`btn ${index === 0 ? "primary" : "secondary"}`} type="button" disabled={state.busy}
          onClick={() => sendCode(channel)}>{state.busy ? "A enviar..." : `Confirmar por ${SMS_CHANNEL_LABELS[channel]}`}</button>)}
    </div>
    {(state.message || state.error) && <p className={state.error ? "error prefs-status" : "prefs-saved prefs-status is-visible"} role="status">
      {state.message && <Icon name="check" size={14} />}{state.message || state.error}</p>}
  </div>;
}

export function SettingsAccount() {
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
      {memberSince && <PrefsRow icon="events" title="No Tchilar desde"><span className="prefs-value">{memberSince}</span></PrefsRow>}
      <PrefsRow icon="globe" title="Idioma e região"><span className="prefs-value">Português · Angola (Kz)</span></PrefsRow>
    </PrefsCard>
    <PrefsCard title="Telemóvel" note="Opcional e privado: só tu e a equipa o veem.">
      <PhoneSetting />
    </PrefsCard>
    <PrefsCard title="Os teus dados" note="Os teus dados são teus. Podes levá-los contigo ou apagar tudo.">
      <AccountDataControls />
    </PrefsCard>
    <PrefsCard title="Pedidos à equipa sobre os teus dados" note="Pela Lei de Proteção de Dados (Lei n.º 22/11) podes pedir uma cópia, a correção ou o apagamento dos teus dados. Respondemos em até 30 dias.">
      <DataRequests />
    </PrefsCard>
  </>;
}
export function SettingsSecurity() {
  return <PrefsCard><SecuritySettings /></PrefsCard>;
}
export const REACH_OPTIONS = {
  messages: [
    { value: "everyone", label: "Toda a gente", hint: "Qualquer pessoa no Tchilar te pode escrever.", icon: "globe" },
    { value: "following", label: "Só quem eu sigo", hint: "As outras pessoas não conseguem começar uma conversa contigo.", icon: "friends" },
    { value: "nobody", label: "Ninguém", hint: "Só recebes respostas em conversas que tu começaste.", icon: "lock" }
  ],
  comments: [
    { value: "everyone", label: "Toda a gente", hint: "Quem vê a publicação pode comentar.", icon: "globe" },
    { value: "following", label: "Só quem eu sigo", hint: "Os outros veem a publicação mas não comentam.", icon: "friends" },
    { value: "nobody", label: "Ninguém", hint: "Os comentários ficam fechados em todas as tuas publicações.", icon: "lock" }
  ]
};
export function SettingsPrivacy() {
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
    <PrefsCard title="Estado de atividade" note="Só os teus amigos veem se estás online, e só enquanto esta opção estiver ligada.">
      {preferences
        ? <PrefsToggle icon="eye" title="Mostrar quando estou ativo" checked={preferences.showActivity !== false} onChange={value => save({ showActivity: value })}>
          Aparece um ponto verde no teu nome quando usaste o Tchilar nos últimos minutos.
        </PrefsToggle>
        : <p className="prefs-loading">A carregar...</p>}
    </PrefsCard>
    <PrefsCard><BlockedAccounts /></PrefsCard>
    <PrefsCard title="Província e idade" note="Só servem para te mostrar promoções da tua zona e idade. Não aparecem no teu perfil.">
      <AudienceSettings />
    </PrefsCard>
    <PrefsCard title="O que é público" note="O teu perfil, as publicações e os Stories são visíveis para quem está no Tchilar. Os Stories desaparecem ao fim de 24 horas.">
      <PrefsRow icon="block" title="Bloquear alguém">Abre o perfil da pessoa e escolhe Bloquear. Deixa de te ver e de te poder contactar.</PrefsRow>
      <PrefsRow icon="report" title="Denunciar conteúdo">Em qualquer publicação, comentário ou perfil, no menu de opções.</PrefsRow>
    </PrefsCard>
  </>;
}
export const NOTIFY_OPTIONS = [
  { key: "interactions", icon: "heart", title: "Gostos, comentários e partilhas", hint: "Quando alguém reage ao que publicas." },
  { key: "people", icon: "friends", title: "Seguidores e amizades", hint: "Novos seguidores, pedidos de amizade e pedidos aceites." },
  { key: "messages", icon: "messages", title: "Mensagens", hint: "Um aviso por cada mensagem nova. O número no ícone de mensagens aparece sempre." },
  { key: "lives", icon: "live", title: "Diretos", hint: "Quando alguém que segues começa um direto." },
  { key: "community", icon: "groups", title: "Grupos, páginas e eventos", hint: "Quando alguém entra no teu grupo, segue a tua página ou vai ao teu evento." }
];
// Avisos no browser (web push): ligar ou desligar neste browser. Cada browser escolhe por si.
const BROWSER_PUSH_HINTS = {
  unsupported: "Este browser não recebe notificações. No iPhone, junta o Tchilar ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abre-o a partir daí.",
  off: "Os avisos no browser ainda não estão disponíveis.",
  blocked: "Bloqueaste as notificações do Tchilar neste browser. Para as ligar, carrega no cadeado ao lado do endereço e autoriza as notificações.",
  disabled: "Recebe os avisos mesmo com o Tchilar fechado, neste computador ou telemóvel.",
  enabled: "Ligado neste browser. Os avisos seguem as escolhas de cima."
};
function BrowserPushToggle() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { webPushStatus().then(setStatus).catch(() => setStatus("unsupported")); }, []);
  const change = async on => {
    setBusy(true); setError("");
    try { setStatus(on ? await enableWebPush() : await disableWebPush()); }
    catch (failure) { setError(failure.message); setStatus(await webPushStatus().catch(() => "unsupported")); }
    finally { setBusy(false); }
  };
  if (!status) return <p className="prefs-loading">A carregar...</p>;
  return <>
    <PrefsToggle icon="notifications" title="Avisos no browser" checked={status === "enabled"} disabled={busy || !["enabled", "disabled"].includes(status)} onChange={change}>
      {BROWSER_PUSH_HINTS[status]}
    </PrefsToggle>
    {error && <p className="error prefs-status" role="alert">{error}</p>}
  </>;
}
export function SettingsNotifications() {
  const { preferences, save, error, saved } = useAccountPreferences();
  const allOn = preferences && NOTIFY_OPTIONS.every(option => preferences.notify[option.key]);
  return <>
    <PrefsStatus error={error} saved={saved} />
    <PrefsCard title="Com o Tchilar fechado" note="Na app, os avisos ligam-se no próprio telemóvel. Aqui escolhes para este browser.">
      <BrowserPushToggle />
    </PrefsCard>
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
export const THEME_OPTIONS = [
  { value: "light", label: "Claro", hint: "Fundo branco", icon: "sun" },
  { value: "dark", label: "Escuro", hint: "Fundo preto, menos brilho", icon: "moon" },
  { value: "system", label: "Automático", hint: "Segue o teu dispositivo", icon: "devices" }
];
export const TEXT_SIZES = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Grande" },
  { value: "larger", label: "Maior" }
];
export function SettingsAppearance() {
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
    <PrefsCard title="Tamanho do texto" note="Aumenta o texto e os botões em todo o Tchilar, neste dispositivo.">
      <div className="prefs-segment" role="radiogroup" aria-label="Tamanho do texto">
        {TEXT_SIZES.map((size, index) => <label key={size.value} className={device.textSize === size.value ? "is-selected" : ""}>
          <input type="radio" name="text-size" value={size.value} checked={device.textSize === size.value} onChange={() => change({ textSize: size.value })} />
          <span className="prefs-segment-sample" style={{ fontSize: `${15 + index * 3}px` }} aria-hidden="true">Aa</span>
          {size.label}
        </label>)}
      </div>
      <p className="prefs-sample">Assim fica uma publicação: «Hoje o pôr do sol na Ilha estava incrível.»</p>
    </PrefsCard>
    <PrefsCard title="Poupar dados" note="Para quem usa dados móveis. Fica guardado neste dispositivo.">
      <PrefsToggle icon="bolt" title="Poupar dados" checked={device.dataSaver} onChange={value => change({ dataSaver: value })}>
        Fotos mais leves no feed (a original abre quando tocas nela) e vídeos só quando carregas no play. Gasta muito menos saldo.
      </PrefsToggle>
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
export function SettingsHelp() {
  const links = [
    ["/help", "help", "Centro de ajuda", "Perguntas frequentes sobre a conta, pagamentos e criadores."],
    ["/about", "info", "Sobre o Tchilar", "O que é o Tchilar e como cuidamos da comunidade."],
    ["/terms", "pages", "Termos", "As regras que todos aceitamos ao usar o Tchilar."],
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
export const SETTINGS_PANELS = {
  conta: SettingsAccount,
  seguranca: SettingsSecurity,
  pagamentos: SettingsPayments,
  privacidade: SettingsPrivacy,
  notificacoes: SettingsNotifications,
  aparencia: SettingsAppearance,
  ajuda: SettingsHelp
};
// Editar o perfil público: capa e foto com pré-visualização, e os campos que aparecem no perfil.
export function EditProfile() {
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
      <PrefsCard title="Sobre ti" level={2}>
        <label className="field">Nome público<input autoComplete="name" maxLength={100} required value={form.displayName} onChange={set("displayName")} /></label>
        <label className="field">Biografia <small className="field-count">{form.bio.length}/500</small>
          <textarea maxLength={500} rows={4} value={form.bio} onChange={set("bio")} placeholder="Conta em poucas palavras quem és e o que partilhas." /></label>
        <div className="field-pair">
          <label className="field">Profissão<input maxLength={100} autoComplete="organization-title" value={form.profession} onChange={set("profession")} placeholder="Ex.: fotógrafa, estudante" /></label>
          <label className="field">Localidade<input maxLength={100} autoComplete="address-level2" value={form.location} onChange={set("location")} placeholder="Ex.: Luanda" /></label>
        </div>
        <label className="field">Site ou link<input maxLength={200} type="text" inputMode="url" autoComplete="url" value={form.website} onChange={set("website")} placeholder="Ex.: instagram.com/o_teu_nome" /></label>
      </PrefsCard>
      {user.is_creator && <PrefsCard title="Subscrição" level={2} note="O valor mensal que os teus subscritores pagam pelo conteúdo exclusivo.">
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
