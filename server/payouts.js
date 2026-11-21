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
// Métodos para receber: cada pessoa escolhe onde quer o dinheiro.
//   iban      — transferência bancária para um IBAN angolano (o titular e o banco são pedidos)
//   express   — Multicaixa Express: número de telemóvel angolano associado ao Express
//   paypay    — PayPay África: número de telemóvel angolano da conta PayPay
//   paypal    — PayPal: email da conta PayPal (pago em dólares à taxa do dia)
//   redotpay  — RedotPay: email ou ID (UID) da conta RedotPay (pago em USDT/dólares)
// ---------------------------------------------------------------------------------------------
const PAYOUT_METHODS = {
  iban: { label: "Transferência bancária", field: "IBAN" },
  express: { label: "Multicaixa Express", field: "Telemóvel do Express" },
  paypay: { label: "PayPay África", field: "Telemóvel da conta PayPay" },
  paypal: { label: "PayPal", field: "Email da conta PayPal" },
  redotpay: { label: "RedotPay", field: "Email ou ID RedotPay" }
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

// "ana.silva@gmail.com" → "an•••@gmail.com"
function maskEmail(email) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}•••@${domain}`;
}

// Valida o destino do método escolhido. Devolve { value, last4, hint } (value é o que fica cifrado) ou { error }.
function parsePayoutDestination(method, raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (method === "iban") {
    const iban = normalizeIban(text);
    if (!isValidAngolanIban(iban)) return { error: "O IBAN não é válido. Um IBAN angolano começa por AO e tem 25 caracteres." };
    return { value: iban, last4: iban.slice(-4), hint: maskIban(iban.slice(-4)) };
  }
  if (method === "express" || method === "paypay") {
    // Express e PayPay África só funcionam com números angolanos: 9 dígitos começados por 9 (com ou sem +244).
    const digits = text.replace(/[\s().\-/]/g, "").replace(/^(\+|00)244/, "");
    if (!/^9\d{8}$/.test(digits)) return { error: `Indica o número angolano da conta ${PAYOUT_METHODS[method].label} (9 dígitos, ex.: 923 456 789).` };
    return { value: `+244${digits}`, last4: digits.slice(-4), hint: `+244 ••• ••${digits.slice(-4, -3)} ${digits.slice(-3)}` };
  }
  if (method === "paypal") {
    const email = text.toLowerCase();
    if (!EMAIL.test(email) || email.length > 160) return { error: "Indica o email da tua conta PayPal." };
    return { value: email, last4: email.slice(-4), hint: maskEmail(email) };
  }
  if (method === "redotpay") {
    const value = text.toLowerCase();
    if (EMAIL.test(value) && value.length <= 160) return { value, last4: value.slice(-4), hint: maskEmail(value) };
    if (/^\d{6,20}$/.test(value)) return { value, last4: value.slice(-4), hint: `ID •••• ${value.slice(-4)}` };
    return { error: "Indica o email ou o ID (UID) da tua conta RedotPay." };
  }
  return { error: "Escolhe onde queres receber: transferência bancária, Multicaixa Express, PayPay África, PayPal ou RedotPay." };
}

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
  // Mantém a derivação antiga para não tornar ilegíveis IBAN já cifrados em desenvolvimento.
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
function payoutBalance({ partnerKz = 0, starsKz = 0, campaignsKz = 0, groupsKz = 0, prizesKz = 0, coursesKz = 0, subscriptionsKz = 0, withdrawnKz = 0 }) {
  const earned = Math.round((partnerKz + starsKz + campaignsKz + groupsKz + prizesKz + coursesKz + subscriptionsKz) * 100) / 100;
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
  PAYOUT_METHODS,
  decrypt,
  encrypt,
  isValidAngolanIban,
  loadKey,
  maskIban,
  maskEmail,
  normalizeIban,
  parsePayoutDestination,
  parseWithdrawal,
  payoutBalance
};
