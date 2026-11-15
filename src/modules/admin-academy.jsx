// Administração: desafios do mês (catálogo de 40 modelos, prémios editáveis, lançar e encerrar) e revisão
// dos cursos da Academia.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon, api, formatCount, formatPrice } from "./core.jsx";

const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
const LEVEL_NAMES = { 1: "Bronze", 2: "Prata", 3: "Ouro", 4: "Diamante", 5: "Lenda" };
const dateOnly = value => value ? new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" }) : "";

export const prizeSummary = prizes => (prizes || []).filter(prize => prize.stars || Number(prize.cashKz))
  .map(prize => `${prize.place}.º ${[prize.stars ? `${formatCount(prize.stars)} ⭐` : "", Number(prize.cashKz) ? formatPrice(prize.cashKz) : ""].filter(Boolean).join(" + ")}`).join(" · ");

// Editor de um modelo (ou de um novo): textos, nível, prémios por lugar e ligado/desligado.
function TemplateForm({ initial, canGiveCash, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || "", description: initial?.description || "", category: initial?.category || "geral", level: initial?.level || 1,
    active: initial?.active ?? true,
    prizes: (initial?.prizes?.length ? initial.prizes : [{ stars: 50, cashKz: 0 }, { stars: 30, cashKz: 0 }, { stars: 20, cashKz: 0 }])
      .map(prize => ({ stars: String(prize.stars || 0), cashKz: String(Number(prize.cashKz) || 0) }))
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setPrize = (index, key, value) => setForm({ ...form, prizes: form.prizes.map((prize, i) => i === index ? { ...prize, [key]: value } : prize) });
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await onSave({ ...form, level: Number(form.level), prizes: form.prizes.map(prize => ({ stars: Number(prize.stars) || 0, cashKz: Number(prize.cashKz) || 0 })) });
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  return <form className="prefs-form challenge-template-form" onSubmit={submit}>
    <label>Título<input required maxLength={100} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
    <label>Regras<textarea rows={3} maxLength={1000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
    <div className="field-pair">
      <label>Nível<select value={form.level} onChange={event => setForm({ ...form, level: event.target.value })}>{Object.entries(LEVEL_NAMES).map(([key, label]) => <option key={key} value={key}>{key} · {label}</option>)}</select></label>
      <label>Categoria<input maxLength={40} value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} /></label>
    </div>
    <fieldset className="prize-table">
      <legend>Prémios por lugar {!canGiveCash && <small className="muted">(dinheiro só a equipa de finanças)</small>}</legend>
      {form.prizes.map((prize, index) => <div key={index} className="prize-row">
        <strong>{index + 1}.º</strong>
        <label>Estrelas<input type="number" min="0" max="1000000" value={prize.stars} onChange={event => setPrize(index, "stars", event.target.value)} /></label>
        <label>Dinheiro (Kz)<input type="number" min="0" step="0.01" value={prize.cashKz} disabled={!canGiveCash} onChange={event => setPrize(index, "cashKz", event.target.value)} /></label>
        {form.prizes.length > 1 && <button type="button" className="btn secondary" aria-label={`Tirar o ${index + 1}.º lugar`} onClick={() => setForm({ ...form, prizes: form.prizes.filter((_, i) => i !== index) })}><Icon name="close" size={14} /></button>}
      </div>)}
      {form.prizes.length < 10 && <button type="button" className="btn secondary" onClick={() => setForm({ ...form, prizes: [...form.prizes, { stars: "0", cashKz: "0" }] })}><Icon name="plus" size={14} /> Mais um lugar</button>}
    </fieldset>
    {initial && <label className="checkbox"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Ligado (aparece para lançar)</label>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="prefs-form-foot"><button className="btn secondary" type="button" onClick={onCancel}>Cancelar</button><button className="btn" type="submit" disabled={busy}>{busy ? "A guardar..." : "Guardar"}</button></div>
  </form>;
}

// Prémios de um desafio em "fichas": 1.º · 25 000 Kz · ★ 1 000
function PrizeChips({ prizes }) {
  const list = (prizes || []).filter(prize => prize.stars || Number(prize.cashKz));
  if (!list.length) return <span className="muted">Sem prémio</span>;
  return <span className="prize-chips">{list.map(prize => <span key={prize.place} className={`prize-chip place-${prize.place}`}>
    <b>{prize.place}.º</b>
    {Number(prize.cashKz) > 0 && <span className="prize-chip-cash">{formatPrice(prize.cashKz)}</span>}
    {prize.stars > 0 && <span className="prize-chip-stars"><Icon name="star" size={12} />{formatCount(prize.stars)}</span>}
  </span>)}</span>;
}
const daysLeft = endsAt => Math.max(0, Math.ceil((new Date(endsAt) - Date.now()) / 86400000));
const cashOf = prizes => (prizes || []).reduce((sum, prize) => sum + (Number(prize.cashKz) || 0), 0);

// Janela por cima da página para editar (ou criar) um modelo.
function TemplateDialog({ template, canGiveCash, onSave, onClose }) {
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal card template-dialog" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <div className="template-dialog-head">
        <h2 id="template-title">{template ? "Editar desafio" : "Novo desafio no catálogo"}</h2>
        <button type="button" className="round-button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <TemplateForm initial={template} canGiveCash={canGiveCash} onSave={onSave} onCancel={onClose} />
    </div>
  </div>, document.body);
}

export function AdminChallenges() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [days, setDays] = useState("");
  const [level, setLevel] = useState(1);
  const [editing, setEditing] = useState(null); // modelo a editar, ou "new"
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => Promise.all([api("/admin/challenge-templates"), api("/challenges")])
    .then(([catalog, list]) => { setData(catalog); setOpen(list.challenges.filter(item => item.closed_at === null)); setError(""); })
    .catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, []);
  const levelCounts = useMemo(() => Object.fromEntries([1, 2, 3, 4, 5].map(key => [key, (data?.templates || []).filter(t => t.level === key).length])), [data]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <div className="empty card">A carregar...</div>;

  const toggle = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const chosen = data.templates.filter(t => selected.has(t.id));
  const chosenCash = chosen.reduce((sum, t) => sum + cashOf(t.prizes), 0);
  const blocked = chosenCash > 0 && !data.canGiveCash;
  const running = open || [];
  const entries = running.reduce((sum, item) => sum + item.entries, 0);
  const atStake = running.reduce((sum, item) => sum + cashOf(item.prizes), 0);
  const nextEnd = running.length ? Math.min(...running.map(item => daysLeft(item.ends_at))) : null;

  const launch = async () => {
    if (!window.confirm(`Lançar ${chosen.length} ${chosen.length === 1 ? "desafio" : "desafios"} ${days ? `por ${days} dias` : "até ao fim do mês"} e avisar todas as pessoas?`)) return;
    setBusy("launch"); setError(""); setNotice("");
    try {
      const result = await post("/admin/challenges/launch", { templateIds: [...selected], ...(days && { days: Number(days) }) });
      setNotice(`Lançados ${result.challenges.length} desafios. Toda a gente recebeu um aviso.`);
      setSelected(new Set());
      await load();
    } catch (launchError) { setError(launchError.message); } finally { setBusy(""); }
  };
  const close = async challenge => {
    if (!window.confirm(`Encerrar «${challenge.title}» e dar os prémios aos primeiros lugares agora?`)) return;
    setBusy(`close${challenge.id}`); setError(""); setNotice("");
    try {
      const result = await post(`/challenges/${challenge.id}/close`);
      setNotice(result.awards?.length ? `Premiados: ${result.awards.map(item => `${item.place}.º @${item.username}`).join(", ")}.` : "Encerrado sem participações.");
      await load();
    } catch (closeError) { setError(closeError.message); } finally { setBusy(""); }
  };
  const save = async body => {
    if (editing === "new") await post("/admin/challenge-templates", body); else await patch(`/admin/challenge-templates/${editing.id}`, body);
    setEditing(null);
    setNotice("Desafio do catálogo guardado.");
    await load();
  };

  return <div className="admin-challenges">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}

    <dl className="admin-kpis">
      <div><dt>Desafios a decorrer</dt><dd>{formatCount(running.length)}</dd></div>
      <div><dt>Participações</dt><dd>{formatCount(entries)}</dd></div>
      <div><dt>Em jogo (dinheiro)</dt><dd>{atStake ? formatPrice(atStake) : "—"}</dd></div>
      <div><dt>Próximo fim</dt><dd>{nextEnd === null ? "—" : nextEnd <= 1 ? "Hoje" : `${nextEnd} dias`}</dd></div>
    </dl>

    <section className="creator-card">
      <div className="creator-card-head">
        <div><h2>A decorrer</h2><p>Encerra quando o desafio acabar: os primeiros lugares por gostos recebem os prémios automaticamente.</p></div>
      </div>
      {!running.length && <p className="muted">Nenhum desafio aberto. Escolhe no catálogo abaixo e lança o mês.</p>}
      <div className="admin-challenge-grid">{running.map(item => <article key={item.id} className={`admin-challenge-card level-${item.level || 0}`}>
        <header><span>{item.level ? LEVEL_NAMES[item.level] : "Especial"}</span><span>{daysLeft(item.ends_at) <= 1 ? "Termina hoje" : `Faltam ${daysLeft(item.ends_at)} dias`}</span></header>
        <div className="admin-challenge-body">
          <strong>{item.title}</strong>
          <PrizeChips prizes={item.prizes} />
          <small className="muted"><Icon name="groups" size={13} /> {formatCount(item.entries)} {item.entries === 1 ? "participação" : "participações"} · até {dateOnly(item.ends_at)}</small>
        </div>
        <footer>
          <Link className="btn secondary" to={`/desafios/${item.id}`}>Ver</Link>
          <button className="btn secondary" type="button" disabled={busy === `close${item.id}`} onClick={() => close(item)}>
            <Icon name="trophy" size={14} /> {busy === `close${item.id}` ? "A premiar..." : "Encerrar e premiar"}</button>
        </footer>
      </article>)}</div>
    </section>

    <section className="creator-card">
      <div className="creator-card-head">
        <div><h2>Catálogo</h2><p>{data.templates.length} desafios. Estrelas no Bronze, Prata e Ouro; estrelas e dinheiro no Diamante e na Lenda. Toca num cartão para o escolher.</p></div>
        <button className="btn secondary" type="button" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Novo desafio</button>
      </div>
      <div className="pages-tabs admin-level-tabs" role="tablist" aria-label="Nível">
        {Object.entries(LEVEL_NAMES).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={level === Number(key)} onClick={() => setLevel(Number(key))}>
          <i className={`level-dot level-${key}`} aria-hidden="true" />{label}<span>{levelCounts[key]}</span></button>)}
      </div>
      <div className="template-grid">{data.templates.filter(t => t.level === level).map(t => {
        const isOn = selected.has(t.id);
        return <article key={t.id} className={`template-card${isOn ? " is-selected" : ""}${t.active ? "" : " is-off"}`}>
          <button type="button" className="template-pick" disabled={!t.active} aria-pressed={isOn} onClick={() => toggle(t.id)}>
            <span className="template-check">{isOn && <Icon name="check" size={14} />}</span>
            <span className="template-text">
              <strong>{t.title}</strong>
              <small className="muted">{t.category}{t.times_launched ? ` · lançado ${t.times_launched}× (último ${dateOnly(t.last_launched_at)})` : " · nunca lançado"}{t.active ? "" : " · desligado"}</small>
              <PrizeChips prizes={t.prizes} />
            </span>
          </button>
          <button type="button" className="template-edit" onClick={() => setEditing(t)} aria-label={`Editar ${t.title}`}><Icon name="create" size={15} /> Editar</button>
        </article>;
      })}</div>
    </section>

    <div className={`launch-bar card${chosen.length ? " has-selection" : ""}`}>
      <div className="launch-summary">
        <strong>{chosen.length ? `${chosen.length} ${chosen.length === 1 ? "desafio escolhido" : "desafios escolhidos"}` : "Lançar os desafios do mês"}</strong>
        <small className="muted">{chosen.length
          ? `${chosenCash ? `Até ${formatPrice(chosenCash)} em prémios · ` : ""}todas as pessoas recebem um aviso`
          : "Escolhe até 20 desafios no catálogo. Só contam publicações feitas durante o desafio."}</small>
        {chosen.length > 0 && <span className="launch-chosen">{chosen.map(t => <button key={t.id} type="button" className="chip" onClick={() => toggle(t.id)}>{t.title} <Icon name="close" size={12} /></button>)}</span>}
        {blocked && <small className="error">Há prémios em dinheiro: só a equipa de finanças lança estes desafios.</small>}
      </div>
      <div className="launch-controls">
        <div className="segmented" role="radiogroup" aria-label="Duração">
          {[["", "Fim do mês"], ["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"]].map(([value, label]) =>
            <button key={value} type="button" role="radio" aria-checked={days === value} onClick={() => setDays(value)}>{label}</button>)}
        </div>
        <button className="btn" type="button" disabled={!chosen.length || busy === "launch" || blocked} onClick={launch}>
          <Icon name="trophy" size={15} /> {busy === "launch" ? "A lançar..." : "Lançar e avisar todos"}</button>
      </div>
    </div>

    {editing && <TemplateDialog template={editing === "new" ? null : editing} canGiveCash={data.canGiveCash} onSave={save} onClose={() => setEditing(null)} />}
  </div>;
}

