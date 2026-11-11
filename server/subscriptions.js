// Regras de negócio das subscrições pagas, separadas do Express para poderem ser testadas sozinhas.

// Condição SQL (alias "s" para a tabela subscriptions) que decide se uma subscrição dá acesso
// ao conteúdo exclusivo. É a única fonte de verdade usada pelo feed, pelos ficheiros e pelos comentários.
const ACTIVE_SUBSCRIPTION_SQL = "s.status='active' AND s.current_period_end > NOW()";

const MIN_PRICE = 1;
const MAX_PRICE = 1000;
const DEMO_PERIOD_DAYS = 30;

// Preço mensal em euros, com no máximo 2 casas decimais.
function parseSubscriptionPrice(value) {
  const price = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (price < MIN_PRICE || price > MAX_PRICE) return null;
  if (Math.round(price * 100) !== Number((price * 100).toFixed(6))) return null;
  return Math.round(price * 100) / 100;
}

// Nas versões recentes da API da Stripe o fim do período passou da subscrição para cada item.
function periodEndFromStripe(stripeSubscription) {
  const seconds = stripeSubscription?.items?.data?.[0]?.current_period_end
    ?? stripeSubscription?.current_period_end;
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

// Converte o estado de uma subscrição Stripe no estado guardado na NOVA+.
// Só "active" dá acesso ao conteúdo exclusivo (ver ACTIVE_SUBSCRIPTION_SQL).
// Estados possíveis na Stripe: active, trialing, past_due, unpaid, canceled,
// incomplete, incomplete_expired, paused.
function mapStripeStatus(stripeStatus) {
  // TODO(tu): decide quais estados da Stripe contam como "active" na NOVA+.
  // Ponto de partida conservador: só pagamentos confirmados dão acesso.
  return stripeStatus === "active" ? "active" : "canceled";
}

module.exports = {
  ACTIVE_SUBSCRIPTION_SQL,
  DEMO_PERIOD_DAYS,
  MAX_PRICE,
  MIN_PRICE,
  mapStripeStatus,
  parseSubscriptionPrice,
  periodEndFromStripe
};
