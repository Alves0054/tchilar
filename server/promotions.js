// Regras de negócio do Programa de Parceiros (o Tchilar paga aos criadores) e do patrocínio
// automático (quem paga é promovido). Sem Express, para poderem ser testadas sozinhas.

// ---------------------------------------------------------------------------------------------
// Programa de Parceiros Tchilar
// ---------------------------------------------------------------------------------------------

// Monetização por vídeos: só conta o VÍDEO VISTO ATÉ AO FIM (visualização completa), de outra pessoa, uma vez por
// pessoa e por dia — somando todos os vídeos do criador. Ver video_full_views e POST /api/posts/:id/watched.
//
// O programa abre BREVEMENTE: enquanto PARTNER_PROGRAM_OPEN for false, mostra-se "Brevemente", ninguém adere e não
// se acumula dinheiro a pagar (as visualizações completas já ficam registadas para quando abrir).
const PARTNER_PROGRAM_OPEN = false;

// Só monetiza quem cumprir TODAS estas condições.
const PARTNER_RULES = {
  minFollowers: 10_000,
  minViews: 10_000,     // visualizações completas de vídeos
  viewsWindowDays: 28   // contam nos últimos 28 dias
};

// Quanto o Tchilar paga por cada 1000 visualizações qualificadas (em Kz) e o mínimo para transferir.
const PARTNER_RPM_KZ = 200;
const MIN_PAYOUT_KZ = 5_000;

// Devolve cada condição com o progresso, para o painel mostrar o que falta.
function partnerEligibility({ followers = 0, views = 0, suspended = false, emailVerified = false }) {
  const checks = [
    { key: "followers", label: "Seguidores", current: followers, target: PARTNER_RULES.minFollowers, met: followers >= PARTNER_RULES.minFollowers },
    { key: "views", label: `Vídeos vistos até ao fim (últimos ${PARTNER_RULES.viewsWindowDays} dias)`, current: views, target: PARTNER_RULES.minViews, met: views >= PARTNER_RULES.minViews },
    { key: "account", label: "Conta sem suspensões", met: !suspended },
    { key: "email", label: "Email confirmado", met: Boolean(emailVerified) }
  ];
  return { eligible: checks.every(check => check.met), checks };
}

// Ganhos de um conjunto de visualizações completas, arredondados ao cêntimo.
function partnerEarnings(views) {
  return Math.round((Math.max(0, views) / 1000) * PARTNER_RPM_KZ * 100) / 100;
}

// O que o Tchilar deve de facto: nada enquanto o programa não abrir.
function partnerPayout(views, open = PARTNER_PROGRAM_OPEN) {
  return open ? partnerEarnings(views) : 0;
}

// ---------------------------------------------------------------------------------------------
// Patrocínio automático
// ---------------------------------------------------------------------------------------------

// Peso de uma promoção = quanto ainda pode gastar por dia (orçamento restante ÷ dias restantes).
// Quem paga mais por dia aparece mais vezes, e o orçamento espalha-se pela duração toda.
function promotionWeight({ budget, spent, endsAt }, now = new Date()) {
  const remaining = Number(budget) - Number(spent);
  if (!(remaining > 0)) return 0;
  const msLeft = new Date(endsAt).getTime() - now.getTime();
  if (!(msLeft > 0)) return 0;
  const daysLeft = Math.max(1, msLeft / 86_400_000);
  return remaining / daysLeft;
}

// Escolhe até `count` promoções diferentes, com probabilidade proporcional ao peso.
function pickPromotions(candidates, count = 1, random = Math.random, now = new Date()) {
  const pool = candidates
    .map(candidate => ({ candidate, weight: promotionWeight({ budget: candidate.budget, spent: candidate.spent, endsAt: candidate.ends_at }, now) }))
    .filter(item => item.weight > 0);
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let ticket = random() * total;
    const index = pool.findIndex(item => (ticket -= item.weight) < 0);
    const [picked] = pool.splice(index === -1 ? pool.length - 1 : index, 1);
    chosen.push(picked.candidate);
  }
  return chosen;
}

module.exports = {
  MIN_PAYOUT_KZ,
  PARTNER_PROGRAM_OPEN,
  PARTNER_RPM_KZ,
  PARTNER_RULES,
  partnerEarnings,
  partnerPayout,
  partnerEligibility,
  pickPromotions,
  promotionWeight
};
