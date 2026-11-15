import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Icon, api, formatCount } from "./core.jsx";
import { groupCategory, groupCategoryLabel, pageCategoryLabel, pageType } from "./community-types.js";

// ---------------------------------------------------------------------------------------------
// Ecrã inicial: "O que está a acontecer?" (faixa Agora) e "O que descobrir / com quem falar?"
// (bloco Descobrir). Os dados vêm todos de GET /api/home.
// ---------------------------------------------------------------------------------------------

// Avatar com o ponto verde de "online".
export function PresenceAvatar({ user, size = "" }) {
  return <span className={`presence${user.online ? " is-online" : ""}`}>
    <Avatar user={user} size={size} />
    {user.online && <span className="presence-dot"><span className="visually-hidden">Online</span></span>}
  </span>;
}

const timeOf = value => new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

export function HomeNow({ now }) {
  if (!now) return null;
  const { events = [], groups = [], online = [] } = now;
  if (!events.length && !groups.length && !online.length) return null;
  return <section className="home-now card" aria-labelledby="home-now-title">
    <h2 id="home-now-title"><span className="home-now-pulse" aria-hidden="true" /> Agora no Tchilar</h2>
    <div className="home-now-track">
      {online.length > 0 && <Link className="home-now-item" to={`/messages/${online[0].id}`}>
        <span className="home-now-avatars">{online.slice(0, 3).map(friend => <PresenceAvatar key={friend.id} user={{ ...friend, online: true }} size="tiny" />)}</span>
        <span><strong>{online.length === 1 ? `${online[0].display_name} está online` : `${online.length} amigos online`}</strong>
          <small>{online.length === 1 ? "Envia uma mensagem" : online.slice(0, 2).map(friend => friend.display_name.split(" ")[0]).join(", ") + (online.length > 2 ? "…" : "")}</small></span>
      </Link>}
      {events.map(event => <Link className="home-now-item" key={`e${event.id}`} to="/events">
        <span className="home-now-icon tone-events"><Icon name="events" size={18} /></span>
        <span><strong>{event.name}</strong>
          <small>Hoje às {timeOf(event.starts_at)} · {event.attendee_count
            ? `${formatCount(event.attendee_count)} ${event.attendee_count === 1 ? "vai" : "vão"}`
            : event.location || "Sê a primeira pessoa a ir"}</small></span>
      </Link>)}
      {groups.map(group => <Link className="home-now-item" key={`g${group.id}`} to={`/groups/${group.id}`}>
        <span className="home-now-icon tone-groups"><Icon name={groupCategory(group.category).icon} size={18} /></span>
        <span><strong>{group.name}</strong>
          <small>{group.new_posts} {group.new_posts === 1 ? "publicação nova" : "publicações novas"}</small></span>
      </Link>)}
    </div>
  </section>;
}

// Porque é que esta sugestão aparece (o motivo ajuda a pessoa a decidir).
function personReason(person) {
  if (person.mutual_count) return `${person.mutual_count} ${person.mutual_count === 1 ? "amigo" : "amigos"} em comum`;
  return "Chegou há pouco ao Tchilar";
}
function communityReason(item, noun) {
  if (item.friend_count) {
    const one = item.friend_count === 1;
    const verb = noun === "membros" ? (one ? "participa" : "participam") : (one ? "segue" : "seguem");
    return `${item.friend_count} ${one ? "amigo" : "amigos"} ${verb}`;
  }
  const total = noun === "membros" ? item.member_count : item.follower_count;
  return `${formatCount(total)} ${total === 1 ? noun.replace(/s$/, "") : noun}`;
}

// variant "column": coluna da direita (ecrãs largos). variant "inline": dentro do feed (telemóvel e tablet).
export function HomeDiscover({ discover, variant = "column" }) {
  const [done, setDone] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!discover) return null;
  const { people = [], groups = [], pages = [] } = discover;
  if (!people.length && !groups.length && !pages.length) return null;

  const act = async (key, path, method = "POST") => {
    setBusy(key);
    setError("");
    try {
      const result = await api(path, { method });
      setDone(current => ({ ...current, [key]: result.requested ? "requested" : "done" }));
    } catch (actError) {
      setError(actError.message);
    } finally {
      setBusy("");
    }
  };
  const actionButton = (key, label, doneLabel, path, icon = "plus") => done[key]
    ? <span className="home-discover-done"><Icon name="check" size={14} /> {done[key] === "requested" ? "Pedido enviado" : doneLabel}</span>
    : <button className="btn secondary home-discover-action" type="button" disabled={busy === key} onClick={() => act(key, path)}><Icon name={icon} size={14} /> {label}</button>;

  return <section className={`home-discover home-discover-${variant}${variant === "inline" ? " card" : ""}`} aria-labelledby={`home-discover-${variant}`}>
    <div className="home-heading-row"><h2 className="home-heading" id={`home-discover-${variant}`}>Descobrir</h2><Link to="/friends">Ver mais</Link></div>
    {error && <p className="error" role="alert">{error}</p>}
    {people.length > 0 && <div className="home-discover-group">
      <h3>Pessoas que talvez conheças</h3>
      <ul>{people.slice(0, variant === "inline" ? 6 : 3).map(person => <li key={`u${person.id}`} className="home-discover-item">
        <Link to={`/u/${person.username}`} className="home-discover-main"><Avatar user={person} />
          <span><strong>{person.display_name}</strong><small>{personReason(person)}</small></span></Link>
        {actionButton(`u${person.id}`, "Adicionar", "Pedido enviado", `/friends/${person.id}/request`)}
      </li>)}</ul>
    </div>}
    {groups.length > 0 && <div className="home-discover-group">
      <h3>Grupos para ti</h3>
      <ul>{groups.slice(0, 3).map(group => <li key={`g${group.id}`} className="home-discover-item">
        <Link to={`/groups/${group.id}`} className="home-discover-main">
          <span className="home-discover-icon tone-groups"><Icon name={groupCategory(group.category).icon} size={18} /></span>
          <span><strong>{group.name}</strong><small>{groupCategoryLabel(group)} · {communityReason(group, "membros")}</small></span></Link>
        {actionButton(`g${group.id}`, group.requires_approval ? "Pedir" : "Participar", "Membro", `/groups/${group.id}/join`)}
      </li>)}</ul>
    </div>}
    {pages.length > 0 && <div className="home-discover-group">
      <h3>Páginas para seguir</h3>
      <ul>{pages.slice(0, 3).map(page => <li key={`p${page.id}`} className="home-discover-item">
        <Link to={`/pages/${page.id}`} className="home-discover-main">
          <span className="home-discover-icon tone-pages"><Icon name={pageType(page.page_type).icon} size={18} /></span>
          <span><strong>{page.name}</strong><small>{pageCategoryLabel(page)} · {communityReason(page, "seguidores")}</small></span></Link>
        {actionButton(`p${page.id}`, "Seguir", "A seguir", `/pages/${page.id}/follow`)}
      </li>)}</ul>
    </div>}
  </section>;
}
