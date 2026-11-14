import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { AvatarEditor, CoverEditor, downscaleImage } from "../PhotoEditors.jsx";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, formatDate, formatPrice, token } from "./core.jsx";
import { Composer, PostCard, ReportDialog } from "./feed.jsx";
import { useDismiss } from "./layout.jsx";
import { SupportersCard, VerifiedBadge } from "./shared.jsx";

export function SubscriptionPanel({ profile, isOwnProfile, busy, onSubscribe, onCancel }) {
  const price = `${formatPrice(profile.subscription_price)}/mês`;
  let status;
  let action = null;
  if (isOwnProfile) {
    status = <>A tua subscrição custa <strong>{price}</strong>. As publicações marcadas como exclusivas só são visíveis para subscritores.</>;
  } else if (profile.is_subscribed && profile.subscription_canceling) {
    status = <>A tua subscrição termina a <strong>{formatDate(profile.subscription_period_end)}</strong> e não vai renovar.</>;
    action = <button className="btn" type="button" disabled={busy} onClick={onSubscribe}>{busy ? "A atualizar..." : "Retomar subscrição"}</button>;
  } else if (profile.is_subscribed) {
    status = <>Subscrito · renova a <strong>{formatDate(profile.subscription_period_end)}</strong> ({price}).</>;
    action = <button className="btn secondary" type="button" disabled={busy} onClick={onCancel}>{busy ? "A cancelar..." : "Cancelar renovação"}</button>;
  } else {
    status = <>Subscreve para veres as publicações exclusivas de {profile.display_name}.</>;
    action = <button className="btn" type="button" disabled={busy} onClick={onSubscribe}>{busy ? "A abrir pagamento..." : `Subscrever por ${price}`}</button>;
  }
  return <div className="subscription-panel">
    <span className="rail-icon"><Icon name="spark" /></span>
    <p>{status}</p>
    {action}
  </div>;
}
// Link externo de um perfil: mostra só o domínio e abre num separador novo sem passar o referrer.
export function WebsiteLink({ href }) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Só http(s): um "javascript:" gravado antes da validação do servidor nunca chega a ser link.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const label = (url.hostname.replace(/^www\./, "") + url.pathname).replace(/\/$/, "");
  return <a className="profile-website" href={url.href} target="_blank" rel="noopener noreferrer nofollow ugc">{label}</a>;
}
// Os três números que importam, junto do nome (o resto fica no cartão Atividade).
export function ProfileHeadline({ profile, username }) {
  const items = [
    ["publicações", profile.posts, `/u/${username}`],
    ["seguidores", profile.followers, null],
    ["amigos", profile.friends, "#profile-friends"]
  ];
  return <ul className="profile-headline-stats">
    {items.map(([label, value, to]) => {
      const content = <><strong>{formatCount(value)}</strong> {value === 1 ? label.replace(/s$/, "").replace(/õe$/, "ão") : label}</>;
      return <li key={label}>{to?.startsWith("#") ? <a href={to}>{content}</a> : to ? <Link to={to}>{content}</Link> : <span>{content}</span>}</li>;
    })}
  </ul>;
}
// Profissão, localidade, site e data de entrada, numa linha por baixo do nome.
export function ProfileMeta({ profile }) {
  const items = [
    profile.profession && ["spark", profile.profession],
    profile.location && ["location", profile.location],
    profile.website && ["externalLink", <WebsiteLink key="site" href={profile.website} />],
    ["events", `No Tchilar desde ${new Date(profile.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}`]
  ].filter(Boolean);
  return <ul className="profile-meta">{items.map(([icon, text], index) => <li key={index}><Icon name={icon} size={14} />{text}</li>)}</ul>;
}
// Cartão "Amigos": até 9 fotos; para quem visita, os amigos em comum aparecem primeiro.
export function ProfileFriendsCard({ username, isOwnProfile }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    api(`/users/${encodeURIComponent(username)}/friends`).then(setData).catch(() => setData({ friends: [], total: 0, mutual: 0 }));
  }, [username]);
  if (!data) return null;
  return <section className="profile-info-card profile-friends-card card" id="profile-friends" aria-labelledby="profile-friends-title">
    <div className="profile-card-head">
      <h2 id="profile-friends-title">Amigos <span>{formatCount(data.total)}</span></h2>
      {isOwnProfile && <Link to="/friends">Ver todos</Link>}
    </div>
    {data.mutual > 0 && <p className="profile-friends-mutual">{data.mutual} {data.mutual === 1 ? "amigo em comum" : "amigos em comum"}</p>}
    {data.friends.length
      ? <ul className="profile-friends-grid">{data.friends.map(friend => <li key={friend.id}>
        <Link to={`/u/${friend.username}`}><Avatar user={friend} /><span>{friend.display_name}</span></Link>
      </li>)}</ul>
      : <p className="muted">{isOwnProfile ? <>Ainda não tens amigos no Tchilar. <Link to="/friends">Encontrar pessoas</Link></> : "Ainda sem amigos no Tchilar."}</p>}
  </section>;
}
// Grelha de fotos e vídeos do perfil (só publicações com imagem ou vídeo).
export function ProfileMediaGrid({ username }) {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const load = () => api(`/posts?username=${encodeURIComponent(username)}&mediaType=media`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));
  useEffect(() => { setPosts(null); load(); }, [username]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (error) return <div className="empty card error">{error}</div>;
  if (!posts) return <div className="empty card">A carregar fotos e vídeos...</div>;
  if (!posts.length) return <div className="empty card">Ainda não há fotos nem vídeos neste perfil.</div>;
  const current = posts.find(post => post.id === open);
  return <section className="profile-media card" aria-label="Fotos e vídeos">
    <ul className="profile-media-grid">{posts.map(post => <li key={post.id}>
      <button type="button" onClick={() => setOpen(post.id)} aria-label={post.body ? `Abrir: ${post.body.slice(0, 80)}` : "Abrir publicação"}>
        {post.media_type === "video"
          ? <><video src={`${API_BASE}${post.media_url}`} muted preload="metadata" playsInline /><span className="profile-media-badge"><Icon name="play" size={14} /></span></>
          : <img src={`${API_BASE}${post.media_url}`} alt="" loading="lazy" />}
      </button>
    </li>)}</ul>
    {current && createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(null); }}>
      <div className="profile-media-viewer" role="dialog" aria-modal="true" aria-label="Publicação">
        <button className="round-button profile-media-close" type="button" aria-label="Fechar" onClick={() => setOpen(null)}><Icon name="close" size={18} /></button>
        <PostCard post={current} onChanged={load} />
      </div>
    </div>, document.body)}
  </section>;
}
export function ProfileStats({ profile }) {
  const stats = [
    ["publicações", profile.posts],
    ["seguidores", profile.followers],
    ["a seguir", profile.following],
    ["amigos", profile.friends],
    ["gostos recebidos", profile.likes_received],
    ["comentários recebidos", profile.comments_received],
    ...(profile.subscribers !== null && profile.subscribers !== undefined ? [["subscritores ativos", profile.subscribers]] : [])
  ];
  return <dl className="profile-stats-grid">
    {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatCount(value)}</dd></div>)}
  </dl>;
}
// Botão de câmara sobre a foto de perfil ou a capa. Sem imagem abre logo o seletor;
// com imagem mostra um menu (carregar nova, editar/reposicionar, remover). Antes de guardar
// abre sempre o editor: recorte e filtros na foto de perfil, posição na capa.
export function ProfilePhotoControl({ kind, profile, onUpdated }) {
  const isAvatar = kind === "avatar";
  const currentUrl = isAvatar ? profile.avatar_url : profile.cover_url;
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState(null); // { src, file?, objectUrl? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeMenu = useMemo(() => () => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);
  const label = isAvatar ? "Alterar foto de perfil" : "Alterar capa";

  const closeEditor = () => {
    if (editor?.objectUrl) URL.revokeObjectURL(editor.objectUrl);
    setEditor(null);
    setError("");
  };

  const pickFile = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return onUpdated(null, "Escolhe um ficheiro de imagem.");
    const objectUrl = URL.createObjectURL(file);
    setEditor({ src: objectUrl, objectUrl, file });
  };

  const openPicker = () => { setMenuOpen(false); inputRef.current?.click(); };
  const editCurrent = () => { setMenuOpen(false); setEditor({ src: `${API_BASE}${currentUrl}` }); };

  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm(isAvatar ? "Remover a foto de perfil?" : "Remover a capa?")) return;
    try {
      const result = await api(`/auth/me/${kind}`, { method: "DELETE" });
      onUpdated(result.user, isAvatar ? "Foto de perfil removida." : "Capa removida.");
    } catch (removeError) {
      onUpdated(null, removeError.message);
    }
  };

  // Foto de perfil: o editor devolve um ficheiro já recortado (640×640).
  const saveAvatar = async file => {
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      const result = await api("/auth/me/avatar", { method: "POST", body: formData });
      closeEditor();
      onUpdated(result.user, "Foto de perfil atualizada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  // Capa: imagem nova é reduzida no browser e enviada com a posição; a atual só muda a posição.
  const saveCover = async position => {
    setBusy(true);
    setError("");
    try {
      let result;
      if (editor.file) {
        const formData = new FormData();
        formData.append("image", await downscaleImage(editor.file, 1920, 6000));
        formData.append("position", String(position));
        result = await api("/auth/me/cover", { method: "POST", body: formData });
      } else {
        result = await api("/auth/me/cover-position", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position })
        });
      }
      closeEditor();
      onUpdated(result.user, "Capa atualizada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className={`photo-control photo-control-${kind}`} ref={menuRef}>
    <button className={`photo-change photo-change-${kind}`} type="button" title={label} aria-label={label}
      aria-haspopup={currentUrl ? "menu" : undefined} aria-expanded={currentUrl ? menuOpen : undefined}
      onClick={() => (currentUrl ? setMenuOpen(open => !open) : openPicker())}>
      <Icon name="camera" size={isAvatar ? 18 : 17} />
      {!isAvatar && <span>Editar capa</span>}
    </button>
    <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" tabIndex={-1} aria-hidden="true" onChange={pickFile} />
    {menuOpen && <div className="post-menu-list photo-menu" role="menu">
      <button type="button" role="menuitem" onClick={openPicker}><Icon name="image" size={15} /> Carregar nova foto</button>
      <button type="button" role="menuitem" onClick={editCurrent}><Icon name={isAvatar ? "create" : "move"} size={15} /> {isAvatar ? "Editar foto atual" : "Reposicionar"}</button>
      <button type="button" role="menuitem" className="danger" onClick={remove}><Icon name="trash" size={15} /> {isAvatar ? "Remover foto" : "Remover capa"}</button>
    </div>}
    {editor && (isAvatar
      ? <AvatarEditor src={editor.src} busy={busy} error={error} onSave={saveAvatar} onCancel={closeEditor} />
      : <CoverEditor src={editor.src} initialPosition={profile.cover_position} busy={busy} error={error} onSave={saveCover} onCancel={closeEditor} />)}
  </div>;
}
export function Profile() {
  const { username } = useParams();
  const { user, refreshUser } = useContext(UserContext);
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const isAboutPage = location.pathname === `/u/${username}/about`;
  const isMediaPage = location.pathname === `/u/${username}/media`;
  const isOwnProfile = user?.username === username;

  useEffect(() => {
    const result = searchParams.get("subscription");
    if (!result) return;
    setMessage(result === "success"
      ? "Pagamento recebido. A subscrição fica ativa assim que a confirmação chegar — pode demorar alguns segundos."
      : "O pagamento foi cancelado. Não foi feita nenhuma cobrança.");
    setSearchParams({}, { replace: true });
    if (result === "success") {
      const timer = window.setTimeout(() => load(), 4000);
      return () => window.clearTimeout(timer);
    }
  }, [searchParams]);

  const subscribe = async () => {
    if (!token()) return setMessage("Entra na tua conta para subscrever.");
    setSubscriptionBusy(true);
    try {
      const result = await api(`/subscriptions/${profile.id}`, { method: "POST" });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      setMessage(result.message);
      await load();
    } catch (actionError) {
      setMessage(actionError.message);
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const cancelSubscription = async () => {
    setSubscriptionBusy(true);
    try {
      await api(`/subscriptions/${profile.id}`, { method: "DELETE" });
      await load();
      setMessage("A subscrição não vai renovar. Manténs o acesso até ao fim do período pago.");
    } catch (actionError) {
      setMessage(actionError.message);
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const load = async () => {
    setProfile(null);
    setPosts([]);
    setError("");
    try {
      const userResult = await api(`/users/${username}`);
      setProfile(userResult.user);
      if (isAboutPage || isMediaPage) {
        setPosts([]);
      } else {
        const postResult = await api(`/posts?username=${encodeURIComponent(username)}`);
        setPosts(postResult.posts);
      }
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, [username, isAboutPage, isMediaPage]);

  // Depois de apagar uma publicação ou bloquear alguém: atualiza só a lista, sem esvaziar a página.
  const reloadProfilePosts = async () => {
    try {
      const [userResult, postResult] = await Promise.all([api(`/users/${username}`), api(`/posts?username=${encodeURIComponent(username)}`)]);
      setProfile(userResult.user);
      setPosts(postResult.posts);
    } catch (reloadError) {
      setError(reloadError.message);
    }
  };

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [reportingProfile, setReportingProfile] = useState(false);
  const photoUpdated = async (updatedUser, text) => {
    if (updatedUser) {
      setProfile(current => ({ ...current, avatar_url: updatedUser.avatar_url, cover_url: updatedUser.cover_url, cover_position: updatedUser.cover_position }));
      await refreshUser();
    }
    setMessage(text);
  };

  const toggleBlock = async () => {
    const blocking = !profile.is_blocked;
    if (blocking && !window.confirm(`Bloquear @${profile.username}? Deixam de ser amigos, de se seguir e de poder trocar mensagens.`)) return;
    try {
      await api(`/users/${profile.id}/block`, { method: blocking ? "POST" : "DELETE" });
      setMessage(blocking ? `Bloqueaste @${profile.username}.` : `Desbloqueaste @${profile.username}.`);
      await load();
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  const toggleFollow = async () => {
    if (!token()) return setMessage("Entra na tua conta para seguir pessoas.");
    try {
      const result = await api(`/users/${profile.id}/follow`, { method: "POST" });
      setProfile(current => ({
        ...current,
        is_following: result.following,
        followers: current.followers + (result.following ? 1 : -1)
      }));
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  const addFriend = async () => {
    if (!token()) return setMessage("Entra na tua conta para adicionar amigos.");
    try {
      await api(`/friends/${profile.id}/request`, { method: "POST" });
      setProfile(current => ({ ...current, friend_request_sent: true }));
      setMessage("Pedido de amizade enviado.");
    } catch (actionError) {
      setMessage(actionError.message);
    }
  };

  if (error) return <div className="page narrow"><div className="empty card error">{error}</div></div>;
  if (!profile) return <div className="page narrow"><div className="empty card">A carregar perfil...</div></div>;

  return <div className="page profile-page">
    <section className="profile-card profile-hero card">
      <div className={`profile-cover${profile.cover_url ? " has-image" : ""}`}>
        {profile.cover_url && <img className="profile-cover-image" src={`${API_BASE}${profile.cover_url}`} alt="" style={{ objectPosition: `50% ${profile.cover_position ?? 50}%` }} />}
        {!isAboutPage && !profile.cover_url && <>
          <span className="profile-cover-kicker">TCHILAR <i /> ESPAÇO DE CRIAÇÃO</span>
          <span className="profile-cover-message">Histórias que<br /><em>nos aproximam.</em></span>
          <span className="profile-cover-mark" aria-hidden="true">B</span>
          <span className="profile-cover-orbit profile-cover-orbit-one" />
          <span className="profile-cover-orbit profile-cover-orbit-two" />
        </>}
        {isOwnProfile && <ProfilePhotoControl kind="cover" profile={profile} onUpdated={photoUpdated} />}
      </div>
      <div className="profile-identity">
        <div className="profile-avatar-wrap">
          <Avatar user={profile} size="large" />
          {profile.online && <span className="profile-online-dot" title="Online agora"><span className="visually-hidden">Online agora</span></span>}
          {isOwnProfile && <ProfilePhotoControl kind="avatar" profile={profile} onUpdated={photoUpdated} />}
        </div>
        <div className="profile-identity-copy">
          <h1>{profile.display_name}<VerifiedBadge show={profile.is_verified} /></h1>
          <p className="handle">@{profile.username}
            {profile.is_creator && <span className="profile-role-chip"><Icon name="spark" size={12} /> Criador</span>}
            {profile.online && <span className="profile-online-chip">Online agora</span>}
            {profile.is_friend && !isOwnProfile && <span className="profile-role-chip"><Icon name="friends" size={12} /> Amigos</span>}</p>
          <ProfileHeadline profile={profile} username={username} />
        </div>
        {<div className="profile-identity-actions">
          {isOwnProfile
            ? <><Link className="btn secondary" to="/profile/edit"><Icon name="create" size={15} /> Editar perfil</Link><Link className="btn secondary" to="/creator"><Icon name="stats" size={15} /> Painel do criador</Link></>
            : <>
              {!profile.is_blocked && <>
                <button className={profile.is_following ? "btn secondary" : "btn"} type="button" aria-pressed={profile.is_following} onClick={toggleFollow}>{profile.is_following ? "A seguir" : "Seguir"}</button>
                {profile.is_friend
                  ? <Link className="btn secondary" to={`/messages/${profile.id}`}><Icon name="messages" size={15} /> Mensagem</Link>
                  : profile.friend_request_sent
                    ? <button className="btn secondary" type="button" disabled><Icon name="check" size={14} /> Pedido enviado</button>
                    : <button className="btn secondary" type="button" onClick={addFriend}><Icon name="plus" size={14} /> Adicionar amigo</button>}
              </>}
              {user && <div className="post-menu">
                <button className="btn secondary icon-only" type="button" aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label="Mais opções" title="Mais opções" onClick={() => setProfileMenuOpen(open => !open)}><Icon name="more" size={18} /></button>
                {profileMenuOpen && <div className="post-menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); setReportingProfile(true); }}><Icon name="report" size={15} /> Denunciar conta</button>
                  <button type="button" role="menuitem" className={profile.is_blocked ? "" : "danger"} onClick={() => { setProfileMenuOpen(false); toggleBlock(); }}><Icon name="block" size={15} /> {profile.is_blocked ? "Desbloquear" : "Bloquear"}</button>
                </div>}
              </div>}
            </>}
        </div>}
      </div>
      {(profile.bio || profile.profession || profile.location || profile.website) && <div className="profile-intro">
        {profile.bio && <p className="profile-intro-bio">{profile.bio}</p>}
        <ProfileMeta profile={profile} />
      </div>}
      {!isAboutPage && profile.is_creator && Number(profile.subscription_price) > 0 && <SubscriptionPanel
        profile={profile}
        isOwnProfile={isOwnProfile}
        busy={subscriptionBusy}
        onSubscribe={subscribe}
        onCancel={cancelSubscription}
      />}
      {profile.is_blocked && <div className="blocked-banner">
        <Icon name="block" />
        <p>Bloqueaste @{profile.username}. Não vês as publicações desta conta e não podem trocar mensagens.</p>
        <button className="btn secondary" type="button" onClick={toggleBlock}>Desbloquear</button>
      </div>}
      {message && <p className="success" role="status">{message}</p>}
      {reportingProfile && <ReportDialog targetType="user" targetId={profile.id} onClose={() => setReportingProfile(false)} />}
    </section>
    <nav className="profile-tabs" aria-label="Navegação do perfil">
      {[[`/u/${username}`, "Publicações", !isAboutPage && !isMediaPage], [`/u/${username}/media`, "Fotos e vídeos", isMediaPage], [`/u/${username}/about`, "Sobre", isAboutPage]]
        .map(([to, label, active]) => <Link key={to} to={to} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>{label}</Link>)}
    </nav>
    {isMediaPage ? <ProfileMediaGrid username={username} /> : isAboutPage ? <section className="profile-about-page card" aria-labelledby="profile-about-heading">
      <h2 id="profile-about-heading">Sobre {profile.display_name}</h2>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Biografia</h3><p>{profile.bio || "Este utilizador ainda não adicionou uma biografia."}</p></div>
      </div>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Nome</h3><p>{profile.display_name}</p></div>
      </div>
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="profile" /></span>
        <div><h3>Nome de utilizador</h3><p>@{profile.username}</p></div>
      </div>
      {profile.profession && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="spark" /></span>
        <div><h3>Profissão</h3><p>{profile.profession}</p></div>
      </div>}
      {profile.location && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="location" /></span>
        <div><h3>Localidade</h3><p>{profile.location}</p></div>
      </div>}
      {profile.website && <div className="profile-about-field">
        <span className="rail-icon"><Icon name="externalLink" /></span>
        <div><h3>Site</h3><p><WebsiteLink href={profile.website} /></p></div>
      </div>}
      <div className="profile-about-field">
        <span className="rail-icon"><Icon name="events" /></span>
        <div><h3>No Tchilar desde</h3><p>{formatDate(profile.created_at)}</p></div>
      </div>
      <ProfileStats profile={profile} />
    </section> : <div className="profile-content-grid">
      <aside className="profile-about-column" id="profile-about">
        {isOwnProfile && !profile.bio && <section className="profile-info-card profile-complete-card card">
          <h2>Completa o teu perfil</h2>
          <p className="muted">Uma biografia e uma foto ajudam as pessoas a reconhecer-te.</p>
          <Link className="btn secondary" to="/profile/edit"><Icon name="create" size={15} /> Adicionar biografia</Link>
        </section>}
        <ProfileFriendsCard username={profile.username} isOwnProfile={isOwnProfile} />
        <section className="profile-info-card profile-stats-card card">
          <h2>Atividade</h2>
          <ProfileStats profile={profile} />
        </section>
        <SupportersCard username={profile.username} />
      </aside>
      <section className="profile-feed-column" id="profile-posts">
        {/* Publicar aqui mesmo, sem sair do perfil (a mesma caixa do Início); a lista atualiza-se a seguir. */}
        {isOwnProfile && <Composer onPosted={reloadProfilePosts} />}
        <div className="profile-posts-heading">
          <div><p className="feed-section-kicker">{isOwnProfile ? "O teu espaço na comunidade" : `Publicações de @${profile.username}`}</p><h2>Publicações</h2></div>
        </div>
        {posts.length ? posts.map(post => <PostCard key={post.id} post={post} onChanged={reloadProfilePosts} />) : <div className="empty card">Ainda não há publicações neste perfil.</div>}
      </section>
    </div>}
  </div>;
}
