import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount } from "./core.jsx";
import { relativeTime } from "./feed.jsx";

// ----- Notificações -----
export const NOTIFICATION_ICONS = {
  like: ["heart", "coral"], comment: ["messages", "ceu"], message: ["messages", "ceu"], friend_request: ["friends", "lagoa"], friend_accept: ["friends", "lagoa"],
  follow: ["profile", "lagoa"], group_join: ["groups", "lagoa"], group_call: ["video", "coral"], call: ["video", "coral"], event_rsvp: ["events", "coral"], share: ["share", "ceu"],
  stars: ["star", "coral"], campaign: ["brand", "lagoa"], challenge: ["trophy", "coral"], referral: ["gift", "coral"],
  ad: ["ad", "coral"], payout: ["gift", "lagoa"], live: ["live", "coral"], moderation: ["shield", "tinta"],
  payment: ["card", "lagoa"], privacy: ["lock", "tinta"], announcement: ["info", "ceu"], subscription: ["spark", "coral"],
  event_reminder: ["clock", "coral"], event_update: ["events", "ceu"], event_ticket: ["card", "lagoa"], event_refund: ["card", "tinta"],
  business: ["shield", "lagoa"]
};
export function notificationGroup(value) {
  const date = new Date(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (today - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000;
  return diff <= 0 ? "Hoje" : diff === 1 ? "Ontem" : diff < 7 ? "Esta semana" : "Antes";
}
// Para onde leva cada notificação (página completa e caixa do topo usam a mesma regra).
export function notificationPath(item) {
  if (item.type === "live" && item.actor_username) return "/live";
  if (item.type === "campaign") return "/creator/parcerias";
  if (item.type === "payout") return "/creator/ganhos";
  if (item.type === "ad") return "/creator/anuncios";
  if (["stars", "referral", "challenge"].includes(item.type)) return "/estrelas";
  if (item.type === "payment") return "/settings/pagamentos";
  if (item.type === "privacy") return /^Novo início de sessão/.test(item.text || "") ? "/settings/seguranca" : "/settings/conta";
  if (item.call_id) return `/calls/${item.call_id}`;
  if (item.event_id) return `/events/${item.event_id}`;
  if (item.post_id) return `/posts/${item.post_id}`;
  if (item.group_id) return `/groups/${item.group_id}`;
  if (item.actor_username) return `/u/${item.actor_username}`;
  return null;
}
export function NotificationRow({ item, onOpen, compact = false }) {
  const [icon, tone] = NOTIFICATION_ICONS[item.type] || ["notifications", "lagoa"];
  return <button type="button" className={`notification-row${item.read ? "" : " is-unread"}${compact ? " is-compact" : ""}`} onClick={() => onOpen(item)}>
    <span className="notification-avatar">
      <Avatar user={{ display_name: item.actor_name || "Tchilar", avatar_url: item.actor_avatar }} />
      <span className={`notification-type tone-page-${tone}`}><Icon name={icon} size={12} /></span>
    </span>
    <span className="notification-text"><span><strong>{item.actor_name || "Tchilar"}</strong> {item.text}</span><small>{relativeTime(item.created_at)}</small></span>
    {!item.read && <span className="notification-unread-dot" aria-label="Por ler" />}
  </button>;
}
export function Notifications() {
  const { user, refreshUser } = useContext(UserContext);
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = async () => {
    try {
      setNotifications((await api("/notifications")).notifications);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  useEffect(() => { if (user) load(); }, [user?.id]);

  const open = async item => {
    if (!item.read) {
      setNotifications(current => current.map(entry => entry.id === item.id ? { ...entry, read: true } : entry));
      api(`/notifications/${item.id}/read`, { method: "POST" }).then(refreshUser).catch(() => {});
    }
    const path = notificationPath(item);
    if (path) navigate(path);
  };

  const markAllRead = async () => {
    setNotifications(current => current.map(entry => ({ ...entry, read: true })));
    try {
      await api("/notifications/read-all", { method: "POST" });
      await refreshUser();
    } catch (readError) {
      setError(readError.message);
    }
  };

  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para ver as notificações. <Link to="/login">Entrar</Link></div></div>;
  const unread = (notifications || []).filter(item => !item.read).length;
  const visible = (notifications || []).filter(item => !onlyUnread || !item.read);
  const groups = visible.reduce((list, item) => {
    const label = notificationGroup(item.created_at);
    const group = list.find(entry => entry.label === label);
    group ? group.items.push(item) : list.push({ label, items: [item] });
    return list;
  }, []);

  return <div className="pages-view notifications-view">
    <header className="pages-head">
      <div><h1>Notificações</h1><p>{unread ? `Tens ${formatCount(unread)} ${unread === 1 ? "notificação por ler" : "notificações por ler"}.` : "Estás em dia."}</p></div>
      {unread > 0 && <button className="btn secondary" type="button" onClick={markAllRead}><Icon name="check" size={15} /> Marcar todas como lidas</button>}
    </header>
    <div className="pages-tabs notification-tabs" role="tablist" aria-label="Filtrar notificações">
      <button type="button" role="tab" aria-selected={!onlyUnread} onClick={() => setOnlyUnread(false)}>Todas<span>{(notifications || []).length}</span></button>
      <button type="button" role="tab" aria-selected={onlyUnread} onClick={() => setOnlyUnread(true)}>Por ler<span>{unread}</span></button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!notifications && !error && <div className="empty card">A carregar...</div>}
    {notifications && !visible.length && <div className="empty card pages-empty"><span className="group-lock-icon"><Icon name="notifications" size={26} /></span><p>{onlyUnread ? "Não tens notificações por ler." : "Ainda não tens notificações. Quando alguém interagir contigo, aparece aqui."}</p></div>}
    {groups.map(group => <section key={group.label} className="notification-group card" aria-label={group.label}>
      <h2>{group.label}</h2>
      <ul>{group.items.map(item => <li key={item.id}><NotificationRow item={item} onOpen={open} /></li>)}</ul>
    </section>)}
  </div>;
}
