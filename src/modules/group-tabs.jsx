// Separadores dentro de um grupo: chat, eventos, sondagens, ficheiros, membros e equipa, estatísticas e definições.
// Cada um fala com /api/groups/:id/... (server/group-features.js).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE, Avatar, Icon, api, formatCount } from "./core.jsx";
import { GROUP_CATEGORIES, GROUP_PRIVACY, GROUP_TYPES, groupCategory, groupPrivacyOf } from "./community-types.js";
import { usePolling } from "./shared.jsx";

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ROLE_LABELS = { owner: "Dono", admin: "Administrador", moderator: "Moderador", member: "Membro" };
export const isTeam = role => ["owner", "admin", "moderator"].includes(role);
const when = value => new Date(value).toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function TabError({ error }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

// ----- Chat do grupo: vai buscando as mensagens novas de 4 em 4 segundos -----
export function GroupChat({ group, me }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const lastId = messages?.length ? messages[messages.length - 1].id : null;
  const load = async () => {
    try {
      const result = await api(`/groups/${group.id}/chat${lastId ? `?after=${lastId}` : ""}`);
      if (result.messages.length || messages === null) setMessages(current => [...(lastId ? current || [] : []), ...result.messages]);
    } catch (loadError) { setError(loadError.message); }
  };
  // Ao abrir: as últimas mensagens logo; depois, as novas de 4 em 4 segundos.
  useEffect(() => {
    setMessages(null);
    api(`/groups/${group.id}/chat`).then(result => setMessages(result.messages)).catch(loadError => setError(loadError.message));
  }, [group.id]);
  usePolling(load, 4000, true);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages?.length]);
  const send = async event => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError("");
    try { await api(`/groups/${group.id}/chat`, json("POST", { body: text.trim() })); setText(""); await load(); }
    catch (sendError) { setError(sendError.message); }
    finally { setBusy(false); }
  };
  const remove = async message => {
    if (!window.confirm("Apagar esta mensagem?")) return;
    try { await api(`/groups/${group.id}/chat/${message.id}`, { method: "DELETE" }); setMessages(current => current.filter(item => item.id !== message.id)); }
    catch (removeError) { setError(removeError.message); }
  };
  return <section className="card group-chat" aria-label="Chat do grupo">
    <div className="group-chat-list" ref={listRef}>
      {messages === null && <p className="muted">A carregar mensagens...</p>}
      {messages?.length === 0 && <p className="muted group-tab-empty">Ainda ninguém escreveu no chat. Diz olá ao grupo.</p>}
      {messages?.map((message, index) => {
        const mine = message.user_id === me?.id;
        const sameAuthor = messages[index - 1]?.user_id === message.user_id;
        return <div key={message.id} className={`group-chat-message${mine ? " is-mine" : ""}${sameAuthor ? " is-follow" : ""}`}>
          {!mine && !sameAuthor && <Avatar user={message} size="tiny" />}
          <div className="group-chat-bubble">
            {!mine && !sameAuthor && <strong>{message.display_name}</strong>}
            <p>{message.body}</p>
            <time dateTime={message.created_at}>{when(message.created_at)}</time>
          </div>
          {(mine || isTeam(group.my_role)) && <button type="button" className="group-chat-delete" aria-label="Apagar mensagem" onClick={() => remove(message)}><Icon name="trash" size={13} /></button>}
        </div>;
      })}
    </div>
    <form className="group-chat-form" onSubmit={send}>
      <input value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="Escreve ao grupo..." aria-label="Mensagem para o grupo" />
      <button className="btn" type="submit" disabled={busy || !text.trim()} aria-label="Enviar"><Icon name="send" size={16} /></button>
    </form>
    <TabError error={error} />
  </section>;
}

