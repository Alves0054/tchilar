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

export function VerifiedBadge({ show, tier }) {
  if (!show) return null;
  const plan = { kazola: "Kazola", bolado: "Bolado", benga: "Benga" }[tier];
  const label = tier === "benga" ? "Selo dourado exclusivo · Benga" : tier === "bolado" ? "Selo vermelho · Bolado"
    : plan ? `Verificado · ${plan}` : "Parceiro verificado do Tchilar";
  const tone = tier === "benga" || tier === "bolado" ? ` is-${tier}` : "";
  return <span className={`verified-badge${tone}`} title={label} aria-label={label}><Icon name="verified" size={15} /></span>;
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
    {paying && <PaymentDialog title={`Pagar a campanha «${paying.campaign.title}»`} amountKz={paying.campaign.budget} purpose="campaign" onPay={paying.onPay}
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
  card: ["Cartão", "Visa ou Mastercard.", "card"],
  paypal: ["PayPal", "Pagas em dólares (USD) na página do PayPal. Bom para quem está fora de Angola.", "globe"],
  redotpay: ["RedotPay", "Cripto (USDT, USDC…) ou cartão RedotPay, em dólares.", "bolt"],
  paypay: ["PayPay Africa", "Aprovas na app PayPay, em kwanzas.", "phone"]
};
// Bandeiras de cartão aceites por cada método (só texto, sem logótipos oficiais).
export const PAYMENT_BRANDS = { express: ["Multicaixa"], reference: ["Multicaixa"], card: ["Visa", "Mastercard"], paypal: ["Visa", "Mastercard"] };
// Logótipo em miniatura do sítio onde se recebe um levantamento (os mesmos de public/payment-logos); o banco usa o ícone.
export function PayoutLogo({ method, size = 20 }) {
  if (method && method !== "iban") return <img className="payout-logo" src={`/payment-logos/${method}.jpg`} alt="" width={size} height={size} loading="lazy" />;
  return <span className="payout-logo is-bank" style={{ width: size, height: size }} aria-hidden="true"><Icon name="brand" size={Math.round(size * 0.7)} /></span>;
}
// Logótipos de cada método (96 px, em public/payment-logos). Cartão = logótipo Visa.
const PAYMENT_LOGOS = new Set(["express", "reference", "paypay", "card", "paypal", "redotpay"]);
// Ordem visual da grelha: Referência ao lado do PayPal e Cartão ao lado do RedotPay.
const PAYMENT_METHOD_ORDER = ["express", "reference", "paypal", "card", "redotpay", "paypay"];
function PaymentMethodBody({ id }) {
  const [label, hint, icon] = PAYMENT_METHODS[id];
  return <>
    {PAYMENT_LOGOS.has(id)
      ? <img className="payment-method-logo" src={`/payment-logos/${id}.jpg`} alt="" width="44" height="44" loading="lazy" />
      : <span className={`payment-method-icon is-${id}`}><Icon name={icon} size={20} /></span>}
    <span><strong>{label}</strong><small>{hint}</small>
      {PAYMENT_BRANDS[id] && <span className="payment-brands" aria-label={`Aceita ${PAYMENT_BRANDS[id].join(" e ")}`}>
        {PAYMENT_BRANDS[id].map(brand => <span key={brand} className={`payment-brand is-${brand.toLowerCase()}`}>{brand}</span>)}
      </span>}
    </span>
  </>;
}
// onPay(choice) faz o pedido ao servidor e devolve a resposta (checkoutUrl, demo, express ou reference).
export function PaymentDialog({ title, amountKz, purpose, onPay, onDone, onClose }) {
  const [methods, setMethods] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [mode, setMode] = useState("stripe");
  const [method, setMethod] = useState("");
  const [phone, setPhone] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [payAmount, setPayAmount] = useState(Number(amountKz));
  const [promoNotice, setPromoNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [state, setState] = useState("pending");

  useEffect(() => {
    api("/payments/methods").then(result => { setMethods(result.methods); setUpcoming(result.upcoming || []); setMode(result.mode); setMethod(result.methods[0] || ""); })
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
    }, pending.method === "express" || pending.method === "paypay" ? 3000 : 8000);
    return () => window.clearInterval(timer);
  }, [pending, state]);

  const applyPromo = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPromoNotice("");
    try {
      const result = await api("/promotion-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode, purpose, amountKz })
      });
      setPayAmount(result.amount);
      setPromoNotice(`Código aplicado: desconto de ${formatPrice(result.discountAmount)}.`);
    } catch (validateError) {
      setPayAmount(Number(amountKz));
      setError(validateError.message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onPay(mode === "demo" ? { promoCode } : { method, promoCode, ...(method === "express" && { phone }) });
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      if (result.demo || result.activated) { setState("paid"); onDone(result); return; }
      if (["express", "reference", "paypay"].includes(result.method)) { setPending(result); setState("pending"); return; }
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
  const activeMethods = new Set(methods || []);
  const upcomingMethods = new Set(upcoming);
  const visibleMethods = PAYMENT_METHOD_ORDER.filter(id => activeMethods.has(id) || upcomingMethods.has(id));

  return createPortal(<div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="modal card payment-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="share-dialog-head">
        <h2 id="payment-title">{state === "paid" ? "Pagamento confirmado" : title}</h2>
        <button className="round-button" type="button" aria-label="Fechar" onClick={close}><Icon name="close" size={18} /></button>
      </div>
      <div className="payment-amount"><small>Valor a pagar</small><strong>{formatPrice(payAmount)}</strong>{payAmount !== Number(amountKz) && <small>Antes: {formatPrice(amountKz)}</small>}</div>

      {state === "paid" ? <div className="payment-result is-ok">
        <span className="payment-result-icon"><Icon name="check" size={28} /></span>
        <p>Recebemos o teu pagamento. Obrigado!</p>
        <button className="btn" type="button" onClick={onClose}>Concluir</button>
      </div>

      : pending ? (pending.method === "paypay" ? <div className="payment-wait">
        <span className="payment-pulse" aria-hidden="true"><Icon name="phone" size={26} /></span>
        <h3>Paga na app PayPay</h3>
        <p>No telemóvel, toca em "Abrir a app PayPay". No computador, lê o código com a app PayPay. Esta janela atualiza sozinha.</p>
        {pending.qrCodeUrl && <figure className="payment-qr"><img src={pending.qrCodeUrl} alt="Código QR para pagar com a app PayPay" /><figcaption>Lê este código com a app PayPay.</figcaption></figure>}
        {pending.deeplink && <a className="btn secondary" href={pending.deeplink}>Abrir a app PayPay</a>}
        <PaymentState state={state} />
      </div> : pending.method === "express" ? <div className="payment-wait">
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
        {purpose && mode !== "off" && <div className="payment-promo">
          <span>Código promocional</span>
          <span><input type="text" autoCapitalize="characters" maxLength={40} placeholder="EXEMPLO20" value={promoCode}
            onChange={event => { setPromoCode(event.target.value.toUpperCase()); setPromoNotice(""); }} />
            <button type="button" className="text-button" onClick={applyPromo} disabled={!promoCode || busy}>Aplicar</button></span>
        </div>}
        {promoNotice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{promoNotice}</p>}
        {mode === "off" && <div className="payment-unavailable" role="status">
          <Icon name="info" size={18} />
          <span><strong>Pagamentos temporariamente indisponíveis</strong><small>Não há métodos de pagamento ativos. Tenta novamente mais tarde.</small></span>
        </div>}
        {mode !== "off" && mode !== "demo" && methods && (methods.length > 0 || upcoming.length > 0) && <div className="payment-methods" role="radiogroup" aria-label="Método de pagamento">
          {visibleMethods.map(id => activeMethods.has(id) ? <label key={id} className={`payment-method payment-method--${id}${method === id ? " is-selected" : ""}`}>
            <input type="radio" name="payment-method" checked={method === id} onChange={() => setMethod(id)} />
            <PaymentMethodBody id={id} />
          </label> : <div key={id} className={`payment-method payment-method--${id} is-soon`} aria-disabled="true">
            <PaymentMethodBody id={id} />
            <span className="payment-soon">Em breve</span>
          </div>)}
        </div>}
        {method === "express" && mode !== "demo" && <label className="payment-phone">Número do Multicaixa Express
          <span><b>+244</b><input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="9XX XXX XXX" maxLength={11} required value={phone}
            onChange={event => setPhone(event.target.value.replace(/[^\d ]/g, ""))} /></span></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          {mode === "off"
            ? <button className="btn" type="button" onClick={close}>Fechar</button>
            : <><button className="btn secondary" type="button" onClick={close} disabled={busy}>Cancelar</button>
              <button className="btn" type="submit" disabled={busy || !methods}>{busy ? "A preparar..." : `Pagar ${formatPrice(amountKz)}`}</button></>}
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
// Botões para descarregar a app, lado a lado. Os endereços vêm do build (ver "Links das lojas" em NOTA-DEPLOY.md):
//   VITE_APP_STORE_URL   → página da app na App Store
//   VITE_PLAY_STORE_URL  → página da app na Google Play
// Sem endereço, o botão aparece como "Em breve" (sem link).
const APP_STORE_URL = import.meta.env.VITE_APP_STORE_URL || "";
const PLAY_STORE_URL = import.meta.env.VITE_PLAY_STORE_URL || "";
const AppleMark = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.37 12.6c-.03-2.7 2.2-4 2.3-4.07-1.26-1.83-3.2-2.08-3.9-2.1-1.65-.17-3.23.98-4.07.98-.85 0-2.14-.96-3.52-.93-1.8.03-3.47 1.05-4.4 2.67-1.89 3.27-.48 8.1 1.35 10.76.9 1.3 1.96 2.75 3.35 2.7 1.35-.06 1.86-.87 3.49-.87 1.62 0 2.08.87 3.5.84 1.45-.02 2.37-1.32 3.25-2.63 1.03-1.5 1.45-2.97 1.47-3.04-.03-.01-2.82-1.08-2.82-4.31zM13.7 4.67c.74-.9 1.24-2.14 1.1-3.38-1.07.04-2.36.71-3.12 1.6-.68.79-1.28 2.06-1.12 3.28 1.19.09 2.4-.6 3.14-1.5z"/></svg>;
const PlayMark = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="#34A853" d="M3.6 2.2 13.4 12l-9.8 9.8c-.36-.2-.6-.6-.6-1.07V3.27c0-.47.24-.87.6-1.07z"/>
  <path fill="#FBBC04" d="m16.8 8.6-3.4 3.4 3.4 3.4 3.85-2.2c.75-.43.75-1.97 0-2.4L16.8 8.6z"/>
  <path fill="#4285F4" d="M3.6 21.8 13.4 12l3.4 3.4-11.7 6.68c-.5.29-1.08.2-1.5-.28z"/>
  <path fill="#EA4335" d="M3.6 2.2c.42-.48 1-.57 1.5-.28L16.8 8.6 13.4 12 3.6 2.2z"/></svg>;
export function StoreButtons() {
  const stores = [["App Store", "Descarregar na", APP_STORE_URL, <AppleMark key="a" />], ["Google Play", "Disponível no", PLAY_STORE_URL, <PlayMark key="p" />]];
  return <div className="store-buttons" aria-label="Descarregar a app Tchilar">
    {stores.map(([store, kicker, url, mark]) => url
      ? <a key={store} className="store-button" href={url} target="_blank" rel="noopener noreferrer">{mark}<span><small>{kicker}</small><strong>{store}</strong></span></a>
      : <span key={store} className="store-button is-soon" title="A app chega em breve">{mark}<span><small>Em breve</small><strong>{store}</strong></span></span>)}
  </div>;
}

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
