import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import { Composer, PostCard } from "./feed.jsx";
import { PaymentDialog, pageMonogram, pageTone } from "./shared.jsx";
import { GROUP_CATEGORIES, GROUP_PRIVACY, GROUP_TYPES, groupCategory, groupCategoryLabel, groupCategoryPath, groupPrivacyOf, groupType } from "./community-types.js";
import { ReportDialog } from "./feed.jsx";
import { GroupCallBar, GroupCallRoom } from "./group-call.jsx";
import { GroupChat, GroupEvents, GroupFiles, GroupMembers, GroupPolls, GroupSettings, GroupStats, isTeam } from "./group-tabs.jsx";
import { Select } from "./select.jsx";
import "./events.css";
import "./groups.css";

const SECRET_MIN_PRICE = 500;
const SECRET_MAX_PRICE = 500000;

// Selo dos grupos secretos: só para maiores de 18, entrada paga.
export function SecretBadge() {
  return <span className="group-secret-badge"><Icon name="lock" size={12} /> Secreto · +18</span>;
}

// Tipo e área do grupo: "Jogos · Free Fire".
export function GroupTopicChip({ group }) {
  return <span className="page-category"><Icon name={groupCategory(group.category).icon} size={13} /> {groupType(group.group_type).label} · {groupCategoryLabel(group)}</span>;
}
// Selo de entrada: "Com aprovação" ou "Privado" (o secreto tem o seu próprio selo).
export function PrivateBadge({ group }) {
  if (group?.invite_only) return <span className="group-private-badge"><Icon name="shield" size={12} /> Privado</span>;
  return <span className="group-private-badge"><Icon name="check" size={12} /> Com aprovação</span>;
}
// Pedidos de entrada num grupo com aprovação, vistos pela equipa do grupo.
export function GroupRequests({ group, onChanged }) {
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/groups/${group.id}/requests`).then(result => setRequests(result.requests)).catch(loadError => setError(loadError.message));
  }, [group.id]);
  const decide = async (person, approve) => {
    setBusyId(person.id);
    setError("");
    try {
      await api(`/groups/${group.id}/requests/${person.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }) });
      setRequests(current => current.filter(item => item.id !== person.id));
      onChanged();
    } catch (decideError) {
      setError(decideError.message);
    } finally {
      setBusyId(null);
    }
  };
  if (!requests?.length && !error) return null;
  return <section className="card group-requests" aria-labelledby="group-requests-title">
    <h2 id="group-requests-title">Pedidos para entrar <span>{requests?.length || 0}</span></h2>
    {error && <p className="error" role="alert">{error}</p>}
    <ul>{requests?.map(person => <li key={person.id}>
      <Link className="group-request-person" to={`/u/${person.username}`}><Avatar user={person} size="small" />
        <span><strong>{person.display_name}</strong><small>@{person.username}</small></span></Link>
      <div className="group-request-actions">
        <button className="btn secondary" type="button" disabled={busyId === person.id} onClick={() => decide(person, false)}>Recusar</button>
        <button className="btn" type="button" disabled={busyId === person.id} onClick={() => decide(person, true)}><Icon name="check" size={15} /> Aceitar</button>
      </div>
    </li>)}</ul>
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Grupos: descobrir, participar, criar e conversar em grupo (mesma linguagem das Páginas)
// ---------------------------------------------------------------------------------------------
export function GroupLogo({ group, size = "" }) {
  return <span className={`page-logo group-logo tone-page-${pageTone(group.name)} ${size}`} aria-hidden="true">
    {group.owner_avatar
      ? <img src={`${API_BASE}${group.owner_avatar}`} alt="" loading="lazy" />
      : pageMonogram(group.name)}
  </span>;
}
export function MemberStack({ members = [], total }) {
  if (!members.length) return null;
  return <span className="member-stack" aria-label={`${formatCount(total)} ${total === 1 ? "membro" : "membros"}`}>
    {members.slice(0, 4).map(member => <Avatar key={member.username} user={member} size="tiny" />)}
    {total > 4 && <span className="member-stack-more">+{formatCount(total - 4)}</span>}
  </span>;
}
export function JoinGroupButton({ group, user, busy, onJoin, onLeave, onPay }) {
  if (!user) return <Link className="btn" to="/login">Entrar para participar</Link>;
  if (group.owner_username === user.username) return <Link className="btn secondary" to={`/groups/${group.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  if (group.invite_only && !group.is_member) {
    return group.has_invite
      ? <button className="btn" type="button" disabled={busy} onClick={() => onJoin(group)}><Icon name="check" size={15} /> Aceitar convite</button>
      : <span className="btn secondary is-static" aria-disabled="true"><Icon name="shield" size={15} /> Só por convite</span>;
  }
  if (group.is_secret && !group.is_member) {
    return <button className="btn" type="button" disabled={busy} onClick={() => onPay(group)}>
      <Icon name="lock" size={15} /> Entrar por {formatPrice(group.access_price)}</button>;
  }
  if (group.is_member) return <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onLeave(group)}>
    <Icon name="check" size={15} /><span className="when-idle">Membro</span><span className="when-hover">Sair do grupo</span></button>;
  // Grupo privado: o pedido fica à espera do dono; carregar outra vez retira o pedido.
  if (group.has_requested) return <button className="btn secondary page-following" type="button" disabled={busy} onClick={() => onLeave(group)}>
    <Icon name="events" size={15} /><span className="when-idle">Pedido enviado</span><span className="when-hover">Retirar pedido</span></button>;
  return group.requires_approval
    ? <button className="btn" type="button" disabled={busy} onClick={() => onJoin(group)}><Icon name="shield" size={15} /> Pedir para entrar</button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onJoin(group)}><Icon name="plus" size={15} /> Participar</button>;
}
export function GroupCard({ group, user, busy, onJoin, onLeave, onPay }) {
  if (group.is_secret && !group.is_member) return <article className="page-card card group-card is-secret">
    <span className={`page-card-cover tone-page-${pageTone(group.name)}`} aria-hidden="true" />
    <div className="page-card-body">
      <GroupLogo group={group} />
      <h2>{group.name}</h2>
      <SecretBadge />
      <p className="page-card-description">{group.description || "Um grupo privado para maiores de 18."}</p>
      <div className="group-card-meta"><span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"}</span></div>
      <div className="page-card-footer">
        <span className="page-owner"><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>por <b>{group.owner_name}</b></span></span>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} onPay={onPay} />
      </div>
    </div>
  </article>;
  return <article className={`page-card card group-card${group.is_secret ? " is-secret" : ""}`}>
    <Link className={`page-card-cover tone-page-${pageTone(group.name)}`} to={`/groups/${group.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/groups/${group.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><GroupLogo group={group} /></Link>
      <h2><Link to={`/groups/${group.id}`}>{group.name}</Link></h2>
      <span className="group-card-kind"><GroupTopicChip group={group} />{group.is_secret && <SecretBadge />}{(group.requires_approval || group.invite_only) && <PrivateBadge group={group} />}</span>
      <p className="page-card-description">{group.description || "Um espaço para a comunidade."}</p>
      <div className="group-card-meta">
        <MemberStack members={group.member_preview} total={group.member_count} />
        <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"} · {formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
      </div>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${group.owner_username}`}><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>por <b>{group.owner_name}</b></span></Link>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} onPay={onPay} />
      </div>
    </div>
  </article>;
}
export function CreateGroupDialog({ viewer, onClose, onCreated }) {
  const { user } = useContext(UserContext);
  const [form, setForm] = useState({ name: "", description: "", groupType: "", category: "", subcategory: "", rules: "", privacy: "public", accessPrice: "" });
  const kind = GROUP_TYPES.find(item => item.key === form.groupType);
  const area = form.category ? groupCategory(form.category) : null;
  // O tipo sugere a categoria (um grupo de compra e venda → Compra e venda); a pessoa pode trocar.
  const chooseType = key => { const next = GROUP_TYPES.find(item => item.key === key); setForm({ ...form, groupType: key, category: next?.category || "", subcategory: "" }); };
  const isSecret = form.privacy === "secret";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { name: form.name, description: form.description, rules: form.rules, groupType: form.groupType, category: form.category, subcategory: form.subcategory || undefined, privacy: form.privacy, ...(isSecret && { accessPrice: Number(form.accessPrice) }) };
      const result = await api("/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onCreated(result.group);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { name: form.name || "Nome do grupo", group_type: form.groupType || "comunitario", category: form.category || "comunidade", subcategory: form.subcategory, requires_approval: form.privacy === "approval", invite_only: form.privacy === "private" };
  const canSecret = Boolean(viewer?.adult);
  const price = Number(form.accessPrice);
  const priceValid = !isSecret || (price >= SECRET_MIN_PRICE && price <= SECRET_MAX_PRICE);
  const nameValid = !isSecret || form.name.trim().length >= 3;
  const privacyNote = {
    public: "Só os membros veem e publicam no grupo. Tu ficas como dono e podes nomear administradores e moderadores.",
    approval: "Recebes os pedidos de entrada e decides quem entra (os teus moderadores também). Só os membros veem e publicam.",
    private: "Ninguém entra sem convite: tu e a tua equipa convidam pelo nome de utilizador.",
    secret: "Partilha o nome exato só com quem queres convidar. Tu ficas como administrador."
  }[form.privacy];
  const privacyOption = GROUP_PRIVACY.find(option => option.key === form.privacy) || GROUP_PRIVACY[0];
  const previewAction = isSecret ? `Entrar por ${formatPrice(price >= SECRET_MIN_PRICE ? price : SECRET_MIN_PRICE)}`
    : form.privacy === "approval" ? "Pedir para entrar" : form.privacy === "private" ? "Só por convite" : "Participar";
  const previewIcon = isSecret ? "lock" : form.privacy === "approval" ? "shield" : form.privacy === "private" ? "shield" : "plus";
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog event-dialog group-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onSubmit={submit}>
      <div className="event-dialog-head">
        <span className="event-dialog-badge" aria-hidden="true"><Icon name="groups" size={22} /></span>
        <div>
          <h2 id="create-group-title">Criar grupo</h2>
          <p>Junta pessoas à volta de um tema. Tu ficas como dono e podes nomear administradores e moderadores.</p>
        </div>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid event-dialog-grid">
        <div className="create-page-fields event-dialog-fields">
          <label className="event-field">
            <span className="event-field-label">Nome do grupo <small>{form.name.length}/100</small></span>
            <input className="event-name-input" required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Fotógrafos de Luanda" />
          </label>
          <label className="event-field">
            <span className="event-field-label">Sobre o que é <small>{form.description.length}/2000</small></span>
            <textarea rows={4} maxLength={2000} value={form.description}
              onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Diz quem deve participar e o que se partilha aqui." />
          </label>
          <label className="event-field">
            <span className="event-field-label">Tipo de grupo</span>
            <span className="select-with-icon group-type-select">
              <Icon name={kind?.icon || "groups"} size={17} />
              <Select required value={form.groupType} onChange={event => chooseType(event.target.value)} placeholder="Escolhe o tipo">
                <option value="" disabled>Escolhe o tipo</option>
                {GROUP_TYPES.map(item => <option key={item.key} value={item.key}>{item.label} — {item.help}</option>)}
              </Select>
            </span>
          </label>
          {kind && <div className="create-page-areas">
            <label className="event-field"><span className="event-field-label">Categoria</span>
              <Select value={form.category} onChange={event => setForm({ ...form, category: event.target.value, subcategory: "" })}>
                {GROUP_CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </Select></label>
            {area?.subcategories.length > 0 && <label className="event-field"><span className="event-field-label">Subcategoria <small>Opcional</small></span>
              <Select value={form.subcategory} onChange={event => setForm({ ...form, subcategory: event.target.value })}>
                <option value="">Sem subcategoria</option>
                {area.subcategories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </Select></label>}
          </div>}
          <fieldset className="event-field group-privacy">
            <legend className="event-field-label">Quem pode entrar</legend>
            <div className="group-privacy-grid">
              {GROUP_PRIVACY.map(option => {
                const locked = option.key === "secret" && !canSecret;
                return <label key={option.key} className={`group-privacy-option is-${option.key}${form.privacy === option.key ? " is-selected" : ""}${locked ? " is-disabled" : ""}`}>
                  <input type="radio" name="group-privacy" checked={form.privacy === option.key} disabled={locked} onChange={() => setForm({ ...form, privacy: option.key })} />
                  <span className="group-privacy-head">
                    <span className="group-privacy-icon"><Icon name={option.icon} size={17} /></span>
                    <strong>{option.label}</strong>
                    <span className="group-privacy-dot" aria-hidden="true" />
                  </span>
                  <small>{option.help}</small>
                </label>;
              })}
            </div>
            <p className="group-privacy-note"><Icon name="info" size={14} /> <span>{privacyNote}</span></p>
            {!canSecret && <p className="muted create-page-note">{viewer?.hasBirthDate
              ? "Os grupos secretos são só para maiores de 18 anos."
              : <>Para criar um grupo secreto, indica primeiro a tua data de nascimento em <Link to="/settings/privacidade">Definições › Privacidade</Link>.</>}</p>}
          </fieldset>
          {isSecret && <label className="event-field">
            <span className="event-field-label">Preço de entrada <small>Pagamento único</small></span>
            <span className="event-input-icon"><Icon name="lock" size={16} />
              <input type="number" inputMode="numeric" required min={SECRET_MIN_PRICE} max={SECRET_MAX_PRICE} step="1" value={form.accessPrice}
                onChange={event => setForm({ ...form, accessPrice: event.target.value })} placeholder="Ex.: 2500" aria-describedby="group-price-help" /></span>
            <small className="muted" id="group-price-help">Entre {formatPrice(SECRET_MIN_PRICE)} e {formatPrice(SECRET_MAX_PRICE)}. Recebes 80% de cada entrada nos teus ganhos.</small>
          </label>}
          <label className="event-field">
            <span className="event-field-label">Regras do grupo <small>Opcional</small></span>
            <textarea rows={3} maxLength={3000} value={form.rules}
              onChange={event => setForm({ ...form, rules: event.target.value })} placeholder={"Ex.: Respeito por todos. Sem spam."} />
          </label>
        </div>
        <div className="create-page-preview event-dialog-preview" aria-label="Pré-visualização">
          <small>Assim vão ver o teu grupo</small>
          <article className="group-poster">
            <div className={`group-poster-cover tone-page-${pageTone(preview.name)}`}>
              <span className="event-poster-waves" aria-hidden="true" />
              <GroupLogo group={preview} />
            </div>
            <div className="group-poster-body">
              <strong className={form.name ? "" : "is-placeholder"}>{preview.name}</strong>
              <span className="group-card-kind">{form.groupType ? <GroupTopicChip group={preview} /> : <span className="page-category is-placeholder">Tipo · categoria</span>}
                {isSecret && <SecretBadge />}{["approval", "private"].includes(form.privacy) && <PrivateBadge group={preview} />}</span>
              <p className={form.description ? "" : "is-placeholder"}>{form.description || "A descrição aparece aqui."}</p>
              <span className="group-poster-privacy"><Icon name={privacyOption.icon} size={14} /> {privacyOption.help}</span>
              <div className="group-poster-foot">
                <small>1 membro · por <b>{user?.display_name || "ti"}</b></small>
                <span className="group-poster-action"><Icon name={previewIcon} size={14} /> {previewAction}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions event-dialog-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.groupType || !priceValid || !nameValid}>
          <Icon name={isSecret ? "lock" : "groups"} size={16} /> {busy ? "A criar..." : isSecret ? "Criar grupo secreto" : "Criar grupo"}</button>
      </div>
    </form>
  </div>, document.body);
}
// Página de um grupo: cabeçalho, separadores (Publicações, Chat, Eventos, Sondagens, Ficheiros, Membros, Sobre,
// e para a equipa Estatísticas e Definições). Carrega o grupo pelo número (funciona mesmo fora da lista).
const GROUP_TABS = [
  ["posts", "Publicações", "pages"], ["chat", "Chat", "messages"], ["events", "Eventos", "events"], ["polls", "Sondagens", "stats"],
  ["files", "Ficheiros", "layers"], ["members", "Membros", "friends"], ["about", "Sobre e regras", "info"]
];
function GroupPage({ groupId, user, onListChanged }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [group, setGroup] = useState(null);
  const [posts, setPosts] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("posts");
  const [reporting, setReporting] = useState(false);
  const [calling, setCalling] = useState(null); // "voice" | "video" quando estou na chamada
  const load = () => api(`/groups/${groupId}`).then(result => { setGroup(result.group); setError(""); }).catch(loadError => { setGroup(false); setError(loadError.message); });
  const loadPosts = () => Promise.all([api(`/posts?groupId=${groupId}`), api(`/posts?groupId=${groupId}&pinned=1`)])
    .then(([all, top]) => { setPinned(top.posts); setPosts(all.posts.filter(post => !top.posts.some(item => item.id === post.id))); })
    .catch(loadError => setError(loadError.message));
  useEffect(() => { setGroup(null); setTab("posts"); load(); window.scrollTo(0, 0); }, [groupId, user?.id]);
  useEffect(() => { setPosts(null); if (group?.is_member) loadPosts(); }, [groupId, group?.is_member]);

  if (group === null) return <div className="page narrow"><div className="empty card">A carregar grupo...</div></div>;
  if (!group) return <div className="page narrow"><div className="empty card">{searchParams.get("pagamento") === "sucesso"
    ? <>Estamos a confirmar o teu pagamento. Assim que for confirmado, o grupo aparece em <Link to="/groups">Grupos › Participas</Link>.</>
    : <>{error || "Este grupo não existe ou foi apagado."} <Link to="/groups">Ver todos os grupos</Link></>}</div></div>;

  const role = group.my_role;
  const owner = role === "owner";
  const team = isTeam(role);
  const admin = owner || role === "admin";
  const tabs = [...GROUP_TABS, ...(team ? [["stats", "Estatísticas", "stats"]] : []), ...(admin ? [["settings", "Definições", "settings"]] : [])];
  const privacy = GROUP_PRIVACY.find(option => option.key === groupPrivacyOf(group));

  const setMembership = async joining => {
    setBusy(true); setError("");
    try { await api(`/groups/${group.id}/${joining ? "join" : "leave"}`, { method: "POST" }); await load(); onListChanged(); }
    catch (membershipError) { setError(membershipError.message); }
    finally { setBusy(false); }
  };
  const deleteGroup = async () => {
    if (!window.confirm(`Apagar o grupo «${group.name}» e tudo o que tem? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try { await api(`/groups/${group.id}`, { method: "DELETE" }); onListChanged(); navigate("/groups"); }
    catch (deleteError) { setError(deleteError.message); setBusy(false); }
  };
  // Ações da equipa no menu de cada publicação.
  const postActions = post => team ? [
    post.pinned_at
      ? { label: "Desafixar", icon: "unpin", onClick: () => api(`/groups/${group.id}/pins/${post.id}`, { method: "DELETE" }).then(loadPosts).catch(e => setError(e.message)) }
      : { label: "Fixar no topo", icon: "pin", onClick: () => api(`/groups/${group.id}/pins/${post.id}`, { method: "POST" }).then(loadPosts).catch(e => setError(e.message)) },
    ...(post.user_id !== user?.id ? [{ label: "Esconder (não cumpre as regras)", icon: "block", danger: true,
      onClick: () => window.confirm("Esconder esta publicação do grupo? O autor é avisado.") && api(`/groups/${group.id}/posts/${post.id}/hide`, { method: "POST" }).then(loadPosts).catch(e => setError(e.message)) }] : [])
  ] : [];
  const joinButton = <JoinGroupButton group={group} user={user} busy={busy} onJoin={() => setMembership(true)} onLeave={() => setMembership(false)} />;

  return <div className="pages-view page-detail group-page">
    <Link className="page-back" to="/groups"><Icon name="previous" size={18} /> Todos os grupos</Link>
    <section className="page-hero card">
      <div className={`page-hero-cover tone-page-${pageTone(group.name)}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(group.name)}</span></div>
      <div className="page-hero-body">
        <GroupLogo group={group} size="large" />
        <div className="page-hero-text">
          <h1>{group.name}</h1>
          <p><GroupTopicChip group={group} />{group.is_secret && <SecretBadge />}{(group.requires_approval || group.invite_only) && <PrivateBadge group={group} />}
            <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"}</span>
            <MemberStack members={group.member_preview} total={group.member_count} /></p>
        </div>
        <div className="page-hero-actions">
          {owner ? <button className="btn secondary danger-text" type="button" disabled={busy} onClick={deleteGroup}><Icon name="trash" size={15} /> Apagar grupo</button> : joinButton}
        </div>
      </div>
      {group.is_member && <nav className="group-tabs" aria-label="Secções do grupo">
        {tabs.map(([id, label, icon]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
          <Icon name={icon} size={15} /> {label}{id === "members" && group.request_count > 0 && <span className="group-tab-count">{group.request_count}</span>}
        </button>)}
      </nav>}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {group.is_member && !calling && <GroupCallBar group={group} onJoin={setCalling} />}
    {calling && <GroupCallRoom group={group} kind={calling} me={user} onClose={() => setCalling(null)} />}

    {!group.is_member ? <div className="page-detail-grid">
      <GroupAbout group={group} privacy={privacy} onReport={user ? () => setReporting(true) : null} />
      <div className="empty card page-empty group-locked">
        <span className="group-lock-icon"><Icon name="shield" size={26} /></span>
        <p>{group.has_requested ? "O teu pedido está à espera da equipa do grupo. Quando for aceite, vês tudo aqui."
          : group.invite_only ? (group.has_invite ? "Foste convidado para este grupo. Aceita o convite para entrares." : "Este grupo é privado: só entra quem for convidado por um administrador.")
            : group.requires_approval ? "Pede para entrar e a equipa do grupo decide."
              : "As publicações, o chat e os ficheiros deste grupo só são visíveis para os membros."}</p>
        {joinButton}
      </div>
    </div> : tab === "posts" ? <div className="page-detail-grid">
      <GroupAbout group={group} privacy={privacy} compact onReport={() => setReporting(true)} />
      <section className="page-posts" aria-label="Publicações do grupo">
        {team && group.requires_approval && <GroupRequests group={group} onChanged={() => { load(); onListChanged(); }} />}
        <Composer target={{ type: "group", id: group.id }} onPosted={loadPosts} />
        {pinned.map(post => <PostCard key={post.id} post={post} onChanged={loadPosts} extraActions={postActions(post)} />)}
        {!posts && <div className="empty card">A carregar publicações...</div>}
        {posts?.map(post => <PostCard key={post.id} post={post} onChanged={loadPosts} extraActions={postActions(post)} />)}
        {posts && !posts.length && !pinned.length && <div className="empty card page-empty"><GroupLogo group={group} /><p>Ainda não há conversa neste grupo. Começa tu: apresenta-te ou faz uma pergunta.</p></div>}
      </section>
    </div> : <div className="group-tab-panel">
      {tab === "chat" && <GroupChat group={group} me={user} />}
      {tab === "events" && <GroupEvents group={group} />}
      {tab === "polls" && <GroupPolls group={group} me={user} />}
      {tab === "files" && <GroupFiles group={group} me={user} />}
      {tab === "members" && <>{team && group.requires_approval && <GroupRequests group={group} onChanged={() => { load(); onListChanged(); }} />}<GroupMembers group={group} me={user} onChanged={load} /></>}
      {tab === "about" && <GroupAbout group={group} privacy={privacy} onReport={() => setReporting(true)} />}
      {tab === "stats" && <GroupStats group={group} />}
      {tab === "settings" && <GroupSettings group={group} onSaved={() => { load(); onListChanged(); }} />}
    </div>}
    {reporting && <ReportDialog targetType="group" targetId={group.id} onClose={() => setReporting(false)} />}
  </div>;
}

// "Sobre": descrição, regras, tipo, categoria, quem pode entrar e denunciar.
function GroupAbout({ group, privacy, compact = false, onReport }) {
  return <aside className="page-about card">
    <h2>Sobre</h2>
    <p>{group.description || "Um espaço para a comunidade."}</p>
    <ul>
      <li><Icon name={groupType(group.group_type).icon} size={16} /><span>Grupo {groupType(group.group_type).label.toLowerCase()}</span></li>
      <li><Icon name={groupCategory(group.category).icon} size={16} /><span>{groupCategoryPath(group)}</span></li>
      <li><Icon name={privacy?.icon || "groups"} size={16} /><span>{privacy?.label}: {privacy?.help}</span></li>
      {group.is_secret && <li><Icon name="info" size={16} /><span>Entrada de {formatPrice(group.access_price)}</span></li>}
      <li><Icon name="profile" size={16} /><span>Criado por <Link to={`/u/${group.owner_username}`}>{group.owner_name}</Link></span></li>
      <li><Icon name="events" size={16} /><span>Desde {new Date(group.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
    </ul>
    {group.rules && <div className="group-rules"><h3>Regras</h3><p>{compact && group.rules.length > 280 ? `${group.rules.slice(0, 280)}…` : group.rules}</p></div>}
    {onReport && <button type="button" className="course-report" onClick={onReport}><Icon name="report" size={14} /> Denunciar grupo</button>}
  </aside>;
}

export function Groups() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState("");
  const busy = false;
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");   // categoria escolhida no filtro
  const [viewer, setViewer] = useState(null);
  const [secretFound, setSecretFound] = useState([]);
  const [paying, setPaying] = useState(null);

  const loadGroups = async () => {
    try {
      const result = await api("/groups");
      setGroups(result.groups);
      setViewer(result.viewer || null);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadGroups(); }, [user?.id]);
  // Os grupos secretos só aparecem quando se escreve o nome exato (e só para maiores de 18: o servidor decide).
  useEffect(() => {
    const name = query.trim();
    if (!user || groupId || name.length < 3) { setSecretFound([]); return undefined; }
    const timer = window.setTimeout(() => {
      api(`/groups/secret?name=${encodeURIComponent(name)}`).then(result => setSecretFound(result.groups)).catch(() => setSecretFound([]));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [query, user?.id, groupId]);

  const startPayment = target => setPaying({
    group: target,
    onPay: choice => api(`/groups/${target.id}/access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: target.name, ...choice }) })
  });
  const paymentDialog = paying && <PaymentDialog title={`Entrar no grupo «${paying.group.name}»`} amountKz={paying.group.access_price} purpose="group_access" onPay={paying.onPay}
    onDone={() => { const id = paying.group.id; setPaying(null); setSecretFound([]); setQuery(""); loadGroups().then(() => navigate(`/groups/${id}`)); }}
    onClose={() => { setPaying(null); loadGroups(); }} />;
  // Entrar/sair muda logo no ecrã; se o servidor falhar, volta atrás. Num grupo privado
  // "entrar" é só pedir (não conta como membro) e "sair" retira o pedido.
  const setMembership = async (target, joining) => {
    setError("");
    const before = { is_member: target.is_member, has_requested: target.has_requested, member_count: target.member_count };
    const asRequest = target.requires_approval && !target.is_member;
    const next = asRequest
      ? { has_requested: joining }
      : { is_member: joining, has_requested: false, member_count: target.member_count + (joining ? 1 : -1) };
    const apply = values => setGroups(current => current.map(item => item.id === target.id ? { ...item, ...values } : item));
    apply(next);
    try {
      await api(`/groups/${target.id}/${joining ? "join" : "leave"}`, { method: "POST" });
    } catch (membershipError) {
      apply(before);
      setError(membershipError.message);
    }
  };

  // ----- Grupo individual -----
  if (groupId) return <GroupPage groupId={groupId} user={user} onListChanged={loadGroups} />;

  // ----- Lista de grupos -----
  const all = groups || [];
  const mine = all.filter(item => user && (item.owner_username === user.username || isTeam(item.my_role)));
  const joined = all.filter(item => item.is_member && !mine.includes(item));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["joined", "Participas", joined.length], ["mine", "Que geres", mine.length]] : [])];
  const source = tab === "mine" ? mine : tab === "joined" ? joined : all;
  const term = query.trim().toLowerCase();
  const topicsInUse = GROUP_CATEGORIES.filter(item => all.some(group => group.category === item.key));
  const matches = source.filter(item => (!topic || item.category === topic)
    && (!term || `${item.name} ${item.description} ${item.owner_name} ${groupCategoryPath(item)} ${groupType(item.group_type).label}`.toLowerCase().includes(term)));
  const pendingTotal = mine.reduce((sum, item) => sum + (item.pending_requests || 0), 0);
  const extraSecret = tab === "discover" ? secretFound.filter(found => !matches.some(item => item.id === found.id)) : [];
  const visible = [...extraSecret, ...matches];

  return <div className="pages-view groups-view">
    <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Grupos</p>
        <h1>Junta-te a quem gosta do mesmo que tu</h1>
        <p>Conversa, marca eventos, faz sondagens e chamadas num espaço só para membros.</p>
      </div>
      <div className="tc-head-actions">
        {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>
          : <Link className="btn" to="/login">Entrar para criar</Link>}
      </div>
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que grupos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar grupos" aria-label="Procurar grupos" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {topicsInUse.length > 1 && <div className="province-chips pages-categories" role="group" aria-label="Categorias">
      <button type="button" className="province-chip" aria-pressed={!topic} onClick={() => setTopic("")}>Todos</button>
      {topicsInUse.map(item => <button key={item.key} type="button" className="province-chip" aria-pressed={topic === item.key} onClick={() => setTopic(topic === item.key ? "" : item.key)}>
        <Icon name={item.icon} size={14} /> {item.label}</button>)}
    </div>}
    {pendingTotal > 0 && tab !== "mine" && <button type="button" className="group-pending-banner" onClick={() => setTab("mine")}>
      <Icon name="notifications" size={16} /> Tens {pendingTotal} {pendingTotal === 1 ? "pedido" : "pedidos"} para entrar nos grupos que geres</button>}
    {error && <p className="error" role="alert">{error}</p>}
    {!groups && !error && <div className="empty card">A carregar grupos...</div>}
    {groups && !visible.length && <div className="empty card pages-empty">
      {term || topic ? <p>Nenhum grupo corresponde à pesquisa.</p>
        : tab === "mine" ? <><p>Ainda não criaste nenhum grupo. Junta pessoas à volta de um tema que gostas.</p><button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar o primeiro grupo</button></>
          : tab === "joined" ? <><p>Ainda não participas em nenhum grupo.</p><button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir grupos</button></>
            : <><p>Ainda não há grupos. Cria o primeiro e convida os teus amigos.</p>{user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>}</>}
    </div>}
    {visible.length > 0 && <div className="pages-grid">{visible.map(item => <GroupCard key={item.id} group={item} user={user} busy={busy}
      onJoin={target => setMembership(target, true)} onLeave={target => setMembership(target, false)} onPay={startPayment} />)}</div>}
    {paymentDialog}
    {creating && <CreateGroupDialog viewer={viewer} onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadGroups().then(() => navigate(`/groups/${created.id}`)); }} />}
  </div>;
}
