import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon, UserContext, api, formatCount } from "./core.jsx";
import { SHORT_MONTHS } from "./shared.jsx";

// ----- Eventos -----
export const eventDay = value => new Date(value).toLocaleDateString("pt-PT", { day: "2-digit" });
export const eventMonth = value => SHORT_MONTHS[new Date(value).getMonth()];
export const eventWhen = value => new Date(value).toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
export function EventDate({ value }) {
  return <span className="event-date-tile" aria-hidden="true"><strong>{eventDay(value)}</strong><small>{eventMonth(value)}</small></span>;
}
export function CreateEventDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", startsAt: "", location: "", description: "" });
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
      await api("/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated();
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const minDate = new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-event-title">Criar evento</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Feira de artesanato no Benfica" /></label>
          <label>Quando<input required type="datetime-local" min={minDate} value={form.startsAt} onChange={event => setForm({ ...form, startsAt: event.target.value })} /></label>
          <label>Onde<input maxLength={160} value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Ex.: Mercado do Benfica, Luanda" /></label>
          <label>Detalhes <small>{form.description.length}/2000</small><textarea rows={3} maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="O que vai acontecer e o que as pessoas devem levar." /></label>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="event-card card is-preview">
            {form.startsAt ? <EventDate value={form.startsAt} /> : <span className="event-date-tile" aria-hidden="true"><strong>--</strong><small>mês</small></span>}
            <div className="event-card-body"><strong>{form.name || "Nome do evento"}</strong><small>{form.startsAt ? eventWhen(form.startsAt) : "Data e hora"}</small>{form.location && <small><Icon name="location" size={13} /> {form.location}</small>}</div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.startsAt}>{busy ? "A criar..." : "Criar evento"}</button>
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
    if (!window.confirm(`Apagar o evento «${item.name}»? Os participantes deixam de o ver.`)) return;
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
      <EventDate value={item.starts_at} />
      <div className="event-card-body">
        <h2>{item.name}</h2>
        <small><Icon name="events" size={13} /> {eventWhen(item.starts_at)}</small>
        {item.location && <small><Icon name="location" size={13} /> {item.location}</small>}
        {item.description && <p>{item.description}</p>}
        <small className="event-meta">{formatCount(item.attendee_count)} {item.attendee_count === 1 ? "pessoa vai" : "pessoas vão"} · organizado por <Link to={`/u/${item.creator_username}`}>{item.creator_name}</Link></small>
      </div>
      {user && <div className="event-card-actions">
        <button className={`btn${item.is_attending ? " secondary page-following" : ""}`} type="button" aria-pressed={item.is_attending} onClick={() => toggleRsvp(item)}>
          {item.is_attending ? <><Icon name="check" size={15} /><span className="when-idle">Vou</span><span className="when-hover">Já não vou</span></> : <><Icon name="plus" size={15} /> Vou participar</>}
        </button>
        {String(item.creator_id) === String(user.id) && <button className="btn secondary danger-text icon-only" type="button" aria-label={`Apagar ${item.name}`} title="Apagar" onClick={() => deleteEvent(item)}><Icon name="trash" size={16} /></button>}
      </div>}
    </article>)}</div>}
    {creating && <CreateEventDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("mine"); load(); }} />}
  </div>;
}
