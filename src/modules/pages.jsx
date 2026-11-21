import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AvatarEditor, CoverEditor, downscaleImage } from "../PhotoEditors.jsx";
import { API_BASE, Avatar, Icon, PUBLIC_URL, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import "./pages.css";
import { Composer, PostCard } from "./feed.jsx";
import { CreateEventDialog, EventDate, eventWhen } from "./events.jsx";
import { StartLiveDialog } from "./live.jsx";
import { VerifiedBadge, pageMonogram, pageTone } from "./shared.jsx";
import { VerificationPlans } from "./verification.jsx";
import { PAGE_CATEGORIES, PAGE_TYPES, pageCategory, pageCategoryLabel, pageCategoryPath, pageType } from "./community-types.js";
import { useDismiss } from "./layout.jsx";
import { Select } from "./select.jsx";
import { DatePicker } from "./date-picker.jsx";

// ---------------------------------------------------------------------------------------------
// Páginas: descobrir, seguir, criar e ver páginas
// ---------------------------------------------------------------------------------------------
export function PageKind({ page }) {
  return <span className="page-category"><Icon name={pageType(page.page_type).icon} size={13} /> {pageType(page.page_type).label} · {pageCategoryLabel(page)}</span>;
}
// Selo ao lado do nome da página: o da verificação paga (Kazola azul, Bolado vermelho, Benga dourado)
// ou, sem plano, o visto da página oficial do Tchilar.
export function OfficialPageBadge({ show, tier = null }) {
  if (tier) return <VerifiedBadge show tier={tier} />;
  return show ? <span className="official-page-badge" role="img" aria-label="Página oficial do Tchilar" title="Página oficial do Tchilar"><Icon name="check" size={11} /></span> : null;
}
// Selo "Negócio verificado": a equipa confirmou o NIF de uma página com loja.
export function BusinessBadge({ page }) {
  return page?.business_verified ? <span className="business-badge" title="A equipa do Tchilar confirmou o NIF deste negócio">
    <Icon name="shield" size={12} /> Negócio verificado</span> : null;
}
// Mensagem pronta para encomendar pelo WhatsApp de quem vende.
export function whatsappOrderUrl(page, offer, price) {
  const text = `Olá! Quero encomendar «${offer.title}» (${formatPrice(price)}) que vi na loja de ${page.name} no Tchilar: ${PUBLIC_URL}/pages/${page.id}`;
  return `https://wa.me/${page.whatsapp}?text=${encodeURIComponent(text)}`;
}
// Pedido do selo dentro de Editar informações (só com a loja ligada).
function BusinessSealRequest({ page, onSaved }) {
  const [nif, setNif] = useState(page.business_nif || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (page.business_verified) return <p className="business-seal-state is-ok"><Icon name="shield" size={15} /> Este negócio tem o selo <strong>Negócio verificado</strong>.</p>;
  const pending = page.business_requested_at && !page.business_rejected_reason;
  const send = async () => {
    setBusy(true); setError("");
    try {
      const result = await api(`/pages/${page.id}/business`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nif }) });
      onSaved({ business_nif: result.page.business_nif, business_requested_at: result.page.business_requested_at, business_rejected_reason: null });
    } catch (sendError) { setError(sendError.message); } finally { setBusy(false); }
  };
  return <div className="business-seal">
    <strong>Selo «Negócio verificado»</strong>
    <p className="muted">Mostra aos clientes que o negócio existe. Indica o NIF; a equipa confirma em poucos dias. É grátis.</p>
    {pending ? <p className="business-seal-state"><Icon name="clock" size={15} /> Pedido enviado com o NIF {page.business_nif}. A equipa está a confirmar.</p>
      : <div className="business-seal-row">
        <input value={nif} onChange={event => setNif(event.target.value)} maxLength={20} placeholder="NIF do negócio" aria-label="NIF do negócio" />
        <button className="btn secondary" type="button" disabled={busy || nif.trim().length < 9} onClick={send}>{busy ? "A enviar..." : "Pedir selo"}</button>
      </div>}
    {page.business_rejected_reason && <p className="error">Pedido anterior recusado: {page.business_rejected_reason}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
export function PageLogo({ page, size = "" }) {
  return <span className={`page-logo tone-page-${pageTone(page.category)} ${size}`} aria-hidden="true">
    {page.logo_url ? <img src={`${API_BASE}${page.logo_url}`} alt="" /> : pageMonogram(page.name)}
  </span>;
}
export function FollowPageButton({ page, user, busy, onFollow, onUnfollow }) {
  if (!user) return <Link className="btn" to="/login">Entrar para seguir</Link>;
  if (page.owner_username === user.username) return <Link className="btn secondary" to={`/pages/${page.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  return page.is_following
    ? <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onUnfollow(page)}>
      <Icon name="check" size={15} /><span className="when-idle">A seguir</span><span className="when-hover">Deixar de seguir</span></button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onFollow(page)}><Icon name="plus" size={15} /> Seguir</button>;
}
const plural = (count, one, many) => `${formatCount(count)} ${count === 1 ? one : many}`;

// Seguidores · publicações, numa linha (no cartão e no cabeçalho da página).
function PageStats({ page, since = false }) {
  return <p className="pg-stats">
    <span><strong>{formatCount(page.follower_count)}</strong> {page.follower_count === 1 ? "seguidor" : "seguidores"}</span>
    <span><strong>{formatCount(page.post_count)}</strong> {page.post_count === 1 ? "publicação" : "publicações"}</span>
    {since && page.created_at && <span>Desde {new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span>}
  </p>;
}

// Capas em faixa ficam a cobrir (na posição escolhida pelo dono). Com fit="smart", uma imagem que não é faixa
// (um cartaz quadrado ou vertical) aparece inteira, com ela própria desfocada por trás a preencher os lados:
// cortada numa faixa só se via uma tira (no destaque, "faz viver / Save the Date" do cartaz oficial).
const BANNER_MIN_RATIO = 1.6;
function PageCover({ page, lazy = true, fit = "cover" }) {
  const [poster, setPoster] = useState(false);
  useEffect(() => { setPoster(false); }, [page.cover_url]);
  if (!page.cover_url) return <span className="pg-cover-mark" aria-hidden="true">{pageMonogram(page.name)}</span>;
  const src = `${API_BASE}${page.cover_url}`;
  const onLoad = event => {
    if (fit !== "smart") return;
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    setPoster(height > 0 && width / height < BANNER_MIN_RATIO);
  };
  return <>
    {poster && <img className="pg-cover-backdrop" src={src} alt="" aria-hidden="true" />}
    <img className={poster ? "pg-cover-poster" : undefined} src={src} alt="" loading={lazy ? "lazy" : undefined} onLoad={onLoad}
      style={poster ? undefined : { objectPosition: `50% ${page.cover_position ?? 50}%` }} />
  </>;
}

export function PageCard({ page, user, busy, onFollow, onUnfollow }) {
  const href = `/pages/${page.id}`;
  return <article className="pg-card">
    <Link className={`pg-card-cover tone-page-${pageTone(page.category)}`} to={href} tabIndex={-1} aria-hidden="true"><PageCover page={page} fit="smart" /></Link>
    <div className="pg-card-main">
      <Link to={href} className="pg-card-logo" aria-hidden="true" tabIndex={-1}><PageLogo page={page} /></Link>
      <h3 className="pg-card-name"><Link to={href}>{page.name}</Link><OfficialPageBadge show={page.is_official} tier={page.verification_tier} /></h3>
      <PageKind page={page} />
      {page.description && <p className="pg-card-desc">{page.description}</p>}
      <PageStats page={page} />
    </div>
    <footer className="pg-card-foot">
      {page.owner_username
        ? <Link className="pg-owner" to={`/u/${page.owner_username}`} title={`Criada por ${page.owner_name}`}>
          <Avatar user={{ display_name: page.owner_name, avatar_url: page.owner_avatar }} size="tiny" /><span>{page.owner_name}</span></Link>
        : <span className="pg-owner"><span className="pg-owner-team" aria-hidden="true"><Icon name="verified" size={13} /></span><span>Equipa Tchilar</span></span>}
      <FollowPageButton page={page} user={user} busy={busy} onFollow={onFollow} onUnfollow={onUnfollow} />
    </footer>
  </article>;
}

// A página oficial (ou outra em destaque), larga, no topo de "Descobrir".
function FeaturedPage({ page, user, busy, onFollow, onUnfollow }) {
  const href = `/pages/${page.id}`;
  return <article className="pg-featured">
    <Link className={`pg-featured-cover tone-page-${pageTone(page.category)}`} to={href} tabIndex={-1} aria-hidden="true"><PageCover page={page} lazy={false} fit="smart" /></Link>
    <div className="pg-featured-body">
      <span className="pg-eyebrow"><Icon name="spark" size={13} /> Em destaque</span>
      <div className="pg-featured-id">
        <Link to={href} aria-hidden="true" tabIndex={-1}><PageLogo page={page} size="medium" /></Link>
        <div>
          <h2><Link to={href}>{page.name}</Link><OfficialPageBadge show={page.is_official} tier={page.verification_tier} /></h2>
          <PageKind page={page} />
        </div>
      </div>
      {page.description && <p>{page.description}</p>}
      <div className="pg-featured-foot">
        <PageStats page={page} />
        <FollowPageButton page={page} user={user} busy={busy} onFollow={onFollow} onUnfollow={onUnfollow} />
      </div>
    </div>
  </article>;
}

// As páginas da própria pessoa: linha compacta com atalho para gerir.
function MyPagesStrip({ pages, onSeeAll }) {
  return <section className="pg-mine" aria-labelledby="pg-mine-title">
    <div className="pg-section-head">
      <h2 id="pg-mine-title">As tuas páginas</h2>
      {pages.length > 3 && <button type="button" className="pg-link-button" onClick={onSeeAll}>Ver todas <Icon name="next" size={15} /></button>}
    </div>
    <div className="pg-mine-list">
      {pages.slice(0, 3).map(page => <Link key={page.id} className="pg-mine-item" to={`/pages/${page.id}`}>
        <PageLogo page={page} />
        <span className="pg-mine-text"><strong>{page.name}</strong><small>{plural(page.follower_count, "seguidor", "seguidores")} · {plural(page.post_count, "publicação", "publicações")}</small></span>
        <span className="pg-mine-go"><Icon name="settings" size={15} /> Gerir</span>
      </Link>)}
    </div>
  </section>;
}
// Grupos da caixa "Tipo de página" (pela ordem do catálogo).
const TYPE_GROUPS = [...new Set(PAGE_TYPES.map(type => type.group))];
export function CreatePageDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", pageType: "", category: "", subcategory: "", description: "", shopEnabled: false });
  const chosenType = PAGE_TYPES.find(type => type.key === form.pageType);
  const chosenArea = pageCategory(form.category);
  // Escolher o tipo sugere logo a categoria mais provável (uma banda → Música e áudio); a pessoa pode trocar.
  const chooseType = type => setForm({ ...form, pageType: type.key, category: type.category, subcategory: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated(result.page);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { ...form, page_type: form.pageType || "comunidade", category: form.category || "sociedade", name: form.name || "Nome da página" };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-page-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-page-title">Criar página</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Loja da Rita" /></label>
          <label>Tipo de página<span className="select-with-icon">
            <Icon name={chosenType?.icon || "pages"} size={17} />
            <Select required value={form.pageType} onChange={event => chooseType(PAGE_TYPES.find(type => type.key === event.target.value))}>
              <option value="" disabled>Escolhe o tipo</option>
              {TYPE_GROUPS.map(group => <optgroup key={group} label={group}>
                {PAGE_TYPES.filter(type => type.group === group).map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
              </optgroup>)}
            </Select>
          </span></label>
          {chosenType && <div className="create-page-areas">
            <label>Categoria<Select value={form.category} onChange={event => setForm({ ...form, category: event.target.value, subcategory: "" })}>
              {PAGE_CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </Select></label>
            {chosenArea?.subcategories.length > 0 && <label>Subcategoria (opcional)<Select value={form.subcategory} onChange={event => setForm({ ...form, subcategory: event.target.value })}>
              <option value="">Sem subcategoria</option>
              {chosenArea.subcategories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </Select></label>}
          </div>}
          <label>Descrição <small>{form.description.length}/2000</small><textarea rows={4} maxLength={2000} value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Conta às pessoas o que vão encontrar nesta página." /></label>
          <ShopToggle checked={form.shopEnabled} onChange={value => setForm({ ...form, shopEnabled: value })} />
          <p className="muted create-page-note">És tu quem publica na página. As pessoas que a seguem veem as publicações no feed.</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.category)}`} />
            <div className="page-card-body">
              <PageLogo page={preview} />
              <h2>{preview.name}</h2>
              {chosenType && <PageKind page={preview} />}
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.pageType}>{busy ? "A criar..." : "Criar página"}</button>
      </div>
    </form>
  </div>, document.body);
}

