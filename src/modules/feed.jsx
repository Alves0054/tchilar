import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { downscaleImage } from "../PhotoEditors.jsx";
import { Auth } from "./auth.jsx";
import { API_BASE, Avatar, Icon, UserContext, VideoPlayer, api, formatCount, formatPrice, token } from "./core.jsx";
import { InfoLinks, LiveBadge, StoreButtons, SponsoredSlot, StarGiftButton, TextWithTags, VerifiedBadge, pageTone } from "./shared.jsx";
import { HomeDiscover, HomeNow, PresenceAvatar } from "./home.jsx";
import { DEFAULT_STORY_BACKGROUND, STORY_COLORS, STORY_THEMES, storyBackgroundStyle } from "./community-types.js";

// Escolha do fundo de um story de texto: temas do Tchilar e cores.
function StoryBackgroundPicker({ value, onChange }) {
  const option = (item, style, kind) => <button key={item.key} type="button" className={`story-bg-option is-${kind}`}
    style={style} aria-pressed={value === item.key} aria-label={item.label} title={item.label} onClick={() => onChange(item.key)} />;
  return <div className="story-bg-picker">
    <p className="story-bg-heading">Temas do Tchilar</p>
    <div className="story-bg-row" role="group" aria-label="Temas do Tchilar">{STORY_THEMES.map(item => option(item, storyBackgroundStyle(item.key), "theme"))}</div>
    <p className="story-bg-heading">Cores</p>
    <div className="story-bg-row" role="group" aria-label="Cores">{STORY_COLORS.map(item => option(item, storyBackgroundStyle(item.key), "color"))}</div>
  </div>;
}

