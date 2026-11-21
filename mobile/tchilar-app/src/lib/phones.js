// Telemóveis dos países da CPLP. A mesma lista e as mesmas regras estão no servidor (server/phones.js) e no site
// (src/modules/phones.jsx): mudar aqui obriga a mudar lá. Guardado como "+244923456789".
export const PHONE_COUNTRIES = [
  { code: "AO", name: "Angola", flag: "🇦🇴", dial: "244", pattern: /^9\d{8}$/, example: "923 456 789" },
  { code: "BR", name: "Brasil", flag: "🇧🇷", dial: "55", pattern: /^[1-9]{2}9\d{8}$/, example: "11 91234 5678" },
  { code: "PT", name: "Portugal", flag: "🇵🇹", dial: "351", pattern: /^9[1236]\d{7}$/, example: "912 345 678" },
  { code: "MZ", name: "Moçambique", flag: "🇲🇿", dial: "258", pattern: /^8[2-7]\d{7}$/, example: "84 123 4567" },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻", dial: "238", pattern: /^[59]\d{6}$/, example: "991 2345" },
  { code: "GW", name: "Guiné-Bissau", flag: "🇬🇼", dial: "245", pattern: /^9[56]\d{7}$/, example: "955 123 456" },
  { code: "ST", name: "São Tomé e Príncipe", flag: "🇸🇹", dial: "239", pattern: /^9\d{6}$/, example: "981 2345" },
  { code: "TL", name: "Timor-Leste", flag: "🇹🇱", dial: "670", pattern: /^7[2-8]\d{6}$/, example: "7723 4567" },
  { code: "GQ", name: "Guiné Equatorial", flag: "🇬🇶", dial: "240", pattern: /^[25]\d{8}$/, example: "222 123 456" },
  { code: "MO", name: "Macau", flag: "🇲🇴", dial: "853", pattern: /^6\d{7}$/, example: "6612 3456" }
];
export const DEFAULT_PHONE_COUNTRY = "AO";
const BY_DIAL = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
export const phoneCountry = code => PHONE_COUNTRIES.find(item => item.code === code) || PHONE_COUNTRIES[0];

// Igual ao servidor: { e164, country } ou null.
export function parsePhone(raw, country = DEFAULT_PHONE_COUNTRY) {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/[\s().\-/]/g, "");
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  if (!/^\+?\d{6,16}$/.test(text)) return null;
  if (text.startsWith("+")) {
    const digits = text.slice(1);
    const found = BY_DIAL.find(item => digits.startsWith(item.dial) && item.pattern.test(digits.slice(item.dial.length)));
    return found ? { e164: `+${digits}`, country: found.code } : null;
  }
  const chosen = phoneCountry(country);
  const national = chosen.code === "BR" ? text.replace(/^0/, "") : text;
  return chosen.pattern.test(national) ? { e164: `+${chosen.dial}${national}`, country: chosen.code } : null;
}

const groupDigits = digits => digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();

// "+244923456789" → { country: "AO", national: "923 456 789" } (para preencher o campo ao editar).
export function splitPhone(e164) {
  const parsed = parsePhone(e164 || "");
  if (!parsed) return { country: DEFAULT_PHONE_COUNTRY, national: "" };
  return { country: parsed.country, national: groupDigits(parsed.e164.slice(1 + phoneCountry(parsed.country).dial.length)) };
}

// Para mostrar: "+244 923 456 789".
export function formatPhone(e164) {
  const parsed = parsePhone(e164 || "");
  if (!parsed) return e164 || "";
  const { dial } = phoneCountry(parsed.country);
  return `+${dial} ${groupDigits(parsed.e164.slice(1 + dial.length))}`;
}

// O número angolano de 9 dígitos (para o Multicaixa Express), ou "" se for de outro país.
// Para mostrar sem revelar o número todo: "+244 949 ••• 152" (igual ao site).
export function maskPhone(e164) {
  const parsed = typeof e164 === "string" ? parsePhone(e164) : null;
  if (!parsed) return "";
  const { dial } = phoneCountry(parsed.country);
  const national = parsed.e164.slice(1 + dial.length);
  const hidden = national.slice(0, 3) + "•".repeat(Math.max(0, national.length - 6)) + national.slice(-3);
  return `+${dial} ${hidden.replace(/(.{3})(?=.)/g, "$1 ")}`;
}

export const angolanNational = e164 => (typeof e164 === "string" && /^\+2449\d{8}$/.test(e164) ? e164.slice(4) : "");

export const phoneError = country => `Indica um telemóvel válido para ${phoneCountry(country).name} (ex.: ${phoneCountry(country).example}).`;
