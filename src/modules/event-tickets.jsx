import { useContext, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, formatPrice, token } from "./core.jsx";
import { EventDate, eventWhen } from "./events.jsx";
import { PaymentDialog } from "./shared.jsx";
import "./events.css";

// Página de um evento: comprar o bilhete (Express, Referência, PayPay...), mostrar o QR e, para quem organiza,
// validar à entrada. O QR leva /events/:id?checkin=CÓDIGO: quem organiza aponta a câmara e o bilhete fica validado aqui.

const MAX_PER_ORDER = 10;

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
  return <section className="creator-card ticket-organizer">
    <div className="creator-card-head"><div><h2>Bilhetes à entrada</h2>
      <p>Aponta a câmara do telemóvel para o QR do bilhete (abre aqui e valida sozinho) ou escreve o código.</p></div></div>
    {data && <dl className="admin-kpis">
      <div><dt>Vendidos</dt><dd>{data.sold}{data.total ? ` / ${data.total}` : ""}</dd></div>
      <div><dt>Já entraram</dt><dd>{data.checked_in}</dd></div>
      <div><dt>Vendas</dt><dd>{formatPrice(data.gross_kz)}</dd></div>
      <div><dt>Para ti (85%)</dt><dd>{formatPrice(data.net_kz)}</dd></div>
    </dl>}
    <form className="ticket-checkin" onSubmit={event => { event.preventDefault(); checkIn(code); }}>
      <input value={code} onChange={changeEvent => setCode(changeEvent.target.value.toUpperCase())} maxLength={16} placeholder="Código do bilhete" aria-label="Código do bilhete" />
      <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>{busy ? "A validar..." : "Validar"}</button>
    </form>
    {result && <p className={`ticket-checkin-result ${result.ok ? "is-ok" : "is-bad"}`} role="status">
      <Icon name={result.ok ? "check" : "close"} size={18} />
      {result.ok ? <>Pode entrar: <strong>{result.person.display_name}</strong> (@{result.person.username}){result.of ? ` · bilhete ${result.of.position} de ${result.of.quantity}` : ""}</> : result.message}
    </p>}
    {data?.tickets.length > 0 && <ul className="person-list ticket-list">{data.tickets.map(ticket => <li key={ticket.id}>
      <Avatar user={ticket} size="small" /><span><strong>{ticket.display_name}{ticket.quantity > 1 ? ` · ${ticket.quantity} bilhetes` : ""}</strong>
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(searchParams.get("pagamento") === "sucesso" ? "Pagamento recebido. O teu bilhete aparece aqui assim que for confirmado." : "");
  const [paying, setPaying] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const checkinCode = searchParams.get("checkin");
  const load = () => api(`/events/${eventId}`).then(result => setEvent(result.event)).catch(loadError => setError(loadError.message));
  useEffect(() => { if (authReady) load(); }, [eventId, authReady, user?.id]);

  if (error) return <div className="page narrow"><div className="empty card">{error} <Link to="/events">Ver eventos</Link></div></div>;
  if (!event) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  const paid = event.ticket_price_kz > 0;
  const soldOut = paid && event.tickets_total && event.tickets_sold >= event.tickets_total;
  const left = event.tickets_total ? Math.max(0, event.tickets_total - event.tickets_sold) : Infinity;
  const maxQuantity = Math.max(1, Math.min(MAX_PER_ORDER, left));
  const mine = event.my_tickets || [];

  const buy = () => { setNotice(""); setPaying(true); };
  const rsvp = async () => {
    setBusy(true);
    try { await api(`/events/${event.id}/rsvp`, { method: "POST" }); await load(); } catch (rsvpError) { setNotice(rsvpError.message); } finally { setBusy(false); }
  };

  return <div className="page narrow event-page">
    <article className="event-poster card event-page-poster">
      <div className="event-poster-cover">
        {event.image_url ? <img src={`${API_BASE}${event.image_url}`} alt="" /> : <span className="event-poster-waves" aria-hidden="true"><Icon name="events" size={30} /></span>}
        <EventDate value={event.starts_at} />
      </div>
      <div className="event-poster-body">
        <h1>{event.name}</h1>
        <span><Icon name="clock" size={14} /> {eventWhen(event.starts_at)}</span>
        {event.location && <span><Icon name="location" size={14} /> {event.location}</span>}
        {event.description && <p>{event.description}</p>}
        <small>Organizado por {event.page_id && event.page_name ? <Link to={`/pages/${event.page_id}`}>{event.page_name}</Link>
          : <Link to={`/u/${event.creator_username}`}>{event.creator_name}</Link>} · {formatCount(event.attendee_count)} {event.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</small>
        <div className="event-page-actions">
          {paid && <span className="ticket-price"><Icon name="card" size={15} /> Bilhete: {formatPrice(event.ticket_price_kz)}
            {event.tickets_total ? <small> · {formatCount(left)} por vender</small> : null}</span>}
          {!user ? <Link className="btn" to="/login">Entrar para {paid ? "comprar bilhete" : "participar"}</Link>
            : event.is_creator ? null
              : paid ? (soldOut ? <button className="btn" type="button" disabled>Esgotado</button> : <>
                <span className="ticket-quantity" role="group" aria-label="Quantos bilhetes">
                  <button type="button" aria-label="Menos um bilhete" disabled={quantity <= 1} onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
                  <strong aria-live="polite">{quantity}</strong>
                  <button type="button" aria-label="Mais um bilhete" disabled={quantity >= maxQuantity} onClick={() => setQuantity(value => Math.min(maxQuantity, value + 1))}>+</button>
                </span>
                <button className="btn" type="button" disabled={busy} onClick={buy}>
                  <Icon name="card" size={15} /> {mine.length ? "Comprar mais" : "Comprar"} {quantity === 1 ? "bilhete" : `${quantity} bilhetes`} · {formatPrice(event.ticket_price_kz * quantity)}</button>
              </>)
                : <button className={`btn${event.is_attending ? " secondary" : ""}`} type="button" disabled={busy} onClick={rsvp}>
                  <Icon name={event.is_attending ? "check" : "plus"} size={15} /> {event.is_attending ? "Vou (carrega para cancelar)" : "Vou participar"}</button>}
        </div>
        {notice && <p className="prefs-saved" role="status">{notice}</p>}
      </div>
    </article>
    {mine.length > 0 && <section className="creator-card">
      <h2>{mine.length === 1 ? "O teu bilhete" : `Os teus ${mine.length} bilhetes`}</h2>
      <p className="muted">{mine.length === 1 ? "Mostra este QR à entrada. Cada bilhete só entra uma vez."
        : "Cada pessoa entra com o seu QR. Podes enviar a cada pessoa o QR dela (também estão no teu email)."}</p>
      <div className="ticket-grid">{mine.map((ticket, index) => <div className="ticket-card" key={ticket.code}>
        <div>{mine.length > 1 && <p className="ticket-number">Bilhete {index + 1} de {mine.length}</p>}
          <p className="ticket-code">{ticket.code}</p>
          <p className="muted">{ticket.checked_in_at ? "Já entrou." : "Por entrar."}</p></div>
        <TicketQr eventId={event.id} code={ticket.code} />
      </div>)}</div>
    </section>}
    {event.is_creator && paid && <OrganizerTickets event={event} autoCode={checkinCode} />}
    {paying && <PaymentDialog title={`${quantity === 1 ? "Bilhete" : `${quantity} bilhetes`} «${event.name}»`} amountKz={event.ticket_price_kz * quantity} purpose="event_ticket"
      onPay={choice => api(`/events/${event.id}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...choice, quantity }) })}
      onDone={() => { setPaying(false); load(); }} onClose={() => { setPaying(false); load(); }} />}
    {event.is_creator && !paid && checkinCode && <p className="muted">Este evento é grátis: não tem bilhetes para validar.</p>}
    {!event.is_creator && checkinCode && <p className="muted" role="status">Só quem organiza o evento pode validar bilhetes.
      <button className="link-button" type="button" onClick={() => setSearchParams({})}>Fechar</button></p>}
  </div>;
}
