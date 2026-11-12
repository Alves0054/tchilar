// Regras de negócio do crescimento e monetização: Estrelas, campanhas de marcas, convites,
// segmentação das promoções e desafios. Sem Express, para poderem ser testadas sozinhas.

// ---------------------------------------------------------------------------------------------
// Estrelas Biva
// ---------------------------------------------------------------------------------------------
const STAR_PRICE_KZ = 10;                       // 1 estrela custa 10 Kz
const STAR_PACKS = [                            // pacotes à venda; os maiores trazem estrelas de bónus
  { stars: 50, bonus: 0 },
  { stars: 100, bonus: 0 },
  { stars: 500, bonus: 25 },
  { stars: 1000, bonus: 100 }
];
const GIFT_AMOUNTS = [1, 5, 10, 50, 100];      // quantidades que se podem oferecer de uma vez
const STAR_CREATOR_SHARE = 0.7;                 // o criador recebe 70% do valor; o Biva fica com 30%

const packPrice = pack => pack.stars * STAR_PRICE_KZ;
// Valor em Kz que o criador recebe por um número de estrelas.
const starsValueKz = stars => Math.round(stars * STAR_PRICE_KZ * STAR_CREATOR_SHARE * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------------------------
const REFERRAL_BONUS_STARS = 50;
// Uma pessoa convidada "fica" quando confirma o email e faz a primeira publicação.
const referralQualifies = ({ emailVerified, posts }) => Boolean(emailVerified) && posts >= 1;

// ---------------------------------------------------------------------------------------------
// Marketplace de marcas
// ---------------------------------------------------------------------------------------------
const CAMPAIGN_COMMISSION = 0.15;               // o Biva fica com 15% de cada campanha
const MIN_CAMPAIGN_KZ = 5_000;
const MAX_CAMPAIGN_KZ = 50_000_000;

function campaignSplit(budget) {
  const commission = Math.round(Number(budget) * CAMPAIGN_COMMISSION * 100) / 100;
  return { commission, net: Math.round((Number(budget) - commission) * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------
// Segmentação das promoções (província e idade)
// ---------------------------------------------------------------------------------------------
// Divisão político-administrativa de Angola com 21 províncias (Lei n.º 14/24).
const ANGOLA_PROVINCES = [
  "Bengo", "Benguela", "Bié", "Cabinda", "Cuando", "Cubango", "Cuanza Norte", "Cuanza Sul", "Cunene",
  "Huambo", "Huíla", "Icolo e Bengo", "Luanda", "Lunda Norte", "Lunda Sul", "Malanje", "Moxico",
  "Moxico Leste", "Namibe", "Uíge", "Zaire"
];
const TARGETING_SURCHARGE = 0.2;                // promoções segmentadas custam mais 20% por impressão
const MIN_TARGET_AGE = 13;
const MAX_TARGET_AGE = 100;

// Valida a segmentação. Devolve { targeting } ou { error }.
function parseTargeting(input = {}) {
  const raw = Array.isArray(input.provinces) ? input.provinces
    : typeof input.provinces === "string" && input.provinces.trim() ? input.provinces.split(",") : [];
  const provinces = [...new Set(raw.map(value => String(value).trim()).filter(Boolean))];
  if (provinces.some(province => !ANGOLA_PROVINCES.includes(province))) return { error: "Província inválida." };
  const age = value => (value === undefined || value === null || value === "" ? null : Number(value));
  const minAge = age(input.minAge);
  const maxAge = age(input.maxAge);
  for (const value of [minAge, maxAge]) {
    if (value !== null && (!Number.isInteger(value) || value < MIN_TARGET_AGE || value > MAX_TARGET_AGE)) {
      return { error: `As idades devem estar entre ${MIN_TARGET_AGE} e ${MAX_TARGET_AGE} anos.` };
    }
  }
  if (minAge !== null && maxAge !== null && minAge > maxAge) return { error: "A idade mínima não pode ser maior do que a máxima." };
  return { targeting: { provinces, minAge, maxAge, targeted: provinces.length > 0 || minAge !== null || maxAge !== null } };
}

// Data de nascimento opcional (AAAA-MM-DD): só serve para a segmentação e nunca é pública.
function parseBirthDate(value, now = new Date()) {
  if (value === null || value === "") return { value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: "Data de nascimento inválida." };
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { error: "Data de nascimento inválida." };
  const years = ageOn(value, now);
  if (years < MIN_TARGET_AGE || years > 120) return { error: `Tens de ter pelo menos ${MIN_TARGET_AGE} anos.` };
  return { value };
}

function ageOn(birthDate, now = new Date()) {
  const [year, month, day] = birthDate.split("-").map(Number);
  let years = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) years -= 1;
  return years;
}

module.exports = {
  ANGOLA_PROVINCES,
  CAMPAIGN_COMMISSION,
  GIFT_AMOUNTS,
  MAX_CAMPAIGN_KZ,
  MIN_CAMPAIGN_KZ,
  REFERRAL_BONUS_STARS,
  STAR_CREATOR_SHARE,
  STAR_PACKS,
  STAR_PRICE_KZ,
  TARGETING_SURCHARGE,
  ageOn,
  campaignSplit,
  packPrice,
  parseBirthDate,
  parseTargeting,
  referralQualifies,
  starsValueKz
};
