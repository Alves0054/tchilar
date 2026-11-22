import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DatePicker } from "./date-picker.jsx";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, token } from "./core.jsx";
import { PaymentDialog } from "./shared.jsx";
import "./events.css";

// Página de um evento (estilo da agenda): capa limpa, data e hora em destaque, factos com ícones e, ao lado,
// a caixa do bilhete (preço, lugares, quantidade, comprar). Quem organiza vê o painel "Bilhetes à entrada".
// O QR leva /events/:id?checkin=CÓDIGO: quem organiza aponta a câmara e o bilhete fica validado aqui.

const MAX_PER_ORDER = 10;
const LUANDA = "Africa/Luanda";
const kzLabel = value => `${String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Kz`;
const countLabel = value => String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
function whenParts(value) {
  const date = new Date(value);
  return {
    weekday: date.toLocaleDateString("pt-PT", { weekday: "long", timeZone: LUANDA }),
    day: date.toLocaleDateString("pt-PT", { day: "numeric", month: "long", timeZone: LUANDA }),
    short: `${date.toLocaleDateString("pt-PT", { weekday: "long", timeZone: LUANDA }).split("-")[0]} ${date.toLocaleDateString("pt-PT", { day: "numeric", timeZone: LUANDA })} ${date.toLocaleDateString("pt-PT", { month: "short", timeZone: LUANDA }).replace(".", "")}`,
    time: date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LUANDA })
  };
}
// "Começa hoje às 18:00", "Começa amanhã às 21:00", "Faltam 5 dias", "A decorrer" (até 6 h depois do início).
function countdown(value) {
  const start = new Date(value).getTime();
  const now = Date.now();
  const time = new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LUANDA });
  if (now >= start) return now - start < 6 * 3600000 ? "A decorrer agora" : null;
  const day = key => new Date(key).toLocaleDateString("en-CA", { timeZone: LUANDA });
  if (day(start) === day(now)) return start - now < 3600000 ? `Começa daqui a ${Math.max(1, Math.round((start - now) / 60000))} min` : `Começa hoje às ${time}`;
  if (day(start) === day(now + 86400000)) return `Começa amanhã às ${time}`;
  const days = Math.ceil((start - now) / 86400000);
  return days <= 30 ? `Faltam ${days} dias` : null;
}
// Ficheiro .ics: o evento entra no calendário do telemóvel ou do computador (2 h de duração por omissão).
function downloadCalendar(event) {
  const stamp = date => new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escapeIcs = text => String(text || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
  const start = new Date(event.starts_at);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tchilar//Eventos//PT", "BEGIN:VEVENT",
    `UID:tchilar-event-${event.id}@tchilar.ao`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(start.getTime() + 2 * 3600000)}`,
    `SUMMARY:${escapeIcs(event.name)}`, event.location ? `LOCATION:${escapeIcs(event.location)}` : null,
    `DESCRIPTION:${escapeIcs(`${event.description || ""}\n\n${window.location.origin}/events/${event.id}`)}`,
    `URL:${window.location.origin}/events/${event.id}`, "END:VEVENT", "END:VCALENDAR"
  ].filter(Boolean);
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${event.name.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60) || "evento"}.ics` });
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const mapsUrl = place => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

