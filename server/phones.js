// Telemóveis dos países da CPLP. Guardamos sempre no formato internacional (E.164): "+244923456789".
// A mesma lista existe no site (src/modules/phones.js) e na app (mobile/tchilar-app/src/lib/phones.js):
// mudar aqui obriga a mudar lá.
//
// "pattern" valida o número nacional de TELEMÓVEL (sem o indicativo), como é escrito no próprio país:
//   Angola 9XX XXX XXX · Brasil DDD + 9XXXX XXXX · Portugal 9X XXX XXXX · Moçambique 8X XXX XXXX ...
const PHONE_COUNTRIES = [
  { code: "AO", name: "Angola", dial: "244", pattern: /^9\d{8}$/, example: "923 456 789" },
  { code: "BR", name: "Brasil", dial: "55", pattern: /^[1-9]{2}9\d{8}$/, example: "11 91234 5678" },
  { code: "PT", name: "Portugal", dial: "351", pattern: /^9[1236]\d{7}$/, example: "912 345 678" },
  { code: "MZ", name: "Moçambique", dial: "258", pattern: /^8[2-7]\d{7}$/, example: "84 123 4567" },
  { code: "CV", name: "Cabo Verde", dial: "238", pattern: /^[59]\d{6}$/, example: "991 2345" },
  { code: "GW", name: "Guiné-Bissau", dial: "245", pattern: /^9[56]\d{7}$/, example: "955 123 456" },
  { code: "ST", name: "São Tomé e Príncipe", dial: "239", pattern: /^9\d{6}$/, example: "981 2345" },
  { code: "TL", name: "Timor-Leste", dial: "670", pattern: /^7[2-8]\d{6}$/, example: "7723 4567" },
  { code: "GQ", name: "Guiné Equatorial", dial: "240", pattern: /^[25]\d{8}$/, example: "222 123 456" },
  { code: "MO", name: "Macau", dial: "853", pattern: /^6\d{7}$/, example: "6612 3456" }
];
const DEFAULT_COUNTRY = "AO";
// Indicativos mais compridos primeiro, para "+2449..." não ser lido como outro país.
const BY_DIAL = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

// Aceita "+244 923 456 789", "00244923456789", "923456789" (com o país indicado) e o formato guardado.
// Devolve { e164, country } ou null. Um número nacional sem indicativo usa "country" (Angola por omissão).
function parsePhoneNumber(raw, country = DEFAULT_COUNTRY) {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/[\s().\-/]/g, "");
  if (text.startsWith("00")) text = `+${text.slice(2)}`;
  if (!/^\+?\d{6,16}$/.test(text)) return null;
  if (text.startsWith("+")) {
    const digits = text.slice(1);
    const found = BY_DIAL.find(item => digits.startsWith(item.dial) && item.pattern.test(digits.slice(item.dial.length)));
    return found ? { e164: `+${digits}`, country: found.code } : null;
  }
  const chosen = PHONE_COUNTRIES.find(item => item.code === country) || PHONE_COUNTRIES[0];
  // Em Portugal e no Brasil há quem escreva o zero do indicativo de operadora/cidade: tira-o.
  const national = chosen.code === "BR" ? text.replace(/^0/, "") : text;
  return chosen.pattern.test(national) ? { e164: `+${chosen.dial}${national}`, country: chosen.code } : null;
}

// O número angolano de 9 dígitos (para o Multicaixa Express), ou null se for de outro país.
const angolanNational = e164 => (typeof e164 === "string" && /^\+2449\d{8}$/.test(e164) ? e164.slice(4) : null);

const PHONE_ERROR = "Indica um telemóvel válido de um país de língua portuguesa (ex.: +244 923 456 789).";

module.exports = { DEFAULT_COUNTRY, PHONE_COUNTRIES, PHONE_ERROR, angolanNational, parsePhoneNumber };
