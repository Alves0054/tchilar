// Administração: Painel (números e o que está por fazer), Utilizadores (lista e ficha) e Registo de ações.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar, Icon, api, formatPrice } from "./core.jsx";
import { relativeTime } from "./feed.jsx";
import { PaymentStatus } from "./payments.jsx";
import { ROLE_LABELS, TeamRole } from "./admin-ops.jsx";
import { Select } from "./select.jsx";

const dateTime = value => new Date(value).toLocaleString("pt-PT", { timeZone: "Africa/Luanda", dateStyle: "medium", timeStyle: "short" });
const shortDay = day => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "numeric", month: "short", timeZone: "UTC" });
const number = value => Number(value || 0).toLocaleString("pt-PT");
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

// Variação face aos 30 dias anteriores: "+12%" / "−5%"; sem base não se compara.
function change(current, previous) {
  if (!previous) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  return { percent, text: `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent)}%` };
}

// Barras por dia (uma série, um eixo). Ao passar o rato ou tocar, mostra o dia e o valor.
function DailyBars({ title, rows, field, format }) {
  const [active, setActive] = useState(null);
  const max = Math.max(...rows.map(row => row[field]), 0);
  const total = rows.reduce((sum, row) => sum + row[field], 0);
  const shown = active === null ? null : rows[active];
  const width = 600;
  const height = 140;
  const gap = 2;
  const bar = (width - gap * (rows.length - 1)) / rows.length;
  return <figure className="admin-chart">
    <figcaption>
      <span>{title}</span>
      <strong>{shown ? `${shortDay(shown.day)}: ${format(shown[field])}` : `${format(total)} em 30 dias`}</strong>
    </figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, últimos 30 dias`} preserveAspectRatio="none"
      onMouseLeave={() => setActive(null)}>
      <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="admin-chart-base" />
      {rows.map((row, index) => {
        const h = max ? Math.max(row[field] > 0 ? 3 : 0, (row[field] / max) * (height - 8)) : 0;
        const x = index * (bar + gap);
        return <g key={row.day} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}>
          <rect className="admin-chart-hit" x={x} y="0" width={bar + gap} height={height} />
          {h > 0 && <rect className={`admin-chart-bar${active === index ? " is-active" : ""}`} x={x} y={height - h} width={bar} height={h} rx={Math.min(4, bar / 2)} />}
        </g>;
      })}
    </svg>
    <div className="admin-chart-axis"><span>{shortDay(rows[0].day)}</span><span>Hoje</span></div>
    <details className="admin-chart-table"><summary>Ver em tabela</summary>
      <table><thead><tr><th>Dia</th><th>{title}</th></tr></thead>
        <tbody>{rows.filter(row => row[field] > 0).map(row => <tr key={row.day}><td>{shortDay(row.day)}</td><td>{format(row[field])}</td></tr>)}</tbody></table>
    </details>
  </figure>;
}

function Kpi({ label, value, hint, tone }) {
  return <div className={`stat-box admin-kpi${tone ? ` is-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

// Uma linha do registo: quem, o quê, sobre quem/o quê, quando.
function ActionLine({ item }) {
  return <li className="admin-action">
    <span className="admin-action-who">{item.admin ? `@${item.admin.username}` : "Equipa"}</span>
    <span className="admin-action-what">{item.label}
      {item.target_user ? <> de <Link to={`/admin/utilizadores/${item.target_user.id}`}>@{item.target_user.username}</Link></>
        : item.target_type !== "user" ? <span className="muted"> #{item.target_id}</span> : null}
      {item.note && <small>«{item.note}»</small>}</span>
    <time className="muted" dateTime={item.created_at} title={dateTime(item.created_at)}>{relativeTime(item.created_at)}</time>
  </li>;
}

// ---------------------------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------------------------
export function AdminOverview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api("/admin/overview"), api("/admin/operations/summary")])
      .then(([overview, summary]) => setData({ ...overview, todo: { ...overview.todo, ...summary } }))
      .catch(loadError => setError(loadError.message));
  }, []);
  if (error) return <section className="creator-card"><p className="error" role="alert">{error}</p></section>;
  if (!data) return <section className="creator-card"><div className="creator-loading">A carregar o painel...</div></section>;
  const { people, money, todo } = data;
  const trend = change(money.last_30d, money.previous_30d);
  const tasks = [
    todo.promotions_in_review > 0 && { to: "/admin/promocoes", icon: "ad", text: `${todo.promotions_in_review} ${todo.promotions_in_review === 1 ? "promoção" : "promoções"} em revisão` },
    todo.business_pending > 0 && { to: "/admin/negocios", icon: "shield", text: `${todo.business_pending} ${todo.business_pending === 1 ? "negócio" : "negócios"} por verificar` },
    todo.payouts_requested > 0 && { to: "/admin/levantamentos", icon: "card", text: `${todo.payouts_requested} ${todo.payouts_requested === 1 ? "levantamento" : "levantamentos"} por pagar · ${formatPrice(todo.payouts_amount)}` },
    todo.refunds_due > 0 && { to: "/admin/pagamentos?status=refund_due", icon: "previous", text: `${todo.refunds_due} ${todo.refunds_due === 1 ? "reembolso" : "reembolsos"} por fazer · ${formatPrice(todo.refunds_amount)}` },
    todo.open_reports > 0 && { to: "/moderation", icon: "flag", text: `${todo.open_reports} ${todo.open_reports === 1 ? "denúncia aberta" : "denúncias abertas"}` },
    todo.data_requests_open > 0 && { to: "/admin/dados", icon: "lock", text: `${todo.data_requests_open} ${todo.data_requests_open === 1 ? "pedido" : "pedidos"} sobre dados pessoais${todo.data_requests_overdue ? ` (${todo.data_requests_overdue} perto do prazo)` : ""}` },
    todo.attempts_unresolved > 0 && { to: "/admin/por-resolver", icon: "card", text: `${todo.attempts_unresolved} ${todo.attempts_unresolved === 1 ? "pagamento expirou ou falhou" : "pagamentos expiraram ou falharam"} sem o produto ser pago` },
    todo.payments_waiting > 0 && { to: "/admin/por-resolver", icon: "card", text: `${todo.payments_waiting} ${todo.payments_waiting === 1 ? "pagamento à espera" : "pagamentos à espera"} de confirmação` }
  ].filter(Boolean);

  return <>
    <section className="creator-card">
      <div className="creator-card-head"><div><h2>Por fazer</h2><p>O que está à espera da equipa.</p></div></div>
      {tasks.length ? <ul className="admin-tasks">{tasks.map(task => <li key={task.to}><Link to={task.to}>
        <span className="admin-task-icon"><Icon name={task.icon} size={18} /></span>{task.text}<Icon name="next" size={16} /></Link></li>)}</ul>
        : <p className="admin-all-done"><Icon name="check" size={18} />Está tudo em dia.</p>}
    </section>

    <section className="creator-card">
      <h2>Dinheiro</h2>
      <div className="stat-grid admin-kpis">
        <Kpi label="Hoje" value={formatPrice(money.today)} />
        <Kpi label="Últimos 30 dias" value={formatPrice(money.last_30d)} hint={trend ? `${trend.text} face aos 30 dias anteriores` : `${number(money.count_30d)} pagamentos`} />
        <Kpi label="Pagamentos (30 dias)" value={number(money.count_30d)} />
      </div>
      <DailyBars title="Recebido por dia" rows={data.daily} field="revenue" format={formatPrice} />
    </section>

    <section className="creator-card">
      <h2>Pessoas</h2>
      <div className="stat-grid admin-kpis">
        <Kpi label="Contas" value={number(people.total)} hint={`+${number(people.new_7d)} esta semana`} />
        <Kpi label="Online agora" value={number(people.online)} />
        <Kpi label="Ativas hoje" value={number(people.active_1d)} hint={`${number(people.active_7d)} nos últimos 7 dias`} />
        <Kpi label="Criadores" value={number(people.creators)} />
        <Kpi label="Email por confirmar" value={number(people.unverified)} />
        <Kpi label="Suspensas" value={number(people.suspended)} tone={people.suspended ? "warning" : ""} />
      </div>
      <DailyBars title="Contas novas por dia" rows={data.daily} field="signups" format={value => number(value)} />
    </section>

    <section className="creator-card">
      <div className="creator-card-head"><div><h2>Últimas ações da equipa</h2></div><Link className="prefs-link" to="/admin/registo">Ver registo <Icon name="next" size={14} /></Link></div>
      {data.recent.length ? <ul className="admin-actions">{data.recent.map(item => <ActionLine key={item.id} item={item} />)}</ul>
        : <p className="muted">Ainda não há ações registadas.</p>}
    </section>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Utilizadores
// ---------------------------------------------------------------------------------------------
const USER_FILTERS = [["all", "Todas"], ["online", "Online"], ["creators", "Criadores"], ["unverified", "Email por confirmar"], ["suspended", "Suspensas"], ["admins", "Equipa"]];

function UserBadges({ user }) {
  return <span className="admin-badges">
    {user.is_admin && <span className="admin-badge is-team">Equipa</span>}
    {user.suspended_at && <span className="admin-badge is-danger">Suspensa</span>}
    {!user.email_verified && <span className="admin-badge">Email por confirmar</span>}
    {user.is_creator && <span className="admin-badge is-info">Criador</span>}
    {user.is_partner && <span className="admin-badge is-info">Parceiro</span>}
    {user.open_reports > 0 && <span className="admin-badge is-warning">{user.open_reports} {user.open_reports === 1 ? "denúncia" : "denúncias"}</span>}
  </span>;
}

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const filter = params.get("filter") || "all";
  const query = new URLSearchParams(["filter", "q", "page"].flatMap(key => params.get(key) ? [[key, params.get(key)]] : [])).toString();
  useEffect(() => {
    let active = true;
    api(`/admin/users${query ? `?${query}` : ""}`).then(result => { if (active) setData(result); }).catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [query]);
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Utilizadores</h2><p>{data ? `${number(data.total)} ${data.total === 1 ? "conta" : "contas"}` : "Procura uma pessoa para ver a ficha completa."}</p></div></div>
    <form className="payment-filters" onSubmit={event => { event.preventDefault(); setParam("q", search.trim()); }}>
      <label className="payment-search"><Icon name="search" size={16} /><span className="visually-hidden">Pesquisar</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome, @utilizador ou email" /></label>
    </form>
    <div className="admin-chips" role="group" aria-label="Filtrar contas">
      {USER_FILTERS.map(([key, label]) => <button key={key} type="button" className="province-chip" aria-pressed={filter === key} onClick={() => setParam("filter", key)}>{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="creator-loading">A carregar...</div>}
    {data && !data.users.length && <p className="muted">Nenhuma conta encontrada.</p>}
    {data?.users.length > 0 && <ul className="admin-user-list">{data.users.map(user => <li key={user.id}>
      <Link to={`/admin/utilizadores/${user.id}`} className="admin-user-row">
        <Avatar user={user} />
        <span className="admin-user-main"><strong>{user.display_name} <span className="muted">@{user.username}</span></strong>
          <small>{user.email}</small><UserBadges user={user} /></span>
        <span className="admin-user-side muted"><small>Entrou {relativeTime(user.created_at)}</small>
          <small>{user.last_seen_at ? `Visto ${relativeTime(user.last_seen_at)}` : "Nunca visto"}</small></span>
      </Link>
    </li>)}</ul>}
    {data?.pages > 1 && <nav className="payment-pages" aria-label="Páginas">
      <button className="btn secondary" type="button" disabled={data.page <= 1} onClick={() => setParam("page", String(data.page - 1))}>Anterior</button>
      <span>Página {data.page} de {data.pages}</span>
      <button className="btn secondary" type="button" disabled={data.page >= data.pages} onClick={() => setParam("page", String(data.page + 1))}>Seguinte</button>
    </nav>}
  </section>;
}

const PAYOUT_STATUS = { requested: "Por pagar", paid: "Pago", rejected: "Recusado" };
const REPORT_STATUS = { open: "Aberta", resolved: "Resolvida", dismissed: "Arquivada" };

export function AdminUserDetail({ userId, canManageTeam = false, canModerate = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/users/${userId}`).then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { setData(null); setError(""); load(); }, [userId]);

  const act = async (kind, ask) => {
    let body = {};
    if (ask) {
      const value = window.prompt(ask);
      if (value === null) return;
      body = kind === "suspend" ? { reason: value } : { note: value };
    }
    setBusy(kind); setError(""); setNotice("");
    try {
      await post(`/admin/users/${userId}/${kind}`, body);
      setNotice({ suspend: "Conta suspensa. As sessões abertas foram terminadas.", unsuspend: "Conta reativada.", "verify-email": "Email confirmado." }[kind]);
      await load();
    } catch (actError) {
      setError(actError.message);
    } finally {
      setBusy("");
    }
  };

  if (!data) return <section className="creator-card">{error ? <p className="error" role="alert">{error}</p> : <div className="creator-loading">A carregar a ficha...</div>}</section>;
  const { user } = data;
  return <>
    <Link className="prefs-back admin-back" to="/admin/utilizadores"><Icon name="previous" size={18} />Utilizadores</Link>
    <section className="creator-card admin-user-card">
      <div className="admin-user-head">
        <Avatar user={user} size="large" />
        <div className="admin-user-title">
          <h2>{user.display_name}</h2>
          <p><Link to={`/u/${user.username}`}>@{user.username}</Link> · {user.email}</p>
          <UserBadges user={{ ...user, is_partner: !!user.partner_since, open_reports: user.reports_open }} />
        </div>
        {canModerate && <div className="admin-user-actions">
          {!user.email_verified && <button className="btn secondary" type="button" disabled={!!busy} onClick={() => act("verify-email")}>Confirmar email</button>}
          {user.suspended_at
            ? <button className="btn" type="button" disabled={!!busy} onClick={() => act("unsuspend", "Nota para o registo (opcional):")}>Reativar conta</button>
            : !user.is_admin && <button className="btn danger" type="button" disabled={!!busy} onClick={() => act("suspend", `Motivo da suspensão de @${user.username} (fica no registo):`)}>Suspender</button>}
        </div>}
      </div>
      {user.suspended_at && <p className="admin-suspended"><Icon name="block" size={16} />Suspensa {relativeTime(user.suspended_at)}{user.suspended_reason ? `: ${user.suspended_reason}` : ""}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
      <div className="stat-grid admin-kpis">
        <Kpi label="Publicações" value={number(user.posts)} />
        <Kpi label="Amigos" value={number(user.friends)} />
        <Kpi label="Seguidores" value={number(user.followers)} />
        {!data.money_hidden && <Kpi label="Gastou no Tchilar" value={formatPrice(data.spent)} />}
        <Kpi label="Denúncias recebidas" value={number(user.reports_total)} hint={user.reports_open ? `${user.reports_open} abertas` : null} tone={user.reports_open ? "warning" : ""} />
        <Kpi label="Denúncias feitas" value={number(user.reports_made)} />
      </div>
      {canManageTeam ? <TeamRole user={user} onChange={load} />
        : user.is_admin && <p className="muted">Na equipa: {ROLE_LABELS[user.admin_role || "super"]}</p>}
      <dl className="admin-facts">
        <div><dt>Conta criada</dt><dd>{dateTime(user.created_at)}</dd></div>
        <div><dt>Última atividade</dt><dd>{user.last_seen_at ? dateTime(user.last_seen_at) : "Nunca"}</dd></div>
        <div><dt>Província</dt><dd>{user.province || "—"}</dd></div>
        <div><dt>Dois passos</dt><dd>{user.two_factor ? "Ativos" : "Desligados"}</dd></div>
        <div><dt>Programa de Parceiros</dt><dd>{user.partner_since ? `Desde ${dateTime(user.partner_since)}` : "Não"}</dd></div>
        <div><dt>Convidado por</dt><dd>{user.referred_by ? <Link to={`/u/${user.referred_by}`}>@{user.referred_by}</Link> : "—"}</dd></div>
      </dl>
    </section>

    {!data.money_hidden && <><section className="creator-card">
      <h2>Pagamentos</h2>
      {data.payments.length ? <ul className="admin-mini-list">{data.payments.map(payment => <li key={`${payment.kind}-${payment.id}`}>
        <Link to={`/recibos/${payment.kind}/${payment.id}?equipa=1`}>{payment.receipt}</Link>
        <span>{payment.description}<small>{dateTime(payment.paid_at)} · {payment.method_label}</small></span>
        <strong>{formatPrice(payment.amount)}</strong><PaymentStatus payment={payment} />
      </li>)}</ul> : <p className="muted">Sem pagamentos.</p>}
    </section>

    <section className="creator-card">
      <h2>Levantamentos</h2>
      {data.payouts.length ? <ul className="admin-mini-list">{data.payouts.map(payout => <li key={payout.id}>
        <span className="muted">#{payout.id}</span>
        <span>{payout.bank_name} · {payout.destination}<small>{dateTime(payout.created_at)}{payout.reference ? ` · ref. ${payout.reference}` : ""}{payout.note ? ` · ${payout.note}` : ""}</small></span>
        <strong>{formatPrice(payout.amount)}</strong><span className="payment-status">{PAYOUT_STATUS[payout.status] || payout.status}</span>
      </li>)}</ul> : <p className="muted">Sem levantamentos.</p>}
    </section></>}

    <section className="creator-card">
      <div className="creator-card-head"><div><h2>Denúncias sobre esta conta</h2></div>{user.reports_open > 0 && <Link className="prefs-link" to="/moderation">Abrir moderação <Icon name="next" size={14} /></Link>}</div>
      {data.reports.length ? <ul className="admin-mini-list">{data.reports.map(report => <li key={report.id}>
        <span className="muted">#{report.id}</span>
        <span>{report.reason}<small>{report.target_type === "post" ? "Publicação" : report.target_type === "comment" ? "Comentário" : "Perfil"} · {dateTime(report.created_at)}</small></span>
        <span className="payment-status">{REPORT_STATUS[report.status] || report.status}</span>
      </li>)}</ul> : <p className="muted">Nenhuma denúncia.</p>}
    </section>

    <section className="creator-card">
      <h2>Ações da equipa sobre esta conta</h2>
      {data.actions.length ? <ul className="admin-actions">{data.actions.map(item => <ActionLine key={item.id} item={item} />)}</ul> : <p className="muted">Nenhuma ação registada.</p>}
    </section>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Registo de ações
// ---------------------------------------------------------------------------------------------
export function AdminActions() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const action = params.get("action") || "";
  const page = Number(params.get("page")) || 1;
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ ...(action ? { action } : {}), page: String(page) }).toString();
    api(`/admin/actions?${query}`).then(result => { if (active) setData(result); }).catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [action, page]);
  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Registo de ações</h2><p>Tudo o que a equipa fez no painel: quem, o quê e quando. Não se pode apagar.</p></div>
      {data && <label className="period-select"><span className="visually-hidden">Tipo de ação</span>
        <Select value={action} onChange={event => set("action", event.target.value)}>
          <option value="">Todas as ações</option>
          {Object.entries(data.labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </Select></label>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="creator-loading">A carregar...</div>}
    {data && !data.actions.length && <p className="muted">Nada registado{action ? " com este filtro" : ""}.</p>}
    {data?.actions.length > 0 && <ul className="admin-actions">{data.actions.map(item => <ActionLine key={item.id} item={item} />)}</ul>}
    {data?.pages > 1 && <nav className="payment-pages" aria-label="Páginas">
      <button className="btn secondary" type="button" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Anterior</button>
      <span>Página {page} de {data.pages}</span>
      <button className="btn secondary" type="button" disabled={page >= data.pages} onClick={() => set("page", String(page + 1))}>Seguinte</button>
    </nav>}
  </section>;
}
