// Página de pesquisa: pessoas, publicações, hashtags, grupos, páginas e eventos.
// "/search?q=texto" procura em tudo; "/search?q=%23tag" (ou um clique numa hashtag) mostra as publicações dessa hashtag.
import { useContext, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Icon, UserContext, api } from "./core.jsx";
import { PostCard } from "./feed.jsx";
import { PeopleCard } from "./friends.jsx";
import { OfficialPageBadge } from "./pages.jsx";

const TABS = [["all", "Tudo"], ["people", "Pessoas"], ["posts", "Publicações"], ["hashtags", "Hashtags"], ["groups", "Grupos"], ["pages", "Páginas"], ["events", "Eventos"]];
const HASHTAG = /^#[\p{L}\p{N}_]{1,50}$/u;

export function Search() {
  const { user, authReady } = useContext(UserContext);
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") || "").trim();
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") : "all";
  const isTag = HASHTAG.test(query);
  const [draft, setDraft] = useState(query);
  const [results, setResults] = useState(null);
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    if (!user || !query) { setResults(null); setPosts(null); return; }
    let active = true;
    setResults(null);
    setPosts(null);
    setError("");
    const postsUrl = isTag ? `/posts?tag=${encodeURIComponent(query.slice(1))}` : `/posts?q=${encodeURIComponent(query)}`;
    Promise.all([api(`/search?q=${encodeURIComponent(query)}`), api(postsUrl)])
      .then(([found, postResult]) => { if (active) { setResults(found); setPosts(postResult.posts); } })
      .catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [query, isTag, user?.id]);

  if (authReady && !user) return <Navigate to="/login" replace />;
  const go = (next, nextTab = tab) => setParams(next ? { q: next, ...(nextTab !== "all" && { tab: nextTab }) } : {});
  const counts = results && posts ? {
    people: results.users.length, posts: posts.length, hashtags: results.hashtags.length,
    groups: results.groups.length, pages: results.pages.length, events: (results.events || []).length
  } : {};
  const show = id => tab === "all" || tab === id;
  const nothing = results && posts && !Object.values(counts).some(Boolean);

  return <div className="pages-view search-view">
    <header className="pages-head">
      <div><h1>{isTag ? query : "Pesquisa"}</h1><p>{isTag ? "Publicações com esta hashtag." : "Pessoas, publicações, hashtags, grupos, páginas e eventos."}</p></div>
    </header>
    <form className="search-page-form" role="search" onSubmit={event => { event.preventDefault(); go(draft.trim()); }}>
      <label className="pages-search"><Icon name="search" size={17} />
        <input type="search" autoFocus={!query} placeholder="Pesquisar no Tchilar (escreve # para hashtags)" aria-label="Pesquisar no Tchilar"
          value={draft} maxLength={100} onChange={event => setDraft(event.target.value)} /></label>
      <button className="btn" type="submit" disabled={!draft.trim()}>Pesquisar</button>
    </form>
    {query && <div className="pages-tabs search-tabs" role="tablist" aria-label="Tipo de resultado">
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => go(query, id)}>
        {label}{id !== "all" && counts[id] !== undefined && <span>{counts[id]}</span>}</button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {!query && <div className="empty card pages-empty"><p>Escreve um nome, uma palavra ou uma hashtag (por exemplo <strong>#Luanda</strong>).</p></div>}
    {query && !results && !error && <div className="empty card">A procurar...</div>}
    {nothing && <div className="empty card pages-empty"><p>Sem resultados para «{query}». Experimenta outra palavra ou menos letras.</p></div>}

    {results && <>
      {show("people") && !!results.users.length && <section className="search-section" aria-labelledby="search-people">
        <h2 id="search-people">Pessoas</h2>
        <div className="people-grid">{results.users.slice(0, tab === "all" ? 4 : 20).map(person => <PeopleCard key={person.id} person={person}>
          <Link className="btn secondary" to={`/u/${person.username}`}>Ver perfil</Link>
        </PeopleCard>)}</div>
      </section>}

      {show("hashtags") && !!results.hashtags.length && <section className="search-section" aria-labelledby="search-tags">
        <h2 id="search-tags">Hashtags</h2>
        <ul className="search-tags">{results.hashtags.map(item => <li key={item.tag}>
          <button type="button" onClick={() => go(`#${item.tag}`, "posts")}><Icon name="reference" size={16} /><strong>#{item.tag}</strong>
            <small>{item.posts === 1 ? "1 publicação" : `${item.posts} publicações`}</small></button>
        </li>)}</ul>
      </section>}

      {show("groups") && !!results.groups.length && <section className="search-section" aria-labelledby="search-groups">
        <h2 id="search-groups">Grupos</h2>
        <ul className="search-list">{results.groups.slice(0, tab === "all" ? 4 : 20).map(group => <li key={group.id}>
          <Link to={`/groups/${group.id}`}><span className="menu-icon tone-groups"><Icon name="groups" size={18} /></span>
            <span><strong>{group.name}</strong><small>{group.member_count === 1 ? "1 membro" : `${group.member_count} membros`}{group.requires_approval ? " · Privado" : ""}{group.is_member ? " · Já és membro" : ""}</small></span></Link>
        </li>)}</ul>
      </section>}

      {show("pages") && !!results.pages.length && <section className="search-section" aria-labelledby="search-pages">
        <h2 id="search-pages">Páginas</h2>
        <ul className="search-list">{results.pages.slice(0, tab === "all" ? 4 : 20).map(page => <li key={page.id}>
          <Link to={`/pages/${page.id}`}><span className="menu-icon tone-pages"><Icon name="pages" size={18} /></span>
            <span><strong>{page.name}<OfficialPageBadge show={page.is_official} tier={page.verification_tier} /></strong><small>{page.follower_count === 1 ? "1 seguidor" : `${page.follower_count} seguidores`}</small></span></Link>
        </li>)}</ul>
      </section>}
      {show("events") && !!results.events?.length && <section className="search-section" aria-labelledby="search-events">
        <h2 id="search-events">Eventos</h2>
        <ul className="search-list">{results.events.slice(0, tab === "all" ? 4 : 20).map(event => <li key={event.id}>
          <Link to={`/events/${event.id}`}><span className="menu-icon tone-events"><Icon name="events" size={18} /></span>
            <span><strong>{event.name}</strong><small>{new Date(event.starts_at).toLocaleString("pt-PT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" })}
              {event.location ? ` · ${event.location}` : ""} · {event.ticket_price_kz > 0 ? `${Math.round(event.ticket_price_kz).toLocaleString("pt-PT")} Kz` : "Grátis"}</small></span></Link>
        </li>)}</ul>
      </section>}
    </>}

    {posts && show("posts") && !!posts.length && <section className="search-section" aria-labelledby="search-posts">
      <h2 id="search-posts">Publicações</h2>
      <div className="search-posts">{posts.map(post => <PostCard key={post.id} post={post} />)}</div>
    </section>}
  </div>;
}
