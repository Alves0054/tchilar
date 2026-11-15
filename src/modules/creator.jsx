import { useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router-dom";
import { downscaleImage } from "../PhotoEditors.jsx";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import { CharCount, ContentThumb, CreatorPartnerships, PaymentDialog, PersonLine, SHORT_MONTHS, canBoost, postKind } from "./shared.jsx";

// Visitas diárias ao perfil: uma série, barras finas, dica ao passar o rato e tabela alternativa.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// ---------------------------------------------------------------------------------------------
// Painel do criador
// ---------------------------------------------------------------------------------------------

export const CREATOR_SECTIONS = [
  ["", "home", "Página inicial"],
  ["insights", "stats", "Insights"],
  ["conteudo", "pages", "Conteúdo"],
  ["engajamento", "messages", "Engajamento"],
  ["monetizacao", "spark", "Monetização"],
  ["ganhos", "gift", "Ganhos"],
  ["parcerias", "brand", "Parcerias"],
  ["anuncios", "ad", "Anúncios"]
];
export const INSIGHT_METRICS = [
  ["views", "Visualizações", "eye", "publicações vistas por outras pessoas"],
  ["engagement", "Engajamento", "messages", "gostos, comentários e partilhas"],
  ["followers", "Novos seguidores", "friends", "pessoas que começaram a seguir-te"],
  ["visits", "Visitas ao perfil", "profile", "pessoas que abriram o teu perfil"]
];
export const PERIOD_OPTIONS = [[7, "Últimos 7 dias"], [28, "Últimos 28 dias"], [90, "Últimos 90 dias"]];
export const shortDate = day => { const date = new Date(`${day}T12:00:00`); return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`; };
// Variação face ao período anterior: null quando não há base de comparação.
export function percentChange(total, previous) {
  if (!previous) return total ? null : 0;
  return Math.round(((total - previous) / previous) * 100);
}
export function DeltaBadge({ total, previous }) {
  const change = percentChange(total, previous);
  if (change === null) return <span className="delta delta-new">novo</span>;
  if (change === 0) return <span className="delta delta-flat">0%</span>;
  const up = change > 0;
  return <span className={`delta ${up ? "delta-up" : "delta-down"}`} title="Comparado com o período anterior">
    <Icon name={up ? "arrowUp" : "arrowDown"} size={13} />{up ? "+" : ""}{change}%
  </span>;
}
// Escala "redonda" para o eixo: 4, 10, 20, 50, 100, 200...
export function niceMax(value) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value);
}
// Gráfico de área de uma só série, com linha de referência e dica ao passar o rato/teclado.
export function InsightsChart({ daily, metric, label }) {
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
export function useCreatorOverview(days) {
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
export function PeriodSelect({ days, onChange }) {
  return <label className="period-select">
    <span className="visually-hidden">Período</span>
    <select value={days} onChange={event => onChange(Number(event.target.value))}>
      {PERIOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <Icon name="chevronDown" size={16} />
  </label>;
}
export function InsightsCard({ data, error, days, onDays, full = false }) {
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
export function ProfileStatusCard({ profile }) {
  if (!profile) return <section className="creator-card"><h2>Estado do perfil</h2><div className="creator-loading">A verificar...</div></section>;
  const problem = profile.suspended_at
    ? ["block", "A tua conta está suspensa. Contacta a equipa do Tchilar."]
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
export function CreatorHome({ user }) {
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
export function MonetizationSummary() {
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
export function AdsSummary() {
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
export function CreatorInsights() {
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
export function CreatorContent() {
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
export function CreatorEngagement() {
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
export function CreatorMonetization() {
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
export const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthLabel = key => { const [year, month] = key.split("-").map(Number); return `${MONTH_NAMES[month - 1]} de ${year}`; };
// Programa de Parceiros: mostra o progresso para as regras e, depois de aderir, os ganhos por mês.
export function PartnerProgramCard() {
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
        <h2 id="partner-title"><Icon name="spark" size={18} /> Programa de Parceiros Tchilar</h2>
        <p>O Tchilar paga-te <strong>{formatPrice(data.rpm)}</strong> por cada 1000 visualizações das tuas publicações.</p>
      </div>
      {data.partner_since && <span className={`status-pill ${data.earning ? "is-ok" : "is-warning"}`}>{data.earning ? "Parceiro ativo" : "Ganhos em pausa"}</span>}
    </div>

    {!data.partner_since || !data.earning ? <>
      <p className="partner-intro">{data.partner_since
        ? "Deixaste de cumprir uma das regras. Os ganhos voltam assim que voltares a cumpri-las."
        : "Para começares a ganhar dinheiro com o Tchilar tens de cumprir todas estas regras:"}</p>
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
export const AD_STATUS = {
  pending_payment: ["A aguardar pagamento", "is-warning"],
  in_review: ["Em revisão", "is-warning"],
  rejected: ["Recusada", "is-off"],
  active: ["Ativo", "is-ok"],
  paused: ["Em pausa", "is-warning"],
  ended: ["Terminado", "is-off"]
};
// Igual ao espaço «Patrocinado» da página inicial (SponsoredSlot), dentro de uma moldura da coluna.
export function AdPreview({ ad, imageSrc, advertiser }) {
  const site = ad.destination === "link" ? (() => { try { return new URL(ad.linkUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";
  return <div className="ad-preview-frame">
    <span className="home-heading">Patrocinado</span>
    <div className="home-sponsor ad-preview" aria-label="Pré-visualização do anúncio">
      <span className="home-sponsor-art">{imageSrc ? <img src={imageSrc} alt="" /> : <img src="/tchilar-logo.png" alt="" />}</span>
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
export const AD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const AD_IMAGE_MAX = 8 * 1024 * 1024;
// Imagem do anúncio: escolher, arrastar para cá, trocar ou remover.
export function AdImagePicker({ image, preview, onChange }) {
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
export const EMPTY_AD = { kind: "boost", postId: "", title: "", body: "", destination: "profile", linkUrl: "", budget: "5000", days: "7", provinces: [], minAge: "", maxAge: "" };
export const BUDGET_PRESETS = [2000, 5000, 10000, 25000, 50000];
export const AD_DAY_OPTIONS = [1, 3, 7, 14, 30];
// Separadores da lista: cada promoção cai num só grupo.
export const AD_FILTERS = [
  ["all", "Todas", () => true],
  ["live", "No ar", ad => ad.status === "active" || ad.status === "paused"],
  ["review", "Em revisão", ad => ad.status === "in_review"],
  ["unpaid", "Por pagar", ad => ad.status === "pending_payment"],
  ["done", "Terminadas", ad => ad.status === "ended" || ad.status === "rejected"]
];
export const dayLabel = value => `${value} ${Number(value) === 1 ? "dia" : "dias"}`;
export const percentOf = (part, whole) => whole ? `${((part / whole) * 100).toFixed(1).replace(".", ",")}%` : "0%";
// Resumo de todas as promoções pagas (as recusadas são devolvidas, por isso não contam).
export function AdsOverview({ ads }) {
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
export function AdResults({ ad }) {
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
export function BoostPreview({ post, user, placement }) {
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
export function CreatorAds() {
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
          <p>Pagas uma vez e o Tchilar mostra a tua promoção a quem ainda não a viu: {formatPrice(cost * 1000)} por cada 1000 pessoas alcançadas.</p></div>
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
            <small className="muted">{targeted ? `Só vê quem ${form.provinces.length ? `está em ${form.provinces.join(", ")}` : "tem a idade indicada"}${form.provinces.length && (form.minAge || form.maxAge) ? " e tem a idade indicada" : ""} (quem indicou a província e a idade nas Definições).` : "Sem filtros: o Tchilar mostra a toda a gente."}</small>
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
        <div><strong>Ainda não criaste nenhuma promoção</strong><p className="muted">Escolhe uma publicação de que gostas, define quanto queres gastar e o Tchilar mostra-a a mais pessoas.</p></div>
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
export function CreatorDashboard() {
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
// ---------------------------------------------------------------------------------------------
// Ganhos e levantamentos (criador) e área de administração (promoções, levantamentos, finanças)
// ---------------------------------------------------------------------------------------------

export const ANGOLAN_BANKS = ["BAI", "BFA", "BIC", "BPC", "Millennium Atlântico", "Banco Sol", "BNI", "Standard Bank", "Banco Económico", "Banco Keve", "Banco Yetu", "Outro"];
export const PAYOUT_STATUS = { requested: ["Em processamento", "is-warning"], paid: ["Pago", "is-ok"], rejected: ["Recusado", "is-off"] };
export function CreatorEarnings() {
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
    ["Campanhas com marcas", data.sources.campaignsKz, "brand", "85% das campanhas concluídas"],
    ["Grupos secretos", data.sources.groupsKz || 0, "lock", "70% das entradas pagas"],
    ["Prémios de desafios", data.sources.prizesKz || 0, "trophy", "Prémios em dinheiro dos desafios do mês"],
    ["Cursos vendidos", data.sources.coursesKz || 0, "academy", "85% das vendas na Academia"]
  ];
  const hasPending = data.requests.some(request => request.status === "requested");
  return <>
    <section className="creator-card" aria-labelledby="earnings-title">
      <div className="creator-card-head"><div><h2 id="earnings-title">Ganhos</h2><p>Tudo o que ganhaste no Tchilar e o que já podes levantar.</p></div></div>
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