// ----- Eventos e calendário do grupo -----
export function GroupEvents({ group }) {
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const load = () => api(`/groups/${group.id}/events`).then(result => setEvents(result.events)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [group.id]);
  const create = async event => {
    event.preventDefault();
    setError("");
    try {
      await api(`/groups/${group.id}/events`, json("POST", { name: form.name, location: form.location, description: form.description, startsAt: new Date(form.startsAt).toISOString() }));
      setForm(null); load();
    } catch (createError) { setError(createError.message); }
  };
  const rsvp = async item => {
    try { await api(`/events/${item.id}/rsvp`, { method: "POST" }); load(); } catch (rsvpError) { setError(rsvpError.message); }
  };
  return <section className="group-tab-stack" aria-label="Eventos do grupo">
    {form ? <form className="card group-form" onSubmit={create}>
      <h3>Novo evento do grupo</h3>
      <label>Nome<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Encontro de sábado" /></label>
      <div className="group-form-row">
        <label>Data e hora<input required type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></label>
        <label>Local<input maxLength={160} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Ex.: Ilha de Luanda" /></label>
      </div>
      <label>Descrição<textarea rows={3} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="btn" type="submit">Criar evento</button></div>
    </form> : <button className="btn group-tab-add" type="button" onClick={() => setForm({ name: "", startsAt: "", location: "", description: "" })}><Icon name="plus" size={15} /> Criar evento</button>}
    <TabError error={error} />
    {events === null && <div className="empty card">A carregar eventos...</div>}
    {events?.length === 0 && !form && <div className="empty card group-tab-empty">Ainda não há eventos marcados. Os eventos do grupo só aparecem aqui, para os membros.</div>}
    {events?.map(item => {
      const date = new Date(item.starts_at);
      return <article key={item.id} className="card group-event">
        <span className="group-event-date"><strong>{date.getDate()}</strong><small>{date.toLocaleDateString("pt-PT", { month: "short" })}</small></span>
        <div>
          <Link to={`/events/${item.id}`}><h3>{item.name}</h3></Link>
          <p className="muted">{date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}{item.location ? ` · ${item.location}` : ""} · {formatCount(item.attendee_count)} {item.attendee_count === 1 ? "vai" : "vão"}</p>
        </div>
        <button className={`btn${item.is_attending ? " secondary" : ""}`} type="button" onClick={() => rsvp(item)}>{item.is_attending ? <><Icon name="check" size={14} /> Vou</> : "Vou"}</button>
      </article>;
    })}
  </section>;
}

// ----- Sondagens -----
export function GroupPolls({ group, me }) {
  const [polls, setPolls] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const load = () => api(`/groups/${group.id}/polls`).then(result => setPolls(result.polls)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [group.id]);
  const create = async event => {
    event.preventDefault();
    setError("");
    try {
      await api(`/groups/${group.id}/polls`, json("POST", { question: form.question, options: form.options.filter(o => o.trim()), multiple: form.multiple, days: form.days ? Number(form.days) : null }));
      setForm(null); load();
    } catch (createError) { setError(createError.message); }
  };
  const vote = async (poll, option) => {
    const mine = poll.options.filter(o => o.mine).map(o => o.id);
    const next = poll.multiple ? (mine.includes(option.id) ? mine.filter(id => id !== option.id) : [...mine, option.id]) : (mine.includes(option.id) ? [] : [option.id]);
    try { await api(`/groups/${group.id}/polls/${poll.id}/vote`, json("POST", { optionIds: next })); load(); } catch (voteError) { setError(voteError.message); }
  };
  const remove = async poll => {
    if (!window.confirm("Apagar esta sondagem?")) return;
    try { await api(`/groups/${group.id}/polls/${poll.id}`, { method: "DELETE" }); load(); } catch (removeError) { setError(removeError.message); }
  };
  return <section className="group-tab-stack" aria-label="Sondagens do grupo">
    {form ? <form className="card group-form" onSubmit={create}>
      <h3>Nova sondagem</h3>
      <label>Pergunta<input required maxLength={200} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} placeholder="Ex.: Que dia preferem para o encontro?" /></label>
      {form.options.map((option, index) => <label key={index}>Resposta {index + 1}<input maxLength={100} value={option}
        onChange={e => setForm({ ...form, options: form.options.map((item, i) => i === index ? e.target.value : item) })} /></label>)}
      {form.options.length < 10 && <button className="link-button" type="button" onClick={() => setForm({ ...form, options: [...form.options, ""] })}><Icon name="plus" size={14} /> Mais uma resposta</button>}
      <div className="group-form-row">
        <label className="checkbox-label"><input type="checkbox" checked={form.multiple} onChange={e => setForm({ ...form, multiple: e.target.checked })} /> Permitir várias respostas</label>
        <label>Fecha em<select value={form.days} onChange={e => setForm({ ...form, days: e.target.value })}>
          <option value="">Não fecha</option><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">1 semana</option><option value="30">1 mês</option>
        </select></label>
      </div>
      <div className="modal-actions"><button className="btn secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="btn" type="submit">Publicar sondagem</button></div>
    </form> : <button className="btn group-tab-add" type="button" onClick={() => setForm({ question: "", options: ["", ""], multiple: false, days: "7" })}><Icon name="plus" size={15} /> Criar sondagem</button>}
    <TabError error={error} />
    {polls === null && <div className="empty card">A carregar sondagens...</div>}
    {polls?.length === 0 && !form && <div className="empty card group-tab-empty">Ainda não há sondagens. Pergunta ao grupo o que pensa.</div>}
    {polls?.map(poll => {
      const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
      return <article key={poll.id} className="card group-poll">
        <header><h3>{poll.question}</h3>
          {(poll.author_id === me?.id || isTeam(group.my_role)) && <button type="button" className="round-button" aria-label="Apagar sondagem" onClick={() => remove(poll)}><Icon name="trash" size={14} /></button>}</header>
        <p className="muted">{poll.author_name} · {formatCount(poll.voters)} {poll.voters === 1 ? "pessoa votou" : "pessoas votaram"}{poll.multiple ? " · várias respostas" : ""}{poll.closed ? " · fechada" : poll.closes_at ? ` · fecha ${when(poll.closes_at)}` : ""}</p>
        <ul>{poll.options.map(option => {
          const percent = total ? Math.round((option.votes / total) * 100) : 0;
          return <li key={option.id}>
            <button type="button" className={`group-poll-option${option.mine ? " is-mine" : ""}`} disabled={poll.closed} onClick={() => vote(poll, option)} aria-pressed={option.mine}>
              <span className="group-poll-bar" style={{ width: `${percent}%` }} />
              <span className="group-poll-label">{option.mine && <Icon name="check" size={14} />} {option.label}</span>
              <span className="group-poll-percent">{percent}%</span>
            </button>
          </li>;
        })}</ul>
      </article>;
    })}
  </section>;
}

