import { useContext, useEffect, useState } from "react";
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
const mapsUrl = place => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(searchParams.get("pagamento") === "sucesso" ? "Pagamento recebido. Os teus bilhetes aparecem aqui assim que for confirmado." : "");
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
  const when = whenParts(event.starts_at);
  const past = new Date(event.starts_at).getTime() < Date.now();
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
        <button className="btn secondary evp-share" type="button" onClick={share}><Icon name="share" size={15} /> Partilhar evento</button>
      </div>
      <div className="evp-side">{ticketBox}</div>
    </div>

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
    {paying && <PaymentDialog title={`${quantity === 1 ? "Bilhete" : `${quantity} bilhetes`} «${event.name}»`} amountKz={event.ticket_price_kz * quantity} purpose="event_ticket"
      onPay={choice => api(`/events/${event.id}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...choice, quantity }) })}
      onDone={() => { setPaying(false); load(); }} onClose={() => { setPaying(false); load(); }} />}
    {event.is_creator && !paid && checkinCode && <p className="evp-muted">Este evento é grátis: não tem bilhetes para validar.</p>}
    {!event.is_creator && checkinCode && <p className="evp-muted" role="status">Só quem organiza o evento pode validar bilhetes.
      <button className="link-button" type="button" onClick={() => setSearchParams({})}>Fechar</button></p>}
  </div>;
}
