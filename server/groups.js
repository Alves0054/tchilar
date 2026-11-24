// Regras dos grupos secretos: só para maiores de 18, com entrada paga, e só se encontram pelo nome exato.
const { ageOn } = require("./growth");
const { RENEWAL_WINDOW_DAYS, nextPeriodEnd } = require("./local-subscriptions");

const ADULT_AGE = 18;
const GROUP_ACCESS_CREATOR_SHARE = 0.8; // o dono do grupo recebe 80% de cada entrada; o Tchilar fica com 20%

// Condição SQL "esta pessoa tem 18 anos ou mais". Sem data de nascimento conta como menor.
const adultSql = column => `(${column} IS NOT NULL AND ${column} <= (CURRENT_DATE - INTERVAL '${ADULT_AGE} years'))`;

const isAdult = (birthDate, now = new Date()) => Boolean(birthDate) && ageOn(String(birthDate).slice(0, 10), now) >= ADULT_AGE;

// O nome procurado tem de ser o nome do grupo, sem contar maiúsculas nem espaços nas pontas.
const sameGroupName = (typed, name) => typeof typed === "string" && typed.trim().toLowerCase() === String(name).trim().toLowerCase();

// Entrada única (paga-se uma vez) ou mensal (paga-se um mês de cada vez, como as subscrições).
const ACCESS_BILLING = ["once", "monthly"];
const ACCESS_LIMITS = { once: { min: 500, max: 50_000 }, monthly: { min: 500, max: 20_000 } };
const RENEWAL_REMINDER_DAYS = 3;
const DAY_MS = 86_400_000;

function parseAccessBilling(value) {
  if (value === undefined || value === null || value === "") return { value: "once" };
  return ACCESS_BILLING.includes(value) ? { value } : { error: "Escolhe pagamento único ou mensal." };
}

// Preço em kwanzas (até 2 casas decimais) dentro dos limites do tipo de pagamento.
function parseAccessPrice(value, billing = "once") {
  const { min, max } = ACCESS_LIMITS[billing] || ACCESS_LIMITS.once;
  const price = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  const valid = typeof price === "number" && Number.isFinite(price) && price >= min && price <= max
    && Math.round(price * 100) === Number((price * 100).toFixed(6));
  if (!valid) {
    const what = billing === "monthly" ? "A mensalidade" : "O preço de entrada";
    return { error: `${what} deve estar entre ${min.toLocaleString("pt-PT")} Kz e ${max.toLocaleString("pt-PT")} Kz.` };
  }
  return { value: Math.round(price * 100) / 100 };
}

// Um membro de um grupo mensal pode pagar o mês seguinte nos últimos 7 dias do acesso.
function canRenewGroupAccess(accessUntil, now = new Date()) {
  if (!accessUntil) return false;
  const end = new Date(accessUntil);
  return end > now && end.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * DAY_MS;
}

const groupDate = value => new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "long", timeZone: "Africa/Luanda" });

// Corre de 10 em 10 minutos: avisa 3 dias antes do fim e retira do grupo quem não renovou.
async function maintainGroupAccess({ pool }) {
  const due = await pool.query(`
    UPDATE group_members m SET renewal_reminded_at=NOW()
    FROM social_groups g
    WHERE g.id=m.group_id AND m.role='member' AND m.access_until IS NOT NULL AND m.renewal_reminded_at IS NULL
      AND m.access_until > NOW() AND m.access_until <= NOW() + make_interval(days => $1)
    RETURNING m.user_id, m.access_until, g.name, g.owner_id`, [RENEWAL_REMINDER_DAYS]);
  for (const row of due.rows) {
    await pool.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)", [row.user_id, row.owner_id,
      `O teu acesso ao grupo «${row.name}» acaba a ${groupDate(row.access_until)}. Renova na página do grupo para continuares.`]);
  }
  const ended = await pool.query(`
    DELETE FROM group_members m USING social_groups g
    WHERE g.id=m.group_id AND m.role='member' AND m.access_until IS NOT NULL AND m.access_until <= NOW()
    RETURNING m.user_id, g.name, g.owner_id`);
  for (const row of ended.rows) {
    await pool.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)", [row.user_id, row.owner_id,
      `O teu acesso ao grupo «${row.name}» acabou. Para voltar, procura o grupo pelo nome e paga a mensalidade.`]);
  }
  return { reminded: due.rowCount, ended: ended.rowCount };
}

const groupAccessValueKz = grossKz => Math.round(Number(grossKz) * GROUP_ACCESS_CREATOR_SHARE * 100) / 100;

module.exports = {
  ACCESS_LIMITS, ADULT_AGE, GROUP_ACCESS_CREATOR_SHARE, adultSql, canRenewGroupAccess, groupAccessValueKz, groupDate, isAdult,
  maintainGroupAccess, nextPeriodEnd, parseAccessBilling, parseAccessPrice, sameGroupName
};
