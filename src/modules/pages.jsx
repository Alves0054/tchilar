import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount } from "./core.jsx";
import { Composer, PostCard } from "./feed.jsx";
import { pageMonogram, pageTone } from "./shared.jsx";
import { PAGE_TYPES, pageCategoryLabel, pageType } from "./community-types.js";

// ---------------------------------------------------------------------------------------------
// Páginas: descobrir, seguir, criar e ver páginas
// ---------------------------------------------------------------------------------------------
export function PageKind({ page }) {
  return <span className="page-category"><Icon name={pageType(page.page_type).icon} size={13} /> {pageCategoryLabel(page)}</span>;
}
export function PageLogo({ page, size = "" }) {
  return <span className={`page-logo tone-page-${pageTone(page.category)} ${size}`} aria-hidden="true">{pageMonogram(page.name)}</span>;
}
export function FollowPageButton({ page, user, busy, onFollow, onUnfollow }) {
  if (!user) return <Link className="btn" to="/login">Entrar para seguir</Link>;
  if (page.owner_username === user.username) return <Link className="btn secondary" to={`/pages/${page.id}`}><Icon name="settings" size={15} /> Gerir</Link>;
  return page.is_following
    ? <button className="btn secondary page-following" type="button" disabled={busy} aria-pressed="true" onClick={() => onUnfollow(page)}>
      <Icon name="check" size={15} /><span className="when-idle">A seguir</span><span className="when-hover">Deixar de seguir</span></button>
    : <button className="btn" type="button" disabled={busy} aria-pressed="false" onClick={() => onFollow(page)}><Icon name="plus" size={15} /> Seguir</button>;
}
export function PageCard({ page, user, busy, onFollow, onUnfollow }) {
  return <article className="page-card card">
    <Link className={`page-card-cover tone-page-${pageTone(page.category)}`} to={`/pages/${page.id}`} tabIndex={-1} aria-hidden="true" />
    <div className="page-card-body">
      <Link to={`/pages/${page.id}`} className="page-card-logo-link" aria-hidden="true" tabIndex={-1}><PageLogo page={page} /></Link>
      <h2><Link to={`/pages/${page.id}`}>{page.name}</Link></h2>
      <PageKind page={page} />
      <p className="page-card-description">{page.description || "Ainda sem descrição."}</p>
      <dl className="page-card-stats">
        <div><dt>Seguidores</dt><dd>{formatCount(page.follower_count)}</dd></div>
        <div><dt>Publicações</dt><dd>{formatCount(page.post_count)}</dd></div>
      </dl>
      <div className="page-card-footer">
        <Link className="page-owner" to={`/u/${page.owner_username}`}><Avatar user={{ display_name: page.owner_name, avatar_url: page.owner_avatar }} size="tiny" /><span>{page.owner_name}</span></Link>
        <FollowPageButton page={page} user={user} busy={busy} onFollow={onFollow} onUnfollow={onUnfollow} />
      </div>
    </div>
  </article>;
}
export function CreatePageDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", pageType: "", category: "", description: "" });
  const chosenType = PAGE_TYPES.find(type => type.key === form.pageType);
  // Mudar de tipo escolhe logo a primeira categoria desse tipo (a pessoa pode trocar a seguir).
  const chooseType = type => setForm({ ...form, pageType: type.key, category: type.categories[0].key });
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
      const result = await api("/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      onCreated(result.page);
    } catch (createError) {
      setError(createError.message);
      setBusy(false);
    }
  };
  const preview = { ...form, page_type: form.pageType || "comunidade", category: form.category || "comunidade", name: form.name || "Nome da página" };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card create-page-dialog" role="dialog" aria-modal="true" aria-labelledby="create-page-title" onSubmit={submit}>
      <div className="share-dialog-head">
        <h2 id="create-page-title">Criar página</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
      </div>
      <div className="create-page-grid">
        <div className="create-page-fields">
          <label>Nome<input required autoFocus maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Loja da Rita" /></label>
          <fieldset className="kind-choice">
            <legend>Tipo de página</legend>
            <div className="kind-choice-grid">
              {PAGE_TYPES.map(type => <label key={type.key} className={form.pageType === type.key ? "is-selected" : ""}>
                <input type="radio" name="page-type" required checked={form.pageType === type.key} onChange={() => chooseType(type)} />
                <Icon name={type.icon} size={18} /><span>{type.label}</span>
              </label>)}
            </div>
          </fieldset>
          {chosenType && <label>Categoria<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>
            {chosenType.categories.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>}
          <label>Descrição <small>{form.description.length}/2000</small><textarea rows={4} maxLength={2000} value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Conta às pessoas o que vão encontrar nesta página." /></label>
          <p className="muted create-page-note">És tu quem publica na página. As pessoas que a seguem veem as publicações no feed.</p>
        </div>
        <div className="create-page-preview" aria-label="Pré-visualização">
          <small>Pré-visualização</small>
          <div className="page-card card is-preview">
            <span className={`page-card-cover tone-page-${pageTone(preview.category)}`} />
            <div className="page-card-body">
              <PageLogo page={preview} />
              <h2>{preview.name}</h2>
              {chosenType && <PageKind page={preview} />}
              <p className="page-card-description">{form.description || "A descrição aparece aqui."}</p>
            </div>
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy || !form.name.trim() || !form.pageType}>{busy ? "A criar..." : "Criar página"}</button>
      </div>
    </form>
  </div>, document.body);
}
export function Pages() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const [pages, setPages] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [category, setCategory] = useState("");
  const page = pages?.find(item => String(item.id) === pageId);
  const ownsPage = Boolean(page && user && page.owner_username === user.username);

  const loadPages = async () => {
    try {
      const result = await api("/pages");
      setPages(result.pages);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadPages(); }, [user?.id]);
  useEffect(() => {
    setPosts(null);
    if (!pageId) return;
    api(`/posts?pageId=${encodeURIComponent(pageId)}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));
    window.scrollTo(0, 0);
  }, [pageId]);

  // Seguir/deixar de seguir muda logo no ecrã; se o servidor falhar, volta atrás.
  const setFollowing = async (target, following) => {
    setError("");
    const apply = (value, delta) => setPages(current => current.map(item => item.id === target.id
      ? { ...item, is_following: value, follower_count: item.follower_count + delta } : item));
    apply(following, following ? 1 : -1);
    try {
      await api(`/pages/${target.id}/follow`, { method: following ? "POST" : "DELETE" });
    } catch (followError) {
      apply(!following, following ? -1 : 1);
      setError(followError.message);
    }
  };

  const deletePage = async () => {
    if (!window.confirm(`Apagar a página «${page.name}» e todas as publicações dela? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      await api(`/pages/${page.id}`, { method: "DELETE" });
      setPages(current => current.filter(item => item.id !== page.id));
      navigate("/pages");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy(false);
    }
  };

  const reloadPosts = () => api(`/posts?pageId=${page.id}`).then(result => setPosts(result.posts)).catch(loadError => setError(loadError.message));

  // ----- Página individual -----
  if (pageId) {
    if (!pages && !error) return <div className="page narrow"><div className="empty card">A carregar página...</div></div>;
    if (!page) return <div className="page narrow"><div className="empty card">Esta página não existe ou foi apagada. <Link to="/pages">Ver todas as páginas</Link></div></div>;
    const tone = pageTone(page.category);
    return <div className="pages-view page-detail">
      <Link className="page-back" to="/pages"><Icon name="previous" size={18} /> Todas as páginas</Link>
      <section className="page-hero card">
        <div className={`page-hero-cover tone-page-${tone}`}><span className="page-hero-mark" aria-hidden="true">{pageMonogram(page.name)}</span></div>
        <div className="page-hero-body">
          <PageLogo page={page} size="large" />
          <div className="page-hero-text">
            <h1>{page.name}</h1>
            <p><PageKind page={page} /><span>{formatCount(page.follower_count)} {page.follower_count === 1 ? "seguidor" : "seguidores"}</span><span>{formatCount(page.post_count)} {page.post_count === 1 ? "publicação" : "publicações"}</span></p>
          </div>
          <div className="page-hero-actions">
            {ownsPage
              ? <button className="btn secondary danger-text" type="button" disabled={busy} onClick={deletePage}><Icon name="trash" size={15} /> Apagar página</button>
              : <FollowPageButton page={page} user={user} busy={busy} onFollow={item => setFollowing(item, true)} onUnfollow={item => setFollowing(item, false)} />}
          </div>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="page-detail-grid">
        <aside className="page-about card">
          <h2>Sobre</h2>
          <p>{page.description || "Esta página ainda não tem descrição."}</p>
          <ul>
            <li><Icon name={pageType(page.page_type).icon} size={16} /><span>{pageType(page.page_type).label} · {pageCategoryLabel(page)}</span></li>
            <li><Icon name="profile" size={16} /><span>Criada por <Link to={`/u/${page.owner_username}`}>{page.owner_name}</Link></span></li>
            <li><Icon name="events" size={16} /><span>Desde {new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</span></li>
          </ul>
        </aside>
        <section className="page-posts" aria-label="Publicações da página">
          {ownsPage && <Composer target={{ type: "page", id: page.id }} onPosted={() => { reloadPosts(); loadPages(); }} />}
          {!posts && <div className="empty card">A carregar publicações...</div>}
          {posts?.map(post => <PostCard key={post.id} post={post} onChanged={reloadPosts} />)}
          {posts && !posts.length && <div className="empty card page-empty">
            <PageLogo page={page} />
            <p>{ownsPage ? "A tua página ainda não tem publicações. Escreve a primeira acima — quem te segue vai vê-la no feed." : "Esta página ainda não publicou nada. Segue-a para veres as novidades no teu feed."}</p>
          </div>}
        </section>
      </div>
    </div>;
  }

  // ----- Lista de páginas -----
  const all = pages || [];
  const mine = all.filter(item => user && item.owner_username === user.username);
  const followed = all.filter(item => item.is_following && !(user && item.owner_username === user.username));
  const tabs = [["discover", "Descobrir", all.length], ...(user ? [["mine", "As tuas páginas", mine.length], ["following", "A seguir", followed.length]] : [])];
  const source = tab === "mine" ? mine : tab === "following" ? followed : all;
  // Só aparecem os tipos (e as categorias do tipo escolhido) que têm pelo menos uma página.
  const typesInUse = PAGE_TYPES.filter(type => all.some(item => item.page_type === type.key));
  const categoriesInUse = typeFilter
    ? pageType(typeFilter).categories.filter(item => all.some(p => p.page_type === typeFilter && p.category === item.key)) : [];
  const chooseTypeFilter = key => { setTypeFilter(typeFilter === key ? "" : key); setCategory(""); };
  const term = query.trim().toLowerCase();
  const visible = source.filter(item => (!typeFilter || item.page_type === typeFilter) && (!category || item.category === category)
    && (!term || `${item.name} ${item.description} ${pageCategoryLabel(item)} ${pageType(item.page_type).label} ${item.owner_name}`.toLowerCase().includes(term)));

  return <div className="pages-view">
    <header className="pages-head">
      <div><h1>Páginas</h1><p>Segue negócios, artistas e projetos da tua comunidade, ou cria a tua.</p></div>
      {user ? <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar página</button>
        : <Link className="btn" to="/login">Entrar para criar</Link>}
    </header>
    <div className="pages-toolbar">
      <div className="pages-tabs" role="tablist" aria-label="Que páginas mostrar">
        {tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
      </div>
      <label className="pages-search"><Icon name="search" size={17} /><input type="search" placeholder="Procurar páginas" aria-label="Procurar páginas" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {typesInUse.length > 1 && <div className="province-chips pages-categories" role="group" aria-label="Tipos de página">
      <button type="button" className="province-chip" aria-pressed={!typeFilter} onClick={() => chooseTypeFilter("")}>Todas</button>
      {typesInUse.map(type => <button key={type.key} type="button" className="province-chip" aria-pressed={typeFilter === type.key} onClick={() => chooseTypeFilter(type.key)}>
        <Icon name={type.icon} size={14} /> {type.label}</button>)}
    </div>}
    {categoriesInUse.length > 1 && <div className="province-chips pages-categories pages-subcategories" role="group" aria-label="Categorias">
      {categoriesInUse.map(item => <button key={item.key} type="button" className="province-chip" aria-pressed={category === item.key} onClick={() => setCategory(category === item.key ? "" : item.key)}>{item.label}</button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!pages && !error && <div className="empty card">A carregar páginas...</div>}
    {pages && !visible.length && <div className="empty card pages-empty">
      {tab === "mine" && !term && !typeFilter
        ? <><p>Ainda não criaste nenhuma página. Uma página serve para o teu negócio, projeto ou arte ter o seu próprio espaço.</p><button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar a primeira página</button></>
        : tab === "following" && !term && !typeFilter
          ? <><p>Ainda não segues nenhuma página.</p><button className="btn secondary" type="button" onClick={() => setTab("discover")}>Descobrir páginas</button></>
          : <p>Nenhuma página corresponde à pesquisa.</p>}
    </div>}
    {visible.length > 0 && <div className="pages-grid">{visible.map(item => <PageCard key={item.id} page={item} user={user} busy={busy}
      onFollow={target => setFollowing(target, true)} onUnfollow={target => setFollowing(target, false)} />)}</div>}
    {creating && <CreatePageDialog onClose={() => setCreating(false)} onCreated={created => { setCreating(false); loadPages().then(() => navigate(`/pages/${created.id}`)); }} />}
  </div>;
}
