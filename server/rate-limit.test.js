// Os limites de pedidos são partilhados entre cópias da API quando há Redis (REDIS_URL).
// Sem Redis, só se testa que o modo em memória continua a funcionar.
const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { closeRateLimitStore, connectRateLimitStore, makeRateLimit } = require("./rate-limit");

const withRedis = Boolean(process.env.REDIS_URL);
if (withRedis) connectRateLimitStore();
after(closeRateLimitStore);

// Uma "cópia da API" mínima com um limite de 3 pedidos por janela.
async function startCopy(name) {
  const app = express();
  app.set("trust proxy", 1);
  app.post("/login", makeRateLimit(name, { windowMs: 60_000, limit: 3, standardHeaders: "draft-8", legacyHeaders: false }), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/login` };
}
const hit = (url, ip) => fetch(url, { method: "POST", headers: { "X-Forwarded-For": ip } }).then(response => response.status);

test("in memory, one copy blocks after the limit", async () => {
  if (withRedis) return; // com REDIS_URL o teste seguinte cobre o caso real
  const copy = await startCopy("memory-test");
  try {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push(await hit(copy.url, "10.0.0.1"));
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    copy.server.close();
  }
});

test("with Redis, two copies share the same count", { skip: withRedis ? false : "sem REDIS_URL" }, async () => {
  const name = `shared-${Date.now()}`;
  const [first, second] = [await startCopy(name), await startCopy(name)];
  try {
    const ip = `10.0.${Math.floor(Math.random() * 250)}.7`;
    const statuses = [await hit(first.url, ip), await hit(second.url, ip), await hit(first.url, ip), await hit(second.url, ip)];
    assert.deepEqual(statuses, [200, 200, 200, 429], "o 4.º pedido é recusado mesmo indo a outra cópia");
    assert.equal(await hit(second.url, "10.9.9.9"), 200, "outra pessoa não é afetada");
  } finally {
    first.server.close();
    second.server.close();
  }
});
