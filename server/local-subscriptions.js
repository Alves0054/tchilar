// Subscrições mensais sem Stripe: Multicaixa Express, Referência, PayPay, PayPal ou RedotPay, um mês de cada vez.
// A Stripe não aceita empresas registadas em Angola, e o Express e a Referência não cobram sozinhos todos
// os meses (cada pagamento é aprovado pela pessoa). Por isso:
//   1. a pessoa paga 1 mês → o acesso vai até daqui a 30 dias (ou mais 30 dias, se ainda tinha tempo);
//   2. 3 dias antes do fim recebe um aviso (notificação e push) para renovar;
//   3. renova no perfil do criador (o botão aparece nos últimos 7 dias); se não renovar, o acesso acaba.
// O cartão continua a ir para a Stripe (subscrição que se cobra sozinha), quando a Stripe estiver ligada.
const SUBSCRIPTION_PERIOD_DAYS = 30;
const RENEWAL_REMINDER_DAYS = 3;
const RENEWAL_WINDOW_DAYS = 7;
// O criador fica com 85% de cada mês pago (como nos cursos); o Tchilar fica com 15%.
const SUBSCRIPTION_CREATOR_SHARE = 0.85;
const DAY_MS = 86_400_000;

const subscriptionShareKz = gross => Math.round(Number(gross || 0) * SUBSCRIPTION_CREATOR_SHARE * 100) / 100;

// Fim do acesso depois de pagar um mês: soma 30 dias ao que ainda falta (renovar cedo não faz perder dias).
function nextPeriodEnd(currentEnd, now = new Date()) {
  const end = currentEnd ? new Date(currentEnd) : null;
  const base = end && end > now ? end : now;
  return new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * DAY_MS);
}

// Pode pagar o mês seguinte: subscrição paga mês a mês, a acabar dentro de 7 dias (ou já cancelada).
function canRenew(subscription, now = new Date()) {
  if (!subscription || subscription.provider === "stripe") return false;
  const end = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  if (!end || end <= now) return false;
  return subscription.cancel_at_period_end === true || end.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY_MS;
}

function registerLocalSubscriptions({ pool, transaction, payments }) {
  const notify = (db, userId, actorId, text) => db.query(
    "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'subscription',$3)", [userId, actorId, text]);

  // Pagamento confirmado (pode chegar repetido: só o primeiro conta).
  payments.register("subscription", async (paymentId, details = {}) => {
    await transaction(async client => {
      const paid = (await client.query(`
        UPDATE subscription_payments SET status='paid', paid_at=NOW(), stripe_payment_intent=$2
        WHERE id=$1 AND status='pending' RETURNING subscriber_id, creator_id`, [paymentId, details.paymentIntent || null])).rows[0];
      if (!paid?.subscriber_id || !paid.creator_id) return;
      const current = (await client.query(`
        SELECT status,current_period_end FROM subscriptions WHERE subscriber_id=$1 AND creator_id=$2 FOR UPDATE`,
      [paid.subscriber_id, paid.creator_id])).rows[0];
      const end = nextPeriodEnd(current?.status === "active" ? current.current_period_end : null);
      await client.query(`
        INSERT INTO subscriptions(subscriber_id,creator_id,status,current_period_end,cancel_at_period_end,provider,provider_subscription_id,updated_at)
        VALUES($1,$2,'active',$3,FALSE,$4,NULL,NOW())
        ON CONFLICT(subscriber_id,creator_id) DO UPDATE SET status='active', current_period_end=EXCLUDED.current_period_end,
          cancel_at_period_end=FALSE, provider=EXCLUDED.provider, provider_subscription_id=NULL, renewal_reminded_at=NULL, updated_at=NOW()`,
      [paid.subscriber_id, paid.creator_id, end, details.demo ? "demo" : "local"]);
      await client.query("UPDATE subscription_payments SET period_end=$2 WHERE id=$1", [paymentId, end]);
      const names = (await client.query("SELECT id,display_name FROM users WHERE id = ANY($1)", [[paid.subscriber_id, paid.creator_id]])).rows;
      const name = id => names.find(row => row.id === id)?.display_name || "alguém";
      const until = end.toLocaleDateString("pt-PT", { day: "numeric", month: "long", timeZone: "Africa/Luanda" });
      await notify(client, paid.subscriber_id, paid.creator_id, `A tua subscrição de ${name(paid.creator_id)} está ativa até ${until}.`);
      await notify(client, paid.creator_id, paid.subscriber_id, current?.status === "active"
        ? "Renovou a subscrição. Os teus 85% já estão no saldo."
        : "Subscreveu o teu conteúdo exclusivo. Os teus 85% já estão no saldo.");
    });
  });

  // Começa o pagamento de 1 mês. creator: { id, username, display_name, subscription_price }.
  async function startPayment({ subscriberId, email, creator, method, phone, promoCode }) {
    const amountKz = Number(creator.subscription_price);
    const created = await pool.query(
      "INSERT INTO subscription_payments(subscriber_id,creator_id,amount_kz) VALUES($1,$2,$3) RETURNING id",
      [subscriberId, creator.id, amountKz]);
    const paymentId = created.rows[0].id;
    const profile = `/u/${encodeURIComponent(creator.username)}`;
    const result = await payments.start({
      purpose: "subscription", refId: paymentId, amountKz, userId: subscriberId, email, method, phone, promoCode,
      name: `Subscrição de ${creator.display_name} no Tchilar (1 mês)`,
      successPath: `${profile}?subscription=success`, cancelPath: `${profile}?subscription=cancelled`,
      onSession: sessionId => pool.query("UPDATE subscription_payments SET stripe_session_id=$2 WHERE id=$1", [paymentId, sessionId])
    });
    if (result.activated) result.message = `Subscrição ativa durante ${SUBSCRIPTION_PERIOD_DAYS} dias${result.demo ? " (demonstração, sem pagamento)" : ""}.`;
    return result;
  }

  // Aviso de renovação, uma vez por mês pago. Devolve quantos avisos criou.
  async function remindRenewals() {
    const result = await pool.query(`
      WITH due AS (
        UPDATE subscriptions s SET renewal_reminded_at=NOW()
        WHERE s.provider IN ('local','demo') AND s.status='active' AND NOT s.cancel_at_period_end AND s.renewal_reminded_at IS NULL
          AND s.current_period_end > NOW() AND s.current_period_end <= NOW() + INTERVAL '${RENEWAL_REMINDER_DAYS} days'
        RETURNING s.subscriber_id, s.creator_id, s.current_period_end
      )
      INSERT INTO notifications(user_id,actor_id,type,text)
      SELECT d.subscriber_id, d.creator_id, 'subscription',
        'A tua subscrição de ' || u.display_name || ' termina a ' || to_char(d.current_period_end AT TIME ZONE 'Africa/Luanda', 'DD/MM')
          || '. Renova no perfil para continuares a ver as publicações exclusivas.'
      FROM due d JOIN users u ON u.id=d.creator_id
      RETURNING id`);
    return result.rowCount || 0;
  }

  return { remindRenewals, startPayment };
}

module.exports = {
  RENEWAL_REMINDER_DAYS, RENEWAL_WINDOW_DAYS, SUBSCRIPTION_CREATOR_SHARE, SUBSCRIPTION_PERIOD_DAYS,
  canRenew, nextPeriodEnd, registerLocalSubscriptions, subscriptionShareKz
};
