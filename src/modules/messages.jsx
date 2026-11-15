import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, token } from "./core.jsx";
import { usePolling } from "./shared.jsx";

export const formatMessageTime = value => {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export function Messages() {
  const { userId } = useParams();
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  // Ligar a esta pessoa: a chamada abre em /calls/:id (lá dá para adicionar mais pessoas, até 8).
  const startCall = kind => navigate(`/calls/new?to=${selected.id}&kind=${kind}&name=${encodeURIComponent(selected.display_name)}`);
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(null);
  const [canMessage, setCanMessage] = useState(true);
  const chatEnd = useRef(null);
  const selected = conversations.find(item => String(item.id) === userId)
    || contacts.find(item => String(item.id) === userId)
    || results.find(item => String(item.id) === userId)
    || (person && String(person.id) === userId ? person : null);

  const loadConversations = async () => {
    if (!token()) return;
    try {
      const [messageResult, friendResult] = await Promise.all([api("/messages"), api("/friends")]);
      setConversations(messageResult.conversations);
      setContacts(friendResult.friends);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    setMessages([]);
    setPerson(null);
    setCanMessage(true);
    if (!userId || !token()) return;
    api(`/messages/${userId}`).then(result => {
      setMessages(result.messages);
      setPerson(result.person);
      setCanMessage(result.canMessage);
    }).catch(loadError => setError(loadError.message));
  }, [userId]);

  // Mensagens novas na conversa aberta (só pede as que vieram depois da última).
  usePolling(async () => {
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    try {
      const result = await api(`/messages/${userId}${lastId ? `?after=${lastId}` : ""}`);
      setCanMessage(result.canMessage);
      if (result.messages.length) {
        setMessages(current => [...current, ...result.messages.filter(message => !current.some(existing => existing.id === message.id))]);
        loadConversations();
      }
    } catch { /* tenta outra vez no próximo ciclo */ }
  }, 4000, !!userId && !!user);

  // Lista de conversas (novas conversas e contadores de não lidas).
  usePolling(loadConversations, 15000, !!user);

  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const searchUsers = async event => {
    event.preventDefault();
    if (!search.trim()) return setResults([]);
    setError("");
    try {
      const result = await api(`/users/search?q=${encodeURIComponent(search.trim())}`);
      setResults(result.users);
    } catch (searchError) {
      setError(searchError.message);
    }
  };

  const sendMessage = async event => {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/messages/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      setMessages([...messages, { ...result.message, sender_id: user?.id }]);
      setBody("");
      await loadConversations();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para usar as mensagens. <Link to="/login">Entrar</Link></div></div>;

  const personRow = item => <button className={`conversation-row ${String(item.id) === userId ? "selected" : ""}${item.unread ? " unread" : ""}`} key={item.id} onClick={() => navigate(`/messages/${item.id}`)}>
    <Avatar user={item} />
    <span><strong>{item.display_name}</strong><small>{item.latest_message || `@${item.username}`}</small></span>
    {item.unread > 0 && <span className="unread-count" aria-label={`${item.unread} mensagens por ler`}>{item.unread}</span>}
  </button>;

  return <div className="page messages-layout card">
    <aside className="conversation-list">
      <h1>Mensagens</h1>
      <form className="search-form pages-search" onSubmit={searchUsers}><Icon name="search" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Procurar pessoas" aria-label="Procurar pessoas para conversar" /></form>
      {results.map(personRow)}
      {conversations.map(personRow)}
      {!conversations.length && !results.length && <p className="muted">Procura uma pessoa para iniciar uma conversa.</p>}
    </aside>
    <section className="chat-panel">
      {selected ? <>
        <header className="chat-header"><Avatar user={selected} /><div><strong>{selected.display_name}</strong><small>@{selected.username}</small></div>
          <span className="chat-call-buttons">
            <button type="button" className="round-button" aria-label={`Chamada de voz com ${selected.display_name}`} title="Chamada de voz" onClick={() => startCall("voice")}><Icon name="mic" size={18} /></button>
            <button type="button" className="round-button" aria-label={`Chamada de vídeo com ${selected.display_name}`} title="Chamada de vídeo" onClick={() => startCall("video")}><Icon name="video" size={18} /></button>
          </span>
        </header>
        <div className="chat-messages" aria-live="polite">
          {messages.map(message => {
            const mine = String(message.sender_id) === String(user.id);
            return <div className={`message-bubble ${mine ? "mine" : ""}`} key={message.id}>
              {message.body}
              <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}{mine && message.read_at ? " · lida" : ""}</time>
            </div>;
          })}
          <div ref={chatEnd} />
        </div>
        {canMessage
          ? <form className="chat-form" onSubmit={sendMessage}><input value={body} onChange={event => setBody(event.target.value)} placeholder="Escreve uma mensagem..." maxLength="4000" /><button className="round-button chat-send" aria-label="Enviar mensagem" title="Enviar" disabled={busy || !body.trim()}><Icon name="send" size={18} /></button></form>
          : <p className="chat-blocked muted">Não é possível enviar mensagens para esta conta.</p>}
      </> : <div className="empty chat-empty"><span className="group-lock-icon chat-empty-icon"><Icon name="messages" size={26} /></span><strong>As tuas conversas</strong><span>Escolhe uma conversa ou procura alguém para enviar uma mensagem.</span></div>}
      {error && <p className="error">{error}</p>}
    </section>
  </div>;
}