// Loja na página: só quem gere a página decide. Sem loja, o separador "Loja" não aparece.
function ShopToggle({ checked, onChange }) {
  return <label className="shop-toggle">
    <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="shop-toggle-text">
      <strong><Icon name="gift" size={15} /> Loja na página</strong>
      <small>Mostra produtos e serviços com preço, desconto e o link para comprar (WhatsApp ou site). Podes mudar depois.</small>
    </span>
  </label>;
}

function PageAboutEditor({ page, onClose, onSaved }) {
  const [form, setForm] = useState({
    about: page.about || page.description || "", contact_email: page.contact_email || "", contact_phone: page.contact_phone || "",
    website: page.website || "", address: page.address || "", opening_hours: page.opening_hours || "", shop_enabled: Boolean(page.shop_enabled),
    whatsapp: page.whatsapp ? `+${page.whatsapp}` : ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setField = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/pages/${page.id}/about`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form)
      });
      onSaved(result.page);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card page-about-form" role="dialog" aria-modal="true" aria-labelledby="page-about-title" onSubmit={submit}>
      <div className="share-dialog-head"><h2 id="page-about-title">Editar informações da página</h2>
        <button className="round-button" type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
      <p className="muted">Estas informações ficam visíveis para todas as pessoas.</p>
      <label>Sobre a página <small>{form.about.length}/3000</small>
        <textarea name="about" rows={5} maxLength={3000} value={form.about} onChange={setField} placeholder="Conta a história, missão ou o que torna esta página especial." />
      </label>
      <div className="page-about-form-grid">
        <label>Email de contacto<input name="contact_email" type="email" maxLength={254} value={form.contact_email} onChange={setField} placeholder="contacto@exemplo.ao" /></label>
        <label>Telefone<input name="contact_phone" type="tel" maxLength={40} value={form.contact_phone} onChange={setField} placeholder="+244 9XX XXX XXX" /></label>
        <label>Site<input name="website" type="url" maxLength={300} value={form.website} onChange={setField} placeholder="https://exemplo.ao" /></label>
        <label>Localização<input name="address" maxLength={240} value={form.address} onChange={setField} placeholder="Luanda, Angola" /></label>
      </div>
      <label>Horário de funcionamento<input name="opening_hours" maxLength={300} value={form.opening_hours} onChange={setField} placeholder="Segunda a sexta, 08:00–17:00" /></label>
      <ShopToggle checked={form.shop_enabled} onChange={value => setForm(current => ({ ...current, shop_enabled: value }))} />
      {form.shop_enabled && <>
        <label>WhatsApp para encomendas<input name="whatsapp" type="tel" maxLength={24} value={form.whatsapp} onChange={setField} placeholder="+244 9XX XXX XXX" />
          <small className="muted">Na loja aparece «Encomendar pelo WhatsApp» com a mensagem já escrita.</small></label>
        {page.shop_enabled && <BusinessSealRequest page={page} onSaved={changes => onSaved({ ...page, ...changes })} />}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy}>{busy ? "A guardar..." : "Guardar informações"}</button>
      </div>
    </form>
  </div>, document.body);
}

// Contactos e dados práticos, com ícone (usados na coluna lateral e no separador "Sobre").
function pageContacts(page) {
  return [
    page.address && { key: "address", icon: "location", label: "Localização", value: page.address },
    page.opening_hours && { key: "hours", icon: "clock", label: "Horário", value: page.opening_hours },
    page.contact_phone && { key: "phone", icon: "phone", label: "Telefone", value: page.contact_phone, href: `tel:${page.contact_phone.replace(/[^+\d]/g, "")}` },
    page.contact_email && { key: "email", icon: "mail", label: "Email", value: page.contact_email, href: `mailto:${page.contact_email}` },
    page.website && { key: "website", icon: "globe", label: "Site", value: page.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: page.website, external: true }
  ].filter(Boolean);
}

function ContactList({ items }) {
  return <ul className="pg-contacts">
    {items.map(item => <li key={item.key}>
      <span className="pg-contacts-icon" aria-hidden="true"><Icon name={item.icon} size={15} /></span>
      <span className="pg-contacts-text">
        <small>{item.label}</small>
        {item.href
          ? <a href={item.href} {...(item.external && { target: "_blank", rel: "noopener noreferrer" })}>{item.value}</a>
          : <span>{item.value}</span>}
      </span>
    </li>)}
  </ul>;
}

function PageAboutDetails({ page, ownsPage, onEdit }) {
  const aboutText = page.about || page.description || "";
  const contacts = pageContacts(page);
  return <div className="pg-about-tab">
    <section className="pg-panel" aria-labelledby="pg-about-story">
      <div className="pg-panel-head">
        <h2 id="pg-about-story">Sobre {page.name}</h2>
        {ownsPage && <button className="btn secondary" type="button" onClick={onEdit}><Icon name="create" size={15} /> Editar</button>}
      </div>
      {aboutText
        ? <p className="pg-about-copy">{aboutText}</p>
        : <p className="muted">{ownsPage ? "Conta às pessoas a história da tua página, o que fazes e porque te devem seguir." : "Esta página ainda não escreveu sobre si."}</p>}
    </section>
    <section className="pg-panel" aria-labelledby="pg-about-contacts">
      <div className="pg-panel-head"><h2 id="pg-about-contacts">Contactos e horário</h2></div>
      {contacts.length
        ? <ContactList items={contacts} />
        : <p className="muted">{ownsPage ? "Adiciona telefone, email, site, morada e horário para as pessoas te encontrarem." : "Sem contactos públicos."}</p>}
    </section>
    <section className="pg-panel" aria-labelledby="pg-about-info">
      <div className="pg-panel-head"><h2 id="pg-about-info">Informações</h2></div>
      <PageFacts page={page} />
    </section>
  </div>;
}

function PageFacts({ page }) {
  return <ul className="pg-facts">
    <li><Icon name={pageType(page.page_type).icon} size={15} /><span>{pageType(page.page_type).label}</span></li>
    {pageCategoryPath(page) && <li><Icon name={pageCategory(page.category)?.icon || "grid"} size={15} /><span>{pageCategoryPath(page)}</span></li>}
    <li><Icon name="profile" size={15} /><span>{page.owner_username
      ? <>Criada por <Link to={`/u/${page.owner_username}`}>{page.owner_name}</Link></>
      : "Gerida pela equipa Tchilar"}</span></li>
    <li><Icon name="events" size={15} /><span>Desde {new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
  </ul>;
}

// Só para quem gere a página: o que falta para ela ficar completa. Desaparece quando está tudo feito.
function PageSetupCard({ page, actions }) {
  const steps = [
    { key: "logo", done: Boolean(page.logo_url), label: "Foto de perfil", action: actions.logo },
    { key: "cover", done: Boolean(page.cover_url), label: "Imagem de capa", action: actions.cover },
    { key: "about", done: Boolean(page.about || page.description), label: "Texto sobre a página", action: actions.about },
    { key: "contacts", done: pageContacts(page).length > 0, label: "Contactos ou horário", action: actions.about },
    { key: "post", done: page.post_count > 0, label: "Primeira publicação", action: actions.post }
  ];
  const done = steps.filter(step => step.done).length;
  if (done === steps.length) return null;
  return <section className="pg-side-card pg-setup" aria-labelledby="pg-setup-title">
    <div className="pg-setup-head">
      <h2 id="pg-setup-title">Completa a tua página</h2>
      <span>{done}/{steps.length}</span>
    </div>
    <div className="pg-setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Página completa">
      <span style={{ width: `${(done / steps.length) * 100}%` }} />
    </div>
    <ul>
      {steps.map(step => <li key={step.key} className={step.done ? "is-done" : ""}>
        {step.done
          ? <span className="pg-setup-step"><span className="pg-setup-check" aria-hidden="true"><Icon name="check" size={12} /></span>{step.label}</span>
          : <button type="button" className="pg-setup-step" onClick={step.action}><span className="pg-setup-check" aria-hidden="true" />{step.label}<Icon name="next" size={14} /></button>}
      </li>)}
    </ul>
  </section>;
}

function PageOfferForm({ page, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", priceKz: "", discountPercent: "", promoCode: "", expiresAt: "", checkoutUrl: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null };
      await api(`/pages/${page.id}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      onCreated();
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  return <form className="page-offer-form card" onSubmit={submit}>
    <h3>Criar produto digital ou serviço</h3>
    <label>Nome<input required maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
    <label>Descrição<textarea rows={3} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
    <label>Preço (Kz)<input required type="number" min="1" max="1000000000" step="0.01" value={form.priceKz} onChange={event => setForm({ ...form, priceKz: event.target.value })} /></label>
    <div className="page-offer-form-row">
      <label>Desconto (%)<input type="number" min="0" max="100" step="1" value={form.discountPercent} onChange={event => setForm({ ...form, discountPercent: event.target.value })} /></label>
      <label>Código de desconto<input maxLength={40} value={form.promoCode} onChange={event => setForm({ ...form, promoCode: event.target.value.toUpperCase() })} placeholder="Ex.: TCHILAR10" /></label>
    </div>
    <div className="page-offer-form-row">
      <label>Válido até (opcional)<DatePicker mode="datetime" defaultTime="23:59" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })}
        placeholder="Sem data de fim" aria-label="Válido até" /></label>
      <label>Link de compra ou contacto<input required type="url" inputMode="url" value={form.checkoutUrl} onChange={event => setForm({ ...form, checkoutUrl: event.target.value })} placeholder="https://wa.me/..." /></label>
    </div>
    <p className="muted">O link abre o WhatsApp ou o site externo do vendedor. O Tchilar não cobra nem valida o código nesse checkout.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions">
      <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
      <button className="btn" type="submit" disabled={busy || !form.title.trim() || !form.priceKz || !form.checkoutUrl}>{busy ? "A guardar..." : "Publicar oferta"}</button>
    </div>
  </form>;
}

