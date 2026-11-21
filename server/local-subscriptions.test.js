const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canRenew, nextPeriodEnd, registerLocalSubscriptions, subscriptionShareKz } = require("./local-subscriptions");

const DAY = 86_400_000;
const now = new Date("2026-11-15T12:00:00Z");

test("paying a month adds 30 days to what is left, never loses days", () => {
  assert.equal(nextPeriodEnd(null, now).getTime(), now.getTime() + 30 * DAY, "primeira vez: 30 dias a partir de agora");
  const inFiveDays = new Date(now.getTime() + 5 * DAY);
  assert.equal(nextPeriodEnd(inFiveDays, now).getTime(), inFiveDays.getTime() + 30 * DAY, "renovar cedo soma ao fim atual");
  const expired = new Date(now.getTime() - 3 * DAY);
  assert.equal(nextPeriodEnd(expired, now).getTime(), now.getTime() + 30 * DAY, "já tinha acabado: conta a partir de hoje");
});

test("renewal opens in the last 7 days, after cancelling, and never for Stripe", () => {
  const ends = days => new Date(now.getTime() + days * DAY);
  assert.equal(canRenew({ provider: "local", current_period_end: ends(20) }, now), false);
  assert.equal(canRenew({ provider: "local", current_period_end: ends(6) }, now), true);
  assert.equal(canRenew({ provider: "local", current_period_end: ends(20), cancel_at_period_end: true }, now), true);
  assert.equal(canRenew({ provider: "stripe", current_period_end: ends(2) }, now), false, "a Stripe renova sozinha");
  assert.equal(canRenew({ provider: "local", current_period_end: ends(-1) }, now), false, "acabou: é subscrever de novo");
  assert.equal(canRenew(null, now), false);
});

test("the creator keeps 85% of each month", () => {
  assert.equal(subscriptionShareKz(2500), 2125);
  assert.equal(subscriptionShareKz(null), 0);
});

// Base de dados falsa: guarda o que se escreve e responde às consultas que o módulo faz.
function fakeDb({ existing = null, alreadyPaid = false } = {}) {
  const writes = [];
  const client = {
    query: async (sql, params) => {
      writes.push([sql, params]);
      if (sql.includes("UPDATE subscription_payments SET status='paid'")) return { rows: alreadyPaid ? [] : [{ subscriber_id: 2, creator_id: 9 }] };
      if (sql.includes("FROM subscriptions WHERE")) return { rows: existing ? [existing] : [] };
      if (sql.includes("SELECT id,display_name")) return { rows: [{ id: 2, display_name: "Bruno" }, { id: 9, display_name: "Carla" }] };
      if (sql.includes("INSERT INTO subscription_payments")) return { rows: [{ id: 77 }] };
      return { rows: [], rowCount: 0 };
    }
  };
  return { writes, client };
}
function setup(db) {
  let fulfill;
  let started;
  const payments = {
    register: (purpose, handler) => { assert.equal(purpose, "subscription"); fulfill = handler; },
    start: async options => { started = options; return { method: "reference", paymentId: 1 }; }
  };
  const module = registerLocalSubscriptions({ pool: db.client, transaction: operation => operation(db.client), payments });
  return { module, fulfill: (...args) => fulfill(...args), started: () => started };
}

test("a paid month activates the subscription and tells both people", async () => {
  const db = fakeDb();
  const { fulfill } = setup(db);
  await fulfill(77, {});
  const upsert = db.writes.find(([sql]) => sql.includes("INSERT INTO subscriptions"));
  assert.equal(upsert[1][3], "local");
  assert.ok(upsert[1][2] > new Date(Date.now() + 29 * DAY), "acesso por ~30 dias");
  assert.match(upsert[0], /renewal_reminded_at=NULL/, "o próximo aviso de renovação volta a contar");
  const notices = db.writes.filter(([sql]) => sql.includes("INSERT INTO notifications")).map(([, params]) => params);
  assert.equal(notices.length, 2);
  assert.match(notices[0][2], /subscrição de Carla está ativa até/);
  assert.match(notices[1][2], /Subscreveu o teu conteúdo exclusivo/);
});

test("a repeated confirmation from the provider does nothing", async () => {
  const db = fakeDb({ alreadyPaid: true });
  const { fulfill } = setup(db);
  await fulfill(77, {});
  assert.equal(db.writes.length, 1, "só a tentativa de marcar como pago");
});

test("renewing early extends from the current end", async () => {
  const end = new Date(Date.now() + 4 * DAY);
  const db = fakeDb({ existing: { status: "active", current_period_end: end } });
  const { fulfill } = setup(db);
  await fulfill(77, {});
  const upsert = db.writes.find(([sql]) => sql.includes("INSERT INTO subscriptions"));
  assert.equal(upsert[1][2].getTime(), end.getTime() + 30 * DAY);
  assert.match(db.writes.filter(([sql]) => sql.includes("INSERT INTO notifications"))[1][1][2], /Renovou a subscrição/);
});

test("starting a payment charges the creator's price for one month", async () => {
  const db = fakeDb();
  const { module, started } = setup(db);
  await module.startPayment({ subscriberId: 2, email: "b@x.ao", creator: { id: 9, username: "carla", display_name: "Carla", subscription_price: "2500" }, method: "reference" });
  assert.equal(started().purpose, "subscription");
  assert.equal(started().refId, 77);
  assert.equal(started().amountKz, 2500);
  assert.equal(started().successPath, "/u/carla?subscription=success");
});

test("renewal reminders go out once, 3 days before the end, only for month-by-month subscriptions", async () => {
  const db = fakeDb();
  const { module } = setup(db);
  await module.remindRenewals();
  const [sql] = db.writes.at(-1);
  for (const rule of ["renewal_reminded_at IS NULL", "provider IN ('local','demo')", "NOT s.cancel_at_period_end", "INTERVAL '3 days'"]) assert.ok(sql.includes(rule), rule);
});
