// Limites dos códigos por SMS/WhatsApp, para o custo do Twilio não fugir ao controlo (e contra o abuso de "SMS pumping",
// em que alguém pede códigos em massa para números caros). Cada envio fica em sms_sends.
//   - o mesmo número só recebe um código por minuto;
//   - no máximo SMS_PER_PHONE_DAILY (5) códigos por número em 24 horas;
//   - teto do Tchilar inteiro por dia: SMS_DAILY_LIMIT no .env (0 ou vazio = sem teto).
const SMS_COOLDOWN_MS = 60 * 1000;
const SMS_PER_PHONE_DAILY = 5;

const dailyLimit = () => Math.max(0, Number.parseInt(process.env.SMS_DAILY_LIMIT || "0", 10) || 0);

/**
 * Vê se pode sair mais um código para este número.
 * @returns {Promise<{ ok: boolean, reason?: "cooldown" | "phone_daily" | "daily_limit", error?: string }>}
 */
async function smsAllowed(pool, phone) {
  const result = await pool.query(`
    SELECT
      (SELECT MAX(created_at) FROM sms_sends WHERE phone=$1) AS last_sent,
      (SELECT COUNT(*) FROM sms_sends WHERE phone=$1 AND created_at > NOW() - INTERVAL '24 hours')::int AS phone_day,
      (SELECT COUNT(*) FROM sms_sends WHERE created_at > date_trunc('day', NOW() AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda')::int AS all_day`,
  [phone]);
  const row = result.rows[0];
  const limit = dailyLimit();
  if (limit && row.all_day >= limit) {
    return { ok: false, reason: "daily_limit", error: "Hoje já não conseguimos enviar mais códigos. Usa o email ou tenta amanhã." };
  }
  if (row.phone_day >= SMS_PER_PHONE_DAILY) {
    return { ok: false, reason: "phone_daily", error: "Já enviámos vários códigos para este número hoje. Tenta amanhã ou usa o email." };
  }
  if (row.last_sent && Date.now() - new Date(row.last_sent).getTime() < SMS_COOLDOWN_MS) {
    const wait = Math.ceil((SMS_COOLDOWN_MS - (Date.now() - new Date(row.last_sent).getTime())) / 1000);
    return { ok: false, reason: "cooldown", error: `Acabámos de enviar um código. Espera ${wait} segundos antes de pedir outro.` };
  }
  return { ok: true };
}

/** Regista um envio (conta para os limites e para os custos). */
function recordSms(pool, { phone, userId = null, channel, purpose }) {
  return pool.query("INSERT INTO sms_sends(phone,user_id,channel,purpose) VALUES($1,$2,$3,$4)", [phone, userId, channel, purpose]);
}

module.exports = { SMS_COOLDOWN_MS, SMS_PER_PHONE_DAILY, recordSms, smsAllowed };