export const PAGE_SECTIONS = [["posts", "Publicações"], ["about", "Sobre"], ["events", "Eventos"], ["offers", "Loja"]];
// "Loja" só aparece nas páginas que a ligaram.
export const pageSections = page => PAGE_SECTIONS.filter(([id]) => id !== "offers" || page.shop_enabled);
// Separadores que só quem criou a página vê.
const OWNER_SECTIONS = [["verification", "Verificação"]];

function PageWorkspace({ page, ownsPage, section, posts, reloadPosts, setError, onEditAbout }) {
  const { user } = useContext(UserContext);
  const [events, setEvents] = useState(null);
  const [offers, setOffers] = useState(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const loadEvents = useCallback(async () => {
    try { setEvents((await api(`/events?pageId=${page.id}`)).events); }
    catch (loadError) { setError(loadError.message); }
  }, [page.id, setError]);
  const loadOffers = useCallback(async () => {
    try { setOffers((await api(`/pages/${page.id}/offers`)).offers); }
    catch (loadError) { setError(loadError.message); }
  }, [page.id, setError]);
  useEffect(() => {
    if (section === "events") loadEvents();
    if (section === "offers") loadOffers();
  }, [section, loadEvents, loadOffers]);

  const toggleRsvp = async item => {
    setBusyId(item.id);
    setError("");
    try {
      await api(`/events/${item.id}/rsvp`, { method: "POST" });
      await loadEvents();
    } catch (rsvpError) {
      setError(rsvpError.message);
    } finally {
      setBusyId(null);
    }
  };
  const deleteEvent = async item => {
    if (!window.confirm(`Apagar o evento «${item.name}»? Os participantes deixam de o ver.`)) return;
    try {
      await api(`/events/${item.id}`, { method: "DELETE" });
      await loadEvents();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };
  const deleteOffer = async offer => {
    if (!window.confirm(`Remover «${offer.title}» da loja desta página?`)) return;
    try {
      await api(`/pages/${page.id}/offers/${offer.id}`, { method: "DELETE" });
      await Promise.all([loadOffers(), reloadPosts()]);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };
  const copyCode = async offer => {
    try {
      await navigator.clipboard.writeText(offer.promo_code);
      setCopiedId(offer.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch (copyError) {
      setError("Não foi possível copiar o código. Seleciona-o e copia manualmente.");
    }
  };
  const emptyState = (icon, title, text, action) => <div className="pg-empty">
    <span className="pg-empty-icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
    <h3>{title}</h3>
    <p>{text}</p>
    {action}
  </div>;

  return <section className="pg-content" id="pg-content" aria-label={[...PAGE_SECTIONS, ...OWNER_SECTIONS].find(([id]) => id === section)?.[1]}>
    {section === "verification" && ownsPage && <VerificationPlans endpoint={`/pages/${page.id}/verification`} page={page} />}
    {section === "about" && <PageAboutDetails page={page} ownsPage={ownsPage} onEdit={onEditAbout} />}
    {section === "posts" && <>
      {ownsPage && <Composer target={{ type: "page", id: page.id, page }} onPosted={() => { reloadPosts(); }} />}
      {!posts && <div className="pg-empty is-loading">A carregar publicações...</div>}
      {posts?.map(post => <PostCard key={post.id} post={post} onChanged={reloadPosts} />)}
      {posts && !posts.length && emptyState("pages", ownsPage ? "Ainda sem publicações" : "Nada publicado ainda",
        ownsPage ? "Escreve a primeira publicação acima: quem segue a página vai vê-la no feed." : "Segue a página para veres as novidades no teu feed.")}
    </>}
    {section === "events" && <>
      <div className="pg-section-head is-tab">
        <div><h2>Eventos</h2><p>Também aparecem na lista geral de eventos do Tchilar.</p></div>
        {ownsPage && <button className="btn" type="button" onClick={() => setCreatingEvent(true)}><Icon name="plus" size={16} /> Criar evento</button>}
      </div>
      {!events && <div className="pg-empty is-loading">A carregar eventos...</div>}
      {events && !events.length && emptyState("events", "Sem eventos marcados",
        ownsPage ? "Cria um evento para juntar quem segue a página: um concerto, uma promoção, um encontro." : "Quando esta página marcar um evento, aparece aqui.",
        ownsPage && <button className="btn secondary" type="button" onClick={() => setCreatingEvent(true)}><Icon name="plus" size={15} /> Criar o primeiro evento</button>)}
      {events?.length > 0 && <div className="event-list">{events.map(item => <article className="event-card card" key={item.id}>
        {item.image_url && <img className="event-card-cover" src={item.image_url} alt={`Imagem do evento ${item.name}`} loading="lazy" />}
        <EventDate value={item.starts_at} />
        <div className="event-card-body">
          <h2>{item.name}</h2>
          <small><Icon name="events" size={13} /> {eventWhen(item.starts_at)}</small>
          {item.location && <small><Icon name="location" size={13} /> {item.location}</small>}
          {item.description && <p>{item.description}</p>}
          <small className="event-meta">{formatCount(item.attendee_count)} {item.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</small>
        </div>
        <div className="event-card-actions">
          {ownsPage
            ? <button className="btn secondary danger-text icon-only" type="button" aria-label={`Apagar ${item.name}`} title="Apagar" onClick={() => deleteEvent(item)}><Icon name="trash" size={16} /></button>
            : user
              ? <button className={`btn${item.is_attending ? " secondary page-following" : ""}`} type="button" disabled={busyId === item.id} aria-pressed={item.is_attending} onClick={() => toggleRsvp(item)}>
                {item.is_attending ? <><Icon name="check" size={15} /> Vou</> : <><Icon name="plus" size={15} /> Vou participar</>}
              </button>
              : <Link className="btn" to="/login">Entrar para participar</Link>}
        </div>
      </article>)}</div>}
      {creatingEvent && <CreateEventDialog pageId={page.id} pageName={page.name} onClose={() => setCreatingEvent(false)}
        onCreated={() => { setCreatingEvent(false); loadEvents(); }} />}
    </>}
    {section === "offers" && page.shop_enabled && <>
      <div className="pg-section-head is-tab">
        <div><h2>Loja <BusinessBadge page={page} /></h2><p>Produtos e serviços. A encomenda é feita no WhatsApp ou no site do vendedor.</p></div>
        {ownsPage && !creatingOffer && <button className="btn" type="button" onClick={() => setCreatingOffer(true)}><Icon name="plus" size={16} /> Criar oferta</button>}
      </div>
      {creatingOffer && <PageOfferForm page={page} onClose={() => setCreatingOffer(false)} onCreated={() => {
        setCreatingOffer(false);
        Promise.all([loadOffers(), reloadPosts()]);
      }} />}
      {!offers && <div className="pg-empty is-loading">A carregar ofertas...</div>}
      {offers && !offers.length && !creatingOffer && emptyState("gift", "A loja está vazia",
        ownsPage ? "Mostra um produto ou serviço, com preço, desconto e o link para comprar." : "Esta página ainda não tem produtos ou serviços.",
        ownsPage && <button className="btn secondary" type="button" onClick={() => setCreatingOffer(true)}><Icon name="plus" size={15} /> Criar a primeira oferta</button>)}
      {offers?.length > 0 && <div className="page-offers">{offers.map(offer => {
        const salePrice = offer.price_kz * (100 - offer.discount_percent) / 100;
        return <article className="page-offer card" key={offer.id}>
          <div className="page-offer-content">
            <h3>{offer.title}</h3>
            {offer.description && <p>{offer.description}</p>}
            <div className="page-offer-price">
              {offer.discount_percent > 0 && <del>{formatPrice(offer.price_kz)}</del>}
              <strong>{formatPrice(salePrice)}</strong>
              {offer.discount_percent > 0 && <span className="page-offer-discount">-{offer.discount_percent}%</span>}
            </div>
            {offer.promo_code && <button className="page-offer-code" type="button" onClick={() => copyCode(offer)}>
              <span>Código: <strong>{offer.promo_code}</strong></span><Icon name={copiedId === offer.id ? "check" : "copy"} size={15} />
              <small>{copiedId === offer.id ? "Copiado" : "Copiar"}</small>
            </button>}
            {offer.expires_at && <small className="muted">Válido até {new Date(offer.expires_at).toLocaleDateString("pt-PT", { timeZone: "Africa/Luanda" })}</small>}
            <small className="muted">Compra e pagamento fora do Tchilar.</small>
          </div>
          <div className="page-offer-actions">
            {page.whatsapp && <a className="btn whatsapp-order" href={whatsappOrderUrl(page, offer, salePrice)} target="_blank" rel="noopener noreferrer">
              <Icon name="messages" size={15} /> Encomendar pelo WhatsApp</a>}
            {offer.checkout_url && <a className={`btn${page.whatsapp ? " secondary" : ""}`} href={offer.checkout_url} target="_blank" rel="noopener noreferrer"><Icon name="externalLink" size={15} /> {page.whatsapp ? "Site" : "Comprar/contactar"}</a>}
            {ownsPage && <button className="btn secondary danger-text icon-only" type="button" aria-label={`Remover ${offer.title}`} title="Remover" onClick={() => deleteOffer(offer)}><Icon name="trash" size={16} /></button>}
          </div>
        </article>;
      })}</div>}
    </>}
  </section>;
}

export function Pages() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [pages, setPages] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingAbout, setEditingAbout] = useState(false);
  const [tab, setTab] = useState("discover");
  const [startingLive, setStartingLive] = useState(false);
  const [pageLive, setPageLive] = useState(null);
  const [imageBusy, setImageBusy] = useState("");
  const [logoEditor, setLogoEditor] = useState(null);
  const [logoEditorError, setLogoEditorError] = useState("");
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const [coverEditor, setCoverEditor] = useState(null);
  const [coverEditorError, setCoverEditorError] = useState("");
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");   // categoria (área de atividade)
  const [category, setCategory] = useState("");       // subcategoria
  const [section, setSection] = useState("posts");    // separador da página individual
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const page = pages?.find(item => String(item.id) === pageId);
  const ownsPage = Boolean(page && user && page.owner_username === user.username);
  const logoInput = useRef(null);
  const coverInput = useRef(null);
  const logoMenuRef = useRef(null);
  const coverMenuRef = useRef(null);
  const moreMenuRef = useRef(null);
  const closeLogoMenu = useCallback(() => setLogoMenuOpen(false), []);
  const closeCoverMenu = useCallback(() => setCoverMenuOpen(false), []);
  const closeMoreMenu = useCallback(() => setMoreMenuOpen(false), []);
  useDismiss(logoMenuRef, logoMenuOpen, closeLogoMenu);
  useDismiss(coverMenuRef, coverMenuOpen, closeCoverMenu);
  useDismiss(moreMenuRef, moreMenuOpen, closeMoreMenu);
  useEffect(() => {
    setSection(new URLSearchParams(window.location.search).has("pagamento") ? "verification" : "posts");
    setMoreMenuOpen(false);
  }, [pageId]);
  useEffect(() => { if (section === "offers" && page && !page.shop_enabled) setSection("posts"); }, [section, page]);

  // Partilhar: a folha do sistema no telemóvel; no computador, copia o link.
  const sharePage = async () => {
    const url = `${PUBLIC_URL}/pages/${page.id}`;
    try {
      if (navigator.share) await navigator.share({ title: page.name, text: page.description || `${page.name} no Tchilar`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), 2000);
      }
    } catch (shareError) {
      if (shareError?.name !== "AbortError") setError("Não foi possível partilhar. Copia o endereço da barra do browser.");
    }
  };
  const openSection = id => {
    setSection(id);
    window.requestAnimationFrame(() => document.getElementById("pg-content")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const loadPages = async () => {
    try {
      const result = await api("/pages");
      setPages(result.pages);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadPages(); }, [user?.id]);
  useEffect(() => {
    setPosts(null);
    if (!pageId) return;
    api(`/posts?pageId=${encodeURIComponent(pageId)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));
    window.scrollTo(0, 0);
  }, [pageId]);
  useEffect(() => {
    setPageLive(null);
    if (!pageId) return;
    api(`/lives?pageId=${encodeURIComponent(pageId)}`).then(result => setPageLive(result.lives[0] || null)).catch(loadError => setError(loadError.message));
  }, [pageId]);

  // Seguir/deixar de seguir muda logo no ecrã; se o servidor falhar, volta atrás.
  const setFollowing = async (target, following) => {
    setError("");
    const apply = (value, delta) => setPages(current => current.map(item => item.id === target.id
      ? { ...item, is_following: value, follower_count: item.follower_count + delta } : item));
    apply(following, following ? 1 : -1);
    try {
      await api(`/pages/${target.id}/follow`, { method: following ? "POST" : "DELETE" });
    } catch (followError) {
      apply(!following, following ? -1 : 1);
      setError(followError.message);
    }
  };

  const deletePage = async () => {
    if (!window.confirm(`Apagar a página «${page.name}» e todas as publicações dela? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api(`/pages/${page.id}`, { method: "DELETE" });
      setPages(current => current.filter(item => item.id !== page.id));
      navigate("/pages");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };

  const reloadPosts = () => api(`/posts?pageId=${page.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));
  const pickPageLogo = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Escolhe um ficheiro de imagem.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLogoEditor({ src: objectUrl, objectUrl });
    setLogoEditorError("");
  };
  const openLogoPicker = () => {
    closeLogoMenu();
    logoInput.current?.click();
  };
  const pickPageCover = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Escolhe um ficheiro de imagem.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setCoverEditor({ src: objectUrl, objectUrl, file });
    setCoverEditorError("");
  };
  const openCoverPicker = () => {
    closeCoverMenu();
    coverInput.current?.click();
  };
  const editCurrentCover = () => {
    closeCoverMenu();
    setCoverEditor({ src: `${API_BASE}${page.cover_url}` });
    setCoverEditorError("");
  };
  const closeCoverEditor = () => {
    if (coverEditor?.objectUrl) URL.revokeObjectURL(coverEditor.objectUrl);
    setCoverEditor(null);
    setCoverEditorError("");
  };
  const savePageCover = async position => {
    setImageBusy("cover");
    setCoverEditorError("");
    try {
      let result;
      if (coverEditor.file) {
        const body = new FormData();
        body.append("image", await downscaleImage(coverEditor.file, 1920, 6000));
        body.append("position", String(position));
        result = await api(`/pages/${page.id}/cover`, { method: "POST", body });
      } else {
        result = await api(`/pages/${page.id}/cover-position`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position })
        });
      }
      setPages(current => current.map(item => item.id === page.id ? {
        ...item,
        ...(coverEditor.file && { cover_url: result.url }),
        cover_position: result.position ?? position
      } : item));
      closeCoverEditor();
    } catch (saveError) {
      setCoverEditorError(saveError.message);
    } finally {
      setImageBusy("");
    }
  };
  const removePageCover = async () => {
    closeCoverMenu();
    if (!window.confirm("Remover a capa desta página?")) return;
    setImageBusy("cover");
    setError("");
    try {
      await api(`/pages/${page.id}/cover`, { method: "DELETE" });
      setPages(current => current.map(item => item.id === page.id ? { ...item, cover_url: "", cover_position: 50 } : item));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setImageBusy("");
    }
  };
  const editCurrentLogo = () => {
    closeLogoMenu();
    setLogoEditor({ src: `${API_BASE}${page.logo_url}` });
    setLogoEditorError("");
  };
  const removePageLogo = async () => {
    closeLogoMenu();
    if (!window.confirm("Remover a foto de perfil desta página?")) return;
    setImageBusy("logo");
    setError("");
    try {
      await api(`/pages/${page.id}/logo`, { method: "DELETE" });
      setPages(current => current.map(item => item.id === page.id ? { ...item, logo_url: "" } : item));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setImageBusy("");
    }
  };
  const closeLogoEditor = () => {
    if (logoEditor?.objectUrl) URL.revokeObjectURL(logoEditor.objectUrl);
    setLogoEditor(null);
    setLogoEditorError("");
  };
  const savePageLogo = async file => {
    setImageBusy("logo");
    setLogoEditorError("");
    try {
      const body = new FormData();
      body.append("image", file);
      const result = await api(`/pages/${page.id}/logo`, { method: "POST", body });
      setPages(current => current.map(item => item.id === page.id ? { ...item, logo_url: result.url } : item));
      closeLogoEditor();
    } catch (uploadError) {
      setLogoEditorError(uploadError.message);
    } finally {
      setImageBusy("");
    }
  };
  // ----- Página individual -----
  if (pageId) {
    if (!pages && !error) return <div className="pg-detail"><div className="pg-hero is-skeleton"><div className="pg-hero-cover" /><div className="pg-hero-main"><span className="pg-skeleton-line" /></div></div></div>;
    if (!page) return <div className="pg-detail"><div className="pg-empty">
      <span className="pg-empty-icon" aria-hidden="true"><Icon name="pages" size={22} /></span>
      <h3>Esta página não existe</h3><p>Pode ter sido apagada ou o link estar errado.</p>
      <Link className="btn secondary" to="/pages">Ver todas as páginas</Link>
    </div></div>;
    const tone = pageTone(page.category);
    const contacts = pageContacts(page);
    const aboutText = page.about || page.description || "";
    return <div className="pg-detail">
      <Link className="pg-back" to="/pages"><Icon name="previous" size={16} /> Páginas</Link>
      <section className="pg-hero">
        <div className={`pg-hero-cover tone-page-${tone}`} ref={coverMenuRef}>
          <PageCover page={page} lazy={false} />
          {pageLive && <Link className="pg-live-pill" to={`/live/${pageLive.id}`}><span aria-hidden="true" /> Em direto agora</Link>}
          {ownsPage && <>
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={pickPageCover} />
            <button className="photo-change photo-change-cover page-cover-edit-btn" type="button" aria-label="Editar capa da página" disabled={Boolean(imageBusy)} aria-haspopup={page.cover_url ? "menu" : undefined} aria-expanded={page.cover_url ? coverMenuOpen : undefined} onClick={() => page.cover_url ? setCoverMenuOpen(open => !open) : openCoverPicker()}>
              <Icon name="camera" size={15} /><span>{imageBusy === "cover" ? "A carregar..." : "Editar capa"}</span>
            </button>
            {coverMenuOpen && <div className="post-menu-list photo-menu page-cover-menu" role="menu">
              <button type="button" role="menuitem" onClick={openCoverPicker}><Icon name="image" size={15} /> Carregar nova capa</button>
              <button type="button" role="menuitem" onClick={editCurrentCover}><Icon name="move" size={15} /> Posicionar capa</button>
              <button type="button" role="menuitem" className="danger" onClick={removePageCover}><Icon name="trash" size={15} /> Remover capa</button>
            </div>}
          </>}
        </div>
        <div className="pg-hero-main">
          {ownsPage
            ? <div className="page-logo-edit-wrap pg-hero-logo" ref={logoMenuRef}>
              <PageLogo page={page} size="large" />
              <input ref={logoInput} type="file" accept="image/*" hidden onChange={pickPageLogo} />
              <button className="photo-change photo-change-avatar page-logo-edit-btn" type="button" aria-label={imageBusy === "logo" ? "A carregar foto da página" : "Mudar foto de perfil da página"} title="Mudar foto de perfil" disabled={Boolean(imageBusy)} aria-haspopup={page.logo_url ? "menu" : undefined} aria-expanded={page.logo_url ? logoMenuOpen : undefined} onClick={() => page.logo_url ? setLogoMenuOpen(open => !open) : openLogoPicker()}>
                <Icon name="camera" size={15} />
              </button>
              {logoMenuOpen && <div className="post-menu-list photo-menu" role="menu">
                <button type="button" role="menuitem" onClick={openLogoPicker}><Icon name="image" size={15} /> Carregar nova foto</button>
                <button type="button" role="menuitem" onClick={editCurrentLogo}><Icon name="create" size={15} /> Editar foto atual</button>
                <button type="button" role="menuitem" className="danger" onClick={removePageLogo}><Icon name="trash" size={15} /> Remover foto</button>
              </div>}
            </div>
            : <div className="pg-hero-logo"><PageLogo page={page} size="large" /></div>}
          <div className="pg-hero-id">
            <h1>{page.name}<OfficialPageBadge show={page.is_official} tier={page.verification_tier} /></h1>
            <BusinessBadge page={page} />
            <PageKind page={page} />
            <PageStats page={page} since />
          </div>
          <div className="pg-hero-actions">
            {ownsPage
              ? <>
                {pageLive
                  ? <Link className="btn" to={`/live/${pageLive.id}`}><Icon name="live" size={15} /> Voltar ao direto</Link>
                  : <button className="btn" type="button" onClick={() => setStartingLive(true)}><Icon name="live" size={15} /> Iniciar direto</button>}
                <button className="btn secondary" type="button" onClick={() => setEditingAbout(true)}><Icon name="create" size={15} /> Editar</button>
              </>
              : <>
                <FollowPageButton page={page} user={user} busy={busy} onFollow={item => setFollowing(item, true)} onUnfollow={item => setFollowing(item, false)} />
                {pageLive && <Link className="btn secondary" to={`/live/${pageLive.id}`}><Icon name="live" size={15} /> Ver direto</Link>}
              </>}
            <button className="btn secondary icon-only" type="button" onClick={sharePage} aria-label={shared ? "Link copiado" : "Partilhar página"} title={shared ? "Link copiado" : "Partilhar"}>
              <Icon name={shared ? "check" : "share"} size={16} />
            </button>
            {ownsPage && <div className="pg-more" ref={moreMenuRef}>
              <button className="btn secondary icon-only" type="button" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen(open => !open)}>
                <Icon name="more" size={16} />
              </button>
              {moreMenuOpen && <div className="post-menu-list pg-more-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { closeMoreMenu(); setEditingAbout(true); }}><Icon name="info" size={15} /> Editar informações</button>
                <button type="button" role="menuitem" onClick={() => { closeMoreMenu(); openCoverPicker(); }}><Icon name="image" size={15} /> Mudar capa</button>
                <button type="button" role="menuitem" onClick={() => { closeMoreMenu(); openLogoPicker(); }}><Icon name="camera" size={15} /> Mudar foto de perfil</button>
                <button type="button" role="menuitem" onClick={() => { closeMoreMenu(); openSection("verification"); }}><Icon name="verified" size={15} /> {page.verification_tier ? "Verificação da página" : "Verificar página"}</button>
                {page.is_official
                  ? <span className="pg-more-note">Página oficial: gerida pela equipa Tchilar</span>
                  : <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => { closeMoreMenu(); deletePage(); }}><Icon name="trash" size={15} /> Apagar página</button>}
              </div>}
            </div>}
          </div>
        </div>
        <nav className="pg-tabs" role="tablist" aria-label="Secções da página">
          {[...pageSections(page), ...(ownsPage ? OWNER_SECTIONS : [])].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} aria-controls="pg-content" onClick={() => setSection(id)}>{label}</button>)}
        </nav>
      </section>
      {editingAbout && <PageAboutEditor page={page} onClose={() => setEditingAbout(false)} onSaved={updated => {
        setPages(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
      }} />}
      {logoEditor && <AvatarEditor src={logoEditor.src} busy={imageBusy === "logo"} error={logoEditorError} onSave={savePageLogo} onCancel={closeLogoEditor} />}
      {coverEditor && <CoverEditor src={coverEditor.src} initialPosition={page.cover_position} busy={imageBusy === "cover"} error={coverEditorError} onSave={savePageCover} onCancel={closeCoverEditor} />}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="pg-layout">
        <aside className="pg-side">
          {ownsPage && <PageSetupCard page={page} actions={{
            logo: openLogoPicker, cover: openCoverPicker, about: () => setEditingAbout(true), post: () => openSection("posts")
          }} />}
          <section className="pg-side-card" aria-labelledby="pg-side-about">
            <div className="pg-panel-head">
              <h2 id="pg-side-about">Sobre</h2>
              {section !== "about" && <button type="button" className="pg-link-button" onClick={() => openSection("about")}>Ver tudo</button>}
            </div>
            {aboutText
              ? <p className="pg-side-copy">{aboutText}</p>
              : <p className="muted">{ownsPage ? "Ainda não escreveste sobre a página." : "Sem descrição."}</p>}
            {contacts.length > 0 && <ContactList items={contacts.slice(0, 3)} />}
          </section>
          <section className="pg-side-card" aria-labelledby="pg-side-facts">
            <div className="pg-panel-head"><h2 id="pg-side-facts">Informações</h2></div>
            <PageFacts page={page} />
          </section>
        </aside>
        <PageWorkspace page={page} ownsPage={ownsPage} section={section} posts={posts} reloadPosts={() => { reloadPosts(); loadPages(); }}
          setError={setError} onEditAbout={() => setEditingAbout(true)} />
      </div>
      {startingLive && <StartLiveDialog pageId={page.id} pageName={page.name} onClose={() => setStartingLive(false)} />}
    </div>;
  }

  // ----- Lista de páginas -----
  const all = pages || [];
  const mine = all.filter(item => user && item.owner_username === user.username);
  const followed = all.filter(item => item.is_following && !(user && item.owner_username === user.username));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["mine", "As tuas páginas", mine.length], ["following", "A seguir", followed.length]] : [])];
  const source = tab === "mine" ? mine : tab === "following" ? followed : all;
  // Filtro por categoria e, dentro dela, por subcategoria. Só aparecem as que têm pelo menos uma página.
  const typesInUse = PAGE_CATEGORIES.filter(area => all.some(item => item.category === area.key));
  const categoriesInUse = typeFilter
    ? pageCategory(typeFilter).subcategories.filter(sub => all.some(p => p.category === typeFilter && p.subcategory === sub.key)) : [];
  const chooseTypeFilter = key => { setTypeFilter(typeFilter === key ? "" : key); setCategory(""); };
  const term = query.trim().toLowerCase();
  const visible = source.filter(item => (!typeFilter || item.category === typeFilter) && (!category || item.subcategory === category)
    && (!term || `${item.name} ${item.description} ${pageCategoryPath(item)} ${pageType(item.page_type).label} ${item.owner_name}`.toLowerCase().includes(term)));

  const follow = target => setFollowing(target, true);
  const unfollow = target => setFollowing(target, false);
  // Em "Descobrir", sem pesquisa nem filtro: a página oficial em destaque e as tuas páginas num atalho.
  const browsing = tab === "discover" && !term && !typeFilter;
  const featured = browsing ? all.find(item => item.is_official) : null;
  const gridPages = featured ? visible.filter(item => item.id !== featured.id) : visible;
  const resetFilters = () => { setQuery(""); setTypeFilter(""); setCategory(""); };
  const gridTitle = tab === "mine" ? "As tuas páginas" : tab === "following" ? "Páginas que segues"
    : typeFilter ? pageCategory(typeFilter)?.label || "Páginas" : term ? "Resultados" : "Todas as páginas";

  return <div className="pg-index">
    <header className="pg-index-head">
      <div>
        <h1>Páginas</h1>
        <p>Negócios, artistas e projetos da tua comunidade. Segue os que gostas ou cria a tua.</p>
      </div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar página</button>
        : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pg-toolbar">
      <div className="pg-segmented" role="tablist" aria-label="Que páginas mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pg-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar por nome, tipo ou categoria" aria-label="Procurar páginas" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {typesInUse.length > 1 && <div className="pg-chips" role="group" aria-label="Categorias">
      <button type="button" className="pg-chip" aria-pressed={!typeFilter} onClick={() => chooseTypeFilter("")}>Todas</button>
      {typesInUse.map(type => <button key={type.key} type="button" className="pg-chip" aria-pressed={typeFilter === type.key} onClick={() => chooseTypeFilter(type.key)}>
        <Icon name={type.icon} size={14} /> {type.label}</button>)}
    </div>}
    {categoriesInUse.length > 1 && <div className="pg-chips is-sub" role="group" aria-label="Subcategorias">
      {categoriesInUse.map(item => <button key={item.key} type="button" className="pg-chip" aria-pressed={category === item.key} onClick={() => setCategory(category === item.key ? "" : item.key)}>{item.label}</button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!pages && !error && <div className="pg-grid" aria-busy="true" aria-label="A carregar páginas">
      {[0, 1, 2].map(item => <div key={item} className="pg-card is-skeleton"><span className="pg-card-cover" /><span className="pg-skeleton-line" /><span className="pg-skeleton-line short" /></div>)}
    </div>}
    {featured && <FeaturedPage page={featured} user={user} busy={busy} onFollow={follow} onUnfollow={unfollow} />}
    {browsing && mine.length > 0 && <MyPagesStrip pages={mine} onSeeAll={() => setTab("mine")} />}
    {pages && !visible.length && <div className="pg-empty">
      {tab === "mine" && !term && !typeFilter
        ? <><span className="pg-empty-icon" aria-hidden="true"><Icon name="pages" size={22} /></span><h3>Ainda não tens páginas</h3>
          <p>Uma página dá ao teu negócio, projeto ou arte um espaço próprio, com publicações, eventos, loja e diretos.</p>
          <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar a primeira página</button></>
        : tab === "following" && !term && !typeFilter
          ? <><span className="pg-empty-icon" aria-hidden="true"><Icon name="heart" size={22} /></span><h3>Ainda não segues páginas</h3>
            <p>Quando seguires uma página, as publicações dela aparecem no teu feed.</p>
            <button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir páginas</button></>
          : <><span className="pg-empty-icon" aria-hidden="true"><Icon name="search" size={22} /></span><h3>Nenhuma página encontrada</h3>
            <p>Experimenta outro nome ou outra categoria.</p>
            <button className="btn secondary" type="button" onClick={resetFilters}>Limpar pesquisa</button></>}
    </div>}
    {gridPages.length > 0 && <section aria-labelledby="pg-grid-title">
      <div className="pg-section-head"><h2 id="pg-grid-title">{gridTitle}</h2><span className="pg-count">{gridPages.length}</span></div>
      <div className="pg-grid">{gridPages.map(item => <PageCard key={item.id} page={item} user={user} busy={busy} onFollow={follow} onUnfollow={unfollow} />)}</div>
    </section>}
    {creating && <CreatePageDialog onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadPages().then(() => navigate(`/pages/${created.id}`)); }} />}
  </div>;
}
