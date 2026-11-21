// Telemóveis dos países da CPLP. A mesma lista e as mesmas regras estão no servidor (server/phones.js) e na app
// (mobile/tchilar-app/src/lib/phones.js): mudar aqui obriga a mudar lá. Guardado como "+244923456789".
import { useEffect, useState } from "react";
import { api } from "./core.jsx";
import { Select } from "./select.jsx";

// Por onde podem ir os códigos (SMS e/ou WhatsApp, pela ordem do servidor). Lido uma vez e guardado.
export const SMS_CHANNEL_LABELS = { sms: "SMS", whatsapp: "WhatsApp" };
let channelsCache = null;
export function useSmsChannels() {
  const [channels, setChannels] = useState(channelsCache || ["sms"]);
  useEffect(() => {
    if (channelsCache) return undefined;
    let alive = true;
    api("/auth/phone/channels").then(result => {
      channelsCache = result.channels?.length ? result.channels : ["sms"];
      if (alive) setChannels(channelsCache);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return channels;
}
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
const countryOf = code => PHONE_COUNTRIES.find(item => item.code === code) || PHONE_COUNTRIES[0];

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
  const chosen = countryOf(country);
  const national = chosen.code === "BR" ? text.replace(/^0/, "") : text;
  return chosen.pattern.test(national) ? { e164: `+${chosen.dial}${national}`, country: chosen.code } : null;
}

// "+244923456789" → { country: "AO", national: "923 456 789" } (para preencher o campo ao editar).
export function splitPhone(e164) {
  const parsed = typeof e164 === "string" ? parsePhone(e164) : null;
  if (!parsed) return { country: DEFAULT_PHONE_COUNTRY, national: "" };
  const national = parsed.e164.slice(1 + countryOf(parsed.country).dial.length);
  return { country: parsed.country, national: groupDigits(national) };
}

const groupDigits = digits => digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();

// Para mostrar: "+244 923 456 789".
export function formatPhone(e164) {
  const parsed = typeof e164 === "string" ? parsePhone(e164) : null;
  if (!parsed) return e164 || "";
  const { dial } = countryOf(parsed.country);
  return `+${dial} ${groupDigits(parsed.e164.slice(1 + dial.length))}`;
}

// Para mostrar sem revelar o número todo: "+244 949 ••• 152" (ficam os 3 primeiros e os 3 últimos algarismos).
export function maskPhone(e164) {
  const parsed = typeof e164 === "string" ? parsePhone(e164) : null;
  if (!parsed) return "";
  const { dial } = countryOf(parsed.country);
  const national = parsed.e164.slice(1 + dial.length);
  const hidden = national.slice(0, 3) + "•".repeat(Math.max(0, national.length - 6)) + national.slice(-3);
  return `+${dial} ${hidden.replace(/(.{3})(?=.)/g, "$1 ")}`;
}

export const PHONE_ERROR = "Indica um telemóvel válido para o país escolhido.";

// País (bandeira + indicativo) + número. "id" vai para o número; a lista tem rótulo próprio para leitores de ecrã.
export function PhoneInput({ id, country, onCountryChange, value, onChange, invalid, describedBy, label = "Telemóvel", required, disabled }) {
  const chosen = countryOf(country);
  return <div className={`phone-input${invalid ? " is-invalid" : ""}`}>
    <label className="phone-input-country">
      <span className="visually-hidden">País do telemóvel</span>
      <Select value={chosen.code} disabled={disabled} minPanelWidth={300} aria-label="País do telemóvel" onChange={event => onCountryChange(event.target.value)}>
        {PHONE_COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.flag} {item.name} (+{item.dial})</option>)}
      </Select>
      <span className="phone-input-dial" aria-hidden="true">{chosen.flag} +{chosen.dial}</span>
    </label>
    <div className="entry-control phone-input-number">
      <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} placeholder=" " required={required} disabled={disabled}
        value={value} onChange={onChange} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      <label htmlFor={id}>{label} <span className="phone-input-example">· ex.: {chosen.example}</span></label>
    </div>
  </div>;
}