// "agora", "há 12 min", "há 3 h", "ontem", "12 de nov."
export function relativeTime(value) {
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  if (hours < 48) return "ontem";
  return date.toLocaleDateString("pt-PT", { day: "numeric", month: "short", ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
}
export function Home() {
  const { user, authReady } = useContext(UserContext);
  if (!authReady) return <div className="auth-loading" role="status">A preparar a tua comunidade...</div>;
  return user ? <Feed /> : <Auth key="login" mode="login" />;
}
export function ExclusiveToggle({ user, checked, onChange }) {
  if (!user?.is_creator || !(Number(user.subscription_price) > 0)) return null;
  return <label className="exclusive-toggle">
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    Só para subscritores
  </label>;
}
export function Composer({ onPosted, target }) {
  const { user } = useContext(UserContext);
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [exclusive, setExclusive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!published) return undefined;
    const timer = window.setTimeout(() => setPublished(null), 15000);
    return () => window.clearTimeout(timer);
  }, [published]);
  const fileInput = useRef(null);
  const textArea = useRef(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const open = () => {
    if (!token()) return navigate("/login");
    setExpanded(true);
    window.requestAnimationFrame(() => textArea.current?.focus());
  };

  const pick = accept => {
    if (!token()) return navigate("/login");
    fileInput.current.accept = accept;
    fileInput.current.click();
  };

  const reset = () => {
    setBody("");
    setFile(null);
    setExclusive(false);
    setExpanded(false);
    setError("");
  };

  const submit = async event => {
    event.preventDefault();
    if (!body.trim() && !file) return setError("Escreve alguma coisa ou junta uma fotografia ou vídeo.");
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 2048, 2048));
    if (target?.type === "group") formData.append("groupId", target.id);
    if (target?.type === "page") formData.append("pageId", target.id);
    if (!target && exclusive) formData.append("isExclusive", "true");
    try {
      const result = await api("/posts", { method: "POST", body: formData });
      reset();
      if (!target && !exclusive && result.post?.id) setPublished(result.post.id);
      onPosted?.();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const firstName = user?.display_name?.split(" ")[0];
  return <form className="composer card" onSubmit={submit}>
    {published && <div className="composer-published" role="status">
      <Icon name="check" size={16} /><span>Publicado! Queres que mais pessoas vejam?</span>
      <Link to={`/creator/anuncios?impulsionar=${published}&orcamento=2000`}><Icon name="bolt" size={14} /> Impulsionar por {formatPrice(2000)}</Link>
      <button type="button" className="round-button" aria-label="Fechar" onClick={() => setPublished(null)}><Icon name="close" size={14} /></button>
    </div>}
    <input ref={fileInput} className="sr-only" type="file" tabIndex={-1} aria-hidden="true"
      onChange={event => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) { setFile(picked); setExpanded(true); } }} />
    <div className="composer-row">
      <Avatar user={user} />
      {expanded
        ? <textarea ref={textArea} aria-label="Nova publicação" rows={3} maxLength={5000} value={body} onChange={event => setBody(event.target.value)}
          placeholder={firstName ? `No que estás a pensar, ${firstName}?` : "No que estás a pensar?"} />
        : <button className="composer-prompt" type="button" onClick={open}>{firstName ? `No que estás a pensar, ${firstName}?` : "No que estás a pensar?"}</button>}
      {!expanded && <div className="composer-quick">
        <button type="button" className="composer-icon tone-video" aria-label="Publicar um vídeo" title="Vídeo" onClick={() => pick("video/*")}><Icon name="video" size={22} /></button>
        <button type="button" className="composer-icon tone-image" aria-label="Publicar uma fotografia" title="Fotografia" onClick={() => pick("image/*")}><Icon name="image" size={22} /></button>
      </div>}
    </div>
    {expanded && <>
      {file && <div className="composer-preview">
        {file.type.startsWith("video") ? <video src={preview} controls muted /> : <img src={preview} alt="Pré-visualização da fotografia escolhida" />}
        <button type="button" className="round-button" aria-label="Remover ficheiro" onClick={() => setFile(null)}><Icon name="close" size={16} /></button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-footer">
        <button type="button" className="composer-chip" onClick={() => pick("image/*,video/*")}><span className="tone-image"><Icon name="image" size={18} /></span>Fotografia ou vídeo</button>
        {!target && <ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />}
        <span className="composer-actions">
          <button className="btn secondary" type="button" disabled={busy} onClick={reset}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy || (!body.trim() && !file)}>{busy ? "A publicar..." : "Publicar"}</button>
        </span>
      </div>
    </>}
  </form>;
}
export const REPORT_REASONS = [
  ["spam", "Spam ou publicidade enganosa"],
  ["harassment", "Assédio ou bullying"],
  ["hate", "Discurso de ódio"],
  ["violence", "Violência ou ameaças"],
  ["sexual", "Conteúdo sexual"],
  ["self_harm", "Automutilação ou suicídio"],
  ["false_info", "Informação falsa"],
  ["impersonation", "Está a fazer-se passar por outra pessoa"],
  ["other", "Outro motivo"]
];
// Janela para denunciar uma publicação, comentário ou conta.
export function ReportDialog({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const what = { post: "publicação", comment: "comentário", user: "conta", course: "curso" }[targetType];

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, details })
      });
      setDone(result.message);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal card report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit}>
      <h2 id="report-title">Denunciar {what}</h2>
      {done
        ? <><p className="success" role="status">{done}</p><div className="modal-actions"><button className="btn" type="button" onClick={onClose} autoFocus>Fechar</button></div></>
        : <>
          <p className="muted">Quem é denunciado não sabe quem fez a denúncia. Se alguém estiver em perigo imediato, contacta as autoridades.</p>
          <fieldset className="report-reasons">
            <legend>Motivo</legend>
            {REPORT_REASONS.map(([id, label]) => <label key={id}><input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} /> {label}</label>)}
          </fieldset>
          <label className="report-details">Detalhes (opcional)<textarea maxLength={1000} rows={3} value={details} onChange={event => setDetails(event.target.value)} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="submit" disabled={busy || !reason}>{busy ? "A enviar..." : "Enviar denúncia"}</button>
          </div>
        </>}
    </form>
  </div>;
}
// Visualizações: uma publicação conta quando fica pelo menos 1 s com metade visível.
// Os ids juntam-se num lote enviado a cada 3 s (ou ao sair da página).
export const viewQueue = new Set();
export const viewsSent = new Set();
export let viewTimer = null;
export function flushPostViews() {
  window.clearTimeout(viewTimer);
  viewTimer = null;
  const ids = [...viewQueue];
  viewQueue.clear();
  if (!ids.length || !token()) return;
  api("/posts/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), keepalive: true }).catch(() => {});
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPostViews(); });
}
export function usePostView(ref, postId, enabled) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || viewsSent.has(postId) || typeof IntersectionObserver !== "function") return undefined;
    let timer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        timer = window.setTimeout(() => {
          viewsSent.add(postId);
          viewQueue.add(postId);
          observer.disconnect();
          if (!viewTimer) viewTimer = window.setTimeout(flushPostViews, 3000);
        }, 1000);
      } else {
        window.clearTimeout(timer);
      }
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [postId, enabled]);
}
export const MAX_SHARE_GROUPS = 5;
export function useSeenOnce(ref, enabled, callback) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver !== "function") return undefined;
    let timer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) timer = window.setTimeout(() => { observer.disconnect(); callback(); }, 1000);
      else window.clearTimeout(timer);
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [enabled]);
}
// Promoções pagas: a impressão só é cobrada quando aparece mesmo no ecrã.
export const recordAdImpression = adId => { if (token()) api(`/ads/${adId}/impression`, { method: "POST" }).catch(() => {}); };
export const recordAdClick = adId => api(`/ads/${adId}/click`, { method: "POST" }).catch(() => ({}));
// Partilhar: escrever algo e escolher o perfil, uma página própria e/ou até 5 grupos.
export function ShareDialog({ post, onClose, onShared }) {
  const { user } = useContext(UserContext);
  const [text, setText] = useState("");
  const [toProfile, setToProfile] = useState(true);
  const [pageId, setPageId] = useState("");
  const [groupIds, setGroupIds] = useState([]);
  const [pages, setPages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    Promise.allSettled([api("/pages"), api("/groups")]).then(([pageResult, groupResult]) => {
      setPages((pageResult.value?.pages || []).filter(page => page.owner_username === user?.username));
      setGroups((groupResult.value?.groups || []).filter(group => group.is_member));
    });
  }, [user?.username]);

  const toggleGroup = id => setGroupIds(current => current.includes(id)
    ? current.filter(item => item !== id)
    : current.length < MAX_SHARE_GROUPS ? [...current, id] : current);

  const destinations = (toProfile ? 1 : 0) + (pageId ? 1 : 0) + groupIds.length;

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, profile: toProfile, pageId: pageId ? Number(pageId) : null, groupIds })
      });
      const places = [toProfile && "no teu perfil", pageId && "na página", groupIds.length && (groupIds.length === 1 ? "num grupo" : `em ${groupIds.length} grupos`)].filter(Boolean);
      setDone(`Partilhado ${places.join(", ").replace(/, ([^,]*)$/, " e $1")}.`);
      onShared(result.shared);
      window.setTimeout(onClose, 1400);
    } catch (shareError) {
      setError(shareError.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="share-title">Partilhar publicação</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      {done
        ? <p className="success share-done" role="status"><Icon name="check" size={18} /> {done}</p>
        : <>
          <div className="share-author"><Avatar user={user} /><strong>{user?.display_name}</strong></div>
          <textarea className="share-text" aria-label="Escreve algo sobre esta publicação" placeholder="Diz algo sobre isto..." maxLength={5000} rows={3}
            value={text} onChange={event => setText(event.target.value)} autoFocus />
          <SharedPostPreview post={post} compact />
          <fieldset className="share-targets">
            <legend>Onde queres partilhar?</legend>
            <label className="share-target">
              <input type="checkbox" checked={toProfile} onChange={event => setToProfile(event.target.checked)} />
              <span className="share-target-icon tone-profile"><Icon name="profile" size={18} /></span>
              <span><strong>No teu perfil</strong><small>Aparece no teu perfil e no feed de quem te segue.</small></span>
            </label>
            {pages.length > 0 && <label className="share-target share-target-select">
              <span className="share-target-icon tone-pages"><Icon name="pages" size={18} /></span>
              <span><strong>Numa página</strong><small>Só páginas que geres.</small></span>
              <select value={pageId} onChange={event => setPageId(event.target.value)} aria-label="Página onde partilhar">
                <option value="">Nenhuma</option>
                {pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select>
            </label>}
            {groups.length > 0 && <div className="share-groups">
              <div className="share-groups-head"><span className="share-target-icon tone-groups"><Icon name="groups" size={18} /></span>
                <span><strong>Em grupos</strong><small>Escolhe até {MAX_SHARE_GROUPS}.</small></span>
                <span className="share-groups-count" aria-live="polite">{groupIds.length}/{MAX_SHARE_GROUPS}</span></div>
              <div className="share-group-list">
                {groups.map(group => {
                  const checked = groupIds.includes(group.id);
                  return <label key={group.id} className={`share-group${checked ? " is-checked" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={!checked && groupIds.length >= MAX_SHARE_GROUPS} onChange={() => toggleGroup(group.id)} />
                    <span className="share-group-initial" aria-hidden="true">{group.name.charAt(0).toUpperCase()}</span>
                    <span>{group.name}<small>{group.member_count} {group.member_count === 1 ? "membro" : "membros"}</small></span>
                  </label>;
                })}
              </div>
            </div>}
          </fieldset>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn" type="submit" disabled={busy || !destinations}>{busy ? "A partilhar..." : "Partilhar agora"}</button>
          </div>
        </>}
    </form>
  </div>, document.body);
}
// Pré-visualização da publicação original dentro de uma partilha.
export function SharedPostPreview({ post, compact = false }) {
  if (post.unavailable) return <div className="shared-post shared-post-unavailable"><Icon name="info" size={16} /> Esta publicação já não está disponível.</div>;
  return <div className={`shared-post${compact ? " is-compact" : ""}`}>
    {post.media_url && (post.media_type === "video"
      ? <video className="shared-post-media" controls={!compact} src={`${API_BASE}${post.media_url}`} />
      : <img className="shared-post-media" src={`${API_BASE}${post.media_url}`} alt="" />)}
    <div className="shared-post-content">
      <div className="shared-post-head">
        <Link to={`/u/${post.username}`} aria-label={`Perfil de ${post.display_name}`}><Avatar user={post} size="tiny" /></Link>
        <span><Link className="post-author" to={`/u/${post.username}`}>{post.display_name}</Link><small>{relativeTime(post.created_at)}</small></span>
      </div>
      {post.body && <p className="shared-post-body"><TextWithTags text={post.body} /></p>}
    </div>
  </div>;
}
// "A ter sucesso": publicação pública com pelo menos 3 interações nas primeiras 72 horas.
export const isTrending = (post, interactions) => !post.is_exclusive && !post.group_id && !post.shared_post_id && !post.hidden_at
  && interactions >= 3 && Date.now() - new Date(post.created_at).getTime() < 72 * 3600 * 1000;
// extraActions: ações a mais no menu "..." (ex.: a equipa de um grupo fixa ou esconde a publicação).
export function PostCard({ post, onChanged, startWithComments = false, extraActions = [] }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body || "");
  const [body, setBody] = useState(post.body || "");
  const [editedAt, setEditedAt] = useState(post.edited_at || null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [likes, setLikes] = useState(Number(post.likes) || 0);
  const [commentCount, setCommentCount] = useState(Number(post.comments) || 0);
  const [shares, setShares] = useState(Number(post.shares) || 0);
  const [stars, setStars] = useState(Number(post.stars) || 0);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const likeBusy = useRef(false);
  const cardRef = useRef(null);
  usePostView(cardRef, post.id, Boolean(user) && String(user?.id) !== String(post.user_id));
  useSeenOnce(cardRef, Boolean(post.sponsored && user), () => recordAdImpression(post.sponsored.ad_id));
  const onSponsoredClick = event => { if (post.sponsored && event.target.closest("a")) recordAdClick(post.sponsored.ad_id); };

  useEffect(() => { setBody(post.body || ""); setEditedAt(post.edited_at || null); }, [post.body, post.edited_at]);
  useEffect(() => {
    setLiked(Boolean(post.liked));
    setLikes(Number(post.likes) || 0);
    setCommentCount(Number(post.comments) || 0);
    setShares(Number(post.shares) || 0);
    setStars(Number(post.stars) || 0);
  }, [post.id, post.liked, post.likes, post.comments, post.shares, post.stars]);

  const saveEdit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft })
      });
      setBody(result.post.body);
      setEditedAt(result.post.edited_at);
      setEditing(false);
    } catch (editError) {
      setError(editError.message);
    } finally {
      setBusy(false);
    }
  };

  const [reporting, setReporting] = useState(null);

  const blockAuthor = async () => {
    if (!window.confirm(`Bloquear @${post.username}? Deixam de ver as publicações um do outro e de poder trocar mensagens.`)) return;
    setError("");
    try {
      await api(`/users/${post.user_id}/block`, { method: "POST" });
      await onChanged();
    } catch (blockError) {
      setError(blockError.message);
    }
  };

  const deleteComment = async commentId => {
    setError("");
    try {
      await api(`/comments/${commentId}`, { method: "DELETE" });
      setComments(current => current.filter(comment => comment.id !== commentId));
      setCommentCount(count => Math.max(0, count - 1));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  // Otimista: o botão muda logo; se o servidor falhar, volta ao estado anterior.
  const toggleLike = async () => {
    if (!token()) return navigate("/login");
    if (likeBusy.current) return;
    likeBusy.current = true;
    setError("");
    const before = { liked, likes };
    setLiked(!liked);
    setLikes(likes + (liked ? -1 : 1));
    try {
      const result = await api(`/posts/${post.id}/like`, { method: "POST" });
      setLiked(result.liked);
      setLikes(result.likes);
    } catch (actionError) {
      setLiked(before.liked);
      setLikes(before.likes);
      setError(actionError.message);
    } finally {
      likeBusy.current = false;
    }
  };

  // Na página da publicação, os comentários abrem logo.
  useEffect(() => { if (startWithComments) toggleComments(); }, []);

  const toggleComments = async () => {
    const opening = !showComments;
    setShowComments(opening);
    if (!opening) return;
    setError("");
    try {
      const result = await api(`/posts/${post.id}/comments`);
      setComments(result.comments);
    } catch (actionError) {
      setError(actionError.message);
    }
  };

  const addComment = async event => {
    event.preventDefault();
    if (!token()) return navigate("/login");
    setBusy(true);
    setError("");
    try {
      const result = await api(`/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentText })
      });
      setComments([...comments, { ...result.comment, user_id: user?.id, username: user?.username, display_name: user?.display_name, avatar_url: user?.avatar_url }]);
      setCommentText("");
      setCommentCount(count => count + 1);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  };

  // Partilhar a partilha de alguém partilha a publicação original.
  const shareSource = post.shared && !post.shared.unavailable ? post.shared : post;
  const canShare = post.shared ? !post.shared.unavailable : !post.is_exclusive && !post.group_id;
  const share = () => {
    if (!token()) return navigate("/login");
    setNotice("");
    setSharing(true);
  };

  const deletePost = async () => {
    setDeleting(true);
    setError("");
    try {
      await api(`/posts/${post.id}`, { method: "DELETE" });
      await onChanged();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting(false);
    }
  };

  const ownsPost = user && String(user.id) === String(post.user_id);

  return <article className={`post card${post.sponsored ? " is-sponsored" : ""}`} ref={cardRef} onClickCapture={onSponsoredClick}>
    <div className="post-head">
      <Link to={`/u/${post.username}`} aria-label={`Perfil de ${post.display_name}`}><Avatar user={post} /></Link>
      <div className="post-byline"><span className="post-author-line"><Link className="post-author" to={`/u/${post.username}`}>{post.display_name}</Link><VerifiedBadge show={post.is_verified} /></span><span className="post-meta">{post.sponsored && <><span className="sponsored-label"><Icon name="spark" size={12} /> Patrocinado</span><span aria-hidden="true">·</span></>}<span>@{post.username}</span><span aria-hidden="true">·</span><Link className="post-permalink" to={`/posts/${post.id}`}><time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString("pt-PT")}>{relativeTime(post.created_at)}</time></Link><span aria-hidden="true">·</span><span className="post-audience" title={post.is_exclusive ? "Só subscritores" : post.group_name ? `Grupo: ${post.group_name}` : "Público"}><Icon name={post.is_exclusive ? "spark" : post.group_name ? "groups" : "globe"} size={12} /></span>{editedAt && <span title={new Date(editedAt).toLocaleString("pt-PT")}>· editado</span>}</span></div>
      {(post.is_creator || post.is_exclusive || user) && <div className="post-head-tools">
        {post.is_creator && <span className="creator-badge">Criador</span>}
        {post.is_exclusive && <span className="exclusive-badge">Exclusivo</span>}
        {post.hidden_at && ownsPost && <span className="hidden-badge" title="Escondida pela moderação: só tu a vês.">Escondida</span>}
        {post.pinned_at && post.group_id && !post.hidden_at && <span className="pinned-badge" title="Fixada pela equipa do grupo"><Icon name="pin" size={12} /> Fixada</span>}
        {user && !ownsPost && <div className="post-menu">
          <button className="post-delete-button" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Opções da publicação" title="Opções" onClick={() => setMenuOpen(open => !open)}><Icon name="more" size={20} /></button>
          {menuOpen && <div className="post-menu-list" role="menu">
            {extraActions.map(action => <button key={action.label} type="button" role="menuitem" className={action.danger ? "danger" : ""} onClick={() => { setMenuOpen(false); action.onClick(); }}><Icon name={action.icon} size={15} /> {action.label}</button>)}
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setReporting({ targetType: "post", targetId: post.id }); }}><Icon name="report" size={15} /> Denunciar publicação</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); blockAuthor(); }}><Icon name="block" size={15} /> Bloquear @{post.username}</button>
          </div>}
        </div>}
        {ownsPost && (confirmDelete
          ? <div className="post-delete-confirm" role="group" aria-label="Confirmar eliminação da publicação">
            <span>Apagar publicação?</span>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancelar</button>
            <button className="confirm" type="button" onClick={deletePost} disabled={deleting}>{deleting ? "A apagar..." : "Apagar"}</button>
          </div>
          : <div className="post-menu">
            <button className="post-delete-button" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Opções da publicação" title="Opções" onClick={() => setMenuOpen(open => !open)}><Icon name="more" size={20} /></button>
            {menuOpen && <div className="post-menu-list" role="menu">
              {extraActions.map(action => <button key={action.label} type="button" role="menuitem" className={action.danger ? "danger" : ""} onClick={() => { setMenuOpen(false); action.onClick(); }}><Icon name={action.icon} size={15} /> {action.label}</button>)}
              {!post.is_exclusive && !post.group_id && !post.shared_post_id && !post.hidden_at && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); navigate(`/creator/anuncios?impulsionar=${post.id}`); }}><Icon name="bolt" size={15} /> Impulsionar publicação</button>}
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDraft(body); setEditing(true); }}><Icon name="create" size={15} /> Editar</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setError(""); setConfirmDelete(true); }}><Icon name="trash" size={15} /> Apagar</button>
            </div>}
          </div>)}
      </div>}
    </div>
    {editing
      ? <form className="post-edit" onSubmit={saveEdit}>
        <textarea aria-label="Editar publicação" maxLength={5000} rows={4} value={draft} onChange={event => setDraft(event.target.value)} autoFocus />
        <div className="post-edit-actions">
          <button className="btn secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy}>{busy ? "A guardar..." : "Guardar"}</button>
        </div>
      </form>
      : body && <p className="post-body"><TextWithTags text={body} /></p>}
    {post.shared && <SharedPostPreview post={post.shared} />}
    {post.media_url && (post.media_type === "video"
      ? <VideoPlayer className="media" src={`${API_BASE}${post.media_url}`} edit={post.video_edit} label={`Vídeo de ${post.display_name}`}
        music={post.music ? { title: post.music.title, artist: post.music.artist, src: `${API_BASE}${post.music.audio_url}` } : null} />
      : <img className="media" src={`${API_BASE}${post.media_url}`} alt="Publicação" />)}
    <div className="post-counts">
      <span><span className="post-count-mark" aria-hidden="true"><Icon name="heart" size={11} /></span>{formatCount(likes)} {likes === 1 ? "gosto" : "gostos"}</span>
      <span className="post-counts-right">
        <button className="text-button" onClick={toggleComments}>{formatCount(commentCount)} {commentCount === 1 ? "comentário" : "comentários"}</button>
        {shares > 0 && <span>{formatCount(shares)} {shares === 1 ? "partilha" : "partilhas"}</span>}
        {stars > 0 && <span className="post-stars-count"><Icon name="star" size={13} /> {formatCount(stars)}</span>}
      </span>
    </div>
    <div className="post-actions">
      <button className={liked ? "active" : ""} type="button" aria-pressed={liked} onClick={toggleLike}><span className="post-like-icon" aria-hidden="true"><Icon name="like" size={18} /></span>{liked ? "Gostaste" : "Gosto"}</button>
      <button type="button" aria-expanded={showComments} onClick={toggleComments}><span aria-hidden="true"><Icon name="messages" size={18} /></span>Comentar</button>
      <button type="button" onClick={share} disabled={!canShare} title={canShare ? "Partilhar" : "Só publicações públicas podem ser partilhadas"}><span aria-hidden="true"><Icon name="share" size={18} /></span>Partilhar</button>
      {user && !ownsPost && <StarGiftButton post={post} onGifted={setStars} />}
    </div>
    {ownsPost && !post.sponsored && isTrending(post, likes + commentCount + shares) && <Link className="boost-nudge" to={`/creator/anuncios?impulsionar=${post.id}&orcamento=2000`}>
      <Icon name="bolt" size={16} /><span><strong>Esta publicação está a ter sucesso.</strong> Impulsiona por {formatPrice(2000)} e chega a mais pessoas.</span><Icon name="next" size={16} />
    </Link>}
    {showComments && <div className="comments">
      {comments.map(comment => <div className="comment" key={comment.id}>
        <Avatar user={comment} size="tiny" />
        <p><strong>{comment.display_name || comment.username}</strong> {comment.body}</p>
        {user && (String(comment.user_id) === String(user.id) || ownsPost) && <button className="comment-delete" type="button" aria-label="Apagar comentário" title="Apagar comentário" onClick={() => deleteComment(comment.id)}><Icon name="trash" size={14} /></button>}
        {user && String(comment.user_id) !== String(user.id) && <button className="comment-delete" type="button" aria-label="Denunciar comentário" title="Denunciar comentário" onClick={() => setReporting({ targetType: "comment", targetId: comment.id })}><Icon name="report" size={14} /></button>}
      </div>)}
      {user && <form className="comment-form" onSubmit={addComment}><Avatar user={user} size="tiny" /><input value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Escreve um comentário..." maxLength="2000" /><button className="text-button" disabled={busy}>Publicar</button></form>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {sharing && <ShareDialog post={shareSource} onClose={() => setSharing(false)} onShared={count => {
      if (shareSource.id === post.id) setShares(value => value + count);
      setNotice(count === 1 ? "Publicação partilhada." : `Publicação partilhada em ${count} sítios.`);
    }} />}
    {reporting && <ReportDialog {...reporting} onClose={() => setReporting(null)} />}
  </article>;
}
export const STORY_SECONDS = 10;
export function StoryZone() {
  const { user } = useContext(UserContext);
  const [stories, setStories] = useState([]);
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [background, setBackground] = useState(DEFAULT_STORY_BACKGROUND);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  // Temporizador: cada story fica STORY_SECONDS no ecrã (os vídeos, a sua duração).
  const [storyReady, setStoryReady] = useState(false);
  const [storyDuration, setStoryDuration] = useState(STORY_SECONDS);
  const [storyPaused, setStoryPaused] = useState(false);
  const [storyHeld, setStoryHeld] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);

  const load = async () => {
    try {
      const result = await api("/stories");
      setStories(result.stories);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { load(); }, []);

  const storyGroups = stories.reduce((groups, story) => {
    let group = groups.find(item => item.user_id === story.user_id);
    if (!group) {
      group = { user_id: story.user_id, username: story.username, display_name: story.display_name, avatar_url: story.avatar_url, stories: [] };
      groups.push(group);
    }
    group.stories.push(story);
    return groups;
  }, []);
  const [liveNow, setLiveNow] = useState([]);
  useEffect(() => { api("/lives").then(result => setLiveNow(result.lives.slice(0, 6))).catch(() => {}); }, []);
  const [sponsoredStory, setSponsoredStory] = useState(null);
  useEffect(() => { api("/ads/feed?placement=stories").then(result => setSponsoredStory(result.posts[0] || null)).catch(() => {}); }, []);
  if (sponsoredStory) storyGroups.splice(0, 0, {
    user_id: `ad-${sponsoredStory.sponsored.ad_id}`, sponsoredAdId: sponsoredStory.sponsored.ad_id,
    username: sponsoredStory.username, display_name: sponsoredStory.display_name, avatar_url: sponsoredStory.avatar_url,
    stories: [{ id: `ad-${sponsoredStory.id}`, user_id: sponsoredStory.user_id, body: sponsoredStory.body, media_url: sponsoredStory.media_url, media_type: sponsoredStory.media_type, created_at: sponsoredStory.created_at }]
  });
  const activeGroup = storyGroups.find(group => group.user_id === activeGroupId);
  // Abrir o story patrocinado conta como impressão.
  useEffect(() => { if (activeGroup?.sponsoredAdId) recordAdImpression(activeGroup.sponsoredAdId); }, [activeGroup?.sponsoredAdId]);
  const activeStory = activeGroup?.stories[activeStoryIndex];

  useEffect(() => {
    if (!activeStory) return undefined;
    const handleKeyDown = event => {
      if (event.key === "Escape") setActiveGroupId(null);
      if (event.key === "ArrowRight") moveStory(1);
      if (event.key === "ArrowLeft") moveStory(-1);
      if (event.key === " " && event.target === document.body) { event.preventDefault(); setStoryPaused(value => !value); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeStory, activeGroup, activeStoryIndex]);

  // Cada story novo começa do zero; texto está pronto logo, imagens e vídeos quando carregam.
  useEffect(() => {
    setStoryReady(!activeStory?.media_url);
    setStoryDuration(STORY_SECONDS);
    setStoryHeld(false);
  }, [activeStory?.id]);

  useEffect(() => {
    if (!activeGroupId) setStoryPaused(false);
  }, [activeGroupId]);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const storyRunning = storyReady && !storyPaused && !storyHeld && !pageHidden;
  const storyVideo = useRef(null);
  const storyPress = useRef(0);
  useEffect(() => {
    const video = storyVideo.current;
    if (!video) return;
    if (storyRunning) video.play().catch(() => {});
    else video.pause();
  }, [storyRunning, activeStory?.id]);

  const createStory = async event => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 1080, 1920));
    else formData.append("background", background);
    try {
      const result = await api("/stories", { method: "POST", body: formData });
      setStories(current => [result.story, ...current]);
      setBody("");
      setFile(null);
      setBackground(DEFAULT_STORY_BACKGROUND);
      setShowComposer(false);
      setNotice("O teu story já está visível durante 24 horas.");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const track = useRef(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  useEffect(() => {
    const element = track.current;
    if (!element) return undefined;
    const update = () => setCanScroll({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { element.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [stories.length]);
  const scrollStories = direction => track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.8, behavior: "smooth" });

  // Avança/recua dentro dos stories da pessoa; nos extremos passa para a pessoa seguinte ou anterior.
  const moveStory = direction => {
    if (!activeGroup) return;
    const nextIndex = activeStoryIndex + direction;
    const groupIndex = storyGroups.findIndex(group => group.user_id === activeGroup.user_id);
    if (nextIndex >= 0 && nextIndex < activeGroup.stories.length) {
      setActiveStoryIndex(nextIndex);
    } else if (direction > 0 && groupIndex < storyGroups.length - 1) {
      setActiveGroupId(storyGroups[groupIndex + 1].user_id);
      setActiveStoryIndex(0);
    } else if (direction < 0 && groupIndex > 0) {
      const previousGroup = storyGroups[groupIndex - 1];
      setActiveGroupId(previousGroup.user_id);
      setActiveStoryIndex(previousGroup.stories.length - 1);
    } else if (direction > 0) {
      setActiveGroupId(null);
    }
  };

  return <section className="stories" aria-label="Stories">
    <div className="stories-track" ref={track}>
      <button className="stories-card stories-create" type="button" onClick={() => { setError(""); setShowComposer(true); }}>
        <span className="stories-create-photo">{user?.avatar_url ? <img src={`${API_BASE}${user.avatar_url}`} alt="" /> : <span>{(user?.display_name || "?").charAt(0).toUpperCase()}</span>}</span>
        <span className="stories-create-plus" aria-hidden="true"><Icon name="plus" size={20} /></span>
        <span className="stories-create-label">Criar story</span>
      </button>
      {/* O cartão abre o story; o nome é um link à parte (um link não pode ficar dentro de um botão). */}
      {liveNow.map(live => <Link key={`live-${live.id}`} className="stories-card stories-live" to={`/live/${live.id}`} aria-label={`Ver o direto de ${live.display_name}`}>
        <span className={`stories-live-cover tone-page-${pageTone(live.username)}`} />
        <span className="stories-ring is-live"><Avatar user={live} size="tiny" /></span>
        <LiveBadge small />
        <span className="stories-name">{live.display_name}</span>
      </Link>)}
      {storyGroups.map(group => <div className="stories-card" key={group.user_id}>
        <button className="stories-open" type="button" aria-label={`Ver story de ${group.display_name}`}
          onClick={() => { setActiveStoryIndex(0); setActiveGroupId(group.user_id); }}>
          {group.stories[0].media_url
            ? group.stories[0].media_type === "video"
              ? <video src={`${API_BASE}${group.stories[0].media_url}`} muted playsInline />
              : <img src={`${API_BASE}${group.stories[0].media_url}`} alt="" />
            : <span className={`stories-text${group.stories[0].background ? " has-background" : ` story-cover-tone-${group.user_id % 4}`}`}
              style={storyBackgroundStyle(group.stories[0].background) || undefined}><span>{group.stories[0].body}</span></span>}
          <span className="stories-ring"><Avatar user={group} size="tiny" /></span>
        </button>
        {group.sponsoredAdId && <span className="stories-sponsored">Patrocinado</span>}
        <Link className="stories-name" to={`/u/${group.username}`}>{group.display_name}</Link>
      </div>)}
    </div>
    {canScroll.right && <button className="stories-arrow next" type="button" aria-label="Ver mais stories" onClick={() => scrollStories(1)}><Icon name="next" size={20} /></button>}
    {canScroll.left && <button className="stories-arrow previous" type="button" aria-label="Stories anteriores" onClick={() => scrollStories(-1)}><Icon name="previous" size={20} /></button>}
    {notice && <p className="story-notice" role="status">{notice}</p>}
    {error && <p className="story-error" role="alert">{error}</p>}
    {showComposer && <div className="story-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowComposer(false); }}>
      <form className="story-composer-modal" onSubmit={createStory} aria-label="Criar story">
        <button className="story-modal-close" type="button" aria-label="Fechar" onClick={() => setShowComposer(false)}><Icon name="close" size={17} /></button>
        <p className="feed-section-kicker">Um momento, à tua maneira</p>
        <h2>Criar story</h2>
        <p className="story-modal-description">Escreve uma ideia ou junta uma fotografia. O teu story fica disponível durante 24 horas.</p>
        {file
          ? <textarea aria-label="Texto do story" maxLength="500" placeholder="Escreve uma legenda (opcional)" value={body} onChange={event => setBody(event.target.value)} />
          : <>
            {/* Pré-visualização: o texto escreve-se diretamente sobre o fundo escolhido. */}
            <div className="story-compose-preview has-background" style={storyBackgroundStyle(background)}>
              <textarea aria-label="Texto do story" maxLength="500" placeholder="Escreve aqui o teu story" value={body} onChange={event => setBody(event.target.value)} />
            </div>
            <StoryBackgroundPicker value={background} onChange={setBackground} />
          </>}
        <div className="story-modal-footer">
          <label className="story-file-label"><Icon name="camera" size={15} />Fotografia ou vídeo<input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <span className="story-character-count">{body.length}/500</span>
        </div>
        {file && <p className="story-selected-file">{file.name}</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn full" type="submit" disabled={busy || (!body.trim() && !file)}>{busy ? "A publicar..." : "Partilhar story"}</button>
      </form>
    </div>}
    {activeStory && <div className="story-viewer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setActiveGroupId(null); }}>
      <section className={`story-viewer${storyRunning ? "" : " is-paused"}`} role="dialog" aria-modal="true" aria-label={`Story de ${activeGroup.display_name}`}
        style={{ "--story-duration": `${storyDuration}s` }}>
        <div className="story-viewer-top">
          {/* Uma barra por story; a atual enche durante o tempo do story e depois avança sozinha. */}
          <div className="story-progress-row" aria-hidden="true">{activeGroup.stories.map((story, index) => <span key={story.id}
            className={index < activeStoryIndex ? "done" : index === activeStoryIndex ? "current" : ""}>
            {index === activeStoryIndex && <i key={story.id} onAnimationEnd={() => moveStory(1)} />}
          </span>)}</div>
          <div className="story-viewer-author"><Link className="story-viewer-profile" to={`/u/${activeGroup.username}`} onClick={() => setActiveGroupId(null)} title={`Ver perfil de ${activeGroup.display_name}`}><Avatar user={activeGroup} size="tiny" /><span className="story-viewer-meta"><strong>{activeGroup.display_name}</strong><small>{activeGroup.sponsoredAdId ? "Patrocinado" : relativeTime(activeStory.created_at)}</small></span></Link><button type="button" className="story-viewer-pause" aria-label={storyPaused ? "Continuar story" : "Pausar story"} aria-pressed={storyPaused} onClick={() => setStoryPaused(value => !value)}><Icon name={storyPaused ? "play" : "pause"} size={16} /></button><button type="button" aria-label="Fechar story" onClick={() => setActiveGroupId(null)}><Icon name="close" size={17} /></button></div>
        </div>
        {activeStory.media_url && (activeStory.media_type === "video"
          ? <video key={activeStory.id} ref={storyVideo} className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} playsInline
            onLoadedMetadata={event => { const seconds = event.currentTarget.duration; setStoryDuration(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : STORY_SECONDS); setStoryReady(true); }}
            onError={() => setStoryReady(true)} />
          : <img key={activeStory.id} className="story-viewer-media" src={`${API_BASE}${activeStory.media_url}`} alt={`Story de ${activeGroup.display_name}`}
            onLoad={() => setStoryReady(true)} onError={() => setStoryReady(true)} />)}
        {activeStory.body && <p className={`story-viewer-body ${activeStory.media_url ? "" : activeStory.background ? "has-background" : `story-cover-tone-${activeStory.user_id % 4}`}`}
          style={!activeStory.media_url ? storyBackgroundStyle(activeStory.background) || undefined : undefined}>{activeStory.body}</p>}
        {/* Sem setas: um toque rápido no terço esquerdo volta atrás, no resto avança; manter carregado pausa. */}
        <div className="story-viewer-hold" aria-hidden="true"
          onPointerDown={event => { storyPress.current = Date.now(); setStoryHeld(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
          onPointerUp={event => {
            setStoryHeld(false);
            const quickTap = Date.now() - storyPress.current < 250;
            storyPress.current = 0;
            if (!quickTap) return;
            const box = event.currentTarget.getBoundingClientRect();
            moveStory(event.clientX - box.left < box.width / 3 ? -1 : 1);
          }}
          onPointerCancel={() => { storyPress.current = 0; setStoryHeld(false); }} />
        <button className="story-viewer-nav previous visually-hidden" type="button" aria-label="Story anterior" onClick={() => moveStory(-1)}><Icon name="previous" size={20} /></button>
        <button className="story-viewer-nav next visually-hidden" type="button" aria-label="Próximo story" onClick={() => moveStory(1)}><Icon name="next" size={20} /></button>
      </section>
    </div>}
  </section>;
}
// Dados partilhados pelas colunas laterais do feed (amigos, pedidos, grupos, páginas, eventos).
export function useHomeSidebars(user) {
  const [data, setData] = useState({ friends: [], requests: [], groups: [], pages: [], events: [], home: null });
  const load = async () => {
    if (!user) return;
    const [friendResult, groupResult, pageResult, eventResult, homeResult] = await Promise.allSettled([
      api("/friends"), api("/groups"), api("/pages"), api("/events"), api("/home")]);
    setData({
      friends: friendResult.value?.friends || [],
      requests: friendResult.value?.requests || [],
      groups: (groupResult.value?.groups || []).filter(group => group.is_member),
      pages: (pageResult.value?.pages || []).filter(page => page.is_following),
      events: eventResult.value?.events || [],
      home: homeResult.value || null
    });
  };
  useEffect(() => { load(); }, [user?.id]);
  // Quem está online muda: atualiza a cada 2 minutos enquanto o separador está visível.
  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 120000);
    return () => window.clearInterval(timer);
  }, [user?.id]);
  return [data, load];
}
export const HOME_LINKS = [
  ["/creator", "stats", "Painel do criador"],
  ["/live", "live", "Diretos"],
  ["/friends", "friends", "Amigos"],
  ["/messages", "messages", "Mensagens"],
  ["/groups", "groups", "Grupos"],
  ["/pages", "pages", "Páginas"],
  ["/events", "events", "Eventos"],
  ["/reels", "reels", "Reels"]
];
export const HOME_MORE_LINKS = [
  ["/estrelas", "star", "Estrelas"],
  ["/desafios", "trophy", "Desafios"],
  ["/marcas", "brand", "Marcas"],
  ["/convidar", "gift", "Convidar amigos"],
  ["/academia", "academy", "Academia Tchilar"],
  ["/notifications", "notifications", "Notificações"],
  ["/settings", "settings", "Definições"],
  ["/help", "help", "Ajuda"]
];
export function HomeLeft({ user, data }) {
  const [more, setMore] = useState(false);
  const shortcuts = [
    ...data.groups.map(group => ({ key: `g${group.id}`, to: `/groups/${group.id}`, name: group.name, kind: "groups" })),
    ...data.pages.map(page => ({ key: `p${page.id}`, to: `/pages/${page.id}`, name: page.name, kind: "pages" }))
  ].slice(0, 8);
  const links = more ? [...HOME_LINKS, ...HOME_MORE_LINKS, ...(user?.is_admin ? [["/admin", "shield", "Administração"]] : [])] : HOME_LINKS;
  return <aside className="home-left" aria-label="Atalhos">
    {user && <Link className="home-link" to={`/u/${user.username}`}><Avatar user={user} /><span>{user.display_name}</span></Link>}
    {links.map(([to, icon, label]) => <Link className="home-link" key={to} to={to}><span className={`home-link-icon tone-${icon}`}><Icon name={icon} size={20} /></span><span>{label}</span></Link>)}
    <button className="home-link" type="button" aria-expanded={more} onClick={() => setMore(value => !value)}>
      <span className="home-link-icon tone-neutral"><Icon name={more ? "previous" : "chevronDown"} size={20} /></span><span>{more ? "Ver menos" : "Ver mais"}</span>
    </button>
    <hr />
    <h2 className="home-heading">Os teus atalhos</h2>
    {shortcuts.length
      ? shortcuts.map(item => <Link className="home-link" key={item.key} to={item.to}>
        <span className={`home-shortcut tone-${item.kind}`}>{item.name.charAt(0).toUpperCase()}</span><span>{item.name}</span>
      </Link>)
      : <p className="home-empty">Os grupos e páginas que segues aparecem aqui. <Link to="/groups">Descobrir grupos</Link></p>}
    <StoreButtons />
    <InfoLinks />
  </aside>;
}
export function HomeRight({ data, reload }) {
  const [busyId, setBusyId] = useState(null);
  const answer = async (id, action) => {
    setBusyId(id);
    try {
      await api(`/friends/requests/${id}/${action}`, { method: "POST" });
      await reload();
    } finally {
      setBusyId(null);
    }
  };
  const onlineCount = data.friends.filter(friend => friend.online).length;
  return <aside className="home-right" aria-label="Novidades">
    {data.requests.length > 0 && <section>
      <div className="home-heading-row"><h2 className="home-heading">Pedidos de amizade</h2><Link to="/friends">Ver tudo</Link></div>
      {data.requests.slice(0, 2).map(request => <div className="home-request" key={request.id}>
        <Link to={`/u/${request.username}`} aria-label={`Perfil de ${request.display_name}`}><Avatar user={request} size="large" /></Link>
        <div>
          <Link className="home-request-name" to={`/u/${request.username}`}>{request.display_name}</Link>
          <small>{relativeTime(request.created_at)}</small>
          <div className="home-request-actions">
            <button className="btn" type="button" disabled={busyId === request.id} onClick={() => answer(request.id, "accept")}>Confirmar</button>
            <button className="btn secondary" type="button" disabled={busyId === request.id} onClick={() => answer(request.id, "reject")}>Recusar</button>
          </div>
        </div>
      </div>)}
    </section>}
    <section><HomeDiscover discover={data.home?.discover} /></section>
    {data.events.length > 0 && <section>
      <div className="home-heading-row"><h2 className="home-heading">Próximos eventos</h2><Link to="/events">Ver tudo</Link></div>
      {data.events.slice(0, 2).map(event => <Link className="home-event" key={event.id} to="/events">
        <span className="home-event-date"><strong>{new Date(event.starts_at).toLocaleDateString("pt-PT", { day: "2-digit" })}</strong><small>{new Date(event.starts_at).toLocaleDateString("pt-PT", { month: "short" })}</small></span>
        <span><strong>{event.name}</strong><small>{event.attendee_count} {event.attendee_count === 1 ? "participante" : "participantes"}{event.location ? ` · ${event.location}` : ""}</small></span>
      </Link>)}
    </section>}
    <section>
      <h2 className="home-heading">Patrocinado</h2>
      <SponsoredSlot />
    </section>
    <section>
      <h2 className="home-heading">Contactos{onlineCount > 0 && <small className="home-online-count"> · {onlineCount} online</small>}</h2>
      {data.friends.length
        ? data.friends.slice(0, 12).map(friend => <Link className="home-link" key={friend.id} to={`/messages/${friend.id}`} title={`Enviar mensagem a ${friend.display_name}${friend.online ? " (online)" : ""}`}>
          <PresenceAvatar user={friend} /><span>{friend.display_name}</span>
        </Link>)
        : <p className="home-empty">Ainda não tens amigos no Tchilar. <Link to="/friends">Encontrar pessoas</Link></p>}
    </section>
  </aside>;
}
// Página de uma publicação (/posts/:postId): aberta das notificações, de links partilhados e da hora da publicação.
export function PostPage() {
  const { postId } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPost(null); setError("");
    api(`/posts/${postId}`).then(result => setPost(result.post)).catch(loadError => setError(loadError.message));
  }, [postId]);
  return <div className="post-page">
    <button type="button" className="post-page-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
      <Icon name="previous" size={18} /> Voltar
    </button>
    {!post && !error && <div className="post-page-loading" aria-busy="true"><span /><span /><span /></div>}
    {error && <div className="post-page-missing">
      <Icon name="info" size={28} />
      <strong>Publicação indisponível</strong>
      <p>{error}</p>
      <Link className="btn" to="/">Ir para o Início</Link>
    </div>}
    {post && <PostCard key={post.id} post={post} startWithComments onChanged={() => navigate("/")} />}
  </div>;
}

export function Feed() {
  const { user } = useContext(UserContext);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [scope, setScope] = useState(() => {
    try { return (localStorage.getItem("biva-feed") || localStorage.getItem("buala-feed")) === "following" ? "following" : "all"; } catch { return "all"; }
  });
  const activeScope = user ? scope : "all";
  const [sidebars, reloadSidebars] = useHomeSidebars(user);
  const [sponsored, setSponsored] = useState([]);
  useEffect(() => { api("/ads/feed").then(result => setSponsored(result.posts)).catch(() => setSponsored([])); }, [user?.id]);
  const feedItems = useMemo(() => {
    // Se a publicação impulsionada já está no feed, essa cópia recebe a etiqueta (sem a repetir).
    const sponsorById = new Map(sponsored.map(post => [post.id, post.sponsored]));
    const organicIds = new Set(posts.map(post => post.id));
    const extra = sponsored.filter(post => !organicIds.has(post.id));
    const items = posts.map(post => ({ key: post.id, post: sponsorById.has(post.id) ? { ...post, sponsored: sponsorById.get(post.id) } : post }));
    if (!posts.length || !extra.length) return items;
    [3, 10].forEach((position, index) => {
      const ad = extra[index];
      if (ad) items.splice(Math.min(position + index, items.length), 0, { key: `sponsored-${ad.sponsored.ad_id}`, post: ad });
    });
    return items;
  }, [posts, sponsored]);

  const load = async () => {
    setError("");
    try {
      const result = await api(`/posts?feed=${activeScope}`);
      setPosts(result.posts);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message === "Failed to fetch" ? "Não foi possível ligar à API. Confirma que o servidor está em execução." : loadError.message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await api(`/posts?feed=${activeScope}&before=${nextCursor}`);
      setPosts(current => [...current, ...result.posts.filter(post => !current.some(existing => existing.id === post.id))]);
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const changeScope = value => {
    setScope(value);
    setLoading(true);
    try { localStorage.setItem("biva-feed", value); } catch { /* preferência opcional */ }
  };

  useEffect(() => { load(); }, [activeScope]);

  return <div className="home">
    <HomeLeft user={user} data={sidebars} />
    <section className="home-feed" aria-labelledby="home-feed-title">
      <h1 className="visually-hidden" id="home-feed-title">Início</h1>
      <Composer onPosted={load} />
      <StoryZone />
      <HomeNow now={sidebars.home?.now} />
      {user && <div className="feed-tabs" role="tablist" aria-label="Que publicações mostrar">
        <button type="button" role="tab" aria-selected={activeScope === "all"} onClick={() => changeScope("all")}>Para ti</button>
        <button type="button" role="tab" aria-selected={activeScope === "following"} onClick={() => changeScope("following")}>Amigos e quem segues</button>
      </div>}
      {loading && <div className="empty card">A carregar publicações...</div>}
      {error && <div className="empty card error">{error}</div>}
      {!loading && !error && !posts.length && <div className="empty card">{activeScope === "following"
        ? <>Ainda não há publicações de amigos ou de quem segues. <Link to="/friends">Encontra pessoas</Link> ou vê o separador «Para ti».</>
        : "Ainda não há publicações. Sê a primeira pessoa a partilhar algo."}</div>}
      {/* Em ecrãs estreitos a coluna da direita não aparece: o Descobrir entra no feed (depois da 3.ª publicação, ou logo no início se houver poucas). */}
      {!loading && feedItems.length < 3 && <HomeDiscover discover={sidebars.home?.discover} variant="inline" />}
      {!loading && feedItems.map((item, index) => <Fragment key={item.key}>
        <PostCard post={item.post} onChanged={load} />
        {index === 2 && <HomeDiscover discover={sidebars.home?.discover} variant="inline" />}
      </Fragment>)}
      {!loading && nextCursor && <button className="btn secondary feed-more" type="button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "A carregar..." : "Carregar mais publicações"}</button>}
      {!loading && !nextCursor && posts.length > 0 && <p className="feed-end muted">Chegaste ao fim. Volta mais tarde para veres novidades.</p>}
    </section>
    <HomeRight data={sidebars} reload={reloadSidebars} />
  </div>;
}
