import { useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { API_BASE, Icon, UserContext, api, formatClock, formatPrice } from "./core.jsx";
import { relativeTime } from "./feed.jsx";
import { MUSIC_GENRE_LABELS, PayoutLogo, audioDuration } from "./shared.jsx";
import { AdminPayments } from "./payments.jsx";
import { AdminActions, AdminOverview, AdminUserDetail, AdminUsers } from "./admin-panel.jsx";
import { AdminChallenges, AdminCourses } from "./admin-academy.jsx";
import { AdminBroadcasts, AdminContent, AdminDataRequests, PaymentAttempts, ROLE_LABELS, canSee, downloadWithSession } from "./admin-ops.jsx";
import { Select } from "./select.jsx";
import { DatePicker } from "./date-picker.jsx";

// Áreas do painel, por grupo, e quem as vê. "super" vê todas; sem lista de funções, qualquer pessoa da equipa.
const ADMIN_SECTIONS = [
  { label: "Geral", items: [
    { slug: "painel", label: "Painel", icon: "grid", hint: "O que está por fazer e os números do dia a dia.", roles: [] },
    { slug: "registo", label: "Registo", icon: "pages", hint: "Tudo o que a equipa fez no painel.", roles: ["super"] }
  ] },
  { label: "Dinheiro", items: [
    { slug: "pagamentos", label: "Pagamentos", icon: "card", hint: "Pagamentos confirmados, recibos e reembolsos.", roles: ["finance"] },
    { slug: "por-resolver", label: "Por resolver", icon: "help", hint: "Pagamentos que ficaram a meio.", roles: ["finance"] },
    { slug: "levantamentos", label: "Levantamentos", icon: "gift", hint: "Pagar os criadores, um a um ou em lote.", roles: ["finance"] },
    { slug: "financas", label: "Finanças", icon: "stats", hint: "Entradas, parte do Tchilar e dívida aos criadores.", roles: ["finance"] },
    { slug: "codigos", label: "Códigos promocionais", icon: "gift", hint: "Criar descontos para campanhas, cursos, estrelas e subscrições.", roles: ["finance"] }
  ] },
  { label: "Pessoas", items: [
    { slug: "utilizadores", label: "Utilizadores", icon: "groups", hint: "Procura uma conta e vê a ficha completa.", roles: [] },
    { slug: "dados", label: "Pedidos de dados", icon: "lock", hint: "Cópias, correções e contas a apagar (Lei n.º 22/11).", roles: ["super"] },
    { slug: "avisos", label: "Avisos", icon: "notifications", hint: "Mensagens para toda a gente ou para um grupo.", roles: ["super"] }
  ] },
  { label: "Conteúdo", items: [
    { slug: "moderacao", label: "Moderação", icon: "shield", hint: "Procura e esconde conteúdo sem esperar por denúncias.", roles: ["moderation"] },
    { slug: "promocoes", label: "Promoções", icon: "ad", hint: "Aprova ou recusa anúncios pagos.", roles: ["finance", "moderation"] },
    { slug: "negocios", label: "Negócios", icon: "shield", hint: "Confirma o NIF e dá o selo «Negócio verificado» às lojas.", roles: ["moderation"] },
    { slug: "musicas", label: "Músicas", icon: "sound", hint: "Biblioteca de músicas com licença.", roles: ["moderation"] }
  ] },
  { label: "Comunidade", items: [
    { slug: "desafios", label: "Desafios", icon: "trophy", hint: "Catálogo de 40 desafios, prémios em estrelas e dinheiro, lançar o mês e premiar.", roles: ["moderation", "finance"] },
    { slug: "cursos", label: "Cursos", icon: "academy", hint: "Rever os cursos dos criadores antes de irem para a venda.", roles: ["moderation"] }
  ] }
];

export function AdminPage() {
  const { user, authReady } = useContext(UserContext);
  const { tab = "painel", itemId } = useParams();
  const nav = useRef(null);
  // No telemóvel o menu é uma faixa que desliza: mostra a área aberta.
  useEffect(() => {
    const active = nav.current?.querySelector("a.is-active");
    if (active && nav.current.scrollWidth > nav.current.clientWidth) {
      nav.current.scrollTo({ left: active.offsetLeft - nav.current.clientWidth / 2 + active.clientWidth / 2 });
    }
  }, [tab, authReady]);
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user?.is_admin) return <div className="page narrow"><div className="empty card">Só a equipa do Tchilar tem acesso a esta área.</div></div>;
  const role = user.admin_role || "super";
  const sections = ADMIN_SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => !item.roles.length || canSee(role, ...item.roles)) }))
    .filter(section => section.items.length);
  const current = sections.flatMap(section => section.items).find(item => item.slug === tab);
  return <div className="admin-shell">
    <aside className="admin-nav" aria-label="Áreas da administração" ref={nav}>
      <div className="admin-nav-title"><strong>Administração</strong><span className="admin-role-badge">{ROLE_LABELS[role]}</span></div>
      {sections.map(section => <div className="admin-nav-group" key={section.label}>
        <h2>{section.label}</h2>
        {section.items.map(item => <NavLink key={item.slug} to={`/admin/${item.slug}`} className={() => item.slug === tab ? "is-active" : ""}>
          <Icon name={item.icon} size={18} /><span>{item.label}</span>
        </NavLink>)}
        {section.label === "Conteúdo" && canSee(role, "moderation") && <Link to="/moderation"><Icon name="flag" size={18} /><span>Denúncias</span></Link>}
      </div>)}
    </aside>
    <div className="admin-main">
      <header className="admin-main-head">
        <h1>{current?.label || "Administração"}</h1>
        {current && <p>{current.hint}</p>}
      </header>
    {!current && <section className="creator-card"><p className="muted">A tua função na equipa ({ROLE_LABELS[role]}) não dá acesso a esta área.</p></section>}
    {current && <>
      {tab === "painel" && <AdminOverview />}
      {tab === "pagamentos" && <AdminPayments />}
      {tab === "por-resolver" && <PaymentAttempts />}
      {tab === "utilizadores" && (itemId ? <AdminUserDetail userId={itemId} canManageTeam={role === "super"} canModerate={canSee(role, "moderation")} /> : <AdminUsers />)}
      {tab === "moderacao" && <AdminContent />}
      {tab === "avisos" && <AdminBroadcasts />}
      {tab === "dados" && <AdminDataRequests />}
      {tab === "registo" && <AdminActions />}
      {tab === "promocoes" && <AdminPromotions />}
      {tab === "negocios" && <AdminBusiness />}
      {tab === "levantamentos" && <AdminPayouts />}
      {tab === "financas" && <AdminFinance />}
      {tab === "codigos" && <AdminPromotionCodes />}
      {tab === "musicas" && <AdminMusic />}
      {tab === "desafios" && <AdminChallenges />}
      {tab === "cursos" && <AdminCourses />}
    </>}
    </div>
  </div>;
}

