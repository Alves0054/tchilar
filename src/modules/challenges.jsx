// Desafios do mês.
//   /desafios      → como funciona (3 passos), prémios do mês, filtros por nível e os desafios em cartões
//   /desafios/:id  → um desafio: pódio de prémios, participar, a tua posição e a classificação
import { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount, formatPrice } from "./core.jsx";
import { ContentThumb, canBoost, postKind } from "./shared.jsx";

const LEVELS = { 1: "Bronze", 2: "Prata", 3: "Ouro", 4: "Diamante", 5: "Lenda" };
const json = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const DAY = 24 * 60 * 60 * 1000;

const daysLeft = endsAt => Math.max(0, Math.ceil((new Date(endsAt) - Date.now()) / DAY));
function timeLeft(challenge) {
  if (!challenge.is_open) return "Terminado";
  const days = daysLeft(challenge.ends_at);
  if (days <= 1) return "Termina hoje";
  return `Faltam ${days} dias`;
}
const cash = prize => Number(prize?.cashKz ?? prize?.cash_kz) || 0;
const firstPrize = challenge => (challenge.prizes || [])[0] || null;
// O prémio principal, numa frase: "25 000 Kz + 1 000 estrelas".
function prizeHeadline(prize) {
  if (!prize) return "Sem prémio";
  return [cash(prize) ? formatPrice(cash(prize)) : "", prize.stars ? `${formatCount(prize.stars)} estrelas` : ""].filter(Boolean).join(" + ") || "Sem prémio";
}

export function ChallengesPage() {
  const { challengeId } = useParams();
  return challengeId ? <ChallengeDetail challengeId={challengeId} /> : <ChallengeList />;
}

// ---------------------------------------------------------------------------------------------
function ChallengeList() {
  const { user } = useContext(UserContext);
  const [list, setList] = useState(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { api("/challenges").then(result => setList(result.challenges)).catch(loadError => setError(loadError.message)); }, [user?.id]);

  const open = useMemo(() => (list || []).filter(item => item.is_open), [list]);
  const finished = useMemo(() => (list || []).filter(item => !item.is_open), [list]);
  const shown = open.filter(item => !level || item.level === level);
  const totalCash = open.reduce((sum, item) => sum + (item.prizes || []).reduce((acc, prize) => acc + cash(prize), 0), 0);
  const mine = open.filter(item => item.my_post_id).length;
  const nextEnd = open.length ? Math.min(...open.map(item => daysLeft(item.ends_at))) : null;
  const month = new Date().toLocaleDateString("pt-PT", { month: "long" });

  return <div className="page challenges-v2">
    <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Desafios de {month}</p>
        <h1>Participa e ganha prémios</h1>
        <p>Todos os meses há desafios novos. Publica, entra com a tua publicação e junta gostos: os mais gostados ganham estrelas e, nos níveis mais altos, dinheiro.</p>
        <p className="tc-head-facts">
          <b>{formatCount(open.length)}</b> {open.length === 1 ? "desafio aberto" : "desafios abertos"}
          {" · "}{totalCash ? <>Prémios de <b>{formatPrice(totalCash)}</b> este mês</> : "Prémios em estrelas"}
          {" · "}{nextEnd === null ? "Próximos desafios em breve" : nextEnd <= 1 ? <b>Último dia</b> : <>Terminam em <b>{nextEnd} dias</b></>}
          {user && <>{" · "}Estás em <b>{mine}</b> {mine === 1 ? "desafio" : "desafios"}</>}
        </p>
      </div>
      {user?.is_admin && <div className="tc-head-actions">
        <Link className="btn secondary" to="/admin/desafios"><Icon name="settings" size={15} /> Gerir desafios</Link>
      </div>}
    </header>

    <section className="challenges-steps" aria-label="Como funciona">
      {[["create", "1. Publica", "Faz uma publicação pública (foto, vídeo ou Reel) sobre o tema do desafio."],
        ["trophy", "2. Entra no desafio", "Abre o desafio e escolhe essa publicação. Só contam publicações feitas durante o desafio."],
        ["like", "3. Junta gostos", "Partilha com amigos. No fim do mês, os 3 mais gostados ganham os prémios."]]
        .map(([icon, title, text]) => <article key={title} className="card challenges-step">
          <span className={`menu-icon tone-${icon}`}><Icon name={icon} size={18} /></span>
          <div><h2>{title}</h2><p>{text}</p></div>
        </article>)}
    </section>

    {error && <p className="error" role="alert">{error}</p>}
    {!list && !error && <div className="empty card">A carregar...</div>}

    {list && <>
      <div className="challenges-toolbar">
        <h2>Desafios abertos</h2>
        <div className="pages-tabs" role="tablist" aria-label="Nível">
          <button type="button" role="tab" aria-selected={!level} onClick={() => setLevel(0)}>Todos</button>
          {Object.entries(LEVELS).map(([key, label]) => open.some(item => item.level === Number(key)) &&
            <button key={key} type="button" role="tab" aria-selected={level === Number(key)} onClick={() => setLevel(Number(key))}>{label}</button>)}
        </div>
      </div>
      {!shown.length && <div className="empty card pages-empty"><p>{open.length ? "Nenhum desafio neste nível." : "Não há desafios abertos agora. Os novos chegam no início do mês e recebes um aviso."}</p></div>}
      <div className="challenge-grid">{shown.map(item => <ChallengeCard key={item.id} challenge={item} />)}</div>

      {finished.length > 0 && <>
        <div className="challenges-toolbar"><h2>Terminados recentemente</h2></div>
        <div className="challenge-grid is-finished">{finished.map(item => <ChallengeCard key={item.id} challenge={item} />)}</div>
      </>}
    </>}
  </div>;
}

