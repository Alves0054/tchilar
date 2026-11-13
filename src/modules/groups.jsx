import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount } from "./core.jsx";
import { Composer, PostCard } from "./feed.jsx";
import { pageMonogram, pageTone } from "./shared.jsx";

// ---------------------------------------------------------------------------------------------
// Grupos: descobrir, participar, criar e conversar em grupo (mesma linguagem das Páginas)
// ---------------------------------------------------------------------------------------------
export function GroupLogo({ group, size = "" }) {
  return <span className={`page-logo group-logo tone-page-${pageTone(group.name)} ${size}`} aria-hidden="true">{pageMonogram(group.name)}</span>;
}
export function MemberStack({ members = [], total }) {
  if (!members.length) return null;
  return <span className="member-stack" aria-label={`${formatCount(total)} ${total === 1 ? "membro" : "membros"}`}>
    {members.slice(0, 4).map(member => <Avatar key={member.username} user={member} size="tiny" />)}
    {total > 4 && <span className="member-stack-more">+{formatCount(total - 4)}</span>}
  </span>;
}
export function JoinGroupButton({ group, user, busy, onJoin, onLeave }) {
  if (!user) return <Link className="btn" to="/login">Entrar para participar</Link>;
  if (group.owner_username === user.username) return <Link className="btn secondary" to={`/groups/${group.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  return group.is_member
    ? <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onLeave(group)}>
      <Icon name="check" size={15} /><span className="when-idle">Membro</span><span className="when-hover">Sair do grupo</span></button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onJoin(group)}><Icon name="plus" size={15} /> Participar</button>;
}
export function GroupCard({ group, user, busy, onJoin, onLeave }) {
  return <article className="page-card card">
    <Link className={`page-card-cover tone-page-${pageTone(group.name)}`} to={`/groups/${group.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/groups/${group.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><GroupLogo group={group} /></Link>
      <h2><Link to={`/groups/${group.id}`}>{group.name}</Link></h2>
      <p className="page-card-description">{group.description || "Um espaço para a comunidade."}</p>
      <div className="group-card-meta">
        <MemberStack members={group.member_preview} total={group.member_count} />
        <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"} · {formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
      </div>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${group.owner_username}`}><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>{group.owner_name}</span></Link>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} />
      </div>
    </div>
  </article>;
}
export function CreateGroupDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "" });
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
      const result = await api("/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated(result.group);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { name: form.name || "Nome do grupo" };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-group-title">Criar grupo</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Fotógrafos de Luanda" /></label>
          <label>Sobre o que é <small>{form.description.length}/2000</small><textarea rows={5} maxLength={2000} value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Diz quem deve participar e o que se partilha aqui." /></label>
          <p className="muted create-page-note">Só os membros veem e publicam no grupo. Tu ficas como administrador.</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.name)}`} />
            <div className="page-card-body">
              <GroupLogo group={preview} />
              <h2>{preview.name}</h2>
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim()}>{busy ? "A criar..." : "Criar grupo"}</button>
      </div>
    </form>
  </div>, document.body);
}
export function Groups() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [groups, setGroups] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const group = groups?.find(item => String(item.id) === groupId);
  const ownsGroup = Boolean(group && user && group.owner_username === user.username);

  const loadGroups = async () => {
    try {
      const result = await api("/groups");
      setGroups(result.groups);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };
  const loadPosts = id => api(`/posts?groupId=${encodeURIComponent(id)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

  useEffect(() => { loadGroups(); }, [user?.id]);
  // As publicações de um grupo só são visíveis para os membros.
  useEffect(() => {
    setPosts(null);
    if (groupId && group?.is_member) loadPosts(groupId);
    if (groupId) window.scrollTo(0, 0);
  }, [groupId, group?.is_member]);

  const setMembership = async (target, joining) => {
    setError("");
    const apply = (value, delta) => setGroups(current => current.map(item => item.id === target.id
      ? { ...item, is_member: value, member_count: item.member_count + delta } : item));
    apply(joining, joining ? 1 : -1);
    try {
      await api(`/groups/${target.id}/${joining ? "join" : "leave"}`, { method: "POST" });
    } catch (membershipError) {
      apply(!joining, joining ? -1 : 1);
      setError(membershipError.message);
    }
  };

  const deleteGroup = async () => {
    if (!window.confirm(`Apagar o grupo «${group.name}» e todas as publicações dele? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api(`/groups/${group.id}`, { method: "DELETE" });
      setGroups(current => current.filter(item => item.id !== group.id));
      navigate("/groups");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };

  // ----- Grupo individual -----
  if (groupId) {
    if (!groups && !error) return <div className="page narrow"><div className="empty card">A carregar grupo...</div></div>;
    if (!group) return <div className="page narrow"><div className="empty card">Este grupo não existe ou foi apagado. <Link to="/groups">Ver todos os grupos</Link></div></div>;
    return <div className="pages-view page-detail">
      <Link className="page-back" to="/groups"><Icon name="previous" size={18} /> Todos os grupos</Link>
      <section className="page-hero card">
        <div className={`page-hero-cover tone-page-${pageTone(group.name)}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(group.name)}</span></div>
        <div className="page-hero-body">
          <GroupLogo group={group} size="large" />
          <div className="page-hero-text">
            <h1>{group.name}</h1>
            <p><span className="page-category"><Icon name="groups" size={13} /> Grupo</span>
              <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"}</span>
              <span>{formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
              <MemberStack members={group.member_preview} total={group.member_count} /></p>
          </div>
          <div className="page-hero-actions">
            {ownsGroup
              ? <button className="btn secondary danger-text" type="button" disabled={busy} onClick={deleteGroup}><Icon name="trash" size={15} /> Apagar grupo</button>
              : <JoinGroupButton group={group} user={user} busy={busy} onJoin={item => setMembership(item, true)} onLeave={item => setMembership(item, false)} />}
          </div>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="page-detail-grid">
        <aside className="page-about card">
          <h2>Sobre</h2>
          <p>{group.description || "Um espaço para a comunidade."}</p>
          <ul>
            <li><Icon name="shield" size={16} /><span>Só os membros veem e publicam</span></li>
            <li><Icon name="profile" size={16} /><span>Criado por <Link to={`/u/${group.owner_username}`}>{group.owner_name}</Link></span></li>
            <li><Icon name="events" size={16} /><span>Desde {new Date(group.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
          </ul>
        </aside>
        <section className="page-posts" aria-label="Publicações do grupo">
          {group.is_member ? <>
            <Composer target={{ type: "group", id: group.id }} onPosted={() => { loadPosts(group.id); loadGroups(); }} />
            {!posts && <div className="empty card">A carregar publicações...</div>}
            {posts?.map(post => <PostCard key={post.id} post={post} onChanged={() => loadPosts(group.id)} />)}
            {posts && !posts.length && <div className="empty card page-empty"><GroupLogo group={group} /><p>Ainda não há conversa neste grupo. Começa tu: apresenta-te ou faz uma pergunta.</p></div>}
          </> : <div className="empty card page-empty group-locked">
            <span className="group-lock-icon"><Icon name="shield" size={26} /></span>
            <p>As publicações deste grupo só são visíveis para os membros.</p>
            <JoinGroupButton group={group} user={user} busy={busy} onJoin={item => setMembership(item, true)} onLeave={item => setMembership(item, false)} />
          </div>}
        </section>
      </div>
    </div>;
  }

  // ----- Lista de grupos -----
  const all = groups || [];
  const mine = all.filter(item => user && item.owner_username === user.username);
  const joined = all.filter(item => item.is_member && !(user && item.owner_username === user.username));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["joined", "Participas", joined.length], ["mine", "Criados por ti", mine.length]] : [])];
  const source = tab === "mine" ? mine : tab === "joined" ? joined : all;
  const term = query.trim().toLowerCase();
  const visible = source.filter(item => !term || `${item.name} ${item.description} ${item.owner_name}`.toLowerCase().includes(term));

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Grupos</h1><p>Junta-te a pessoas com os mesmos interesses e conversa num espaço só para membros.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>
        : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que grupos mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar grupos" aria-label="Procurar grupos" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!groups && !error && <div className="empty card">A carregar grupos...</div>}
    {groups && !visible.length && <div className="empty card pages-empty">
      {term ? <p>Nenhum grupo corresponde à pesquisa.</p>
        : tab === "mine" ? <><p>Ainda não criaste nenhum grupo. Junta pessoas à volta de um tema que gostas.</p><button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar o primeiro grupo</button></>
          : tab === "joined" ? <><p>Ainda não participas em nenhum grupo.</p><button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir grupos</button></>
            : <><p>Ainda não há grupos. Cria o primeiro e convida os teus amigos.</p>{user && <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar grupo</button>}</>}
    </div>}
    {visible.length > 0 && <div className="pages-grid">{visible.map(item => <GroupCard key={item.id} group={item} user={user} busy={busy}
      onJoin={target => setMembership(target, true)} onLeave={target => setMembership(target, false)} />)}</div>}
    {creating && <CreateGroupDialog onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadGroups().then(() => navigate(`/groups/${created.id}`)); }} />}
  </div>;
}
