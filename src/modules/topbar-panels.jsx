// Caixas do topo: notificações e mensagens abrem por cima da página (como o Menu), com as mais
// recentes e "Ver todas" no fim. Carregam ao abrir, para não pesar em cada página.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, Icon, api } from "./core.jsx";
import { relativeTime } from "./feed.jsx";
import { NotificationRow, notificationPath } from "./notifications.jsx";

const PANEL_SIZE = 8;

export function NotificationsPanel({ onChange, onClose }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/notifications").then(result => setItems(result.notifications)).catch(loadError => setError(loadError.message));
  }, []);

  const open = item => {
    if (!item.read) {
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, read: true } : entry));
      api(`/notifications/${item.id}/read`, { method: "POST" }).then(onChange).catch(() => {});
    }
    const path = notificationPath(item);
    onClose();
    if (path) navigate(path);
  };
  const markAll = () => {
    setItems(current => current.map(entry => ({ ...entry, read: true })));
    api("/notifications/read-all", { method: "POST" }).then(onChange).catch(readError => setError(readError.message));
  };

  const unread = (items || []).filter(item => !item.read).length;
  const visible = (items || []).filter(item => !onlyUnread || !item.read).slice(0, PANEL_SIZE);
  return <div className="topbar-dropdown topbar-panel" role="dialog" aria-label="Notificações">
    <header className="topbar-panel-head">
      <h2>Notificações</h2>
      {unread > 0 && <button type="button" className="topbar-panel-link" onClick={markAll}>Marcar todas como lidas</button>}
    </header>
    <div className="topbar-panel-tabs" role="group" aria-label="Filtrar">
      <button type="button" aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>Todas</button>
      <button type="button" aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>Por ler{unread > 0 ? ` (${unread})` : ""}</button>
    </div>
    <div className="topbar-panel-body">
      {error && <p className="error" role="alert">{error}</p>}
      {!items && !error && <p className="muted">A carregar...</p>}
      {items && !visible.length && <p className="topbar-panel-empty"><Icon name="notifications" size={22} />{onlyUnread ? "Não tens notificações por ler." : "Ainda não tens notificações."}</p>}
      {visible.map(item => <NotificationRow key={item.id} item={item} onOpen={open} compact />)}
    </div>
    <Link className="topbar-panel-all" to="/notifications" onClick={onClose}>Ver todas as notificações</Link>
  </div>;
}

export function MessagesPanel({ onClose }) {
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/messages").then(result => setConversations(result.conversations)).catch(loadError => setError(loadError.message));
  }, []);
  const unread = (conversations || []).reduce((sum, item) => sum + item.unread, 0);
  return <div className="topbar-dropdown topbar-panel" role="dialog" aria-label="Mensagens">
    <header className="topbar-panel-head">
      <h2>Mensagens</h2>
      <Link className="topbar-panel-link" to="/messages" onClick={onClose}><Icon name="plus" size={14} />Nova</Link>
    </header>
    {unread > 0 && <p className="topbar-panel-note">{unread} {unread === 1 ? "mensagem por ler" : "mensagens por ler"}</p>}
    <div className="topbar-panel-body">
      {error && <p className="error" role="alert">{error}</p>}
      {!conversations && !error && <p className="muted">A carregar...</p>}
      {conversations && !conversations.length && <p className="topbar-panel-empty"><Icon name="messages" size={22} />Ainda não tens conversas.</p>}
      {conversations?.slice(0, PANEL_SIZE).map(item => <Link key={item.id} className={`conversation-row${item.unread ? " is-unread" : ""}`} to={`/messages/${item.id}`} onClick={onClose}>
        <Avatar user={item} />
        <span className="conversation-text">
          <span className="conversation-top"><strong>{item.display_name}</strong><small>{relativeTime(item.latest_message_at)}</small></span>
          <span className="conversation-preview">{item.latest_message}</span>
        </span>
        {item.unread > 0 && <span className="conversation-count">{item.unread > 9 ? "9+" : item.unread}</span>}
      </Link>)}
    </div>
    <Link className="topbar-panel-all" to="/messages" onClick={onClose}>Ver todas as mensagens</Link>
  </div>;
}
