import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, Icon, UserContext, api } from "./core.jsx";
import { relativeTime } from "./feed.jsx";

// ---------------------------------------------------------------------------------------------
// Amigos, Eventos e Notificações (mesma linguagem das Páginas e Grupos)
// ---------------------------------------------------------------------------------------------
export function PeopleCard({ person, children, subtitle }) {
  return <article className="person-card card">
    <Link to={`/u/${person.username}`} className="person-card-avatar" aria-label={`Perfil de ${person.display_name}`}><Avatar user={person} size="large" /></Link>
    <Link className="person-card-name" to={`/u/${person.username}`}>{person.display_name}</Link>
    <small>{subtitle || `@${person.username}`}</small>
    <div className="person-card-actions">{children}</div>
  </article>;
}
export function Friends() {
  const { user } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("requests");
  const [sent, setSent] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);

  const load = async () => {
    try {
      const result = await api("/friends");
      setData(result);
      setError("");
      if (!result.requests.length) setTab(current => current === "requests" ? "suggestions" : current);
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { if (user) load(); }, [user?.id]);

  // Procurar pessoas por nome (com uma pequena pausa enquanto se escreve).
  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); return undefined; }
    const timer = window.setTimeout(() => api(`/users/search?q=${encodeURIComponent(term)}`).then(result => setResults(result.users)).catch(() => setResults([])), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const sendRequest = async person => {
    setSent(current => new Set(current).add(person.id));
    try {
      await api(`/friends/${person.id}/request`, { method: "POST" });
    } catch (requestError) {
      setSent(current => { const next = new Set(current); next.delete(person.id); return next; });
      setError(requestError.message);
    }
  };

  const answer = async (request, action) => {
    setData(current => ({
      ...current,
      requests: current.requests.filter(item => item.id !== request.id),
      friends: action === "accept" ? [...current.friends, { id: request.user_id, username: request.username, display_name: request.display_name, avatar_url: request.avatar_url }] : current.friends
    }));
    try {
      await api(`/friends/requests/${request.id}/${action}`, { method: "POST" });
    } catch (answerError) {
      setError(answerError.message);
      load();
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver os teus amigos. <Link to="/login">Entrar</Link></div></div>;

  const friendIds = new Set((data?.friends || []).map(friend => friend.id));
  const addButton = person => friendIds.has(person.id)
    ? <Link className="btn secondary" to={`/messages/${person.id}`}><Icon name="messages" size={15} /> Mensagem</Link>
    : sent.has(person.id)
      ? <button className="btn secondary" type="button" disabled><Icon name="check" size={15} /> Pedido enviado</button>
      : <button className="btn" type="button" onClick={() => sendRequest(person)}><Icon name="friends" size={15} /> Adicionar</button>;

  const tabs = [["requests", "Pedidos", data?.requests.length || 0], ["suggestions", "Sugestões", data?.suggestions.length || 0], ["friends", "Os teus amigos", data?.friends.length || 0]];

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Amigos</h1><p>Responde a pedidos, encontra pessoas que conheces e fala com os teus amigos.</p></div>
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Amigos">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={!results && tab === id} onClick={() => { setTab(id); setQuery(""); }}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar pessoas" aria-label="Procurar pessoas" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A carregar...</div>}
    {results && (results.length
      ? <div className="people-grid">{results.map(person => <PeopleCard key={person.id} person={person}>{addButton(person)}</PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ninguém com esse nome. Experimenta o nome de utilizador (sem @).</p></div>)}
    {!results && data && tab === "requests" && (data.requests.length
      ? <div className="people-grid">{data.requests.map(request => <PeopleCard key={request.id} person={request} subtitle={`Pediu ${relativeTime(request.created_at)}`}>
        <button className="btn" type="button" onClick={() => answer(request, "accept")}><Icon name="check" size={15} /> Confirmar</button>
        <button className="btn secondary" type="button" onClick={() => answer(request, "reject")}>Recusar</button>
      </PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Não tens pedidos de amizade por responder.</p><button className="btn secondary" type="button" onClick={() => setTab("suggestions")}>Ver sugestões</button></div>)}
    {!results && data && tab === "suggestions" && (data.suggestions.length
      ? <div className="people-grid">{data.suggestions.map(person => <PeopleCard key={person.id} person={person}>{addButton(person)}</PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ainda não há sugestões. Convida os teus amigos para o Biva.</p><Link className="btn" to="/convidar"><Icon name="gift" size={15} /> Convidar amigos</Link></div>)}
    {!results && data && tab === "friends" && (data.friends.length
      ? <div className="people-grid">{data.friends.map(person => <PeopleCard key={person.id} person={person}>
        <Link className="btn secondary" to={`/messages/${person.id}`}><Icon name="messages" size={15} /> Mensagem</Link>
      </PeopleCard>)}</div>
      : <div className="empty card pages-empty"><p>Ainda não tens amigos no Biva. Começa pelas sugestões.</p><button className="btn" type="button" onClick={() => setTab("suggestions")}>Ver sugestões</button></div>)}
  </div>;
}
