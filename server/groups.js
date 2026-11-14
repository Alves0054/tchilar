// Regras dos grupos secretos: só para maiores de 18, com entrada paga, e só se encontram pelo nome exato.
const { MAX_PRICE, MIN_PRICE, parseSubscriptionPrice } = require("./subscriptions");
const { ageOn } = require("./growth");

const ADULT_AGE = 18;
const GROUP_ACCESS_CREATOR_SHARE = 0.7; // o dono do grupo recebe 70% de cada entrada; o Tchilar fica com 30%

// Condição SQL "esta pessoa tem 18 anos ou mais". Sem data de nascimento conta como menor.
const adultSql = column => `(${column} IS NOT NULL AND ${column} <= (CURRENT_DATE - INTERVAL '${ADULT_AGE} years'))`;

const isAdult = (birthDate, now = new Date()) => Boolean(birthDate) && ageOn(String(birthDate).slice(0, 10), now) >= ADULT_AGE;

// O nome procurado tem de ser o nome do grupo, sem contar maiúsculas nem espaços nas pontas.
const sameGroupName = (typed, name) => typeof typed === "string" && typed.trim().toLowerCase() === String(name).trim().toLowerCase();

function parseAccessPrice(value) {
  const price = parseSubscriptionPrice(value);
  return price === null ? { error: `O preço de entrada deve estar entre ${MIN_PRICE} Kz e ${MAX_PRICE} Kz.` } : { value: price };
}

const groupAccessValueKz = grossKz => Math.round(Number(grossKz) * GROUP_ACCESS_CREATOR_SHARE * 100) / 100;

module.exports = { ADULT_AGE, GROUP_ACCESS_CREATOR_SHARE, adultSql, groupAccessValueKz, isAdult, parseAccessPrice, sameGroupName };
