import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount } from "./core.jsx";
import { relativeTime } from "./feed.jsx";

// ----- Notificações -----
export const NOTIFICATION_ICONS = {
  like: ["heart", "coral"], comment: ["messages", "ceu"], message: ["messages", "ceu"], friend_request: ["friends", "lagoa"], friend_accept: ["friends", "lagoa"],
  follow: ["profile", "lagoa"], group_join: ["groups", "lagoa"], event_rsvp: ["events", "coral"], share: ["share", "ceu"],
  stars: ["star", "coral"], campaign: ["brand", "lagoa"], challenge: ["trophy", "coral"], referral: ["gift", "coral"],
  ad: ["ad", "coral"], payout: ["gift", "lagoa"], live: ["live", "coral"], moderation: ["shield", "tinta"]
};
export function notificationGroup(value) {
  const date = new Date(value);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (today - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000;
  return diff <= 0 ? "Hoje" : diff === 1 ? "Ontem" : diff < 7 ? "Esta semana" : "Antes";
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
    if (item.type === "live" && item.actor_username) return navigate("/live");
    if (["campaign"].includes(item.type)) return navigate("/creator/parcerias");
    if (["payout"].includes(item.type)) return navigate("/creator/ganhos");
    if (["ad"].includes(item.type)) return navigate("/creator/anuncios");
    if (["stars", "referral", "challenge"].includes(item.type)) return navigate("/estrelas");
    if (item.actor_username) navigate(`/u/${item.actor_username}`);
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
      <ul>{group.items.map(item => {
        const [icon, tone] = NOTIFICATION_ICONS[item.type] || ["notifications", "lagoa"];
        return <li key={item.id}>
          <button type="button" className={`notification-row${item.read ? "" : " is-unread"}`} onClick={() => open(item)}>
            <span className="notification-avatar">
              <Avatar user={{ display_name: item.actor_name || "Biva", avatar_url: item.actor_avatar }} />
              <span className={`notification-type tone-page-${tone}`}><Icon name={icon} size={12} /></span>
            </span>
            <span className="notification-text"><span><strong>{item.actor_name || "Biva"}</strong> {item.text}</span><small>{relativeTime(item.created_at)}</small></span>
            {!item.read && <span className="notification-unread-dot" aria-label="Por ler" />}
          </button>
        </li>;
      })}</ul>
    </section>)}
  </div>;
}
