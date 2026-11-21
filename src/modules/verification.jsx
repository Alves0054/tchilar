import { useEffect, useState } from "react";
import { Icon, api, formatCount, formatPrice } from "./core.jsx";
import { PaymentDialog, VerifiedBadge } from "./shared.jsx";
import "./verification.css";

// Selo de verificação: Kazola azul, Bolado vermelho, Benga dourado (o mesmo para contas e páginas).
// Plano em destaque na página de verificação: o Benga, o mais completo (distintivo dourado, prioridade máxima).
const FEATURED_PLAN = "benga";
const PLAN_TAGLINES = {
  kazola: "O selo azul, para começares a ser reconhecido.",
  bolado: "O selo vermelho e mais destaque junto das marcas.",
  benga: "O distintivo dourado e o topo do Marketplace."
};

// Ecrã de verificação de uma conta (endpoint "/creator/verification") ou de uma página
// ("/pages/:id/verification"): o servidor devolve os planos, o selo ativo e os seguidores que contam.
export function VerificationPlans({ endpoint, page = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const load = () => api(endpoint).then(result => { setData(result); setError(""); })
    .catch(loadError => setError(loadError.message));
  useEffect(() => { load(); }, [endpoint]);
  if (error && !data) return <section className="creator-card"><p className="error" role="alert">{error}</p></section>;
  if (!data) return <section className="creator-card"><div className="creator-loading">A carregar planos...</div></section>;
  const activePlan = data.plans.find(plan => plan.id === data.active?.tier);
  const checkout = (plan, choice) => api(`${endpoint}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: plan.id, ...choice })
  });
  // A barra de progresso vai até ao requisito mais alto; cada plano tem a sua marca na barra.
  const top = Math.max(...data.plans.map(plan => plan.minimum_followers));
  const markers = [...data.plans].sort((a, b) => a.minimum_followers - b.minimum_followers);
  const nextPlan = markers.find(plan => !plan.eligible);

  return <>
    <header className="tc-head vf-head" aria-labelledby="vf-title">
      <div className="tc-head-text">
        <p className="tc-head-kicker">{page ? `Verificação da página ${page.name}` : "Verificação"}</p>
        <h2 id="vf-title">{page ? "Mostra que a página é a verdadeira" : "Mostra que és tu, com o selo"}</h2>
        <p>{page
          ? "O selo aparece ao lado do nome da página, nas publicações e nos diretos dela, e ajuda o público a confiar que é a página verdadeira."
          : "O selo aparece no teu perfil, nas publicações e nos diretos, ajuda o público a confiar na tua conta e dá-te mais destaque no Marketplace de marcas."}</p>
      </div>
    </header>

    <section className="creator-card vf-progress-card" aria-labelledby="vf-progress-title">
      <div className="vf-progress-head">
        <div>
          <h3 id="vf-progress-title">{data.eligible ? "Já podes ativar a verificação" : "O teu caminho até ao selo"}</h3>
          <p>{nextPlan
            ? <>Tens <strong>{formatCount(data.followers)}</strong> seguidores. Faltam <strong>{formatCount(nextPlan.minimum_followers - data.followers)}</strong> para o plano {nextPlan.name}.</>
            : <>Tens <strong>{formatCount(data.followers)}</strong> seguidores: cumpres o requisito de todos os planos.</>}</p>
        </div>
        {activePlan && <span className="vf-active"><VerifiedBadge show tier={activePlan.id} /> {activePlan.name} ativo até {new Date(data.active.expires_at).toLocaleDateString("pt-PT")}</span>}
      </div>
      <div className="vf-track" role="progressbar" aria-label="Seguidores para a verificação" aria-valuemin={0} aria-valuemax={top}
        aria-valuenow={Math.min(data.followers, top)}>
        <span className="vf-track-fill" style={{ width: `${Math.min(100, (data.followers / top) * 100)}%` }} />
        {markers.map(plan => <span key={plan.id} className={`vf-marker${plan.eligible ? " is-met" : ""}${plan.id === FEATURED_PLAN ? " is-featured" : ""}`}
          style={{ left: `${(plan.minimum_followers / top) * 100}%` }}>
          <span className="vf-marker-dot" />
          <span className="vf-marker-label">{plan.name}<small>{formatCount(plan.minimum_followers)}</small></span>
        </span>)}
      </div>
      <p className="vf-note">{page ? "Contam os seguidores da página." : "Só contam seguidores (as amizades não contam)."} Cada pagamento ativa o selo durante um mês; a renovação é manual.</p>
      {data.active && activePlan && !activePlan.eligible && <p className="muted">O selo continua ativo até expirar, mas precisas de {formatCount(activePlan.minimum_followers)} seguidores para renovar o {activePlan.name}.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>

    <div className="vf-plans">
      {data.plans.map(plan => {
        const active = data.active?.tier === plan.id;
        const blocked = data.active && !active;
        const featured = plan.id === FEATURED_PLAN;
        return <section key={plan.id} className={`vf-plan is-${plan.id}${featured ? " is-featured" : ""}${active ? " is-active" : ""}`} aria-labelledby={`vf-plan-${plan.id}`}>
          {featured && <span className="vf-ribbon"><Icon name="star" size={13} /> Recomendado</span>}
          <div className="vf-plan-head">
            <span className={`vf-plan-badge is-${plan.id}`} aria-hidden="true"><Icon name="verified" size={22} /></span>
            <div>
              <h3 id={`vf-plan-${plan.id}`}>{plan.name}</h3>
              <p>{PLAN_TAGLINES[plan.id]}</p>
            </div>
          </div>
          <p className="vf-price">{formatPrice(plan.priceKz)}<small>/ mês</small></p>
          <p className={`vf-requirement${plan.eligible ? " is-met" : ""}`}>
            <Icon name={plan.eligible ? "check" : "friends"} size={14} />
            {plan.eligible ? `Requisito cumprido · ${formatCount(plan.minimum_followers)} seguidores` : `A partir de ${formatCount(plan.minimum_followers)} seguidores`}
          </p>
          <ul className="vf-benefits">{plan.benefits.map(benefit => <li key={benefit}><Icon name="check" size={14} /><span>{benefit}</span></li>)}</ul>
          <button className={`btn vf-cta${active || !featured ? " secondary" : ""}`} type="button" disabled={!plan.eligible || Boolean(blocked)}
            onClick={() => setPaying(plan)}>
            {!plan.eligible ? `Faltam ${formatCount(plan.minimum_followers - data.followers)} seguidores` : blocked ? "Disponível quando o plano atual acabar" : active ? `Renovar ${plan.name}` : `Ativar ${plan.name}`}
          </button>
        </section>;
      })}
    </div>
    {paying && <PaymentDialog title={page ? `Verificação ${paying.name} da página ${page.name} · 1 mês` : `Verificação ${paying.name} · 1 mês`} amountKz={paying.priceKz} purpose="verification"
      onPay={choice => checkout(paying, choice)}
      onDone={() => load()}
      onClose={() => { setPaying(null); load(); }} />}
  </>;
}