function ChallengeCard({ challenge }) {
  const prize = firstPrize(challenge);
  const others = (challenge.prizes || []).slice(1).filter(item => item.stars || cash(item));
  return <Link to={`/desafios/${challenge.id}`} className={`challenge-tile card level-${challenge.level || 0}`}>
    <span className="challenge-tile-band">
      <span><Icon name="trophy" size={14} /> {LEVELS[challenge.level] || "Especial"}</span>
      <span>{timeLeft(challenge)}</span>
    </span>
    <span className="challenge-tile-body">
      <strong className="challenge-tile-title">{challenge.title}</strong>
      {challenge.description && <span className="challenge-tile-text">{challenge.description}</span>}
      <span className="challenge-tile-prize">
        <small>1.º lugar</small>
        <b>{prizeHeadline(prize)}</b>
        {others.length > 0 && <small>{others.map(item => `${item.place}.º ${prizeHeadline(item)}`).join(" · ")}</small>}
      </span>
    </span>
    <span className="challenge-tile-foot">
      <span><Icon name="groups" size={14} /> {formatCount(challenge.entries)} {challenge.entries === 1 ? "participante" : "participantes"}</span>
      {challenge.my_post_id ? <span className="status-pill is-ok"><Icon name="check" size={12} /> Estás a participar</span>
        : challenge.is_open ? <span className="challenge-tile-cta">Participar <Icon name="next" size={14} /></span>
          : challenge.winner_name ? <span className="muted">Venceu {challenge.winner_name}</span> : <span className="muted">Ver resultados</span>}
    </span>
  </Link>;
}

