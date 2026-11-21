// Códigos por SMS com o Twilio Verify (https://www.twilio.com/docs/verify/api): o Twilio gera o código de 6 dígitos,
// envia-o, controla a validade (10 minutos) e bloqueia tentativas a mais. Nós só pedimos "envia" e "confere".
//
// Sem as chaves do Twilio:
//   - em desenvolvimento, os códigos são gerados aqui, aparecem no terminal da API (e na resposta, se
//     DEV_EXPOSE_AUTH_LINKS=true) e valem 10 minutos;
//   - em produção não há SMS: confirmar o número e recuperar a conta pelo telemóvel ficam indisponíveis.
const crypto = require("node:crypto");

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Canais por onde o código pode ir. O WhatsApp é normalmente mais barato do que um SMS para Angola, mas precisa de um
// remetente WhatsApp ligado ao serviço Verify na consola do Twilio. SMS_CHANNELS=whatsapp,sms no .env (por ordem).
const CHANNELS = ["sms", "whatsapp"];
function parseChannels(value) {
  const list = String(value || "sms").split(",").map(item => item.trim().toLowerCase()).filter(item => CHANNELS.includes(item));
  return list.length ? [...new Set(list)] : ["sms"];
}

function createTwilioVerify({ accountSid, authToken, serviceSid, fetchImpl = fetch, channels = ["sms"] }) {
  const base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  async function post(path, fields) {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString()
    });
    /** @type {any} */
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }
  return {
    mode: "twilio",
    channels,
    async send(phone, channel = channels[0]) {
      const result = await post("/Verifications", { To: phone, Channel: channels.includes(channel) ? channel : channels[0], Locale: "pt" });
      // 60200: número inválido; 60203: demasiados envios para este número; 60410: número bloqueado por fraude.
      if (!result.ok) {
        const code = result.data?.code;
        if (code === 60203 || result.status === 429) return { error: "Já enviámos vários códigos para este número. Espera uns minutos." };
        if (code === 60200 || code === 21211 || code === 60410) return { error: "Não conseguimos enviar SMS para este número. Confirma o número." };
        throw new Error(`Twilio Verify falhou (${result.status}) ${code || ""} ${result.data?.message || ""}`.trim());
      }
      return { sent: true };
    },
    async check(phone, code) {
      const result = await post("/VerificationCheck", { To: phone, Code: code });
      // 404/20404: não há código pendente (expirou, já foi usado ou tentativas a mais).
      if (!result.ok) {
        if (result.status === 404 || result.data?.code === 20404 || result.data?.code === 60202) return false;
        throw new Error(`Twilio Verify falhou (${result.status}) ${result.data?.code || ""} ${result.data?.message || ""}`.trim());
      }
      return result.data?.status === "approved";
    }
  };
}

// Só para desenvolvimento: códigos guardados em memória (não sobrevivem a reinícios nem são partilhados entre cópias).
function createDevVerify({ log = console.log, now = Date.now, channels = ["sms"] } = {}) {
  const pending = new Map();
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  return {
    mode: "dev",
    channels,
    async send(phone, channel = channels[0]) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      pending.set(phone, { hash: hash(code), expires: now() + CODE_TTL_MS, attempts: 0 });
      log(`[${channel === "whatsapp" ? "WhatsApp" : "SMS"} de desenvolvimento] código para ${phone}: ${code}`);
      return { sent: true, devCode: code };
    },
    async check(phone, code) {
      const entry = pending.get(phone);
      if (!entry || entry.expires < now()) { pending.delete(phone); return false; }
      entry.attempts += 1;
      if (entry.attempts > MAX_ATTEMPTS) { pending.delete(phone); return false; }
      const ok = crypto.timingSafeEqual(Buffer.from(entry.hash), Buffer.from(hash(String(code))));
      if (ok) pending.delete(phone);
      return ok;
    }
  };
}

/**
 * @param {{ accountSid?: string, authToken?: string, serviceSid?: string, isProduction?: boolean, fetchImpl?: typeof fetch, log?: (text: string) => void, channels?: string }} options
 */
function createSms({ accountSid, authToken, serviceSid, isProduction, fetchImpl, log, channels }) {
  const list = parseChannels(channels);
  if (accountSid && authToken && serviceSid) return createTwilioVerify({ accountSid, authToken, serviceSid, fetchImpl, channels: list });
  return isProduction ? null : createDevVerify({ log, channels: list });
}

const SMS_CODE_PATTERN = /^\d{4,10}$/;

module.exports = { SMS_CODE_PATTERN, createDevVerify, createSms, createTwilioVerify, parseChannels };
