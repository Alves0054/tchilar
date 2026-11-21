const VERIFICATION_PLANS = [
  {
    id: "kazola",
    name: "Kazola",
    priceKz: 5_000,
    minFollowers: 10_000,
    priority: 0,
    benefits: [
      "Selo azul no perfil, nas publicações e nos diretos.",
      "Identificação como criador verificado no diretório e no Marketplace de marcas."
    ]
  },
  {
    id: "bolado",
    name: "Bolado",
    priceKz: 10_000,
    minFollowers: 15_000,
    priority: 1,
    benefits: [
      "Selo vermelho Bolado no perfil, nas publicações e nos diretos.",
      "Prioridade elevada no Marketplace de marcas, acima de Kazola e de perfis sem selo."
    ]
  },
  {
    id: "benga",
    name: "Benga",
    priceKz: 20_000,
    minFollowers: 20_000,
    priority: 2,
    benefits: [
      "Todas as vantagens Bolado, com o selo vermelho substituído pelo distintivo dourado Benga.",
      "Prioridade máxima no Marketplace de marcas.",
      "O distintivo dourado aparece no perfil, nas publicações e nos diretos."
    ]
  }
];

const VERIFICATION_MIN_FOLLOWERS = Math.min(...VERIFICATION_PLANS.map(plan => plan.minFollowers));

function verificationEligibility(followers, tier) {
  const plan = VERIFICATION_PLANS.find(item => item.id === tier);
  const count = Number(followers);
  return Boolean(plan) && Number.isFinite(count) && count >= plan.minFollowers;
}

module.exports = { VERIFICATION_MIN_FOLLOWERS, VERIFICATION_PLANS, verificationEligibility };
