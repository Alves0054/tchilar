// Verificação em dois passos (TOTP, RFC 6238): os códigos de 6 dígitos que mudam a cada 30 segundos
// em apps como Google Authenticator, Microsoft Authenticator ou Authy. Sem dependências externas.
const crypto = require("crypto");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Chave base32 inválida.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 bytes aleatórios = 160 bits, o tamanho recomendado para HMAC-SHA1.
const generateSecret = () => base32Encode(crypto.randomBytes(20));

function codeAt(secret, step, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

// Aceita o código atual e o de 30 s antes/depois (relógios do telemóvel ligeiramente desacertados).
// Devolve o "passo" usado, para o servidor recusar o mesmo código duas vezes (proteção contra repetição),
// ou null se o código estiver errado.
function verifyCode(secret, code, { lastStep = null, now = Date.now() } = {}) {
  const clean = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const candidate of [step, step - 1, step + 1]) {
    if (lastStep !== null && candidate <= Number(lastStep)) continue;
    const expected = codeAt(secret, candidate);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return candidate;
  }
  return null;
}

// Endereço que as apps de autenticação leem do código QR.
function otpauthUri({ secret, account, issuer = "Tchilar" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

module.exports = { base32Decode, base32Encode, codeAt, currentStep, generateSecret, otpauthUri, verifyCode };
