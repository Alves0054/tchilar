import { useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { API_BASE, Icon, UserContext, api, formatClock, formatPrice } from "./core.jsx";
import { relativeTime } from "./feed.jsx";
import { MUSIC_GENRE_LABELS, audioDuration } from "./shared.jsx";

export function AdminPage() {
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
export function AdminMusic() {
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
export function AdminPromotions() {
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
export function AdminPayouts() {
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
export function AdminFinance() {
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
export const MODERATION_ACTION_LABELS = {
  dismiss: "Arquivar sem ação",
  hide_post: "Esconder publicação",
  restore_post: "Repor publicação",
  delete_comment: "Apagar comentário",
  suspend_user: "Suspender conta",
  unsuspend_user: "Reativar conta"
};
export function Moderation() {
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
