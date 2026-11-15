// Regras dos levantamentos dos criadores: validação do IBAN angolano, cifra dos dados bancários
// e cálculo do saldo disponível. Sem Express, para poderem ser testadas sozinhas.
const crypto = require("crypto");

const MIN_WITHDRAWAL_KZ = 5_000;

// IBAN angolano: "AO" + 2 dígitos de controlo + 21 dígitos (25 caracteres), validado pelo módulo 97.
function normalizeIban(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
}

function isValidAngolanIban(value) {
  const iban = normalizeIban(value);
  if (!/^AO\d{23}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

// Mostra só os últimos 4 dígitos: "•••• 1234".
const maskIban = last4 => `•••• ${last4}`;

// ---------------------------------------------------------------------------------------------
// Cifra AES-256-GCM. A chave vem de PAYOUT_ENCRYPTION_KEY (32 bytes em hex ou base64).
// Em desenvolvimento, sem chave, deriva-se uma do JWT_SECRET (nunca em produção).
// ---------------------------------------------------------------------------------------------
function loadKey({ payoutKey, jwtSecret, isProduction }) {
  if (payoutKey) {
    const key = /^[0-9a-f]{64}$/i.test(payoutKey) ? Buffer.from(payoutKey, "hex") : Buffer.from(payoutKey, "base64");
    if (key.length !== 32) throw new Error("PAYOUT_ENCRYPTION_KEY tem de ter 32 bytes (64 caracteres hex ou base64).");
    return key;
  }
  if (isProduction) return null;
  return crypto.createHash("sha256").update(`biva-payouts:${jwtSecret || "dev"}`).digest();
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decrypt(key, payload) {
  const [version, iv, tag, data] = String(payload).split(".");
  if (version !== "v1") throw new Error("Formato cifrado desconhecido.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------------------------
// Saldo: ganhos de todas as fontes menos o que já foi pedido ou pago.
// ---------------------------------------------------------------------------------------------
function payoutBalance({ partnerKz = 0, starsKz = 0, campaignsKz = 0, groupsKz = 0, prizesKz = 0, coursesKz = 0, withdrawnKz = 0 }) {
  const earned = Math.round((partnerKz + starsKz + campaignsKz + groupsKz + prizesKz + coursesKz) * 100) / 100;
  const available = Math.max(0, Math.round((earned - withdrawnKz) * 100) / 100);
  return { earned, available };
}

// Valida um pedido de levantamento. Devolve { amount } ou { error }.
function parseWithdrawal(value, available) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.round(amount * 100) !== Number((amount * 100).toFixed(6))) return { error: "Valor inválido." };
  if (amount < MIN_WITHDRAWAL_KZ) return { error: `O levantamento mínimo é de ${MIN_WITHDRAWAL_KZ.toLocaleString("pt-PT")} Kz.` };
  if (amount > available) return { error: "O valor é maior do que o teu saldo disponível." };
  return { amount: Math.round(amount * 100) / 100 };
}

module.exports = {
  MIN_WITHDRAWAL_KZ,
  decrypt,
  encrypt,
  isValidAngolanIban,
  loadKey,
  maskIban,
  normalizeIban,
  parseWithdrawal,
  payoutBalance
};