// ----- Ficheiros e documentos -----
const sizeLabel = bytes => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const fileIcon = mime => mime.startsWith("image/") ? "image" : mime.includes("pdf") ? "pages" : mime.includes("sheet") || mime.includes("excel") || mime.includes("csv") ? "stats" : mime.includes("zip") ? "layers" : "pages";
export function GroupFiles({ group, me }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef(null);
  const load = () => api(`/groups/${group.id}/files`).then(result => setFiles(result.files)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [group.id]);
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return setError("O ficheiro tem mais de 25 MB.");
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/groups/${group.id}/files`, { method: "POST", body: form });
      load();
    } catch (uploadError) { setError(uploadError.message); }
    finally { setBusy(false); }
  };
  const remove = async file => {
    if (!window.confirm(`Apagar «${file.name}»?`)) return;
    try { await api(`/groups/${group.id}/files/${file.id}`, { method: "DELETE" }); load(); } catch (removeError) { setError(removeError.message); }
  };
  return <section className="group-tab-stack" aria-label="Ficheiros do grupo">
    <input ref={input} type="file" hidden onChange={upload} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/jpeg,image/png,image/webp" />
    <button className="btn group-tab-add" type="button" disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" size={15} /> {busy ? "A enviar..." : "Partilhar ficheiro"}</button>
    <p className="muted group-tab-note">PDF, Word, Excel, PowerPoint, texto, ZIP ou imagens, até 25 MB. Só os membros os descarregam.</p>
    <TabError error={error} />
    {files === null && <div className="empty card">A carregar ficheiros...</div>}
    {files?.length === 0 && <div className="empty card group-tab-empty">Ainda não há ficheiros. Partilha materiais, regulamentos ou fotografias com o grupo.</div>}
    {files?.length > 0 && <ul className="card group-files">{files.map(file => <li key={file.id}>
      <span className="group-file-icon"><Icon name={fileIcon(file.mime)} size={18} /></span>
      <span className="group-file-text"><strong>{file.name}</strong><small>{sizeLabel(file.size_bytes)} · {file.display_name} · {when(file.created_at)}</small></span>
      <a className="btn secondary" href={`${API_BASE}${file.url}`} download={file.name}>Descarregar</a>
      {(file.user_id === me?.id || isTeam(group.my_role)) && <button type="button" className="round-button" aria-label={`Apagar ${file.name}`} onClick={() => remove(file)}><Icon name="trash" size={14} /></button>}
    </li>)}</ul>}
  </section>;
}

// ----- Membros, equipa e convites -----
export function GroupMembers({ group, me, onChanged }) {
  const [members, setMembers] = useState(null);
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = () => api(`/groups/${group.id}/members`).then(result => setMembers(result.members)).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [group.id]);
  const myRole = group.my_role;
  const rank = { member: 0, moderator: 1, admin: 2, owner: 3 };
  const canInvite = !group.is_secret && (!group.invite_only || isTeam(myRole));
  const invite = async event => {
    event.preventDefault();
    setError(""); setNotice("");
    try { await api(`/groups/${group.id}/invites`, json("POST", { username })); setNotice(`Convite enviado a @${username.replace(/^@/, "")}.`); setUsername(""); }
    catch (inviteError) { setError(inviteError.message); }
  };
  const setRole = async (person, role) => {
    setError("");
    try { await api(`/groups/${group.id}/members/${person.id}/role`, json("POST", { role })); load(); } catch (roleError) { setError(roleError.message); }
  };
  const remove = async person => {
    if (!window.confirm(`Remover ${person.display_name} do grupo?`)) return;
    try { await api(`/groups/${group.id}/members/${person.id}`, { method: "DELETE" }); load(); onChanged?.(); } catch (removeError) { setError(removeError.message); }
  };
  return <section className="group-tab-stack" aria-label="Membros do grupo">
    {canInvite && <form className="card group-invite" onSubmit={invite}>
      <label>Convidar alguém<span className="group-invite-row"><input value={username} onChange={e => setUsername(e.target.value)} placeholder="@nome de utilizador" required />
        <button className="btn" type="submit"><Icon name="plus" size={15} /> Convidar</button></span></label>
      {group.invite_only && <small className="muted">Este grupo é privado: só entra quem for convidado.</small>}
      {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    </form>}
    <TabError error={error} />
    {members === null && <div className="empty card">A carregar membros...</div>}
    {members && <ul className="card group-members">{members.map(person => {
      const manageable = person.id !== me?.id && rank[myRole] > rank[person.role] && isTeam(myRole);
      return <li key={person.id}>
        <Link className="group-member" to={`/u/${person.username}`}><Avatar user={person} size="small" />
          <span><strong>{person.display_name}</strong><small>@{person.username}</small></span></Link>
        <span className={`group-role is-${person.role}`}>{ROLE_LABELS[person.role]}</span>
        {manageable && <span className="group-member-actions">
          {(myRole === "owner" || myRole === "admin") && <select aria-label={`Papel de ${person.display_name}`} value={person.role} onChange={e => setRole(person, e.target.value)}>
            <option value="member">Membro</option>
            <option value="moderator">Moderador</option>
            {myRole === "owner" && <option value="admin">Administrador</option>}
          </select>}
          <button type="button" className="round-button" aria-label={`Remover ${person.display_name}`} onClick={() => remove(person)}><Icon name="close" size={14} /></button>
        </span>}
      </li>;
    })}</ul>}
    <p className="muted group-tab-note">Administradores mudam as regras e as definições. Moderadores aprovam pedidos, fixam e escondem publicações e removem membros.</p>
  </section>;
}

// ----- Estatísticas de participação (equipa) -----
export function GroupStats({ group }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api(`/groups/${group.id}/stats`).then(setData).catch(loadError => setError(loadError.message)); }, [group.id]);
  if (error) return <TabError error={error} />;
  if (!data) return <div className="empty card">A carregar estatísticas...</div>;
  const { stats, top, weekly } = data;
  const max = Math.max(1, ...weekly.map(week => week.posts));
  const tiles = [
    ["Membros", stats.members, `+${stats.new_members_7d} esta semana`],
    ["Ativos (30 dias)", stats.active_30d, stats.members ? `${Math.round((stats.active_30d / stats.members) * 100)}% dos membros` : ""],
    ["Publicações (30 dias)", stats.posts_30d, `${stats.comments_30d} comentários`],
    ["Mensagens no chat", stats.messages_30d, "nos últimos 30 dias"]
  ];
  return <section className="group-tab-stack" aria-label="Estatísticas do grupo">
    <div className="group-stat-tiles">{tiles.map(([label, value, hint]) => <div key={label} className="card group-stat"><small>{label}</small><strong>{formatCount(value)}</strong><span>{hint}</span></div>)}</div>
    <div className="card group-chart">
      <h3>Publicações por semana</h3>
      <div className="group-chart-bars" role="img" aria-label={`Publicações nas últimas 8 semanas: ${weekly.map(w => w.posts).join(", ")}`}>
        {weekly.map(week => <span key={week.week} className="group-chart-bar" title={`Semana de ${new Date(week.week).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}: ${week.posts} publicações, ${week.joins} novos membros`}>
          <span style={{ height: `${(week.posts / max) * 100}%` }} /><small>{new Date(week.week).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}</small>
        </span>)}
      </div>
    </div>
    <div className="card">
      <h3>Quem mais participa (30 dias)</h3>
      {top.length ? <ol className="group-top">{top.map(person => <li key={person.username}><Avatar user={person} size="tiny" /><span>{person.display_name}</span><small>{person.actions} {person.actions === 1 ? "ação" : "ações"}</small></li>)}</ol>
        : <p className="muted">Ainda sem participação este mês.</p>}
    </div>
    {stats.pending_requests > 0 && <p className="muted">{stats.pending_requests} {stats.pending_requests === 1 ? "pedido" : "pedidos"} para entrar à espera.</p>}
  </section>;
}

// ----- Definições e regras (dono e administradores) -----
export function GroupSettings({ group, onSaved }) {
  const [form, setForm] = useState({ name: group.name, description: group.description || "", rules: group.rules || "", groupType: group.group_type, category: group.category, subcategory: group.subcategory || "", privacy: groupPrivacyOf(group) });
  const [state, setState] = useState({ busy: false, error: "", saved: false });
  const area = groupCategory(form.category);
  const save = async event => {
    event.preventDefault();
    setState({ busy: true, error: "", saved: false });
    try {
      await api(`/groups/${group.id}`, json("PATCH", { name: form.name, description: form.description, rules: form.rules, groupType: form.groupType, category: form.category, subcategory: form.subcategory || null, ...(!group.is_secret && { privacy: form.privacy }) }));
      setState({ busy: false, error: "", saved: true });
      onSaved?.();
    } catch (saveError) { setState({ busy: false, error: saveError.message, saved: false }); }
  };
  return <form className="card group-form" onSubmit={save}>
    <h3>Definições do grupo</h3>
    <label>Nome<input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label>Descrição<textarea rows={3} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
    <label>Regras do grupo <small>{form.rules.length}/3000</small><textarea rows={5} maxLength={3000} value={form.rules} onChange={e => setForm({ ...form, rules: e.target.value })}
      placeholder={"Ex.:\n1. Respeito por todos.\n2. Sem spam nem publicidade.\n3. Publicações sobre o tema do grupo."} /></label>
    <div className="group-form-row">
      <label>Tipo<select value={form.groupType} onChange={e => setForm({ ...form, groupType: e.target.value })}>
        {GROUP_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
      {!group.is_secret && <label>Quem pode entrar<select value={form.privacy} onChange={e => setForm({ ...form, privacy: e.target.value })}>
        {GROUP_PRIVACY.filter(option => option.key !== "secret").map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>}
    </div>
    <div className="group-form-row">
      <label>Categoria<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value, subcategory: "" })}>
        {GROUP_CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {area.subcategories.length > 0 && <label>Subcategoria (opcional)<select value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })}>
        <option value="">Sem subcategoria</option>
        {area.subcategories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>}
    </div>
    <TabError error={state.error} />
    {state.saved && <p className="prefs-saved" role="status"><Icon name="check" size={14} />Guardado.</p>}
    <div className="modal-actions"><button className="btn" type="submit" disabled={state.busy}>{state.busy ? "A guardar..." : "Guardar"}</button></div>
  </form>;
}