const COURSE_TABS = [["review", "Por rever"], ["published", "À venda"], ["rejected", "Recusados"], ["hidden", "Retirados"]];
export function AdminCourses() {
  const [status, setStatus] = useState("review");
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/admin/courses?status=${status}`).then(result => { setCourses(result.courses); setError(""); }).catch(loadError => setError(loadError.message));
  useEffect(() => { setCourses(null); load(); }, [status]);
  const act = async (course, action) => {
    let note = "";
    if (action !== "approve") {
      note = window.prompt(action === "reject" ? "O que tem de mudar? (o criador recebe esta nota)" : "Porque sai da Academia? (o criador recebe esta nota)") || "";
      if (!note.trim()) return;
    }
    setError(""); setNotice("");
    try {
      await post(`/admin/courses/${course.id}/review`, { action, note });
      setNotice({ approve: "Curso aprovado e à venda.", reject: "Curso devolvido ao criador.", hide: "Curso retirado da Academia." }[action]);
      await load();
    } catch (actError) { setError(actError.message); }
  };
  return <>
    <div className="pages-tabs" role="tablist" aria-label="Estado dos cursos">
      {COURSE_TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={status === key} onClick={() => setStatus(key)}>{label}</button>)}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    <section className="creator-card">
      {!courses && <p className="muted">A carregar...</p>}
      {courses && !courses.length && <p className="muted">Nada aqui.</p>}
      {courses?.length > 0 && <ul className="admin-mini-list">{courses.map(course => <li key={course.id}>
        <span className="muted">#{course.id}</span>
        <span><strong>{course.title}</strong>
          <small>{course.by_team ? "Equipa Tchilar" : `@${course.owner_username}`} · {Number(course.price_kz) ? formatPrice(course.price_kz) : "Grátis"} · {course.lessons_count} aulas · {course.students} alunos</small>
          {course.summary && <small>{course.summary}</small>}
          {course.review_note && <small className="muted">Nota: {course.review_note}</small>}</span>
        <span><Link className="btn secondary" to={`/academia/cursos/${course.id}`}>Ver aulas</Link></span>
        <span className="admin-row-actions">
          {["review", "hidden"].includes(status) && <button className="btn" type="button" onClick={() => act(course, "approve")}>{status === "hidden" ? "Repor" : "Aprovar"}</button>}
          {status === "review" && <button className="btn secondary" type="button" onClick={() => act(course, "reject")}>Pedir mudanças</button>}
          {status === "published" && <button className="btn secondary danger" type="button" onClick={() => act(course, "hide")}>Retirar</button>}
        </span>
      </li>)}</ul>}
    </section>
  </>;
}
