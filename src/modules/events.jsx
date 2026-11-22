import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { API_BASE, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
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
  // Bilhete: grátis (botão "Vou") ou pago com dinheiro, com lotação opcional. Os eventos de grupos são sempre grátis.
  const [ticket, setTicket] = useState({ paid: false, price: "2000", total: "" });
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
        ...(!group && ticket.paid ? { ticketPriceKz: ticket.price, ...(ticket.total ? { ticketsTotal: ticket.total } : {}) } : {}) })
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
                <Icon name="card" size={16} /><span><b>Bilhete pago</b><small>Express, Referência, PayPay... com QR à entrada</small></span></button>
            </div>
            {ticket.paid && <div className="event-ticket-fields">
              <label>Preço (Kz)<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7} required value={ticket.price}
                onChange={event => setTicket({ ...ticket, price: event.target.value.replace(/\D/g, "") })} /></label>
              <label>Bilhetes <small>{ticket.total ? `${Number(ticket.total).toLocaleString("pt-PT")} à venda` : "vazio = sem limite"}</small><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={ticket.total}
                onChange={event => setTicket({ ...ticket, total: event.target.value.replace(/\D/g, "") })} placeholder="Sem limite" /></label>
              <small className="muted">Ficas com 85% de cada bilhete ({formatPrice(Math.round(Number(ticket.price || 0) * 0.85))} por bilhete); o Tchilar fica com 15%.
                O dinheiro fica disponível para levantar 1 dia depois do evento. Se cancelares antes, devolvemos a quem comprou.</small>
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
                  ? <><Icon name="card" size={14} /> {formatPrice(Number(ticket.price || 0))}</> : <><Icon name="check" size={14} /> Vou</>}</span>
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
// ----- Agenda: eventos agrupados por dia (hora de Luanda), com filtros rápidos -----
const LUANDA = "Africa/Luanda";
const dayKey = value => new Date(value).toLocaleDateString("en-CA", { timeZone: LUANDA });
const agendaTime = value => new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LUANDA });
const kzLabel = value => `${String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kz`;
function isWeekend(value) {
  const weekday = new Date(value).toLocaleDateString("en-GB", { weekday: "short", timeZone: LUANDA });
  return ["Fri", "Sat", "Sun"].includes(weekday);
}
const withinDays = (value, days) => new Date(value).getTime() - Date.now() < days * 86400000;
export const AGENDA_FILTERS = [
  ["all", "Tudo", () => true],
  ["today", "Hoje", item => dayKey(item.starts_at) === dayKey(Date.now())],
  ["weekend", "Fim de semana", item => isWeekend(item.starts_at) && withinDays(item.starts_at, 7)],
  ["free", "Grátis", item => !(item.ticket_price_kz > 0)],
  ["paid", "Com bilhete", item => item.ticket_price_kz > 0]
];
function groupByDay(items) {
  const today = dayKey(Date.now());
  const tomorrow = dayKey(Date.now() + 86400000);
  const groups = new Map();
  for (const item of [...items].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))) {
    const key = dayKey(item.starts_at);
    if (!groups.has(key)) {
      const date = new Date(`${key}T12:00:00`);
      const weekday = `${date.toLocaleDateString("pt-PT", { weekday: "long" })} · ${date.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}`;
      groups.set(key, { key, date, weekday, title: `${weekday} ${date.getDate()}`, badge: key === today ? "Hoje" : key === tomorrow ? "Amanhã" : "", items: [] });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

export function Events() {
  const { user } = useContext(UserContext);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("upcoming");
  const [filter, setFilter] = useState("all");
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
    const refund = item.tickets_sold > 0 ? ` O dinheiro dos ${item.tickets_sold} bilhetes vendidos é devolvido a quem comprou.` : "";
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
  const inTab = tab === "going" ? going : tab === "mine" ? mine : all;
  const visible = inTab.filter(AGENDA_FILTERS.find(([id]) => id === filter)[2]);
  const days = groupByDay(visible);

  return <div className="pages-view agenda-view">
    <header className="agenda-head">
      <div>
        <p className="agenda-kicker">Agenda</p>
        <h1>Eventos</h1>
        <p>Concertos, feiras, aulas e encontros perto de ti. Confirma que vais ou compra o bilhete.</p>
      </div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button> : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="agenda-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que eventos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <div className="agenda-filters" role="group" aria-label="Filtrar">
        {AGENDA_FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!events && !error && <div className="agenda-empty">A carregar a agenda...</div>}
    {events && !visible.length && <div className="agenda-empty">
      <Icon name="events" size={28} />
      <p>{filter !== "all" ? "Nada com este filtro." : tab === "going" ? "Ainda não confirmaste presença em nenhum evento."
        : tab === "mine" ? "Ainda não organizaste nenhum evento." : "Não há eventos marcados para os próximos dias."}</p>
      {filter !== "all" ? <button className="btn secondary" type="button" onClick={() => setFilter("all")}>Ver todos</button>
        : user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar evento</button>}
    </div>}
    {days.map(day => <section className="agenda-day" key={day.key} aria-label={day.title}>
      <header className="agenda-day-rail">
        <strong>{day.date.getDate()}</strong>
        <span>{day.weekday}</span>
        {day.badge && <em>{day.badge}</em>}
      </header>
      <div className="agenda-items">{day.items.map(item => {
        const owner = user && String(item.creator_id) === String(user.id);
        const host = item.page_id && item.page_name ? { to: `/pages/${item.page_id}`, name: item.page_name } : { to: `/u/${item.creator_username}`, name: item.creator_name };
        const paid = item.ticket_price_kz > 0;
        const myTickets = item.my_tickets?.length || 0;
        const left = paid && item.tickets_total ? Math.max(0, item.tickets_total - item.tickets_sold) : null;
        return <article className="agenda-item" key={item.id}>
          <Link className="agenda-poster" to={`/events/${item.id}`} tabIndex={-1} aria-hidden="true">
            {item.image_url ? <img src={`${API_BASE}${item.image_url}`} alt="" loading="lazy" />
              : <span className={`agenda-poster-blank tone-${item.id % 4}`}><b>{(item.name.match(/[\p{L}\p{N}]/u) || ["•"])[0].toUpperCase()}</b></span>}
          </Link>
          <div className="agenda-body">
            <p className="agenda-when"><b>{agendaTime(item.starts_at)}</b>{item.location && <> · {item.location}</>}</p>
            <h2><Link to={`/events/${item.id}`}>{item.name}</Link></h2>
            <p className="agenda-host">por <Link to={host.to}>{host.name}</Link></p>
            <p className="agenda-facts">
              <span className={`agenda-price${paid ? "" : " is-free"}`}>{paid ? kzLabel(item.ticket_price_kz) : "Grátis"}</span>
              <span>{formatCount(item.attendee_count)} {item.attendee_count === 1 ? "vai" : "vão"}</span>
              {left !== null && left <= 50 && <span className="agenda-left">{left ? `Últimos ${left}` : "Esgotado"}</span>}
            </p>
          </div>
          {user && <div className="agenda-actions">
            {paid
              ? <Link className={`btn${myTickets || owner ? " secondary" : ""}`} to={`/events/${item.id}`}>
                {myTickets ? (myTickets === 1 ? "O meu bilhete" : `${myTickets} bilhetes`) : owner ? "Bilhetes" : "Comprar"}</Link>
              : !owner && <button className={`btn${item.is_attending ? " secondary page-following" : ""}`} type="button" aria-pressed={item.is_attending} onClick={() => toggleRsvp(item)}>
                {item.is_attending ? <><Icon name="check" size={15} /><span className="when-idle">Vou</span><span className="when-hover">Já não vou</span></> : "Vou"}
              </button>}
            {owner && <button className="btn secondary danger-text icon-only" type="button" aria-label={`Apagar ${item.name}`} title="Apagar" onClick={() => deleteEvent(item)}><Icon name="trash" size={16} /></button>}
          </div>}
        </article>;
      })}</div>
    </section>)}
    {creating && <CreateEventDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("mine"); load(); }} />}
  </div>;
}