export function AdminPromotionCodes() {
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ code: "", discountPercent: "10", minAmountKz: "0", maxDiscountKz: "", maxUses: "", expiresAt: "", purposes: [] });
  const load = () => api("/admin/promotion-codes").then(result => setCodes(result.codes)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const create = async event => {
    event.preventDefault(); setError(""); setNotice("");
    try {
      await api("/admin/promotion-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        code: form.code, discountPercent: Number(form.discountPercent), minAmountKz: Number(form.minAmountKz),
        maxDiscountKz: form.maxDiscountKz, maxUses: form.maxUses, expiresAt: form.expiresAt, purposes: form.purposes
      }) });
      setNotice("Código promocional criado.");
      setForm({ code: "", discountPercent: "10", minAmountKz: "0", maxDiscountKz: "", maxUses: "", expiresAt: "", purposes: [] });
      load();
    } catch (createError) { setError(createError.message); }
  };
  const toggle = async item => {
    setError(""); setNotice("");
    try { await api(`/admin/promotion-codes/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !item.active }) }); load(); }
    catch (toggleError) { setError(toggleError.message); }
  };
  const purposeOptions = [["stars","Estrelas"],["ad","Promoções"],["campaign","Campanhas"],["course","Cursos"],["subscription","Subscrições"],["group_access","Grupos"],["verification","Verificação"]];
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Criar código promocional</h2><p>Limita o desconto por compra, número de usos e data de validade.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status">{notice}</p>}
    <form className="prefs-form" onSubmit={create}>
      <label>Código<input value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="TCHILAR20" maxLength={40} required /></label>
      <label>Desconto (%)<input type="number" min="1" max="100" value={form.discountPercent} onChange={event => setForm(current => ({ ...current, discountPercent: event.target.value }))} required /></label>
      <label>Valor mínimo (Kz)<input type="number" min="0" step="0.01" value={form.minAmountKz} onChange={event => setForm(current => ({ ...current, minAmountKz: event.target.value }))} /></label>
      <label>Desconto máximo (Kz, opcional)<input type="number" min="1" step="0.01" value={form.maxDiscountKz} onChange={event => setForm(current => ({ ...current, maxDiscountKz: event.target.value }))} /></label>
      <label>Máximo de usos (opcional)<input type="number" min="1" value={form.maxUses} onChange={event => setForm(current => ({ ...current, maxUses: event.target.value }))} /></label>
      <label>Válido até (opcional)<DatePicker mode="datetime" defaultTime="23:59" value={form.expiresAt} onChange={event => setForm(current => ({ ...current, expiresAt: event.target.value }))}
        placeholder="Sem data de fim" aria-label="Válido até" /></label>
      <fieldset><legend>Aplicar a</legend><div className="admin-chips">{purposeOptions.map(([key,label]) => <button type="button" key={key} className="province-chip" aria-pressed={form.purposes.includes(key)}
        onClick={() => setForm(current => ({ ...current, purposes: current.purposes.includes(key) ? current.purposes.filter(value => value !== key) : [...current.purposes, key] }))}>{label}</button>)}</div></fieldset>
      <button className="btn" type="submit">Criar código</button>
    </form>
    <h3>Códigos existentes</h3>
    {!codes && <p className="muted">A carregar...</p>}
    {codes?.length === 0 && <p className="muted">Ainda não existem códigos promocionais.</p>}
    {codes?.map(item => <div className="admin-item" key={item.id}>
      <div className="admin-item-main"><div className="admin-item-title"><strong>{item.code}</strong><span className="muted">{item.discount_percent}% · {item.used_count}/{item.max_uses || "∞"} usos</span></div>
        <p className="muted">{item.expires_at ? `Até ${new Date(item.expires_at).toLocaleString("pt-PT")}` : "Sem validade"} · {item.applicable_purposes?.length ? item.applicable_purposes.join(", ") : "Todas as compras"}</p></div>
      <button className="btn secondary" type="button" onClick={() => toggle(item)}>{item.active ? "Desativar" : "Ativar"}</button>
    </div>)}
  </section>;
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
      <p className="muted">Só músicas que a Tchilar pode usar: compostas para a Tchilar, com autorização escrita do artista, ou com licença livre (por exemplo, Pixabay Music ou Creative Commons CC0). Regista sempre a licença.</p>
      <input ref={fileInput} className="sr-only" type="file" accept="audio/*" tabIndex={-1} aria-hidden="true" onChange={event => { pick(event.target.files?.[0]); event.target.value = ""; }} />
      <button type="button" className="music-upload-button" onClick={() => fileInput.current.click()}><Icon name="sound" size={16} />{form.file ? form.file.name : "Escolher ficheiro de áudio (até 15 MB)"}</button>
      <div className="admin-music-fields">
        <label>Nome<input required maxLength={100} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label>Artista<input maxLength={100} value={form.artist} onChange={event => setForm({ ...form, artist: event.target.value })} /></label>
        <label>Género<Select value={form.genre} onChange={event => setForm({ ...form, genre: event.target.value })}>
          {Object.entries(MUSIC_GENRE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select></label>
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
// Pedidos do selo «Negócio verificado»: confirmar o NIF (por exemplo no portal da AGT) e aprovar ou recusar.
export function AdminBusiness() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const load = () => api("/admin/business").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const decide = async (page, approve) => {
    const reason = approve ? "" : window.prompt(`Motivo da recusa para «${page.name}» (a pessoa vai ver):`, "O NIF não corresponde a um negócio ativo.");
    if (!approve && !reason) return;
    setBusy(page.id); setError("");
    try {
      await api(`/admin/business/${page.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, reason }) });
      await load();
    } catch (decideError) { setError(decideError.message); } finally { setBusy(null); }
  };
  return <section className="creator-card">
    <div className="creator-card-head"><div><h2>Negócios por verificar</h2>
      <p>Confirma que o NIF existe e pertence ao negócio (portal da AGT) antes de aprovar. {data ? `${data.verified} negócios já verificados.` : ""}</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {data && !data.requests.length && <p className="muted">Não há pedidos à espera.</p>}
    {data?.requests.length > 0 && <ul className="admin-mini-list">{data.requests.map(page => <li key={page.id}>
      <span className="muted">#{page.id}</span>
      <span><strong><Link to={`/pages/${page.id}`}>{page.name}</Link></strong>
        <small>NIF {page.business_nif} · @{page.owner_username || "sem dono"} · pedido {relativeTime(page.business_requested_at)}</small>
        <small>{[page.address, page.contact_phone, page.contact_email, page.whatsapp && `WhatsApp +${page.whatsapp}`].filter(Boolean).join(" · ") || "Sem contactos na página"}</small></span>
      <span />
      <span className="admin-row-actions">
        <button className="btn" type="button" disabled={busy === page.id} onClick={() => decide(page, true)}>Aprovar</button>
        <button className="btn secondary" type="button" disabled={busy === page.id} onClick={() => decide(page, false)}>Recusar</button>
      </span>
    </li>)}</ul>}
  </section>;
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
      <label className="period-select"><Select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="in_review">Em revisão</option><option value="active">No ar</option><option value="rejected">Recusadas</option><option value="all">Todas</option>
      </Select></label></div>
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
  const [selected, setSelected] = useState([]);
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/payouts?status=${status}`).then(result => setPayouts(result.payouts)).catch(loadError => setError(loadError.message));
  useEffect(() => { setPayouts(null); setSelected([]); load(); }, [status]);
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  // Lote: descarrega o ficheiro para o banco; depois de o banco processar, marca os escolhidos com a referência do lote.
  const exportBatch = async () => {
    setError(""); setNotice("");
    try {
      await downloadWithSession("/admin/payouts.csv", `tchilar-levantamentos-${new Date().toISOString().slice(0, 10)}.csv`);
      setNotice("Ficheiro descarregado. Depois de o banco processar, escolhe os pagos e marca-os com a referência do lote.");
    } catch (exportError) { setError(exportError.message); }
  };
  const payBatch = async () => {
    const total = payouts.filter(payout => selected.includes(payout.id)).reduce((sum, payout) => sum + payout.amount, 0);
    const reference = window.prompt(`Marcar ${selected.length} levantamentos como pagos (${formatPrice(total)}).\nReferência do lote no banco:`);
    if (!reference) return;
    setError(""); setNotice("");
    try {
      const result = await api("/admin/payouts/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected, reference }) });
      setNotice(`${result.paid.length} marcados como pagos.${result.skipped.length ? ` ${result.skipped.length} já não estavam por pagar.` : ""}`);
      setPayouts(current => current.filter(item => !result.paid.includes(item.id)));
      setSelected([]);
    } catch (batchError) { setError(batchError.message); }
  };
  const settle = async (payout, action) => {
    const value = window.prompt(action === "paid" ? `Referência do pagamento de ${formatPrice(payout.amount)} para ${payout.holder_name} (${payout.method_label}: ${payout.destination}):` : "Motivo da recusa (o criador vai ver):");
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
      <label className="period-select"><Select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="requested">Por pagar</option><option value="paid">Pagos</option><option value="rejected">Recusados</option>
      </Select></label></div>
    {status === "requested" && payouts?.length > 0 && <div className="admin-batch">
      <button className="btn secondary" type="button" onClick={exportBatch}><Icon name="arrowDown" size={16} />Ficheiro dos levantamentos</button>
      <label className="admin-check"><input type="checkbox" checked={selected.length === payouts.length}
        onChange={event => setSelected(event.target.checked ? payouts.map(payout => payout.id) : [])} />Escolher todos</label>
      <button className="btn" type="button" disabled={!selected.length} onClick={payBatch}>Marcar {selected.length || ""} como pagos</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {!payouts && !error && <div className="creator-loading">A carregar...</div>}
    {payouts && !payouts.length && <p className="muted">Nada para mostrar.</p>}
    {payouts?.length > 0 && <ul className="ad-list">{payouts.map(payout => <li className="payout-item admin-payout" key={payout.id}>
      {payout.status === "requested" && <input className="admin-payout-check" type="checkbox" aria-label={`Escolher o levantamento de ${payout.holder_name}`}
        checked={selected.includes(payout.id)} onChange={() => toggle(payout.id)} />}
      <span><strong>{formatPrice(payout.amount)}</strong> para {payout.display_name ? <Link to={`/u/${payout.username}`}>{payout.display_name}</Link> : "conta apagada"}
        <small>Titular: {payout.holder_name} · {payout.bank_name}</small>
        <small className="admin-iban"><PayoutLogo method={payout.method} size={16} /> {payout.method === "iban" ? "IBAN" : payout.method_label}: {payout.destination}</small>
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
    ["Entradas (pagas por clientes)", [["Promoções", data.income.promotions], ["Estrelas vendidas", data.income.stars], ["Campanhas pagas", data.income.campaigns], ["Entradas em grupos secretos", data.income.groups || 0]]],
    ["Parte do Tchilar", [["Promoções", data.tchilar_share.promotions], ["Estrelas (30% + não oferecidas)", data.tchilar_share.stars], ["Comissão de campanhas (15%)", data.tchilar_share.campaigns_commission], ["Grupos secretos (30%)", data.tchilar_share.groups || 0]]],
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
  hide_course: "Esconder curso",
  restore_course: "Repor curso",
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
    if (report.target_type === "course") list.push(report.target_hidden ? "restore_course" : "hide_course");
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
        <strong>{{ post: "Publicação", comment: "Comentário", user: "Conta", course: "Curso" }[report.target_type]} de {report.target_username ? <Link to={`/u/${report.target_username}`}>@{report.target_username}</Link> : "conta apagada"}</strong>
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