// Data no formato do campo (hora local do aparelho), como no Criar evento.
const localInput = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// Editar o evento (quem organiza). Mudar a data ou o local avisa quem vai e quem tem bilhete.
function EditEventDialog({ event, onClose, onSaved }) {
  const [form, setForm] = useState({ name: event.name, startsAt: localInput(event.starts_at), location: event.location || "", description: event.description || "",
    ticketsTotal: event.tickets_total ? String(event.tickets_total) : "",
    sellerName: event.seller_name || "", sellerNif: event.seller_nif || "", sellerAddress: event.seller_address || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = key => changeEvent => setForm(current => ({ ...current, [key]: changeEvent.target.value }));
  const paid = event.ticket_price_kz > 0;
  const save = async submitEvent => {
    submitEvent.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api(`/events/${event.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: form.name, location: form.location, description: form.description, startsAt: new Date(form.startsAt).toISOString(),
        ...(paid ? { ticketsTotal: form.ticketsTotal ? Number(form.ticketsTotal) : null,
          sellerName: form.sellerName, sellerNif: form.sellerNif, sellerAddress: form.sellerAddress } : {})
      }) });
      onSaved(result.notified);
    } catch (saveError) { setError(saveError.message); setBusy(false); }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={mouseEvent => { if (mouseEvent.target === mouseEvent.currentTarget && !busy) onClose(); }}>
    <form className="modal card evp-edit" role="dialog" aria-modal="true" aria-labelledby="evp-edit-title" onSubmit={save}>
      <div className="share-dialog-head"><h2 id="evp-edit-title">Editar evento</h2>
        <button className="round-button" type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
      <label>Nome<input required maxLength={120} value={form.name} onChange={set("name")} /></label>
      <label>Quando<DatePicker mode="datetime" required value={form.startsAt} onChange={set("startsAt")} aria-label="Dia e hora do evento" /></label>
      <label>Onde<input maxLength={160} value={form.location} onChange={set("location")} placeholder="Ex.: Cine Atlântico, Luanda" /></label>
      <label>Detalhes<textarea rows={4} maxLength={2000} value={form.description} onChange={set("description")} /></label>
      {paid && <label>Bilhetes à venda <small>vazio = sem limite</small>
        <input type="text" inputMode="numeric" maxLength={6} value={form.ticketsTotal} onChange={changeEvent => setForm(current => ({ ...current, ticketsTotal: changeEvent.target.value.replace(/\D/g, "") }))} /></label>}
      {paid && <>
        <label>Quem vende (empresa ou o teu nome)<input required maxLength={160} value={form.sellerName} onChange={set("sellerName")} /></label>
        <label>NIF de quem vende<input required maxLength={20} value={form.sellerNif} onChange={changeEvent => setForm(current => ({ ...current, sellerNif: changeEvent.target.value.toUpperCase() }))} /></label>
        <label>Morada <small>opcional</small><input maxLength={240} value={form.sellerAddress} onChange={set("sellerAddress")} /></label>
      </>}
      <p className="evp-muted">Se mudares a data ou o local, avisamos quem vai e quem tem bilhete. O preço não muda depois de haver vendas.
        Os recibos já emitidos ficam com os dados de quem vendia na altura.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.startsAt}>{busy ? "A guardar..." : "Guardar"}</button>
      </div>
    </form>
  </div>, document.body);
}

function TicketQr({ eventId, code }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    let alive = true;
    fetch(`${API_BASE}/api/events/${eventId}/tickets/mine/qr?code=${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(response => (response.ok ? response.blob() : null))
      .then(blob => { if (blob && alive) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [eventId, code]);
  return src ? <img className="ticket-qr" src={src} alt="QR do bilhete" /> : <div className="ticket-qr is-loading" aria-hidden="true" />;
}

// Barra de vendas: quanto já foi vendido da lotação.
function SoldBar({ sold, total }) {
  if (!total) return null;
  const percent = Math.min(100, Math.round((sold / total) * 100));
  return <div className="evp-bar" role="img" aria-label={`${percent}% vendido`}><span style={{ width: `${Math.max(percent, sold ? 2 : 0)}%` }} /></div>;
}

function OrganizerTickets({ event, autoCode }) {
  const [data, setData] = useState(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/events/${event.id}/tickets`).then(setData).catch(() => {});
  const checkIn = async value => {
    setBusy(true); setResult(null);
    try {
      const response = await api(`/events/${event.id}/check-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: value }) });
      setResult({ ok: true, person: response.person, of: response.of });
      setCode("");
      load();
    } catch (checkError) {
      setResult({ ok: false, message: checkError.message });
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [event.id]);
  useEffect(() => { if (autoCode) checkIn(autoCode); }, [autoCode]);
  return <section className="evp-panel">
    <div className="evp-panel-head">
      <div><h2>Bilhetes à entrada</h2>
        <p>Na app, abre o evento e usa «Ler bilhetes à entrada». Aqui podes escrever o código, ou apontar a câmara do telemóvel ao QR.</p></div>
    </div>
    {data && <div className="evp-stats">
      <div className="evp-stat is-wide">
        <span>Vendidos</span>
        <strong>{countLabel(data.sold)}{data.total ? <small> / {countLabel(data.total)}</small> : null}</strong>
        <SoldBar sold={data.sold} total={data.total} />
      </div>
      <div className="evp-stat"><span>Já entraram</span><strong>{countLabel(data.checked_in)}</strong></div>
      <div className="evp-stat"><span>Vendas</span><strong>{kzLabel(data.gross_kz)}</strong></div>
      <div className="evp-stat is-money"><span>Para ti (85%)</span><strong>{kzLabel(data.net_kz)}</strong><small>Disponível 1 dia depois do evento</small></div>
    </div>}
    <form className="evp-checkin" onSubmit={submitEvent => { submitEvent.preventDefault(); checkIn(code); }}>
      <Icon name="lock" size={18} />
      <input value={code} onChange={changeEvent => setCode(changeEvent.target.value.toUpperCase())} maxLength={16} placeholder="Código do bilhete" aria-label="Código do bilhete" />
      <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>{busy ? "A validar..." : "Validar"}</button>
    </form>
    {result && <p className={`ticket-checkin-result ${result.ok ? "is-ok" : "is-bad"}`} role="status">
      <Icon name={result.ok ? "check" : "close"} size={18} />
      {result.ok ? <>Pode entrar: <strong>{result.person.display_name}</strong> (@{result.person.username}){result.of ? ` · bilhete ${result.of.position} de ${result.of.quantity}` : ""}</> : result.message}
    </p>}
    {data && !data.tickets.length && <p className="evp-muted">Ainda ninguém comprou bilhete.</p>}
    {data?.tickets.length > 0 && <ul className="evp-buyers">{data.tickets.map(ticket => <li key={ticket.id}>
      <Avatar user={ticket} size="small" />
      <span><strong>{ticket.display_name}{ticket.quantity > 1 ? ` · ${ticket.quantity} bilhetes` : ""}</strong>
        <small>@{ticket.username} · comprou a {new Date(ticket.created_at).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}</small></span>
      <span className={`status-pill ${ticket.checked_in === ticket.quantity ? "is-ok" : ""}`}>
        {ticket.quantity > 1 ? `Entraram ${ticket.checked_in} de ${ticket.quantity}` : ticket.checked_in ? "Entrou" : "Por entrar"}</span>
    </li>)}</ul>}
  </section>;
}

export function EventPage() {
  const { eventId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, authReady } = useContext(UserContext);
  const [event, setEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(searchParams.get("pagamento") === "sucesso" ? "Pagamento recebido. Os teus bilhetes aparecem aqui assim que for confirmado." : "");
  const [paying, setPaying] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [editing, setEditing] = useState(false);
  const checkinCode = searchParams.get("checkin");
  const load = () => api(`/events/${eventId}`).then(result => { setEvent(result.event); setAttendees(result.attendees || []); }).catch(loadError => setError(loadError.message));
  useEffect(() => { if (authReady) load(); }, [eventId, authReady, user?.id]);

  if (error) return <div className="page narrow"><div className="empty card">{error} <Link to="/events">Ver eventos</Link></div></div>;
  if (!event) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  const paid = event.ticket_price_kz > 0;
  const soldOut = paid && event.tickets_total && event.tickets_sold >= event.tickets_total;
  const left = event.tickets_total ? Math.max(0, event.tickets_total - event.tickets_sold) : Infinity;
  const maxQuantity = Math.max(1, Math.min(MAX_PER_ORDER, left));
  const mine = event.my_tickets || [];
  const when = whenParts(event.starts_at);
  const past = new Date(event.starts_at).getTime() < Date.now();
  const soon = countdown(event.starts_at);
  const friends = attendees.filter(person => person.is_friend);
  const host = event.page_id && event.page_name ? { to: `/pages/${event.page_id}`, name: event.page_name } : { to: `/u/${event.creator_username}`, name: event.creator_name };

  const buy = () => { setNotice(""); setPaying(true); };
  const rsvp = async () => {
    setBusy(true);
    try { await api(`/events/${event.id}/rsvp`, { method: "POST" }); await load(); } catch (rsvpError) { setNotice(rsvpError.message); } finally { setBusy(false); }
  };
  const share = () => {
    const url = `${window.location.origin}/events/${event.id}`;
    if (navigator.share) navigator.share({ title: event.name, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => setNotice("Ligação copiada.")).catch(() => {});
  };

  // Caixa do bilhete (ao lado no computador, por baixo do título no telemóvel).
  const ticketBox = <aside className="evp-box" aria-label={paid ? "Bilhetes" : "Participar"}>
    {soon && <p className="evp-soon"><Icon name="clock" size={14} /> {soon}</p>}
    {paid ? <>
      <p className="evp-box-label">Bilhete</p>
      <p className="evp-price">{kzLabel(event.ticket_price_kz)}</p>
      {event.tickets_total ? <>
        <SoldBar sold={event.tickets_sold} total={event.tickets_total} />
        <p className="evp-left">{soldOut ? "Esgotado" : left <= 50 ? `Últimos ${left} bilhetes` : `${countLabel(left)} por vender`}</p>
      </> : <p className="evp-left">Pagamento por Express, Referência, PayPay ou PayPal</p>}
    </> : <>
      <p className="evp-box-label">Entrada</p>
      <p className="evp-price is-free">Grátis</p>
      <p className="evp-left">{formatCount(event.attendee_count)} {event.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</p>
    </>}
    {past ? <p className="evp-muted">Este evento já aconteceu.</p>
      : !user ? <Link className="btn evp-cta" to="/login">Entrar para {paid ? "comprar" : "participar"}</Link>
        : event.is_creator ? <p className="evp-muted">És quem organiza este evento.</p>
          : paid ? (soldOut ? <button className="btn evp-cta" type="button" disabled>Esgotado</button> : <>
            <div className="evp-qty">
              <span>Quantidade</span>
              <span className="ticket-quantity" role="group" aria-label="Quantos bilhetes">
                <button type="button" aria-label="Menos um bilhete" disabled={quantity <= 1} onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
                <strong aria-live="polite">{quantity}</strong>
                <button type="button" aria-label="Mais um bilhete" disabled={quantity >= maxQuantity} onClick={() => setQuantity(value => Math.min(maxQuantity, value + 1))}>+</button>
              </span>
            </div>
            <button className="btn evp-cta" type="button" disabled={busy} onClick={buy}>
              {mine.length ? "Comprar mais" : "Comprar"} · {kzLabel(event.ticket_price_kz * quantity)}</button>
            <p className="evp-fine">Recebes {quantity === 1 ? "o bilhete" : `${quantity} bilhetes, cada um com o seu QR,`} aqui e no teu email.</p>
          </>)
            : <button className={`btn evp-cta${event.is_attending ? " secondary" : ""}`} type="button" disabled={busy} onClick={rsvp}>
              <Icon name={event.is_attending ? "check" : "plus"} size={15} /> {event.is_attending ? "Vou · carrega para cancelar" : "Vou participar"}</button>}
    {notice && <p className="evp-notice" role="status">{notice}</p>}
  </aside>;

  return <div className="evp">
    <Link className="evp-back" to="/events"><Icon name="previous" size={16} /> Agenda</Link>
    <div className="evp-cover">
      {event.image_url ? <img src={`${API_BASE}${event.image_url}`} alt="" />
        : <span className={`evp-cover-blank tone-${event.id % 4}`}><b>{(event.name.match(/[\p{L}\p{N}]/u) || ["•"])[0].toUpperCase()}</b></span>}
    </div>
    <div className="evp-grid">
      <div className="evp-main">
        <p className="evp-when-line">{when.short} · {when.time}</p>
        <h1>{event.name}</h1>
        <ul className="evp-facts">
          <li><Icon name="clock" size={18} /><span><strong>{when.weekday.charAt(0).toUpperCase() + when.weekday.slice(1)}, {when.day}</strong><small>Às {when.time} (hora de Luanda)</small></span></li>
          {event.location && <li><Icon name="location" size={18} /><span><strong>{event.location}</strong>
            <a href={mapsUrl(event.location)} target="_blank" rel="noopener noreferrer">Ver no mapa</a></span></li>}
          <li><Avatar user={{ display_name: host.name, avatar_url: event.creator_avatar }} size="small" />
            <span><small>Organizado por</small><Link to={host.to}><strong>{host.name}</strong></Link></span></li>
          <li><Icon name="friends" size={18} /><span><strong>{formatCount(event.attendee_count)} {event.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</strong></span></li>
        </ul>
        <div className="evp-box-mobile">{ticketBox}</div>
        {event.description && <section className="evp-about"><h2>Sobre o evento</h2><p>{event.description}</p></section>}
        {attendees.length > 0 && <section className="evp-going">
          <h2>Quem vai <span>{formatCount(event.attendee_count)}</span></h2>
          {friends.length > 0 && <p className="evp-muted">{friends.length === 1 ? `${friends[0].display_name} vai` : `${friends[0].display_name} e mais ${friends.length - 1} ${friends.length === 2 ? "amigo vão" : "amigos vão"}`}</p>}
          <ul>{attendees.slice(0, 18).map(person => <li key={person.id}>
            <Link to={`/u/${person.username}`} title={person.display_name}><Avatar user={person} />
              <span>{person.display_name.split(" ")[0]}</span>{person.is_friend && <em>Amigo</em>}</Link>
          </li>)}</ul>
        </section>}
        <div className="evp-tools">
          <button className="btn secondary evp-share" type="button" onClick={share}><Icon name="share" size={15} /> Partilhar evento</button>
          {!past && <button className="btn secondary evp-share" type="button" onClick={() => downloadCalendar(event)}><Icon name="events" size={15} /> Adicionar ao calendário</button>}
          {event.is_creator && !past && <button className="btn secondary evp-share" type="button" onClick={() => setEditing(true)}><Icon name="settings" size={15} /> Editar evento</button>}
        </div>
      </div>
      <div className="evp-side">{ticketBox}</div>
    </div>

    {!past && user && !event.is_creator && <div className="evp-sticky" aria-hidden="true">
      <span><strong>{paid ? kzLabel(event.ticket_price_kz) : "Grátis"}</strong><small>{soon || (paid ? "por bilhete" : `${formatCount(event.attendee_count)} vão`)}</small></span>
      {paid ? <button className="btn" type="button" tabIndex={-1} disabled={Boolean(soldOut)} onClick={buy}>{soldOut ? "Esgotado" : mine.length ? "Comprar mais" : "Comprar"}</button>
        : <button className={`btn${event.is_attending ? " secondary" : ""}`} type="button" tabIndex={-1} disabled={busy} onClick={rsvp}>{event.is_attending ? "Vou ✓" : "Vou"}</button>}
    </div>}
    {mine.length > 0 && <section className="evp-panel">
      <div className="evp-panel-head"><div>
        <h2>{mine.length === 1 ? "O teu bilhete" : `Os teus ${mine.length} bilhetes`}</h2>
        <p>{mine.length === 1 ? "Mostra este QR à entrada. Cada bilhete só entra uma vez."
          : "Cada pessoa entra com o seu QR. Podes enviar a cada pessoa o QR dela (também estão no teu email)."}</p>
      </div></div>
      <div className="ticket-grid">{mine.map((ticket, index) => <div className="evp-ticket" key={ticket.code}>
        <div>
          {mine.length > 1 && <p className="ticket-number">Bilhete {index + 1} de {mine.length}</p>}
          <p className="evp-ticket-event">{event.name}</p>
          <p className="evp-muted">{when.short} · {when.time}</p>
          <p className="ticket-code">{ticket.code}</p>
          <span className={`status-pill ${ticket.checked_in_at ? "is-ok" : ""}`}>{ticket.checked_in_at ? "Já entrou" : "Por entrar"}</span>
        </div>
        <TicketQr eventId={event.id} code={ticket.code} />
      </div>)}</div>
    </section>}
    {event.is_creator && paid && <OrganizerTickets event={event} autoCode={checkinCode} />}
    {editing && <EditEventDialog event={event} onClose={() => setEditing(false)}
      onSaved={notified => { setEditing(false); setNotice(notified ? "Evento atualizado. Avisámos quem vai." : "Evento atualizado."); load(); }} />}
    {paying && <PaymentDialog title={`${quantity === 1 ? "Bilhete" : `${quantity} bilhetes`} «${event.name}»`} amountKz={event.ticket_price_kz * quantity} purpose="event_ticket"
      onPay={choice => api(`/events/${event.id}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...choice, quantity }) })}
      onDone={() => { setPaying(false); load(); }} onClose={() => { setPaying(false); load(); }} />}
    {event.is_creator && !paid && checkinCode && <p className="evp-muted">Este evento é grátis: não tem bilhetes para validar.</p>}
    {!event.is_creator && checkinCode && <p className="evp-muted" role="status">Só quem organiza o evento pode validar bilhetes.
      <button className="link-button" type="button" onClick={() => setSearchParams({})}>Fechar</button></p>}
  </div>;
}
