// Administração: pagamentos por resolver, moderação sem denúncia, avisos gerais, pedidos sobre dados
// pessoais e funções na equipa.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API, Icon, api, formatPrice, token } from "./core.jsx";
import { relativeTime } from "./feed.jsx";

const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const dateTime = value => new Date(value).toLocaleString("pt-PT", { timeZone: "Africa/Luanda", dateStyle: "medium", timeStyle: "short" });

// Quem pode ver cada área. "super" vê tudo.
export const ROLE_LABELS = { super: "Administração total", finance: "Finanças", moderation: "Moderação" };
export const canSee = (role, ...allowed) => role === "super" || allowed.includes(role);

// Descarrega um ficheiro de uma rota com sessão (um <a href> não levaria o token).
export async function downloadWithSession(path, filename) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível descarregar.");
  const url = URL.createObjectURL(await response.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------------------------
// Pagamentos por resolver (Express e Referência que não chegaram ao fim)
// ---------------------------------------------------------------------------------------------
const ATTEMPT_TABS = [["pending", "À espera"], ["expired", "Expirados"], ["failed", "Falhados"]];
const METHOD_LABELS = { express: "Multicaixa Express", reference: "Referência" };

export function PaymentAttempts() {
  const [status, setStatus] = useState("expired");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(0);
  const load = () => api(`/admin/payment-attempts?status=${status}`).then(result => setData(result.attempts)).catch(loadError => setError(loadError.message));
  useEffect(() => { setData(null); setError(""); load(); }, [status]);

  const check = async attempt => {
    setBusy(attempt.id); setError(""); setNotice("");
    try {
      const result = await post(`/admin/payment-attempts/${attempt.id}/check`);
      setNotice(result.status === "paid" ? `O fornecedor confirmou o pagamento #${attempt.id}. O produto foi entregue.` : `O fornecedor ainda diz: ${result.status}.`);
      await load();
    } catch (checkError) { setError(checkError.message); } finally { setBusy(0); }
  };
  const confirm = async attempt => {
    const note = window.prompt(`Confirmar à mão ${formatPrice(attempt.amount)} de @${attempt.username}?\nIndica a prova (ex.: nº do comprovativo do banco):`);
    if (!note) return;
    setBusy(attempt.id); setError(""); setNotice("");
    try {
      await post(`/admin/payment-attempts/${attempt.id}/confirm`, { note });
      setNotice(`Pagamento #${attempt.id} confirmado e produto entregue. A pessoa foi avisada.`);
      await load();
    } catch (confirmError) { setError(confirmError.message); } finally { setBusy(0); }
  };

  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Pagamentos por resolver</h2>
      <p>Pedidos de Express e Referência que não foram confirmados. É aqui que se resolvem os casos de «paguei e não recebi».</p></div></div>
    <div className="admin-chips" role="group" aria-label="Estado">
      {ATTEMPT_TABS.map(([key, label]) => <button key={key} type="button" className="province-chip" aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {!data && !error && <div className="creator-loading">A carregar...</div>}
    {data && !data.length && <p className="muted">Nada por resolver.</p>}
    {data?.length > 0 && <ul className="admin-items">{data.map(attempt => <li className="admin-item" key={attempt.id}>
      <span className={`admin-item-icon is-${attempt.method}`}><Icon name={attempt.method === "express" ? "phone" : "reference"} size={20} /></span>
      <div className="admin-item-main">
        <div className="admin-item-title"><strong>{attempt.purpose_label}</strong><span className="muted">· {METHOD_LABELS[attempt.method]} · pedido #{attempt.id}</span></div>
        <div className="admin-item-person">{attempt.username
          ? <Link to={`/admin/utilizadores/${attempt.user_id}`}>{attempt.display_name} <span className="muted">@{attempt.username}</span></Link>
          : <span className="muted">Conta apagada</span>}</div>
        <dl className="admin-item-facts">
          {attempt.method === "reference" && attempt.provider_ref && <><div><dt>Entidade</dt><dd>{attempt.entity}</dd></div><div><dt>Referência</dt><dd>{attempt.provider_ref}</dd></div></>}
          {attempt.method === "express" && attempt.phone_last3 && <div><dt>Telemóvel</dt><dd>••• ••• {attempt.phone_last3}</dd></div>}
          <div><dt>Pedido</dt><dd>{dateTime(attempt.created_at)}</dd></div>
          {attempt.expires_at && <div><dt>{new Date(attempt.expires_at) < new Date() ? "Expirou" : "Válido até"}</dt><dd>{dateTime(attempt.expires_at)}</dd></div>}
        </dl>
      </div>
      <div className="admin-item-side">
        <strong className="admin-item-amount">{formatPrice(attempt.amount)}</strong>
        {attempt.product_paid
          ? <span className="payment-status">Já pago por outra via</span>
          : <div className="admin-item-actions">
            <button className="btn secondary" type="button" disabled={busy === attempt.id} onClick={() => check(attempt)}>Verificar</button>
            <button className="btn" type="button" disabled={busy === attempt.id} onClick={() => confirm(attempt)}>Confirmar à mão</button>
          </div>}
      </div>
    </li>)}</ul>}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Moderação sem denúncia
// ---------------------------------------------------------------------------------------------
const CONTENT_TABS = [["post", "Publicações"], ["comment", "Comentários"], ["group", "Grupos"], ["page", "Páginas"]];

export function AdminContent() {
  const [type, setType] = useState("post");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/content?${new URLSearchParams({ type, q: query, hidden: onlyHidden ? "1" : "0" })}`)
    .then(result => setItems(result.items)).catch(loadError => setError(loadError.message));
  useEffect(() => { setItems(null); setError(""); load(); }, [type, query, onlyHidden]);

  const act = async (item, action) => {
    const what = { post: "esta publicação", comment: "este comentário", group: "este grupo", page: "esta página" }[type];
    let reason = "";
    if (action !== "restore") {
      reason = window.prompt(`Motivo para ${action === "delete" ? "apagar" : "esconder"} ${what} (o dono vai ver):`);
      if (!reason) return;
    }
    setError(""); setNotice("");
    try {
      await post(`/admin/content/${type}/${item.id}/${action}`, { reason });
      setNotice({ hide: "Escondido. O dono foi avisado.", restore: "Voltou a estar visível.", delete: "Apagado. O dono foi avisado." }[action]);
      await load();
    } catch (actError) { setError(actError.message); }
  };

  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Moderação</h2><p>Procura e esconde conteúdo sem esperar por uma denúncia. Tudo fica no registo.</p></div>
      <Link className="prefs-link" to="/moderation">Denúncias <Icon name="next" size={14} /></Link></div>
    <div className="admin-chips" role="group" aria-label="Tipo de conteúdo">
      {CONTENT_TABS.map(([key, label]) => <button key={key} type="button" className="province-chip" aria-pressed={type === key} onClick={() => setType(key)}>{label}</button>)}
    </div>
    <form className="payment-filters" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}>
      <label className="payment-search"><Icon name="search" size={16} /><span className="visually-hidden">Pesquisar</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Texto ou @autor" /></label>
      {type !== "comment" && <label className="admin-check"><input type="checkbox" checked={onlyHidden} onChange={event => setOnlyHidden(event.target.checked)} />Só escondidos</label>}
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {!items && !error && <div className="creator-loading">A carregar...</div>}
    {items && !items.length && <p className="muted">Nada encontrado.</p>}
    {items?.length > 0 && <ul className="admin-content-list">{items.map(item => <li key={item.id} className={item.hidden_at ? "is-hidden" : ""}>
      <div className="admin-content-main">
        {item.title && <strong>{item.title}</strong>}
        <p>{item.text || (item.media_url ? `[${item.media_type === "video" ? "vídeo" : "imagem"}]` : "—")}</p>
        <small className="muted">
          <Link to={`/admin/utilizadores/${item.owner_id}`}>@{item.username}</Link> · {relativeTime(item.created_at)}
          {item.members !== undefined && ` · ${item.members} membros`}{item.followers !== undefined && ` · ${item.followers} seguidores`}
          {item.is_secret && " · secreto"}{item.open_reports > 0 && ` · ${item.open_reports} denúncias abertas`}
          {item.hidden_at && ` · escondido ${relativeTime(item.hidden_at)}`}
        </small>
      </div>
      <div className="admin-row-actions">
        {type === "comment"
          ? <button className="prefs-link danger-text" type="button" onClick={() => act(item, "delete")}>Apagar</button>
          : item.hidden_at
            ? <button className="prefs-link" type="button" onClick={() => act(item, "restore")}>Voltar a mostrar</button>
            : <button className="prefs-link danger-text" type="button" onClick={() => act(item, "hide")}>Esconder</button>}
      </div>
    </li>)}</ul>}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Avisos gerais
// ---------------------------------------------------------------------------------------------
const CHANNEL_LABELS = { notification: "Notificação na app", email: "Email", both: "Notificação e email" };

export function AdminBroadcasts() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ title: "", body: "", audience: "all", channel: "notification" });
  const [reach, setReach] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api("/admin/broadcasts").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setReach(null);
    api(`/admin/broadcasts/audience?audience=${encodeURIComponent(form.audience)}`).then(setReach).catch(() => {});
  }, [form.audience]);

  const send = async event => {
    event.preventDefault();
    const people = form.channel === "email" ? reach?.emails : reach?.people;
    if (!window.confirm(`Enviar «${form.title}» a ${people ?? "?"} pessoas (${CHANNEL_LABELS[form.channel].toLowerCase()})? Não dá para desfazer.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post("/admin/broadcasts", form);
      setNotice(`Aviso enviado a ${result.recipients} pessoas.${form.channel !== "notification" ? " Os emails seguem aos poucos, em segundo plano." : ""}`);
      setForm({ ...form, title: "", body: "" });
      await load();
    } catch (sendError) { setError(sendError.message); } finally { setBusy(false); }
  };

  return <>
    <section className="creator-card">
      <div className="creator-card-head"><div><h2>Novo aviso</h2><p>Para manutenção, novidades ou regras novas. Chega a toda a gente, mesmo a quem desligou outras notificações.</p></div></div>
      {data && <form className="prefs-form admin-broadcast-form" onSubmit={send}>
        <label>Título<input required maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Manutenção amanhã" /></label>
        <label>Mensagem<textarea required rows={4} maxLength={1000} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} placeholder="Amanhã às 2h o Tchilar fica parado cerca de 10 minutos." /></label>
        <div className="admin-broadcast-row">
          <label>Para quem
            <select value={form.audience} onChange={event => setForm({ ...form, audience: event.target.value })}>
              <option value="all">Todas as pessoas</option>
              <option value="creators">Criadores</option>
              <option value="inactive">Sem entrar há 30 dias</option>
              <optgroup label="Por província">{data.provinces.map(province => <option key={province} value={`province:${province}`}>{province}</option>)}</optgroup>
            </select>
          </label>
          <label>Como
            <select value={form.channel} onChange={event => setForm({ ...form, channel: event.target.value })}>
              {Object.entries(CHANNEL_LABELS).map(([key, label]) => <option key={key} value={key} disabled={key !== "notification" && !data.emailEnabled}>{label}{key !== "notification" && !data.emailEnabled ? " (sem SMTP)" : ""}</option>)}
            </select>
          </label>
        </div>
        <p className="muted">{reach ? `${reach.people} pessoas · ${reach.emails} com email confirmado` : "A contar..."}</p>
        <div className="prefs-form-foot"><button className="btn" type="submit" disabled={busy}>{busy ? "A enviar..." : "Enviar aviso"}</button></div>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    </section>
    <section className="creator-card">
      <h2>Avisos enviados</h2>
      {data && !data.broadcasts.length && <p className="muted">Ainda não enviaste avisos.</p>}
      {data?.broadcasts.length > 0 && <ul className="admin-mini-list">{data.broadcasts.map(item => <li key={item.id}>
        <span className="muted">#{item.id}</span>
        <span><strong>{item.title}</strong><small>{item.body}</small>
          <small>{item.audience} · {CHANNEL_LABELS[item.channel]} · por @{item.admin_username || "equipa"} · {dateTime(item.created_at)}</small></span>
        <span>{item.recipients} pessoas{item.channel !== "notification" && <small>{item.emails_sent} emails enviados</small>}</span>
        <span />
      </li>)}</ul>}
    </section>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Pedidos sobre dados pessoais
// ---------------------------------------------------------------------------------------------
export function AdminDataRequests() {
  const [status, setStatus] = useState("open");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/data-requests?status=${status}`).then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { setData(null); setError(""); load(); }, [status]);
  const run = async (task, success) => {
    setError(""); setNotice("");
    try { await task(); setNotice(success); await load(); } catch (taskError) { setError(taskError.message); }
  };
  const close = (request, outcome) => {
    const answer = window.prompt(outcome === "done" ? "Resposta para a pessoa (o que foi feito):" : "Motivo da recusa (a pessoa vai ver):");
    if (answer) run(() => post(`/admin/data-requests/${request.id}/close`, { status: outcome, answer }), "Pedido fechado. A pessoa foi avisada.");
  };
  const exportData = request => run(() => downloadWithSession(`/admin/data-requests/${request.id}/export`, `tchilar-dados-${request.username}.json`),
    "Ficheiro descarregado. Envia-o à pessoa por um canal seguro e depois marca o pedido como tratado.");
  const removeAccount = request => {
    const confirm = window.prompt(`Isto apaga a conta @${request.username} e todos os dados. Não pode ser desfeito.\nEscreve ${request.username} para confirmar:`);
    if (confirm) run(() => post(`/admin/data-requests/${request.id}/delete-account`, { confirm }), `Conta @${request.username} apagada.`);
  };

  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Pedidos sobre dados pessoais</h2>
      <p>Lei n.º 22/11: responde em até 30 dias. Os pedidos com mais de 20 dias ficam assinalados.</p></div></div>
    <div className="admin-chips" role="group" aria-label="Estado">
      {[["open", "Abertos"], ["done", "Tratados"], ["rejected", "Recusados"]].map(([key, label]) =>
        <button key={key} type="button" className="province-chip" aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {!data && !error && <div className="creator-loading">A carregar...</div>}
    {data && !data.requests.length && <p className="muted">Nenhum pedido.</p>}
    {data?.requests.length > 0 && <ul className="admin-content-list">{data.requests.map(request => <li key={request.id} className={request.overdue && status === "open" ? "is-overdue" : ""}>
      <div className="admin-content-main">
        <strong>{data.kinds[request.kind]}{request.overdue && status === "open" ? " · prazo a acabar" : ""}</strong>
        {request.details && <p>{request.details}</p>}
        <small className="muted">{request.user_id ? <Link to={`/admin/utilizadores/${request.user_id}`}>@{request.username}</Link> : `@${request.username} (conta apagada)`} · {request.email} · {dateTime(request.created_at)}
          {request.answer && ` · Resposta: ${request.answer}`}{request.handled_by_username && ` · por @${request.handled_by_username}`}</small>
      </div>
      {status === "open" && <div className="admin-row-actions">
        {request.kind === "export" && request.user_id && <button className="prefs-link" type="button" onClick={() => exportData(request)}>Descarregar dados</button>}
        {request.kind === "delete" && request.user_id && <button className="prefs-link danger-text" type="button" onClick={() => removeAccount(request)}>Apagar conta</button>}
        <button className="prefs-link" type="button" onClick={() => close(request, "done")}>Marcar tratado</button>
        <button className="prefs-link" type="button" onClick={() => close(request, "rejected")}>Recusar</button>
      </div>}
    </li>)}</ul>}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Função na equipa (na ficha da pessoa; só para administração total)
// ---------------------------------------------------------------------------------------------
export function TeamRole({ user, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async event => {
    const role = event.target.value || null;
    const text = role ? `Dar a @${user.username} a função «${ROLE_LABELS[role]}»?` : `Retirar @${user.username} da equipa? As sessões abertas terminam.`;
    if (!window.confirm(text)) { event.target.value = user.is_admin ? user.admin_role || "super" : ""; return; }
    setBusy(true); setError("");
    try { await post(`/admin/users/${user.id}/role`, { role }); await onChange(); } catch (changeError) { setError(changeError.message); } finally { setBusy(false); }
  };
  return <div className="admin-role">
    <label>Função na equipa
      <select value={user.is_admin ? user.admin_role || "super" : ""} disabled={busy} onChange={change}>
        <option value="">Sem acesso</option>
        {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <small className="muted">Para entrar no painel, a pessoa precisa de ter a verificação em dois passos ativa.</small>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
