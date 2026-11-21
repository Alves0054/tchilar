// Bloqueio da app: quando ligado, pede Face ID / impressão digital (ou o código do telemóvel)
// ao abrir a app e ao voltar a ela depois de mais de 1 minuto fora. Não termina a sessão: só tapa o ecrã.
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const KEY = "tchilar-app-lock";
export const LOCK_AFTER_MS = 60 * 1000;

export async function lockEnabled() {
  try { return (await SecureStore.getItemAsync(KEY)) === "on"; } catch { return false; }
}

// O que este telemóvel tem: "Face ID", "impressão digital", "código do telemóvel" ou null (nada configurado).
export async function lockMethod() {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) {
      return (await LocalAuthentication.getEnrolledLevelAsync()) > 0 ? "código do telemóvel" : null;
    }
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return "Face ID";
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return "impressão digital";
    return "código do telemóvel";
  } catch { return null; }
}

export async function unlock(reason = "Desbloquear o Tchilar") {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancelar", fallbackLabel: "Usar código" });
    return result.success;
  } catch { return false; }
}

// Ligar pede logo a confirmação (assim ninguém liga o bloqueio sem conseguir desbloquear depois).
export async function setLockEnabled(on) {
  if (on) {
    if (!(await lockMethod())) throw new Error("Este telemóvel não tem Face ID, impressão digital nem código configurado.");
    if (!(await unlock("Confirmar para ligar o bloqueio"))) throw new Error("Não confirmado. O bloqueio continua desligado.");
  }
  await SecureStore.setItemAsync(KEY, on ? "on" : "off");
  lockListeners.forEach(listener => listener(on));
}
const lockListeners = new Set();
export function onLockChange(listener) { lockListeners.add(listener); return () => lockListeners.delete(listener); }
