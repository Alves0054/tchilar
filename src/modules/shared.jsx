import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE, Avatar, Icon, api, formatCount, formatPrice } from "./core.jsx";
import { recordAdClick, recordAdImpression, relativeTime, useSeenOnce } from "./feed.jsx";
import { useDismiss } from "./layout.jsx";

export const MUSIC_GENRE_LABELS = {
  afrobeat: "Afrobeat", kizomba: "Kizomba", semba: "Semba", kuduro: "Kuduro", amapiano: "Amapiano",
  hiphop: "Hip-hop", pop: "Pop", gospel: "Gospel", calmo: "Calmo", outro: "Outros"
};
// Lê a duração de um ficheiro de áudio no próprio browser (para o servidor e para o início da música).
export const audioDuration = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  audio.onloadedmetadata = () => { const value = audio.duration; URL.revokeObjectURL(url); Number.isFinite(value) ? resolve(value) : reject(new Error("duration")); };
  audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("audio")); };
  audio.src = url;
});
export const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function postKind(post) {
  if (post.shared_post_id) return "Partilha";
  if (post.media_type === "video") return "Vídeo";
  if (post.media_type === "image") return "Fotografia";
  return "Texto";
}
export function ContentThumb({ post }) {
  return <div className="content-thumb">
    {post.media_url && post.media_type === "image"
      ? <img src={`${API_BASE}${post.media_url}`} alt="" />
      : post.media_url && post.media_type === "video"
        ? <video src={`${API_BASE}${post.media_url}`} muted preload="metadata" />
        : <span className="content-thumb-text">{post.excerpt || postKind(post)}</span>}
    <span className="content-thumb-views"><Icon name="eye" size={13} /> {formatCount(post.views)}</span>
  </div>;
}
export function PersonLine({ person, children, time }) {
  return <li className="person-line">
    <Link to={`/u/${person.username}`} aria-label={`Perfil de ${person.display_name}`}><Avatar user={person} /></Link>
    <span><Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link> {children}{time && <small>{relativeTime(time)}</small>}</span>
  </li>;
}
export function CharCount({ value, max }) {
  const left = max - value.length;
  return <small className={`char-count${left <= Math.ceil(max * 0.1) ? " is-near" : ""}`} aria-live={left <= 10 ? "polite" : "off"}>{value.length}/{max}</small>;
}
// Só publicações públicas tuas podem ser impulsionadas.
export const canBoost = post => !post.is_exclusive && !post.group_id && !post.hidden_at && !post.shared_post_id;
// Espaço "Patrocinado" do feed: mostra um anúncio ativo; sem anúncios, convida a anunciar.
export function SponsoredSlot() {
  const navigate = useNavigate();
  const [ad, setAd] = useState(undefined);
  const slotRef = useRef(null);
  useEffect(() => { api("/ads/serve").then(result => setAd(result.ad)).catch(() => setAd(null)); }, []);
  useSeenOnce(slotRef, Boolean(ad?.id), () => recordAdImpression(ad.id));
  if (ad === undefined) return null;
  if (!ad) return <Link className="home-sponsor" to="/creator/anuncios?novo=1">
    <span className="home-sponsor-art" aria-hidden="true"><img src="/tchilar-logo.png" alt="" /></span>
    <span><strong>Anuncia no Tchilar</strong><small>Mostra o teu perfil ou o teu negócio a mais pessoas. Cria um anúncio no painel do criador.</small></span>
  </Link>;
  const open = async event => {
    event.preventDefault();
    let url = ad.link_url;
    url = (await recordAdClick(ad.id)).url || url;
    if (url.startsWith("/")) navigate(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  return <a className="home-sponsor" ref={slotRef} href={ad.link_url} onClick={open} rel={ad.link_url.startsWith("/") ? undefined : "noopener noreferrer sponsored"}>
    <span className="home-sponsor-art" aria-hidden="true"><img src={ad.image_url ? `${API_BASE}${ad.image_url}` : "/tchilar-logo.png"} alt="" /></span>
    <span><strong>{ad.title}</strong><small>{ad.body || ad.advertiser}</small><small className="home-sponsor-by">{ad.advertiser}</small></span>
  </a>;
}
// ---------------------------------------------------------------------------------------------
// Crescimento e monetização: selo, Estrelas, marcas, desafios, convites, academia
// ---------------------------------------------------------------------------------------------

export function VerifiedBadge({ show }) {
  if (!show) return null;
  return <span className="verified-badge" title="Parceiro verificado do Tchilar" aria-label="Parceiro verificado"><Icon name="verified" size={15} /></span>;
}
// Botão "Estrelas" numa publicação de outra pessoa: escolhe quantas oferecer.
export function StarGiftButton({ post, onGifted }) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [amounts, setAmounts] = useState([1, 5, 10, 50, 100]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const boxRef = useRef(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(boxRef, open, close);
  const toggle = async () => {
    const opening = !open;
    setOpen(opening);
    setMessage("");
    if (opening) {
      try {
        const result = await api("/stars");
        setBalance(result.balance);
        setAmounts(result.gift_amounts);
      } catch (loadError) {
        setMessage(loadError.message);
      }
    }
  };
  const give = async amount => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/posts/${post.id}/stars`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
      setBalance(result.balance);
      onGifted(result.stars);
      setMessage(`Ofereceste ${amount} ${amount === 1 ? "estrela" : "estrelas"} a ${post.display_name}.`);
    } catch (giftError) {
      setMessage(giftError.message);
    } finally {
      setBusy(false);
    }
  };
  return <div className="star-gift" ref={boxRef}>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}><span className="post-star-icon" aria-hidden="true"><Icon name="star" size={18} /></span>Estrelas</button>
    {open && <div className="star-gift-panel" role="dialog" aria-label="Oferecer estrelas">
      <strong>Apoia {post.display_name}</strong>
      <small>{balance === null ? "A ver o teu saldo..." : `Tens ${formatCount(balance)} ${balance === 1 ? "estrela" : "estrelas"}.`}</small>
      <div className="star-gift-amounts">
        {amounts.map(amount => <button key={amount} type="button" disabled={busy || (balance !== null && balance < amount)} onClick={() => give(amount)}>
          <Icon name="star" size={14} /> {amount}
        </button>)}
      </div>
      {message && <p className="star-gift-message" role="status">{message}</p>}
      <Link className="star-gift-buy" to="/estrelas">Comprar estrelas</Link>
    </div>}
  </div>;
}
export function SupportersCard({ username }) {
  const [supporters, setSupporters] = useState([]);
  useEffect(() => { api(`/users/${encodeURIComponent(username)}/supporters`).then(result => setSupporters(result.supporters)).catch(() => {}); }, [username]);
  if (!supporters.length) return null;
  return <section className="profile-info-card card supporters-card">
    <h2><Icon name="trophy" size={18} /> Maiores apoiantes</h2>
    <ol className="supporters-list">{supporters.map((person, index) => <li key={person.username}>
      <span className={`supporter-rank rank-${index + 1}`}>{index + 1}</span>
      <Link to={`/u/${person.username}`} aria-label={`Perfil de ${person.display_name}`}><Avatar user={person} size="tiny" /></Link>
      <Link className="post-author" to={`/u/${person.username}`}>{person.display_name}</Link>
      <span className="supporter-stars"><Icon name="star" size={13} /> {formatCount(person.stars)}</span>
    </li>)}</ol>
  </section>;
}
export const CAMPAIGN_STATUS = {
  proposed: ["Proposta", "is-warning"], accepted: ["Aceite — por pagar", "is-warning"], declined: ["Recusada", "is-off"],
  paid: ["Paga — em curso", "is-ok"], completed: ["Concluída", "is-ok"], cancelled: ["Cancelada", "is-off"]
};
export function CreatorPartnerships() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api("/campaigns").then(setData).catch(loadError => setError(loadError.message));
  useEffect(() => {
    load();
    const payment = searchParams.get("pagamento");
    if (payment) {
      setNotice(payment === "sucesso" ? "Pagamento recebido. A campanha fica marcada como paga em poucos segundos." : "O pagamento foi cancelado.");
      setSearchParams({}, { replace: true });
      if (payment === "sucesso") window.setTimeout(load, 4000);
    }
  }, []);
  const [paying, setPaying] = useState(null);
  const act = async (campaign, action) => {
    setError("");
    if (action === "pay") {
      setPaying({ campaign, onPay: choice => api(`/campaigns/${campaign.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(choice) }) });
      return;
    }
    try {
      const result = await api(`/campaigns/${campaign.id}/${action}`, { method: "POST" });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      if (result.demo) setNotice("Campanha paga em modo de demonstração (sem cobrança).");
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  };
  const row = (campaign, side) => {
    const [label, pill] = CAMPAIGN_STATUS[campaign.status];
    const other = side === "received"
      ? { username: campaign.brand_username, display_name: campaign.brand_name, avatar_url: campaign.brand_avatar }
      : { username: campaign.creator_username, display_name: campaign.creator_name, avatar_url: campaign.creator_avatar };
    return <li className="campaign-item" key={campaign.id}>
      <Link to={`/u/${other.username}`} aria-label={`Perfil de ${other.display_name}`}><Avatar user={other} /></Link>
      <div className="campaign-main">
        <div className="ad-item-title"><strong>{campaign.title}</strong><span className={`status-pill ${pill}`}>{label}</span></div>
        <small>{side === "received" ? "De" : "Para"} {other.display_name} · {relativeTime(campaign.created_at)}</small>
        <p>{campaign.brief}</p>
        <small>{formatPrice(campaign.budget)} · {side === "received" ? `recebes ${formatPrice(campaign.net)}` : `o criador recebe ${formatPrice(campaign.net)}`} (comissão do Tchilar: {formatPrice(campaign.commission)})</small>
      </div>
      <div className="ad-actions">
        {side === "received" && campaign.status === "proposed" && <><button className="btn" type="button" onClick={() => act(campaign, "accept")}>Aceitar</button><button className="btn secondary" type="button" onClick={() => act(campaign, "decline")}>Recusar</button></>}
        {side === "sent" && campaign.status === "accepted" && <button className="btn" type="button" onClick={() => act(campaign, "pay")}>Pagar {formatPrice(campaign.budget)}</button>}
        {side === "sent" && ["proposed", "accepted"].includes(campaign.status) && <button className="btn secondary" type="button" onClick={() => act(campaign, "cancel")}>Cancelar</button>}
        {side === "sent" && campaign.status === "paid" && <button className="btn" type="button" onClick={() => act(campaign, "complete")}>Confirmar entrega</button>}
      </div>
    </li>;
  };
  return <>
    {paying && <PaymentDialog title={`Pagar a campanha «${paying.campaign.title}»`} amountKz={paying.campaign.budget} onPay={paying.onPay}
      onDone={() => { setNotice("Campanha paga. O criador já pode começar."); load(); }} onClose={() => { setPaying(null); load(); }} />}
    <section className="creator-card" aria-labelledby="partnerships-title">
      <div className="creator-card-head"><div><h2 id="partnerships-title">Parcerias com marcas</h2><p>Propostas de campanhas pagas. O Tchilar fica com 15% de cada campanha.</p></div>
        <Link className="btn secondary" to="/marcas"><Icon name="brand" size={16} /> Marketplace de marcas</Link></div>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <div className="creator-loading">A carregar...</div>}
      {data && <>
        <h3 className="campaign-heading">Recebidas</h3>
        {data.received.length ? <ul className="ad-list">{data.received.map(campaign => row(campaign, "received"))}</ul> : <p className="muted">Ainda não recebeste propostas. Ter o selo de Parceiro verificado ajuda as marcas a confiar em ti.</p>}
        <h3 className="campaign-heading">Enviadas</h3>
        {data.sent.length ? <ul className="ad-list">{data.sent.map(campaign => row(campaign, "sent"))}</ul> : <p className="muted">Não enviaste propostas. <Link to="/marcas">Encontrar criadores</Link></p>}
      </>}
    </section>
  </>;
}
// ---------------------------------------------------------------------------------------------
// Pagamento: Multicaixa Express, Referência ou cartão — um só ecrã para todos os produtos
// ---------------------------------------------------------------------------------------------
export const PAYMENT_METHODS = {
  express: ["Multicaixa Express", "Recebes o pedido na app do teu telemóvel.", "phone"],
  reference: ["Pagamento por Referência", "Paga no ATM, no Multicaixa Express ou no internet banking.", "reference"],
  card: ["Cartão", "Visa ou Mastercard.", "card"]
};
// onPay(choice) faz o pedido ao servidor e devolve a resposta (checkoutUrl, demo, express ou reference).
export function PaymentDialog({ title, amountKz, onPay, onDone, onClose }) {
  const [methods, setMethods] = useState(null);
  const [mode, setMode] = useState("stripe");
  const [method, setMethod] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [state, setState] = useState("pending");

  useEffect(() => {
    api("/payments/methods").then(result => { setMethods(result.methods); setMode(result.mode); setMethod(result.methods[0] || ""); })
      .catch(() => { setMethods([]); setMode("off"); });
  }, []);

  useEffect(() => {
    const onKey = event => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Enquanto espera pela confirmação, pergunta ao servidor de poucos em poucos segundos.
  useEffect(() => {
    if (!pending || state !== "pending") return undefined;
    const timer = window.setInterval(async () => {
      try {
        const result = await api(`/payments/${pending.paymentId}`);
        setState(result.status);
        if (result.status === "paid") onDone();
      } catch { /* tenta outra vez no próximo intervalo */ }
    }, pending.method === "express" ? 3000 : 8000);
    return () => window.clearInterval(timer);
  }, [pending, state]);

  const pay = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onPay(mode === "demo" ? {} : { method, ...(method === "express" && { phone }) });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      if (result.demo || result.activated) { setState("paid"); onDone(result); return; }
      if (result.method === "express" || result.method === "reference") { setPending(result); setState("pending"); return; }
      if (result.error) setError(result.error);
    } catch (payError) {
      setError(payError.message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    try { setState((await api(`/payments/${pending.paymentId}/simulate`, { method: "POST" })).status); } catch (simError) { setError(simError.message); }
  };

  const copy = text => navigator.clipboard?.writeText(String(text)).catch(() => {});
  const close = () => { if (!busy) onClose(); };

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal card payment-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="share-dialog-head">
        <h2 id="payment-title">{state === "paid" ? "Pagamento confirmado" : title}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={close}><Icon name="close" size={18} /></button>
      </div>
      <div className="payment-amount"><small>Valor a pagar</small><strong>{formatPrice(amountKz)}</strong></div>

      {state === "paid" ? <div className="payment-result is-ok">
        <span className="payment-result-icon"><Icon name="check" size={28} /></span>
        <p>Recebemos o teu pagamento. Obrigado!</p>
        <button className="btn" type="button" onClick={onClose}>Concluir</button>
      </div>

      : pending ? (pending.method === "express" ? <div className="payment-wait">
        <span className="payment-pulse" aria-hidden="true"><Icon name="phone" size={26} /></span>
        <h3>Confirma na app Multicaixa Express</h3>
        <p>Enviámos o pedido para o número {pending.phone}. Abre a app e aceita o pagamento.</p>
        {pending.qrCodeUrl && <figure className="payment-qr"><img src={pending.qrCodeUrl} alt="Código QR para pagar com o Multicaixa Express" /><figcaption>Ou lê este código com a app.</figcaption></figure>}
        {pending.deeplink && <a className="btn secondary" href={pending.deeplink}>Abrir a app</a>}
        <PaymentState state={state} />
      </div> : <div className="payment-wait">
        <h3>Paga com estes dados</h3>
        <dl className="payment-reference">
          <div><dt>Entidade</dt><dd>{pending.entity}</dd><button type="button" className="text-button" onClick={() => copy(pending.entity)}>Copiar</button></div>
          <div><dt>Referência</dt><dd>{String(pending.reference).replace(/(\d{3})(?=\d)/g, "$1 ")}</dd><button type="button" className="text-button" onClick={() => copy(pending.reference)}>Copiar</button></div>
          <div><dt>Valor</dt><dd>{formatPrice(pending.amount)}</dd></div>
        </dl>
        <p className="muted">No ATM, no Multicaixa Express ou no internet banking: escolhe <strong>Pagamentos → Pagamento por Referência</strong>. Válida até {new Date(pending.expiresAt).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}. Podes fechar esta janela: confirmamos sozinhos quando pagares.</p>
        {pending.sandbox && <button className="btn secondary" type="button" onClick={simulate}>Simular pagamento (teste)</button>}
        <PaymentState state={state} />
      </div>)

      : <form className="payment-form" onSubmit={pay}>
        {mode === "demo" && <p className="info-draft" role="note"><Icon name="info" size={15} /> Modo de demonstração: o pagamento é aprovado sem cobrança.</p>}
        {mode === "off" && <p className="error">Os pagamentos ainda não estão disponíveis.</p>}
        {mode !== "demo" && methods && methods.length > 0 && <div className="payment-methods" role="radiogroup" aria-label="Método de pagamento">
          {methods.map(id => {
            const [label, hint, icon] = PAYMENT_METHODS[id];
            return <label key={id} className={`payment-method${method === id ? " is-selected" : ""}`}>
              <input type="radio" name="payment-method" checked={method === id} onChange={() => setMethod(id)} />
              <span className={`payment-method-icon is-${id}`}><Icon name={icon} size={20} /></span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </label>;
          })}
        </div>}
        {method === "express" && mode !== "demo" && <label className="payment-phone">Número do Multicaixa Express
          <span><b>+244</b><input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="9XX XXX XXX" maxLength={11} required value={phone}
            onChange={event => setPhone(event.target.value.replace(/[^\d ]/g, ""))} /></span></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={close} disabled={busy}>Cancelar</button>
          <button className="btn" type="submit" disabled={busy || mode === "off" || !methods}>{busy ? "A preparar..." : `Pagar ${formatPrice(amountKz)}`}</button>
        </div>
      </form>}
    </div>
  </div>, document.body);
}
export function PaymentState({ state }) {
  if (state === "pending") return <p className="payment-state"><span className="payment-spinner" aria-hidden="true" /> À espera da confirmação...</p>;
  if (state === "failed") return <p className="payment-state is-error" role="alert">O pagamento foi recusado ou cancelado. Podes tentar outra vez.</p>;
  if (state === "expired") return <p className="payment-state is-error" role="alert">O prazo para pagar terminou. Gera um novo pagamento.</p>;
  return null;
}
export function LiveBadge({ small }) {
  return <span className={`live-badge${small ? " is-small" : ""}`}><span className="live-dot" aria-hidden="true" />Ao vivo</span>;
}
// ---------------------------------------------------------------------------------------------
// Páginas informativas
// ---------------------------------------------------------------------------------------------

export const INFO_LINKS = [["/about", "Sobre"], ["/help", "Ajuda"], ["/terms", "Termos"], ["/privacy", "Privacidade"], ["/publicidade", "Publicidade"]];
export function InfoLinks() {
  return <nav className="info-links" aria-label="Informação">
    {INFO_LINKS.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
    <span>© {new Date().getFullYear()} Tchilar</span>
  </nav>;
}
// Repete `callback` a cada `ms` enquanto o separador do browser estiver visível.
export function usePolling(callback, ms, enabled = true) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => { if (document.visibilityState === "visible") Promise.resolve(saved.current()).catch(() => {}); };
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, enabled]);
}
// Cada categoria fica sempre com a mesma família de cor (lagoa, céu, coral ou tinta).
export const pageTone = category => {
  const text = (category || "Comunidade").toLowerCase();
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["lagoa", "ceu", "coral", "tinta"][hash % 4];
};
// Monograma: iniciais das duas primeiras palavras ("Loja da Rita" → "LR").
export const pageMonogram = name => (name || "?").split(/\s+/).filter(word => word.length > 2 || /^[A-ZÁ-Ú]/.test(word))
  .slice(0, 2).map(word => word.charAt(0).toUpperCase()).join("") || (name || "?").charAt(0).toUpperCase();

// Texto de uma publicação com as hashtags clicáveis (levam à pesquisa dessa hashtag).
const TAG_SPLIT = /(#[\p{L}\p{N}_]{1,50})/u;
export function TextWithTags({ text }) {
  return text.split(TAG_SPLIT).map((part, index) => index % 2
    ? <Link key={index} className="hashtag" to={`/search?q=${encodeURIComponent(part)}&tab=posts`}>{part}</Link>
    : part);
}
