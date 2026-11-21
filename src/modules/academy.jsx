// Academia Tchilar: guias, cursos à venda (criadores e equipa) e "Como funciona o Tchilar".
//   /academia                       → guias para crescer
//   /academia/cursos                → loja de cursos
//   /academia/cursos/:courseId      → curso: descrição, aulas (abertas a quem tem acesso) e compra
//   /academia/os-meus-cursos        → cursos que comprei e que criei (+ criar curso)
//   /academia/editar/:courseId      → editar um curso meu e as aulas
//   /academia/como-funciona         → explicação de tudo o que há no Tchilar
import { useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_BASE, Avatar, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import { ReportDialog } from "./feed.jsx";
import { ACADEMY_GUIDES } from "./growth.jsx";
import { PaymentDialog } from "./shared.jsx";
import GUIDE from "../data/tchilar-guide.json";
import { Select } from "./select.jsx";
import { FilePicker } from "./file-picker.jsx";

const CATEGORY_LABELS = { criacao: "Criação de conteúdo", video: "Vídeo", fotografia: "Fotografia", musica: "Música", negocios: "Negócios",
  marketing: "Marketing", tecnologia: "Tecnologia", idiomas: "Idiomas", "bem-estar": "Bem-estar", outro: "Outro" };
const LEVEL_LABELS = { iniciante: "Iniciante", intermedio: "Intermédio", avancado: "Avançado" };
const STATUS = { draft: ["Rascunho", "is-off"], review: ["Em revisão", "is-warning"], published: ["À venda", "is-ok"], rejected: ["Precisa de mudanças", "is-warning"], hidden: ["Retirado", "is-off"] };
const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const priceLabel = course => Number(course.price_kz) > 0 ? formatPrice(course.price_kz) : "Grátis";
const media = url => url ? `${API_BASE}${url}` : "";

const CATEGORY_ICONS = { criacao: "spark", video: "reels", fotografia: "camera", musica: "sound", negocios: "stats", marketing: "ad",
  tecnologia: "devices", idiomas: "globe", "bem-estar": "like", outro: "academy" };
const CATEGORY_TONES = { criacao: "#AF52DE", video: "#D63384", fotografia: "#0FA3B1", musica: "#5E5CE6", negocios: "#30B350", marketing: "#FF8A00",
  tecnologia: "#0A84FF", idiomas: "#2F80ED", "bem-estar": "#30B350", outro: "#6E6E73" };
const GUIDE_TONES = ["#0A84FF", "#30B350", "#AF52DE", "#FF8A00", "#0FA3B1", "#5E5CE6", "#E5A000", "#D63384", "#2F80ED", "#F06A2A", "#3A3A3C"];
const TABS = [["/academia", "Início", "home", true], ["/academia/cursos", "Cursos", "academy"], ["/academia/os-meus-cursos", "Os meus cursos", "profile"], ["/academia/como-funciona", "Como funciona", "help"]];

function AcademyTabs() {
  return <nav className="academy-nav" aria-label="Academia">
    {TABS.map(([to, label, icon, end]) => <NavLink key={to} to={to} end={end}><Icon name={icon} size={16} />{label}</NavLink>)}
  </nav>;
}

export function AcademyPage() {
  const { tab, courseId } = useParams();
  const inCourse = (tab === "cursos" && courseId) || tab === "editar";
  return <div className="page academy-v2">
    {!inCourse && <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Academia</p>
        <h1>Aprende, ensina e cresce</h1>
        <p>Cursos de criadores e da equipa, guias para crescer e tudo o que precisas de saber sobre o Tchilar.</p>
        <p className="tc-head-facts">Aulas em vídeo e texto · Aulas de amostra grátis · Paga por Multicaixa Express, Referência ou cartão · Quem ensina fica com 85%</p>
      </div>
      <div className="tc-head-actions">
        <Link className="btn" to="/academia/cursos"><Icon name="academy" size={16} /> Ver cursos</Link>
        <Link className="btn secondary" to="/academia/os-meus-cursos"><Icon name="plus" size={16} /> Vender um curso</Link>
      </div>
    </header>}
    {!inCourse && <AcademyTabs />}
    {!tab && <AcademyHome />}
    {tab === "cursos" && (courseId ? <CourseDetail courseId={courseId} /> : <CourseStore />)}
    {tab === "os-meus-cursos" && <MyCourses />}
    {tab === "editar" && <CourseEditor courseId={courseId} />}
    {tab === "como-funciona" && <HowItWorks />}
  </div>;
}

// ----- Início: cursos em destaque, guias e convite para ensinar -----
function AcademyHome() {
  const [courses, setCourses] = useState(null);
  useEffect(() => { api("/courses").then(result => setCourses(result.courses)).catch(() => setCourses([])); }, []);
  return <>
    <section className="academy-section">
      <div className="academy-section-head">
        <div><h2>Cursos em destaque</h2><p className="muted">Os mais procurados agora.</p></div>
        <Link className="btn secondary" to="/academia/cursos">Ver todos <Icon name="next" size={14} /></Link>
      </div>
      {courses === null ? <div className="empty card">A carregar...</div>
        : courses.length ? <div className="course-grid">{courses.slice(0, 4).map(course => <CourseCard key={course.id} course={course} />)}</div>
          : <div className="academy-empty card"><span className="menu-icon tone-academy"><Icon name="academy" size={22} /></span>
            <div><strong>Os primeiros cursos estão a chegar</strong><p className="muted">Sabes ensinar alguma coisa? Cria o teu curso e fica com 85% de cada venda.</p></div>
            <Link className="btn" to="/academia/os-meus-cursos">Criar um curso</Link></div>}
    </section>

    <section className="academy-section">
      <div className="academy-section-head"><div><h2>Guias para crescer</h2><p className="muted">Seis passos para chegares aos 10 mil seguidores.</p></div></div>
      <div className="guide-cards">{ACADEMY_GUIDES.map(([title, icon, tips], index) => <article className="guide-card card" key={title}>
        <header>
          <span className="guide-card-icon" style={{ "--tone": GUIDE_TONES[index % GUIDE_TONES.length] }}><Icon name={icon} size={18} /></span>
          <span className="guide-card-step">Passo {index + 1}</span>
        </header>
        <h3>{title}</h3>
        <ul>{tips.map(tip => <li key={tip}><Icon name="check" size={14} />{tip}</li>)}</ul>
      </article>)}</div>
    </section>

    <section className="academy-teach card">
      <div>
        <h2>Ensina o que sabes</h2>
        <p>Cria um curso com aulas em vídeo ou texto, define o preço (ou deixa grátis) e envia para revisão. Depois de aprovado fica à venda e recebes 85% de cada venda no teu saldo.</p>
      </div>
      <ol>
        <li><b>1</b>Cria o curso</li>
        <li><b>2</b>Junta as aulas</li>
        <li><b>3</b>Envia para revisão</li>
        <li><b>4</b>Recebe 85%</li>
      </ol>
      <Link className="btn" to="/academia/os-meus-cursos">Começar</Link>
    </section>
  </>;
}

// ----- Como funciona o Tchilar -----
function HowItWorks() {
  const [open, setOpen] = useState(GUIDE[0].key);
  return <div className="guide-layout">
    <nav className="guide-index card" aria-label="Temas">
      <p className="feed-section-kicker">Temas</p>
      {GUIDE.map((section, index) => <button key={section.key} type="button" className={open === section.key ? "is-active" : ""} onClick={() => {
        setOpen(section.key);
        document.getElementById(`guia-${section.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}><span className="guide-dot" style={{ "--tone": GUIDE_TONES[index % GUIDE_TONES.length] }}><Icon name={section.icon} size={14} /></span>{section.title}</button>)}
    </nav>
    <div className="guide-sections">
      {GUIDE.map((section, index) => <section key={section.key} id={`guia-${section.key}`} className="guide-section card">
        <h2><span className="guide-card-icon" style={{ "--tone": GUIDE_TONES[index % GUIDE_TONES.length] }}><Icon name={section.icon} size={18} /></span>{section.title}</h2>
        <div className="guide-items">{section.items.map(([term, text]) => <div key={term} className="guide-item">
          <h3>{term}</h3><p>{text}</p>
        </div>)}</div>
      </section>)}
      <section className="academy-empty card">
        <span className="menu-icon tone-help"><Icon name="help" size={20} /></span>
        <div><strong>Ainda com dúvidas?</strong><p className="muted">As perguntas frequentes respondem ao resto.</p></div>
        <Link className="btn secondary" to="/help">Perguntas frequentes</Link>
      </section>
    </div>
  </div>;
}

// ----- Loja de cursos -----
function CourseCover({ course, large = false }) {
  return <span className={`course-cover${large ? " is-large" : ""}`}>
    {course.cover_url ? <img src={media(course.cover_url)} alt="" />
      : <span className="course-cover-art" style={{ "--tone": CATEGORY_TONES[course.category] || "#6E6E73" }}><Icon name={CATEGORY_ICONS[course.category] || "academy"} size={large ? 44 : 32} /></span>}
  </span>;
}

function CourseCard({ course, to }) {
  const owned = course.has_access && Number(course.price_kz) > 0;
  return <Link to={to || `/academia/cursos/${course.id}`} className="course-card card">
    <span className="course-card-top">
      <CourseCover course={course} />
      <span className={`course-price-tag${Number(course.price_kz) ? "" : " is-free"}`}>{owned ? "Já tens" : priceLabel(course)}</span>
    </span>
    <span className="course-body">
      <span className="course-meta">{CATEGORY_LABELS[course.category] || "Curso"} · {LEVEL_LABELS[course.level]}</span>
      <strong>{course.title}</strong>
      {course.summary && <small className="course-summary">{course.summary}</small>}
      <span className="course-foot">
        <span className="course-author">{course.by_team
          ? <><span className="course-team-mark"><Icon name="academy" size={12} /></span>Equipa Tchilar</>
          : <><Avatar user={{ display_name: course.owner_name, avatar_url: course.owner_avatar }} size="tiny" />{course.owner_name}</>}</span>
        <span className="muted">{course.lessons_count} {course.lessons_count === 1 ? "aula" : "aulas"} · {formatCount(course.students)} alunos</span>
      </span>
    </span>
  </Link>;
}

function CourseStore() {
  const [data, setData] = useState(null);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ ...(category && { category }), ...(query.trim() && { q: query.trim() }) });
      api(`/courses${params.toString() ? `?${params}` : ""}`).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [category, query]);
  return <section className="academy-section">
    <div className="course-filters card">
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar cursos por nome ou tema" aria-label="Procurar cursos" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="course-categories" role="tablist" aria-label="Categorias">
        <button type="button" role="tab" aria-selected={!category} onClick={() => setCategory("")}>Todos</button>
        {(data?.categories || []).map(key => <button key={key} type="button" role="tab" aria-selected={category === key} onClick={() => setCategory(key)}>
          <Icon name={CATEGORY_ICONS[key] || "academy"} size={14} />{CATEGORY_LABELS[key]}</button>)}
      </div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A carregar...</div>}
    {data && !data.courses.length && <div className="academy-empty card"><span className="menu-icon tone-academy"><Icon name="academy" size={22} /></span>
      <div><strong>{query || category ? "Nenhum curso encontrado" : "Ainda não há cursos à venda"}</strong>
        <p className="muted">{query || category ? "Experimenta outra palavra ou categoria." : "Sabes ensinar alguma coisa? Sê a primeira pessoa a vender um curso."}</p></div>
      <Link className="btn secondary" to="/academia/os-meus-cursos">Criar um curso</Link></div>}
    {data?.courses.length > 0 && <>
      <p className="muted course-count">{data.courses.length} {data.courses.length === 1 ? "curso" : "cursos"}{category ? ` em ${CATEGORY_LABELS[category]}` : ""}</p>
      <div className="course-grid">{data.courses.map(course => <CourseCard key={course.id} course={course} />)}</div>
    </>}
  </section>;
}

// ----- Um curso -----
function CourseDetail({ courseId }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [paying, setPaying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState("");
  const load = () => api(`/courses/${courseId}`).then(result => {
    setData(result);
    setLessonId(current => current ?? result.lessons.find(lesson => !lesson.locked)?.id ?? null);
  }).catch(loadError => setError(loadError.message));
  useEffect(() => { setData(null); setLessonId(null); load(); window.scrollTo(0, 0); }, [courseId, user?.id]);
  if (error) return <div className="empty card">{error}</div>;
  if (!data) return <div className="empty card">A carregar...</div>;
  const { course, lessons } = data;
  const lesson = lessons.find(item => item.id === lessonId);
  const paid = Number(course.price_kz) > 0;
  const videos = lessons.filter(item => item.has_video).length;
  const previews = lessons.filter(item => item.is_preview).length;

  return <div className="course-page">
    <button className="btn secondary challenges-back" type="button" onClick={() => navigate("/academia/cursos")}><Icon name="previous" size={15} /> Todos os cursos</button>
    <div className="course-page-top">
      <section className="course-intro card">
        <p className="course-meta">{CATEGORY_LABELS[course.category]} · {LEVEL_LABELS[course.level]}</p>
        <h1>{course.title}</h1>
        {course.summary && <p className="course-lead">{course.summary}</p>}
        <p className="course-author-line">
          {course.by_team ? <><span className="course-team-mark"><Icon name="academy" size={14} /></span> Equipa Tchilar</>
            : <Link to={`/u/${course.owner_username}`}><Avatar user={{ display_name: course.owner_name, avatar_url: course.owner_avatar }} size="tiny" /> {course.owner_name}</Link>}
          <span className="muted">· {formatCount(course.students)} {course.students === 1 ? "aluno" : "alunos"}</span>
        </p>
        {course.description && <div className="course-description">{course.description}</div>}
      </section>
      <aside className="course-buy card">
        <CourseCover course={course} large />
        <div className="course-buy-body">
          <p className="course-buy-price">{paid ? formatPrice(course.price_kz) : "Grátis"}</p>
          {searchParams.get("pagamento") === "sucesso" && !course.has_access && <p className="prefs-saved">A confirmar o pagamento… atualiza daqui a pouco.</p>}
          {course.has_access
            ? <span className="status-pill is-ok course-owned"><Icon name="check" size={13} /> {course.can_edit ? "O teu curso" : paid ? "Já tens este curso" : "Todas as aulas abertas"}</span>
            : !user ? <Link className="btn course-buy-btn" to="/login">Entrar para comprar</Link>
              : <button className="btn course-buy-btn" type="button" onClick={() => setPaying(true)}>Comprar curso</button>}
          {course.can_edit && <Link className="btn secondary course-buy-btn" to={`/academia/editar/${course.id}`}><Icon name="create" size={15} /> Editar curso</Link>}
          <ul className="course-includes">
            <li><Icon name="pages" size={15} /> {lessons.length} {lessons.length === 1 ? "aula" : "aulas"}</li>
            {videos > 0 && <li><Icon name="play" size={15} /> {videos} com vídeo</li>}
            {previews > 0 && !course.has_access && <li><Icon name="check" size={15} /> {previews} de amostra grátis</li>}
            <li><Icon name="lock" size={15} /> Acesso para sempre</li>
            {paid && <li><Icon name="card" size={15} /> Express, Referência ou cartão</li>}
          </ul>
          {user && !course.can_edit && <button className="course-report" type="button" onClick={() => setReporting(true)}><Icon name="report" size={14} /> Denunciar curso</button>}
        </div>
      </aside>
    </div>

    <div className="course-learn">
      <section className="course-lessons card" aria-label="Aulas">
        <h2>Aulas</h2>
        {!lessons.length && <p className="muted">Ainda sem aulas.</p>}
        <ol>{lessons.map((item, index) => <li key={item.id}>
          <button type="button" disabled={item.locked} className={item.id === lessonId ? "is-active" : ""} onClick={() => setLessonId(item.id)}>
            <span className="lesson-number">{index + 1}</span>
            <span className="lesson-title">{item.title}{item.is_preview && !course.has_access && <small>Amostra</small>}</span>
            <Icon name={item.locked ? "lock" : item.has_video ? "play" : "pages"} size={15} />
          </button>
        </li>)}</ol>
      </section>
      <section className="course-lesson card">
        {lesson ? <>
          <p className="course-meta">Aula {lessons.indexOf(lesson) + 1} de {lessons.length}</p>
          <h2>{lesson.title}</h2>
          {lesson.video_url && <video className="lesson-video" src={media(lesson.video_url)} controls playsInline preload="metadata" />}
          {lesson.body && <div className="course-description">{lesson.body}</div>}
        </> : <div className="course-locked">
          <Icon name="lock" size={28} />
          <strong>{lessons.some(item => item.locked) ? "Compra o curso para abrires as aulas" : "Escolhe uma aula"}</strong>
          {!course.has_access && user && paid && <button className="btn" type="button" onClick={() => setPaying(true)}>Comprar por {formatPrice(course.price_kz)}</button>}
        </div>}
      </section>
    </div>
    {reporting && <ReportDialog targetType="course" targetId={course.id} onClose={() => setReporting(false)} />}
    {paying && <PaymentDialog title={`Curso «${course.title}»`} amountKz={course.price_kz} purpose="course"
      onPay={choice => api(`/courses/${course.id}/buy`, json(choice))}
      onDone={() => { setPaying(false); load(); }} onClose={() => { setPaying(false); load(); }} />}
  </div>;
}

// ----- Os meus cursos -----
function MyCourses() {
  const { user, authReady } = useContext(UserContext);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { if (user) api("/courses/mine").then(setData).catch(loadError => setError(loadError.message)); }, [user?.id]);
  if (authReady && !user) return <Navigate to="/login" replace />;
  const create = async event => {
    event.preventDefault();
    setError("");
    try {
      const result = await api("/courses", json({ ...form, priceKz: form.priceKz === "" ? 0 : Number(form.priceKz) }));
      navigate(`/academia/editar/${result.id}`);
    } catch (createError) { setError(createError.message); }
  };
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <div className="empty card">A carregar...</div>;
  const sales = data.created.reduce((sum, course) => sum + (course.by_team ? 0 : course.students * Number(course.price_kz) * 0.85), 0);
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="academy-section">
      <div className="academy-section-head"><div><h2>Os cursos que tenho</h2><p className="muted">Ficam aqui para sempre.</p></div></div>
      {data.purchased.length ? <div className="course-grid">{data.purchased.map(course => <CourseCard key={course.id} course={{ ...course, has_access: true }} />)}</div>
        : <div className="academy-empty card"><span className="menu-icon tone-academy"><Icon name="academy" size={22} /></span>
          <div><strong>Ainda não tens cursos</strong><p className="muted">Os cursos que comprares (ou os grátis que abrires) aparecem aqui.</p></div>
          <Link className="btn secondary" to="/academia/cursos">Ver a loja</Link></div>}
    </section>

    <section className="academy-section">
      <div className="academy-section-head">
        <div><h2>Os cursos que vendo</h2><p className="muted">{data.isTeam ? "Os cursos da equipa publicam logo; os dos criadores passam por revisão." : "Ficas com 85% de cada venda. A equipa revê o curso antes de o pôr à venda."}</p></div>
        {data.canCreate && !form && <button className="btn" type="button" onClick={() => setForm({ title: "", summary: "", category: "criacao", level: "iniciante", priceKz: "", byTeam: false })}><Icon name="plus" size={15} /> Novo curso</button>}
      </div>
      {data.created.length > 0 && <dl className="admin-kpis">
        <div><dt>Cursos</dt><dd>{data.created.length}</dd></div>
        <div><dt>À venda</dt><dd>{data.created.filter(course => course.status === "published").length}</dd></div>
        <div><dt>Alunos</dt><dd>{formatCount(data.created.reduce((sum, course) => sum + course.students, 0))}</dd></div>
        <div><dt>Os teus 85%</dt><dd>{formatPrice(sales)}</dd></div>
      </dl>}
      {!data.canCreate && <div className="academy-empty card"><span className="menu-icon tone-stats"><Icon name="stats" size={22} /></span>
        <div><strong>Ativa o modo criador para vender</strong><p className="muted">É grátis e demora um segundo, no Painel do criador.</p></div>
        <Link className="btn" to="/creator">Abrir o Painel do criador</Link></div>}
      {form && <form className="card course-new" onSubmit={create}>
        <h3>Novo curso</h3>
        <div className="course-new-grid">
          <label>Título<input required maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Reels que vendem" /></label>
          <label>Resumo<input maxLength={240} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} placeholder="O que se aprende, numa frase" /></label>
          <label>Categoria<Select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
          <label>Nível<Select value={form.level} onChange={event => setForm({ ...form, level: event.target.value })}>{Object.entries(LEVEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
          <label>Preço (Kz) <small className="muted">vazio = grátis · 500 a 500 000</small><input type="number" min="0" max="500000" value={form.priceKz} onChange={event => setForm({ ...form, priceKz: event.target.value })} /></label>
          {data.isTeam && <label className="checkbox"><input type="checkbox" checked={form.byTeam} onChange={event => setForm({ ...form, byTeam: event.target.checked })} /> Curso da equipa Tchilar</label>}
        </div>
        <div className="prefs-form-foot"><button className="btn secondary" type="button" onClick={() => setForm(null)}>Cancelar</button><button className="btn" type="submit">Criar e juntar aulas</button></div>
      </form>}
      {data.created.length > 0 && <div className="my-course-list">{data.created.map(course => <article key={course.id} className="my-course card">
        <CourseCover course={course} />
        <div className="my-course-text">
          <span className={`status-pill ${STATUS[course.status][1]}`}>{STATUS[course.status][0]}</span>
          <strong>{course.title}</strong>
          <small className="muted">{priceLabel(course)} · {course.lessons_count} aulas · {course.students} alunos</small>
          {course.review_note && <small className="my-course-note"><Icon name="info" size={13} /> {course.review_note}</small>}
        </div>
        <div className="my-course-actions">
          <Link className="btn" to={`/academia/editar/${course.id}`}><Icon name="create" size={14} /> Editar</Link>
          <Link className="btn secondary" to={`/academia/cursos/${course.id}`}>Ver</Link>
        </div>
      </article>)}</div>}
    </section>
  </>;
}

// ----- Editar um curso e as aulas -----
function CourseEditor({ courseId }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [lesson, setLesson] = useState({ title: "", body: "", isPreview: false, video: null });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const coverInput = useRef(null);
  const load = () => api(`/courses/${courseId}`).then(result => {
    setData(result);
    setForm(current => current || { title: result.course.title, summary: result.course.summary, description: result.course.description,
      category: result.course.category, level: result.course.level, priceKz: Number(result.course.price_kz) ? String(result.course.price_kz) : "" });
  }).catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [courseId]);
  if (error && !data) return <div className="empty card">{error}</div>;
  if (!data || !form) return <div className="empty card">A carregar...</div>;
  if (!data.course.can_edit) return <div className="empty card">Só quem criou o curso o pode editar.</div>;
  const { course, lessons } = data;
  const run = async (key, task, message) => {
    setBusy(key); setError(""); setNotice("");
    try { await task(); await load(); if (message) setNotice(message); } catch (taskError) { setError(taskError.message); } finally { setBusy(""); }
  };
  const save = event => { event.preventDefault(); run("save", async () => {
    const result = await api(`/courses/${course.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, priceKz: form.priceKz === "" ? 0 : Number(form.priceKz) }) });
    if (result.status === "review" && course.status === "published") setNotice("Guardado. O curso voltou a revisão e fica à venda quando a equipa aprovar.");
  }, "Guardado."); };
  const addLesson = event => { event.preventDefault(); run("lesson", async () => {
    const body = new FormData();
    body.append("title", lesson.title);
    body.append("body", lesson.body);
    body.append("isPreview", lesson.isPreview ? "true" : "false");
    if (lesson.video) body.append("video", lesson.video);
    await api(`/courses/${course.id}/lessons`, { method: "POST", body });
    setLesson({ title: "", body: "", isPreview: false, video: null });
  }, "Aula adicionada."); };
  const uploadCover = file => file && run("cover", () => { const body = new FormData(); body.append("image", file); return api(`/courses/${course.id}/cover`, { method: "POST", body }); }, "Capa atualizada.");
  const removeLesson = item => window.confirm(`Apagar a aula «${item.title}»?`) && run(`del${item.id}`, () => api(`/courses/${course.id}/lessons/${item.id}`, { method: "DELETE" }));
  const togglePreview = item => run(`pre${item.id}`, () => api(`/courses/${course.id}/lessons/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPreview: !item.is_preview }) }));
  const submit = () => run("submit", async () => {
    const result = await api(`/courses/${course.id}/submit`, { method: "POST" });
    setNotice(result.status === "published" ? "Publicado na Academia." : "Enviado para revisão. Avisamos-te quando estiver à venda.");
  });
  const remove = () => window.confirm("Apagar este curso e todas as aulas? Não pode ser desfeito.") && run("delete", async () => {
    await api(`/courses/${course.id}`, { method: "DELETE" });
    navigate("/academia/os-meus-cursos");
  });

  return <div className="course-editor">
    <button className="btn secondary challenges-back" type="button" onClick={() => navigate("/academia/os-meus-cursos")}><Icon name="previous" size={15} /> Os meus cursos</button>
    <section className="creator-card">
      <div className="creator-card-head">
        <div><h2>{course.title}</h2><p><span className={`status-pill ${STATUS[course.status][1]}`}>{STATUS[course.status][0]}</span>
          {course.review_note && <span className="error"> Nota da equipa: {course.review_note}</span>}</p></div>
        <div className="course-actions">
          {["draft", "rejected"].includes(course.status) && <button className="btn" type="button" disabled={busy === "submit"} onClick={submit}>{course.by_team ? "Publicar" : "Enviar para revisão"}</button>}
          <Link className="btn secondary" to={`/academia/cursos/${course.id}`}>Ver como aluno</Link>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
      <div className="course-cover-edit">
        <span className="course-cover">{course.cover_url ? <img src={media(course.cover_url)} alt="" /> : <Icon name="academy" size={32} />}</span>
        <input ref={coverInput} type="file" accept="image/*" hidden onChange={event => uploadCover(event.target.files[0])} />
        <button className="btn secondary" type="button" disabled={busy === "cover"} onClick={() => coverInput.current.click()}><Icon name="camera" size={15} /> {course.cover_url ? "Mudar capa" : "Adicionar capa"}</button>
      </div>
      <form className="prefs-form course-form" onSubmit={save}>
        <label>Título<input required maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
        <label>Resumo<input maxLength={240} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} /></label>
        <label>Descrição<textarea rows={5} maxLength={8000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Para quem é, o que se aprende, o que é preciso." /></label>
        <div className="field-pair">
          <label>Categoria<Select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
          <label>Nível<Select value={form.level} onChange={event => setForm({ ...form, level: event.target.value })}>{Object.entries(LEVEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
        </div>
        <label>Preço (Kz) <small>0 ou vazio = grátis · 500 a 500 000 Kz{course.by_team ? "" : " · ficas com 85%"}</small><input type="number" min="0" max="500000" value={form.priceKz} onChange={event => setForm({ ...form, priceKz: event.target.value })} /></label>
        <div className="prefs-form-foot">
          {!course.students && <button className="btn secondary danger" type="button" onClick={remove}>Apagar curso</button>}
          <button className="btn" type="submit" disabled={busy === "save"}>{busy === "save" ? "A guardar..." : "Guardar"}</button>
        </div>
      </form>
    </section>
    <section className="creator-card">
      <h2>Aulas</h2>
      {lessons.length > 0 && <ol className="admin-mini-list course-lesson-list">{lessons.map((item, index) => <li key={item.id}>
        <span className="lesson-number">{index + 1}</span>
        <span><strong>{item.title}</strong><small>{item.has_video ? "Vídeo" : "Texto"}{item.is_preview ? " · amostra grátis" : ""}</small></span>
        <span><button className="btn secondary" type="button" disabled={busy === `pre${item.id}`} onClick={() => togglePreview(item)}>{item.is_preview ? "Tirar amostra" : "Pôr como amostra"}</button></span>
        <span><button className="btn secondary danger" type="button" disabled={busy === `del${item.id}`} onClick={() => removeLesson(item)} aria-label={`Apagar ${item.title}`}><Icon name="trash" size={15} /></button></span>
      </li>)}</ol>}
      <form className="prefs-form course-form" onSubmit={addLesson}>
        <h3>Nova aula</h3>
        <label>Título<input required maxLength={120} value={lesson.title} onChange={event => setLesson({ ...lesson, title: event.target.value })} /></label>
        <label>Texto da aula<textarea rows={5} maxLength={20000} value={lesson.body} onChange={event => setLesson({ ...lesson, body: event.target.value })} placeholder="Explicação, passos, links úteis..." /></label>
        <div className="field-block"><span className="field-block-label">Vídeo (opcional)</span>
          <FilePicker kind="video" file={lesson.video} onChange={video => setLesson({ ...lesson, video })} accept="video/mp4,video/webm,video/quicktime"
            hint="MP4, WebM ou MOV" label="Vídeo da aula" disabled={busy === "lesson"} /></div>
        <label className="checkbox"><input type="checkbox" checked={lesson.isPreview} onChange={event => setLesson({ ...lesson, isPreview: event.target.checked })} /> Amostra grátis (qualquer pessoa vê antes de comprar)</label>
        <div className="prefs-form-foot"><button className="btn" type="submit" disabled={busy === "lesson" || !lesson.title.trim() || (!lesson.body.trim() && !lesson.video)}>{busy === "lesson" ? "A enviar..." : "Adicionar aula"}</button></div>
      </form>
    </section>
  </div>;
}
