// Limites de pedidos partilhados entre várias cópias da API.
// Com REDIS_URL, todas as cópias contam no mesmo sítio (uma pessoa não ganha 3x as tentativas por
// haver 3 servidores). Sem REDIS_URL, conta em memória, como antes: certo para uma só cópia.
const { rateLimit } = require("express-rate-limit");

let client = null;
let RedisStore = null;

function logRedis(message) {
  console.error(JSON.stringify({ level: "error", kind: "redis", at: new Date().toISOString(), message }));
}

// Liga ao Redis uma vez, no arranque. Os comandos enviados antes de a ligação abrir ficam em fila.
function connectRateLimitStore(env = process.env) {
  if (!env.REDIS_URL || client) return client;
  const { createClient } = require("redis");
  ({ RedisStore } = require("rate-limit-redis"));
  client = createClient({ url: env.REDIS_URL });
  client.on("error", error => logRedis(error.message));
  client.connect().catch(error => logRedis(`ligação falhou: ${error.message}`));
  return client;
}

// Igual ao rateLimit() do express-rate-limit, com o armazenamento certo e um prefixo por limite.
// Se o Redis falhar, o pedido passa (o nginx continua a limitar): é melhor do que deitar o site abaixo.
function makeRateLimit(name, options) {
  return rateLimit({
    ...options,
    ...(client ? {
      store: new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix: `biva:rl:${name}:` }),
      passOnStoreError: true
    } : {})
  });
}

async function closeRateLimitStore() {
  if (client) await client.quit().catch(() => {});
  client = null;
}

module.exports = { closeRateLimitStore, connectRateLimitStore, makeRateLimit };
