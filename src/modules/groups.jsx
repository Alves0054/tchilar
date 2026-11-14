import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import { Composer, PostCard } from "./feed.jsx";
import { PaymentDialog, pageMonogram, pageTone } from "./shared.jsx";
import { GROUP_PRIVACY, GROUP_TOPICS, groupPrivacyOf, groupTopic } from "./community-types.js";

const SECRET_MIN_PRICE = 500;
const SECRET_MAX_PRICE = 500000;

// Selo dos grupos secretos: só para maiores de 18, entrada paga.
export function SecretBadge() {
  return <span className="group-secret-badge"><Icon name="lock" size={12} /> Secreto · +18</span>;
}

export function GroupTopicChip({ group }) {
  const topic = groupTopic(group.topic);
  return <span className="page-category"><Icon name={topic.icon} size={13} /> {topic.label}</span>;
}
export function PrivateBadge() {
  return <span className="group-private-badge"><Icon name="shield" size={12} /> Privado</span>;
}
// Pedidos de entrada num grupo privado, vistos só pelo dono.
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
  return <span className={`page-logo group-logo tone-page-${pageTone(group.name)} ${size}`} aria-hidden="true">{pageMonogram(group.name)}</span>;
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
  if (group.is_secret && !group.is_member) return <article className="page-card card is-secret">
    <span className={`page-card-cover tone-page-${pageTone(group.name)}`} aria-hidden="true" />
    <div className="page-card-body">
      <GroupLogo group={group} />
      <h2>{group.name}</h2>
      <SecretBadge />
      <p className="page-card-description">{group.description || "Um grupo privado para maiores de 18."}</p>
      <div className="group-card-meta"><span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"}</span></div>
      <div className="page-card-footer">
        <span className="page-owner"><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>{group.owner_name}</span></span>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} onPay={onPay} />
      </div>
    </div>
  </article>;
  return <article className={`page-card card${group.is_secret ? " is-secret" : ""}`}>
    <Link className={`page-card-cover tone-page-${pageTone(group.name)}`} to={`/groups/${group.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/groups/${group.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><GroupLogo group={group} /></Link>
      <h2><Link to={`/groups/${group.id}`}>{group.name}</Link></h2>
      <span className="group-card-kind"><GroupTopicChip group={group} />{group.is_secret && <SecretBadge />}{group.requires_approval && <PrivateBadge />}</span>
      <p className="page-card-description">{group.description || "Um espaço para a comunidade."}</p>
      <div className="group-card-meta">
        <MemberStack members={group.member_preview} total={group.member_count} />
        <span>{formatCount(group.member_count)} {group.member_count === 1 ? "membro" : "membros"} · {formatCount(group.post_count)} {group.post_count === 1 ? "publicação" : "publicações"}</span>
      </div>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${group.owner_username}`}><Avatar user={{ display_name: group.owner_name, avatar_url: group.owner_avatar }} size="tiny" /><span>{group.owner_name}</span></Link>
        <JoinGroupButton group={group} user={user} busy={busy} onJoin={onJoin} onLeave={onLeave} onPay={onPay} />
      </div>
    </div>
  </article>;
}
export function CreateGroupDialog({ viewer, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", description: "", topic: "geral", privacy: "public", accessPrice: "" });
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
      const payload = { name: form.name, description: form.description, topic: form.topic, privacy: form.privacy, ...(isSecret && { accessPrice: Number(form.accessPrice) }) };
      const result = await api("/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onCreated(result.group);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { name: form.name || "Nome do grupo", topic: form.topic };
  const canSecret = Boolean(viewer?.adult);
  const price = Number(form.accessPrice);
  const priceValid = !isSecret || (price >= SECRET_MIN_PRICE && price <= SECRET_MAX_PRICE);
  const nameValid = !isSecret || form.name.trim().length >= 3;
  const privacyNote = {
    public: "Só os membros veem e publicam no grupo. Tu ficas como administrador.",
    private: "Recebes os pedidos de entrada no grupo e decides quem entra. Só os membros veem e publicam.",
    secret: "Partilha o nome exato só com quem queres convidar. Tu ficas como administrador."
  }[form.privacy];
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
          <label>Tema<select value={form.topic} onChange={event => setForm({ ...form, topic: event.target.value })}>
            {GROUP_TOPICS.map(topic => <option key={topic.key} value={topic.key}>{topic.label}</option>)}
          </select></label>
          <fieldset className="group-type-choice">
            <legend>Quem pode entrar</legend>
            {GROUP_PRIVACY.map(option => {
              const locked = option.key === "secret" && !canSecret;
              return <label key={option.key} className={`${form.privacy === option.key ? "is-selected" : ""}${locked ? " is-disabled" : ""}`}>
                <input type="radio" name="group-type" checked={form.privacy === option.key} disabled={locked} onChange={() => setForm({ ...form, privacy: option.key })} />
                <span className={`group-type-icon is-${option.key}`}><Icon name={option.icon} size={18} /></span>
                <span><strong>{option.label}</strong><small>{option.help}</small></span>
              </label>;
            })}
          </fieldset>
          {!canSecret && <p className="muted create-page-note">{viewer?.hasBirthDate
            ? "Os grupos secretos são só para maiores de 18 anos."
            : <>Para criar um grupo secreto, indica primeiro a tua data de nascimento em <Link to="/settings/privacidade">Definições › Privacidade</Link>.</>}</p>}
          {isSecret && <label>Preço de entrada (Kz)
            <input type="number" inputMode="numeric" required min={SECRET_MIN_PRICE} max={SECRET_MAX_PRICE} step="1" value={form.accessPrice}
              onChange={event => setForm({ ...form, accessPrice: event.target.value })} placeholder="Ex.: 2500" aria-describedby="group-price-help" />
            <small id="group-price-help">Pagamento único, entre {formatPrice(SECRET_MIN_PRICE)} e {formatPrice(SECRET_MAX_PRICE)}. Recebes 70% de cada entrada nos teus ganhos.</small>
          </label>}
          <p className="muted create-page-note">{privacyNote}</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.name)}`} />
            <div className="page-card-body">
              <GroupLogo group={preview} />
              <h2>{preview.name}</h2>
              <span className="group-card-kind"><GroupTopicChip group={preview} />{isSecret && <SecretBadge />}{form.privacy === "private" && <PrivateBadge />}</span>
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !priceValid || !nameValid}>{busy ? "A criar..." : isSecret ? "Criar grupo secreto" : "Criar grupo"}</button>
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
  const [topic, setTopic] = useState("");
  const [viewer, setViewer] = useState(null);
  const [secretFound, setSecretFound] = useState([]);
  const [paying, setPaying] = useState(null);
  const [searchParams] = useSearchParams();
  const group = groups?.find(item => String(item.id) === groupId);
  const ownsGroup = Boolean(group && user && group.owner_username === user.username);

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
  const loadPosts = id => api(`/posts?groupId=${encodeURIComponent(id)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

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
  const paymentDialog = paying && <PaymentDialog title={`Entrar no grupo «${paying.group.name}»`} amountKz={paying.group.access_price} onPay={paying.onPay}
    onDone={() => { const id = paying.group.id; setPaying(null); setSecretFound([]); setQuery(""); loadGroups().then(() => navigate(`/groups/${id}`)); }}
    onClose={() => { setPaying(null); loadGroups(); }} />;
  // As publicações de um grupo só são visíveis para os membros.
  useEffect(() => {
    setPosts(null);
    if (groupId && group?.is_member) loadPosts(groupId);
    if (groupId) window.scrollTo(0, 0);
  }, [groupId, group?.is_member]);

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
    if (!group) return <div className="page narrow"><div className="empty card">{searchParams.get("pagamento") === "sucesso"
      ? <>Estamos a confirmar o teu pagamento. Assim que for confirmado, o grupo aparece em <Link to="/groups">Grupos › Participas</Link>.</>
      : <>Este grupo não existe ou foi apagado. <Link to="/groups">Ver todos os grupos</Link></>}</div></div>;
    return <div className="pages-view page-detail">
      <Link className="page-back" to="/groups"><Icon name="previous" size={18} /> Todos os grupos</Link>
      <section className="page-hero card">
        <div className={`page-hero-cover tone-page-${pageTone(group.name)}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(group.name)}</span></div>
        <div className="page-hero-body">
          <GroupLogo group={group} size="large" />
          <div className="page-hero-text">
            <h1>{group.name}</h1>
            <p><GroupTopicChip group={group} />{group.is_secret && <SecretBadge />}{group.requires_approval && <PrivateBadge />}
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
            <li><Icon name={groupTopic(group.topic).icon} size={16} /><span>Tema: {groupTopic(group.topic).label}</span></li>
            {groupPrivacyOf(group) === "private" && <li><Icon name="check" size={16} /><span>Privado: o administrador aprova quem entra</span></li>}
            {group.is_secret && <>
              <li><Icon name="lock" size={16} /><span>Secreto: não aparece na lista, só se encontra pelo nome exato</span></li>
              <li><Icon name="info" size={16} /><span>Só para maiores de 18 · entrada de {formatPrice(group.access_price)}</span></li>
            </>}
            <li><Icon name="profile" size={16} /><span>Criado por <Link to={`/u/${group.owner_username}`}>{group.owner_name}</Link></span></li>
            <li><Icon name="events" size={16} /><span>Desde {new Date(group.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
          </ul>
        </aside>
        <section className="page-posts" aria-label="Publicações do grupo">
          {ownsGroup && group.requires_approval && <GroupRequests group={group} onChanged={loadGroups} />}
          {group.is_member ? <>
            <Composer target={{ type: "group", id: group.id }} onPosted={() => { loadPosts(group.id); loadGroups(); }} />
            {!posts && <div className="empty card">A carregar publicações...</div>}
            {posts?.map(post => <PostCard key={post.id} post={post} onChanged={() => loadPosts(group.id)} />)}
            {posts && !posts.length && <div className="empty card page-empty"><GroupLogo group={group} /><p>Ainda não há conversa neste grupo. Começa tu: apresenta-te ou faz uma pergunta.</p></div>}
          </> : <div className="empty card page-empty group-locked">
            <span className="group-lock-icon"><Icon name="shield" size={26} /></span>
            <p>{group.has_requested
              ? "O teu pedido está à espera do administrador. Quando for aceite, vês as publicações aqui."
              : group.requires_approval
                ? "Este grupo é privado: pede para entrar e o administrador decide."
                : "As publicações deste grupo só são visíveis para os membros."}</p>
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
  const topicsInUse = GROUP_TOPICS.filter(item => all.some(group => group.topic === item.key));
  const matches = source.filter(item => (!topic || item.topic === topic)
    && (!term || `${item.name} ${item.description} ${item.owner_name} ${groupTopic(item.topic).label}`.toLowerCase().includes(term)));
  const pendingTotal = mine.reduce((sum, item) => sum + (item.pending_requests || 0), 0);
  const extraSecret = tab === "discover" ? secretFound.filter(found => !matches.some(item => item.id === found.id)) : [];
  const visible = [...extraSecret, ...matches];

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
    {topicsInUse.length > 1 && <div className="province-chips pages-categories" role="group" aria-label="Temas">
      <button type="button" className="province-chip" aria-pressed={!topic} onClick={() => setTopic("")}>Todos</button>
      {topicsInUse.map(item => <button key={item.key} type="button" className="province-chip" aria-pressed={topic === item.key} onClick={() => setTopic(topic === item.key ? "" : item.key)}>
        <Icon name={item.icon} size={14} /> {item.label}</button>)}
    </div>}
    {pendingTotal > 0 && tab !== "mine" && <button type="button" className="group-pending-banner" onClick={() => setTab("mine")}>
      <Icon name="notifications" size={16} /> Tens {pendingTotal} {pendingTotal === 1 ? "pedido" : "pedidos"} para entrar nos teus grupos privados</button>}
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
