// Erros da app: enviados para a API (/api/client-errors, o mesmo do site) com uma referência curta que a
// pessoa pode mostrar ao suporte. Só texto curto: nunca tokens nem dados pessoais.
import { Platform } from "react-native";
import { API_URL } from "./api";

const seen = new Set();

export function reportError(error, context = "app") {
  const message = String(error?.message || error || "Erro desconhecido").slice(0, 500);
  const key = `${context}|${message}`;
  if (seen.has(key) || seen.size >= 20) return null;
  seen.add(key);
  const reference = Math.random().toString(16).slice(2, 10);
  fetch(`${API_URL}/api/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference, context: `${context}-${Platform.OS}`.slice(0, 20), message, stack: String(error?.stack || "").slice(0, 4000), path: "app" })
  }).catch(() => {});
  return reference;
}

// Erros fora dos ecrãs (código assíncrono, eventos): regista e deixa o React Native tratar como antes.
export function installGlobalErrorReporting() {
  const handler = globalThis.ErrorUtils?.getGlobalHandler?.();
  if (!handler || handler.__tchilar) return;
  const wrapped = (error, isFatal) => { reportError(error, isFatal ? "fatal" : "global"); handler(error, isFatal); };
  wrapped.__tchilar = true;
  globalThis.ErrorUtils.setGlobalHandler(wrapped);
}
