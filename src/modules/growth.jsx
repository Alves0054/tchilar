import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar, Icon, UserContext, api, formatCount, formatPrice, PUBLIC_URL } from "./core.jsx";
import { relativeTime } from "./feed.jsx";
import { PaymentDialog, PersonLine, VerifiedBadge } from "./shared.jsx";
import { Select } from "./select.jsx";

export function StarsPage() {
  const { user, authReady } = useContext(UserContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api("/stars").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => {
    if (!user) return;
    load();
    const payment = searchParams.get("pagamento");
    if (payment) {
      setNotice(payment === "sucesso" ? "Pagamento recebido. As estrelas chegam ao teu saldo em poucos segundos." : "O pagamento foi cancelado.");
      setSearchParams({}, { replace: true });
      if (payment === "sucesso") window.setTimeout(load, 4000);
    }
  }, [user?.id]);
  const [paying, setPaying] = useState(null);
  const buy = pack => {
    setError("");
    setPaying({
      pack,
      onPay: choice => api("/stars/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack: pack.index, ...choice }) })
    });
  };
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para veres as tuas estrelas. <Link to="/login">Entrar</Link></div></div>;
  const kindLabel = item => ({
    purchase: "Compraste estrelas",
    gift_sent: `Ofereceste a ${item.display_name || "alguém"}`,
    gift_received: `Recebeste de ${item.display_name || "alguém"}`,
    referral_bonus: `Prémio por convidar ${item.display_name || "alguém"}`,
    challenge_prize: "Prémio de um desafio"
  })[item.kind] || "Movimento";
  return <div className="page narrow growth-page">
    <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Estrelas</p>
        <h1>Apoia quem gostas</h1>
        <p>Oferece estrelas nas publicações dos teus criadores favoritos. Cada estrela vale {data ? formatPrice(data.price_kz) : "10 Kz"}; o criador recebe 70% e o Tchilar fica com 30%.</p>
      </div>
      <p className="tc-head-figure"><small>O teu saldo</small><strong><Icon name="star" size={20} /> {data ? formatCount(data.balance) : "…"}</strong></p>
    </header>
    {paying && <PaymentDialog title={`Comprar ${formatCount(paying.pack.stars + paying.pack.bonus)} estrelas`} amountKz={paying.pack.price} purpose="stars" onPay={paying.onPay}
      onDone={() => { setNotice(`${paying.pack.stars + paying.pack.bonus} estrelas adicionadas ao teu saldo.`); load(); }}
      onClose={() => { setPaying(null); load(); }} />}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {data?.payments === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Pagamentos em modo de demonstração: as compras não são cobradas.</p>}
    {data && <>
      <section className="creator-card" aria-labelledby="packs-title">
        <h2 id="packs-title">Comprar estrelas</h2>
        <div className="star-packs">{data.packs.map(pack => <button key={pack.index} type="button" className="star-pack" disabled={Boolean(paying)} onClick={() => buy(pack)}>
          <strong><Icon name="star" size={18} /> {formatCount(pack.stars)}</strong>
          {pack.bonus > 0 && <span className="star-pack-bonus">+{pack.bonus} de bónus</span>}
          <span className="star-pack-price">{paying?.pack?.index === pack.index ? "A preparar..." : formatPrice(pack.price)}</span>
        </button>)}</div>
      </section>
      {data.received.stars > 0 && <section className="creator-card">
        <h2>Estrelas que recebeste</h2>
        <p className="muted">As estrelas que recebes não entram no saldo para oferecer: valem dinheiro e aparecem em <Link to="/creator/ganhos">Painel do criador → Ganhos</Link>.</p>
        <div className="mini-stats"><div><strong>{formatCount(data.received.stars)}</strong><span>estrelas recebidas</span></div><div><strong>{formatPrice(data.received.value_kz)}</strong><span>a tua parte (70%)</span></div></div>
      </section>}
      <section className="creator-card" aria-labelledby="history-title">
        <h2 id="history-title">Movimentos</h2>
        {data.history.length ? <ul className="star-history">{data.history.map(item => <li key={item.id}>
          <span>{kindLabel(item)}<small>{relativeTime(item.created_at)}</small></span>
          <strong className={item.amount > 0 ? "is-in" : "is-out"}>{item.amount > 0 ? "+" : ""}{formatCount(item.amount)}</strong>
        </li>)}</ul> : <p className="muted">Ainda não tens movimentos.</p>}
      </section>
    </>}
  </div>;
}
// Marketplace: marcas encontram criadores e propõem campanhas pagas.
export function BrandsPage() {
  const { user } = useContext(UserContext);
  const [filters, setFilters] = useState({ province: "", area: "", minFollowers: "0" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [proposing, setProposing] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value && value !== "0"));
      api(`/creators?${query}`).then(setData).catch(loadError => setError(loadError.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.province, filters.area, filters.minFollowers]);
  return <div className="page growth-page brands-page">
    <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Marketplace de marcas</p>
        <h1>Encontra criadores para a tua marca</h1>
        <p>Filtra por província, área e número de seguidores e envia uma proposta de campanha. Pagas pelo Tchilar quando o criador aceitar; o Tchilar fica com 15%.</p>
      </div>
    </header>
    <div className="brand-filters card" role="search">
      <label>Província<Select value={filters.province} onChange={event => setFilters({ ...filters, province: event.target.value })}>
        <option value="">Todas</option>
        {(data?.provinces || []).map(province => <option key={province}>{province}</option>)}
      </Select></label>
      <label>Área<input type="search" placeholder="Ex.: moda, música, culinária" value={filters.area} onChange={event => setFilters({ ...filters, area: event.target.value })} /></label>
      <label>Seguidores<Select value={filters.minFollowers} onChange={event => setFilters({ ...filters, minFollowers: event.target.value })}>
        <option value="0">Qualquer número</option><option value="1000">1 000 ou mais</option><option value="10000">10 000 ou mais</option><option value="100000">100 000 ou mais</option>
      </Select></label>
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!data && !error && <div className="empty card">A procurar criadores...</div>}
    {data && !data.creators.length && <div className="empty card">Nenhum criador corresponde aos filtros.</div>}
    {data && data.creators.length > 0 && <div className="creator-grid">{data.creators.map(creator => <article className="creator-tile card" key={creator.id}>
      <Link to={`/u/${creator.username}`} aria-label={`Perfil de ${creator.display_name}`}><Avatar user={creator} size="large" /></Link>
      <h2><Link to={`/u/${creator.username}`}>{creator.display_name}</Link><VerifiedBadge show={creator.is_verified} tier={creator.verification_tier} /></h2>
      <small>@{creator.username}{creator.province ? ` · ${creator.province}` : ""}</small>
      {creator.verification_tier === "bolado" && <span className="verification-feature-label">Destaque</span>}
      {creator.verification_tier === "benga" && <span className="verification-feature-label is-premium">Prioridade máxima</span>}
      {creator.profession && <span className="content-tag">{creator.profession}</span>}
      <p>{creator.bio || "Ainda sem biografia."}</p>
      <div className="creator-tile-stats"><span><strong>{formatCount(creator.followers)}</strong> seguidores</span><span><strong>{formatCount(creator.posts)}</strong> publicações</span></div>
      {user ? <button className="btn" type="button" onClick={() => setProposing(creator)}><Icon name="brand" size={16} /> Propor campanha</button>
        : <Link className="btn" to="/login">Entrar para propor</Link>}
    </article>)}</div>}
    {proposing && <ProposalDialog creator={proposing} onClose={() => setProposing(null)} onSent={() => { setProposing(null); setNotice(`Proposta enviada a ${proposing.display_name}. Acompanha em Painel do criador → Parcerias.`); }} />}
  </div>;
}
export function ProposalDialog({ creator, onClose, onSent }) {
  const [form, setForm] = useState({ title: "", brief: "", budget: "50000" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const budget = Number(form.budget) || 0;
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: creator.id, ...form }) });
      onSent();
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="modal card proposal-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-title" onSubmit={submit}>
      <h2 id="proposal-title">Proposta para {creator.display_name}</h2>
      <label>Título da campanha<input value={form.title} maxLength={100} required onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Lançamento da nova coleção" /></label>
      <label>O que pedes ao criador<textarea rows={5} value={form.brief} maxLength={2000} required onChange={event => setForm({ ...form, brief: event.target.value })} placeholder="Ex.: 1 vídeo de 30 s e 2 publicações a mostrar o produto, durante a próxima semana." /></label>
      <label>Orçamento (Kz)<input type="number" min="5000" step="1000" required value={form.budget} onChange={event => setForm({ ...form, budget: event.target.value })} /></label>
      <p className="muted proposal-split">O criador recebe {formatPrice(Math.round(budget * 0.85))}; o Tchilar fica com {formatPrice(Math.round(budget * 0.15))} (15%).</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn" type="submit" disabled={busy}>{busy ? "A enviar..." : "Enviar proposta"}</button>
      </div>
    </form>
  </div>, document.body);
}
export function InvitePage() {
  const { user, authReady } = useContext(UserContext);
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (user) api("/referrals").then(setData).catch(() => {}); }, [user?.id]);
  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Entra na tua conta para convidares amigos. <Link to="/login">Entrar</Link></div></div>;
  const link = `${PUBLIC_URL}/register?convite=${encodeURIComponent(user.username)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };
  const share = () => navigator.share?.({ title: "Vem para o Tchilar", text: "Junta-te a mim no Tchilar!", url: link }).catch(() => {});
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Junta-te a mim no Tchilar, a rede social angolana! ${link}`)}`;
  return <div className="page narrow growth-page">
    <header className="tc-head">
      <div className="tc-head-text">
        <p className="tc-head-kicker">Convidar amigos</p>
        <h1>Traz os teus amigos e ganha estrelas</h1>
        <p>Por cada pessoa que entrar com o teu convite, confirmar o email e fizer a primeira publicação, ganhas {data?.bonus ?? 50} estrelas.</p>
      </div>
    </header>
    <section className="creator-card">
      <h2>O teu convite</h2>
      <div className="invite-link"><input readOnly value={link} aria-label="Ligação de convite" onFocus={event => event.target.select()} />
        <a className="btn invite-whatsapp" href={whatsapp} target="_blank" rel="noopener noreferrer"><Icon name="messages" size={16} /> WhatsApp</a>
        <button className="btn secondary" type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copiado" : "Copiar"}</button>
        {typeof navigator.share === "function" && <button className="btn secondary" type="button" onClick={share}><Icon name="share" size={16} /> Partilhar</button>}</div>
      {data && <div className="mini-stats"><div><strong>{formatCount(data.invited)}</strong><span>pessoas convidadas</span></div><div><strong>{formatCount(data.rewarded * data.bonus)}</strong><span>estrelas ganhas</span></div></div>}
    </section>
    <InviteRanking />
    {data?.people.length > 0 && <section className="creator-card"><h2>Quem entrou com o teu convite</h2>
      <ul className="person-list">{data.people.map(person => <PersonLine key={person.username} person={person} time={person.created_at}>
        <span className={`status-pill ${person.rewarded ? "is-ok" : "is-warning"}`}>{person.rewarded ? `+${data.bonus} estrelas` : "À espera da 1.ª publicação"}</span>
      </PersonLine>)}</ul></section>}
  </div>;
}
// Ranking do mês: nacional ou por província (só quem autorizou mostrar a província).
function InviteRanking() {
  const [province, setProvince] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api(`/referrals/ranking${province ? `?province=${encodeURIComponent(province)}` : ""}`).then(setData).catch(loadError => setError(loadError.message));
  }, [province]);
  return <section className="creator-card invite-ranking">
    <div className="creator-card-head"><div><h2>Ranking do mês</h2>
      <p>Quem trouxe mais amigos este mês (contam os que já confirmaram o email e publicaram). Recomeça no dia 1.</p></div></div>
    <label className="invite-ranking-filter">Ver
      <Select value={province} onChange={event => setProvince(event.target.value)}>
        <option value="">Angola inteira</option>
        {(data?.provinces || []).map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
    </label>
    {error && <p className="error" role="alert">{error}</p>}
    {data && !data.ranking.length && <p className="muted">Ainda ninguém {province ? `em ${province} ` : ""}trouxe amigos este mês. Podes ser o primeiro.</p>}
    {data?.ranking.length > 0 && <ol className="invite-ranking-list">{data.ranking.map(row => <li key={row.username} className={row.is_me ? "is-me" : ""}>
      <span className="invite-ranking-pos">{row.position}</span>
      <Avatar user={row} size="small" />
      <Link to={`/u/${row.username}`}><strong>{row.display_name}</strong><small>@{row.username}</small></Link>
      <span className="invite-ranking-count">{formatCount(row.invited)} {row.invited === 1 ? "amigo" : "amigos"}</span>
    </li>)}</ol>}
    {data && <p className="muted invite-ranking-me">{data.me.position ? `Estás em ${data.me.position}.º lugar com ${data.me.invited} ${data.me.invited === 1 ? "amigo" : "amigos"}.` : "Ainda não tens amigos a contar este mês."}
      {province ? " Nas províncias só aparece quem escolheu mostrar a província (Definições → Público)." : ""}</p>}
  </section>;
}

export const ACADEMY_GUIDES = [
  ["Começa pelo teu perfil", "profile", ["Usa uma foto de perfil nítida, com o rosto visível.", "Escreve na biografia o que publicas e para quem.", "Indica a tua área (profissão) para as marcas te encontrarem no marketplace."]],
  ["Publica com regularidade", "create", ["Escolhe 3 a 4 dias por semana e cumpre-os.", "Os vídeos curtos (Reels) chegam a mais pessoas.", "Usa os Stories todos os dias para manteres os seguidores por perto."]],
  ["Conversa com a tua comunidade", "messages", ["Responde aos comentários nas primeiras horas.", "Faz perguntas no fim das publicações.", "Agradece as estrelas: os apoiantes gostam de ser vistos."]],
  ["Entra nos desafios do mês", "trophy", ["Os desafios trazem visitas novas ao teu perfil.", "Partilha a tua participação no perfil e em grupos.", "Mesmo sem ganhar, ganhas seguidores."]],
  ["Lê os teus Insights", "stats", ["No Painel do criador, vê que publicações tiveram mais visualizações.", "Repete os formatos que funcionam.", "Compara cada mês com o anterior."]],
  ["Rumo aos 10 mil", "spark", ["O Programa de Parceiros paga a partir de 10 000 seguidores e 10 000 visualizações em 28 dias.", "Impulsiona as publicações que já estão a ter sucesso.", "Com o selo verificado, as marcas confiam mais em ti."]]
];