// ---------------------------------------------------------------------------------------------
function Podium({ prizes, awards }) {
  const byPlace = place => ({ prize: (prizes || []).find(item => item.place === place), award: (awards || []).find(item => item.place === place) });
  const places = [2, 1, 3].map(place => ({ place, ...byPlace(place) })).filter(item => item.prize && (item.prize.stars || cash(item.prize)));
  if (!places.length) return null;
  return <div className="podium" aria-label="Prémios por lugar">
    {places.map(({ place, prize, award }) => <div key={place} className={`podium-step place-${place}`}>
      {award ? <Link to={`/u/${award.username}`} className="podium-winner"><Avatar user={award} size="small" /><span>{award.display_name}</span></Link>
        : <span className="podium-medal">{place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉"}</span>}
      <div className="podium-block">
        <strong>{place}.º</strong>
        {cash(prize) > 0 && <span className="podium-cash">{formatPrice(cash(prize))}</span>}
        {prize.stars > 0 && <span className="podium-stars"><Icon name="star" size={13} /> {formatCount(prize.stars)}</span>}
      </div>
    </div>)}
  </div>;
}

function ChallengeDetail({ challengeId }) {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [myPosts, setMyPosts] = useState(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api(`/challenges/${challengeId}`).then(setDetail).catch(loadError => setError(loadError.message));
  useEffect(() => { setDetail(null); setPicking(false); load(); window.scrollTo(0, 0); }, [challengeId]);
  useEffect(() => { if (user) api("/creator/content").then(result => setMyPosts(result.posts.filter(canBoost))).catch(() => setMyPosts([])); }, [user?.id]);
  if (error && !detail) return <div className="page narrow"><div className="empty card">{error}</div></div>;
  if (!detail) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;

  const { challenge, ranking, awards } = detail;
  const myIndex = user ? ranking.findIndex(entry => entry.username === user.username) : -1;
  const joined = myIndex >= 0;
  const since = challenge.new_posts_only ? new Date(challenge.starts_at) : null;
  const eligible = (myPosts || []).filter(post => !since || new Date(post.created_at) >= since);
  const join = async postId => {
    setError("");
    try {
      await api(`/challenges/${challenge.id}/entries`, json({ postId }));
      setPicking(false);
      setNotice("Estás a participar! Partilha a tua publicação para juntar gostos.");
      await load();
    } catch (joinError) { setError(joinError.message); }
  };
  const close = async () => {
    if (!window.confirm("Encerrar o desafio? Os primeiros lugares (por gostos) recebem os prémios automaticamente.")) return;
    try {
      const result = await api(`/challenges/${challenge.id}/close`, { method: "POST" });
      setNotice(result.awards?.length ? `Premiados: ${result.awards.map(item => `${item.place}.º @${item.username}`).join(", ")}.` : "Encerrado sem participações.");
      await load();
    } catch (closeError) { setError(closeError.message); }
  };

  return <div className="page challenges-v2">
    <button className="btn secondary challenges-back" type="button" onClick={() => navigate("/desafios")}><Icon name="previous" size={15} /> Todos os desafios</button>

    <header className={`challenge-banner card level-${challenge.level || 0}`}>
      <div className="challenge-banner-top">
        <span className="challenge-level-chip"><Icon name="trophy" size={14} /> {LEVELS[challenge.level] || "Desafio especial"}</span>
        <span className={`status-pill ${challenge.is_open ? "is-ok" : "is-off"}`}>{timeLeft(challenge)}</span>
      </div>
      <h1>{challenge.title}</h1>
      <p className="challenge-banner-meta">
        <span><Icon name="groups" size={15} /> {formatCount(challenge.entries)} {challenge.entries === 1 ? "participante" : "participantes"}</span>
        <span><Icon name="events" size={15} /> {challenge.is_open ? "Termina" : "Terminou"} a {new Date(challenge.closed_at || challenge.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}</span>
        {challenge.sponsor && challenge.sponsor !== "Tchilar" && <span><Icon name="gift" size={15} /> Patrocínio: {challenge.sponsor}</span>}
      </p>
    </header>

    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    <div className="challenge-columns">
      <div className="challenge-main">
        <section className="creator-card">
          <h2>O desafio</h2>
          <p className="challenge-rules">{challenge.description || "Sem regras extra: participa com a tua melhor publicação."}</p>
          <ul className="challenge-facts">
            {challenge.new_posts_only && <li><Icon name="events" size={15} /> Só contam publicações feitas depois de o desafio começar.</li>}
            <li><Icon name="like" size={15} /> Ganha quem tiver mais gostos quando o desafio terminar (empate: entrou primeiro).</li>
            <li><Icon name="check" size={15} /> Uma participação por pessoa, com uma publicação pública tua.</li>
            {(challenge.prizes || []).some(prize => cash(prize) > 0) && <li><Icon name="card" size={15} /> O dinheiro entra no teu saldo e levantas para o IBAN no Painel do criador.</li>}
          </ul>
        </section>

        {challenge.is_open && <section className="creator-card challenge-join">
          {!user ? <><h2>Queres participar?</h2><p className="muted">Entra na tua conta para participares.</p><Link className="btn" to="/login">Entrar</Link></>
            : joined ? <>
              <h2>A tua participação</h2>
              <p className="challenge-you"><span className={`supporter-rank rank-${myIndex + 1}`}>{myIndex + 1}</span>
                Estás em <strong>{myIndex + 1}.º lugar</strong> com {formatCount(ranking[myIndex].likes)} gostos.
                {myIndex > 0 && ` Faltam ${formatCount(ranking[myIndex - 1].likes - ranking[myIndex].likes + 1)} gostos para subires.`}</p>
              <p className="muted">Partilha a tua publicação nos grupos e com amigos para juntar mais gostos.</p>
            </> : picking ? <>
              <h2>Escolhe a tua publicação</h2>
              {myPosts === null ? <p className="muted">A carregar...</p>
                : eligible.length ? <div className="boost-posts">{eligible.slice(0, 12).map(post => <button key={post.id} type="button" className="boost-post" onClick={() => join(post.id)}>
                  <ContentThumb post={post} /><small>{post.excerpt || postKind(post)}</small></button>)}</div>
                  : <p className="muted">Ainda não tens publicações públicas {since ? "feitas desde que o desafio começou" : ""}. <Link to="/create">Publica agora</Link> e volta aqui.</p>}
              <button className="btn secondary" type="button" onClick={() => setPicking(false)}>Cancelar</button>
            </> : <>
              <h2>Pronto para participar?</h2>
              <p className="muted">Publica algo sobre o tema e depois escolhe essa publicação aqui.</p>
              <div className="course-actions">
                <button className="btn" type="button" onClick={() => setPicking(true)}><Icon name="trophy" size={16} /> Participar</button>
                <Link className="btn secondary" to="/create"><Icon name="create" size={15} /> Publicar primeiro</Link>
              </div>
            </>}
        </section>}

        <section className="creator-card">
          <h2>Classificação</h2>
          {ranking.length ? <ol className="challenge-ranking-v2">{ranking.map((entry, index) => <li key={entry.post_id} className={entry.username === user?.username ? "is-me" : ""}>
            <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
            <ContentThumb post={{ ...entry, views: entry.likes }} />
            <span className="challenge-entry-text">
              <Link className="post-author" to={`/u/${entry.username}`}>{entry.display_name}{entry.username === user?.username ? " (tu)" : ""}</Link>
              <small>{entry.excerpt || postKind(entry)}</small>
            </span>
            <span className="challenge-likes"><Icon name="like" size={14} /> {formatCount(entry.likes)}</span>
          </li>)}</ol> : <p className="muted">Ainda ninguém participou. Sê a primeira pessoa!</p>}
        </section>
      </div>

      <aside className="challenge-side">
        <section className="creator-card">
          <h2>{awards?.length ? "Vencedores" : "Prémios"}</h2>
          <Podium prizes={challenge.prizes} awards={awards} />
          {(challenge.prizes || []).length > 3 && <ul className="prize-list">{challenge.prizes.slice(3).filter(prize => prize.stars || cash(prize)).map(prize =>
            <li key={prize.place}><span className="supporter-rank">{prize.place}</span>{prizeHeadline(prize)}</li>)}</ul>}
          {challenge.prize && <p className="muted"><Icon name="gift" size={14} /> {challenge.prize}</p>}
        </section>
        {user?.is_admin && challenge.closed_at === null && <section className="creator-card">
          <h2>Equipa</h2>
          <p className="muted">Encerrar dá os prémios aos primeiros lugares agora.</p>
          <button className="btn secondary" type="button" onClick={close}>Encerrar e premiar</button>
        </section>}
      </aside>
    </div>
  </div>;
}
