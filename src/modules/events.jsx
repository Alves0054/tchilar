import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon, UserContext, api, formatCount } from "./core.jsx";
import { downscaleImage } from "../PhotoEditors.jsx";
import { SHORT_MONTHS } from "./shared.jsx";
import { DatePicker } from "./date-picker.jsx";
import { FilePicker } from "./file-picker.jsx";
import "./events.css";

// ----- Eventos -----
export const eventDay = value => new Date(value).toLocaleDateString("pt-PT", { day: "2-digit" });
export const eventMonth = value => SHORT_MONTHS[new Date(value).getMonth()];
export const eventWhen = value => new Date(value).toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
export function EventDate({ value }) {
  return <span className="event-date-tile" aria-hidden="true"><strong>{eventDay(value)}</strong><small>{eventMonth(value)}</small></span>;
}
// Criar evento: nome, dia e hora (calendário do Tchilar), local, detalhes e imagem; ao lado, o cartaz do evento
// tal como as pessoas o vão ver.
const EVENT_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif";
// group = { id, name }: o evento é só do grupo (vai para /groups/:id/events e só os membros o veem).
export function CreateEventDialog({ onClose, onCreated, pageId, pageName, group = null }) {
  const { user } = useContext(UserContext);
  const [form, setForm] = useState({ name: "", startsAt: "", location: "", description: "" });
  // Bilhete: grátis (botão "Vou") ou pago em estrelas, com lotação opcional. Os eventos de grupos são sempre grátis.
  const [ticket, setTicket] = useState({ paid: false, stars: "50", total: "" });
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!image) {
      setImagePreview("");
      return;
    }
    const preview = URL.createObjectURL(image);
    setImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [image]);
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
      const body = new FormData();
      Object.entries({ ...form, startsAt: new Date(form.startsAt).toISOString(), ...(pageId ? { pageId } : {}),
        ...(!group && ticket.paid ? { ticketStars: ticket.stars, ...(ticket.total ? { ticketsTotal: ticket.total } : {}) } : {}) })
        .forEach(([key, value]) => body.append(key, value));
      if (image) body.append("image", await downscaleImage(image, 1600, 1200));
      await api(group ? `/groups/${group.id}/events` : "/events", { method: "POST", body });
      onCreated();
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const set = key => event => setForm({ ...form, [key]: event.target.value });
  const minDate = new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const host = pageName || group?.name || user?.display_name || user?.username || "Tu";
  const ready = form.name.trim() && form.startsAt;
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog event-dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title" onSubmit={submit}>
      <div className="event-dialog-head">
        <span className="event-dialog-badge" aria-hidden="true"><Icon name="events" size={22} /></span>
        <div>
          <h2 id="create-event-title">{group ? "Novo evento do grupo" : pageName ? "Novo evento da página" : "Criar evento"}</h2>
          <p>{group ? `Só os membros de ${group.name} o veem. Avisamos todos os membros quando o criares.`
            : pageName ? `Aparece na página ${pageName} e na lista de eventos do Tchilar.` : "Aparece na lista de eventos do Tchilar. As pessoas confirmam que vão."}</p>
        </div>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid event-dialog-grid">
        <div className="create-page-fields event-dialog-fields">
          <label className="event-field">
            <span className="event-field-label">Nome do evento <small>{form.name.length}/120</small></span>
            <input className="event-name-input" required autoFocus maxLength={120} value={form.name} onChange={set("name")}
              placeholder={group ? "Ex.: Encontro de sábado" : "Ex.: Feira de artesanato no Benfica"} />
          </label>
          <label className="event-field">
            <span className="event-field-label">Quando</span>
            <DatePicker mode="datetime" required min={minDate} value={form.startsAt} onChange={set("startsAt")} aria-label="Dia e hora do evento" />
          </label>
          <label className="event-field">
            <span className="event-field-label">Onde <small>Opcional</small></span>
            <span className="event-input-icon"><Icon name="location" size={16} />
              <input maxLength={160} value={form.location} onChange={set("location")} placeholder="Ex.: Mercado do Benfica, Luanda" /></span>
          </label>
          <label className="event-field">
            <span className="event-field-label">Detalhes <small>{form.description.length}/2000</small></span>
            <textarea rows={3} maxLength={2000} value={form.description} onChange={set("description")} placeholder="O que vai acontecer e o que as pessoas devem levar." />
          </label>
          {!group && <div className="event-field">
            <span className="event-field-label">Entrada</span>
            <div className="event-ticket-choice" role="radiogroup" aria-label="Entrada">
              <button type="button" role="radio" aria-checked={!ticket.paid} onClick={() => setTicket({ ...ticket, paid: false })}>
                <Icon name="check" size={16} /><span><b>Grátis</b><small>As pessoas carregam em «Vou»</small></span></button>
              <button type="button" role="radio" aria-checked={ticket.paid} onClick={() => setTicket({ ...ticket, paid: true })}>
                <Icon name="star" size={16} /><span><b>Bilhete pago</b><small>Em estrelas, com QR à entrada</small></span></button>
            </div>
            {ticket.paid && <div className="event-ticket-fields">
              <label>Preço (estrelas)<input type="number" min={1} max={100000} required value={ticket.stars}
                onChange={event => setTicket({ ...ticket, stars: event.target.value.replace(/\D/g, "") })} /></label>
              <label>Bilhetes <small>vazio = sem limite</small><input type="number" min={1} max={100000} value={ticket.total}
                onChange={event => setTicket({ ...ticket, total: event.target.value.replace(/\D/g, "") })} placeholder="Sem limite" /></label>
              <small className="muted">As estrelas dos bilhetes contam para os teus levantamentos, como os presentes. Se apagares o evento, voltam a quem comprou.</small>
            </div>}
          </div>}
          <div className="event-field">
            <span className="event-field-label">Imagem do evento <small>Opcional</small></span>
            <FilePicker kind="image" wide file={image} onChange={setImage} accept={EVENT_IMAGE_TYPES} maxBytes={8 * 1024 * 1024} disabled={busy}
              hint="JPEG, PNG, WebP ou GIF · até 8 MB · na horizontal fica melhor" label="Imagem do evento" />
          </div>
        </div>
        <div className="create-page-preview event-dialog-preview" aria-label="Pré-visualização">
          <small>Assim vão ver o teu evento</small>
          <article className="event-poster">
            <div className="event-poster-cover">
              {imagePreview ? <img src={imagePreview} alt="" /> : <span className="event-poster-waves" aria-hidden="true"><Icon name="events" size={30} /></span>}
              {form.startsAt ? <EventDate value={form.startsAt} /> : <span className="event-date-tile" aria-hidden="true"><strong>--</strong><small>mês</small></span>}
            </div>
            <div className="event-poster-body">
              <strong className={form.name ? "" : "is-placeholder"}>{form.name || "Nome do evento"}</strong>
              <span><Icon name="clock" size={14} /> {form.startsAt ? (when => when[0].toUpperCase() + when.slice(1))(eventWhen(form.startsAt)) : "Dia e hora"}</span>
              <span className={form.location ? "" : "is-placeholder"}><Icon name="location" size={14} /> {form.location || "Local"}</span>
              {form.description && <p>{form.description}</p>}
              <div className="event-poster-foot">
                <small>{group ? <>Evento do grupo <b>{host}</b></> : <>Organizado por <b>{host}</b></>}</small>
                <span className="event-poster-going" aria-hidden="true">{ticket.paid && !group
                  ? <><Icon name="star" size={14} /> {ticket.stars || 0} estrelas</> : <><Icon name="check" size={14} /> Vou</>}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions event-dialog-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !ready}><Icon name="events" size={16} /> {busy ? "A criar..." : "Criar evento"}</button>
      </div>
    </form>
  </div>, document.body);
}
export function Events() {
  const { user } = useContext(UserContext);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("upcoming");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setEvents((await api("/events")).events);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { load(); }, [user?.id]);

  const toggleRsvp = async item => {
    const going = !item.is_attending;
    const apply = (value, delta) => setEvents(current => current.map(event => event.id === item.id ? { ...event, is_attending: value, attendee_count: event.attendee_count + delta } : event));
    apply(going, going ? 1 : -1);
    try {
      await api(`/events/${item.id}/rsvp`, { method: "POST" });
    } catch (rsvpError) {
      apply(!going, going ? -1 : 1);
      setError(rsvpError.message);
    }
  };

  const deleteEvent = async item => {
    const refund = item.tickets_sold > 0 ? ` As estrelas dos ${item.tickets_sold} bilhetes vendidos voltam a quem comprou.` : "";
    if (!window.confirm(`Apagar o evento «${item.name}»? Os participantes deixam de o ver.${refund}`)) return;
    try {
      await api(`/events/${item.id}`, { method: "DELETE" });
      setEvents(current => current.filter(event => event.id !== item.id));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const all = events || [];
  const going = all.filter(item => item.is_attending);
  const mine = all.filter(item => user && String(item.creator_id) === String(user.id));
  const tabs = [["upcoming", "Próximos", all.length], ...(user ? [["going", "Vou", going.length], ["mine", "Organizados por ti", mine.length]] : [])];
  const visible = tab === "going" ? going : tab === "mine" ? mine : all;

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Eventos</h1><p>Descobre o que acontece perto de ti, confirma presença ou organiza o teu.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button> : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que eventos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!events && !error && <div className="empty card">A carregar eventos...</div>}
    {events && !visible.length && <div className="empty card pages-empty">
      <p>{tab === "going" ? "Ainda não confirmaste presença em nenhum evento." : tab === "mine" ? "Ainda não organizaste nenhum evento." : "Não há eventos marcados para os próximos dias."}</p>
      {user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button>}
    </div>}
    {visible.length > 0 && <div className="event-list">{visible.map(item => <article className="event-card card" key={item.id}>
      {item.image_url && <img className="event-card-cover" src={item.image_url} alt={`Imagem do evento ${item.name}`} loading="lazy" />}
      <EventDate value={item.starts_at} />
      <div className="event-card-body">
        <h2><Link to={`/events/${item.id}`}>{item.name}</Link></h2>
        <small><Icon name="events" size={13} /> {eventWhen(item.starts_at)}</small>
        {item.location && <small><Icon name="location" size={13} /> {item.location}</small>}
        {item.description && <p>{item.description}</p>}
        <small className="event-meta">{formatCount(item.attendee_count)} {item.attendee_count === 1 ? "pessoa vai" : "pessoas vão"} · organizado por {item.page_id && item.page_name
          ? <Link to={`/pages/${item.page_id}`}>{item.page_name}</Link>
          : <Link to={`/u/${item.creator_username}`}>{item.creator_name}</Link>}</small>
      </div>
      {user && <div className="event-card-actions">
        {item.ticket_stars > 0
          ? <Link className={`btn${item.my_ticket ? " secondary" : ""}`} to={`/events/${item.id}`}><Icon name="star" size={15} />
            {item.my_ticket ? " O meu bilhete" : String(item.creator_id) === String(user.id) ? " Bilhetes" : ` ${formatCount(item.ticket_stars)} estrelas`}</Link>
          : <button className={`btn${item.is_attending ? " secondary page-following" : ""}`} type="button" aria-pressed={item.is_attending} onClick={() => toggleRsvp(item)}>
            {item.is_attending ? <><Icon name="check" size={15} /><span className="when-idle">Vou</span><span className="when-hover">Já não vou</span></> : <><Icon name="plus" size={15} /> Vou participar</>}
          </button>}
        {String(item.creator_id) === String(user.id) && <button className="btn secondary danger-text icon-only" type="button" aria-label={`Apagar ${item.name}`} title="Apagar" onClick={() => deleteEvent(item)}><Icon name="trash" size={16} /></button>}
      </div>}
    </article>)}</div>}
    {creating && <CreateEventDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("mine"); load(); }} />}
  </div>;
}
