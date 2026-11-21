// Ligação à API do Tchilar (a mesma do site). O endereço vem de EXPO_PUBLIC_API_URL (.env.local).
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://api.tchilar.ao").replace(/\/$/, "");
// Site do Tchilar: áreas que a app ainda não tem abrem aqui.
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || "https://tchilar.ao").replace(/\/$/, "");

// Descarrega um ficheiro da API com a sessão (cópia dos dados, CSV) e abre a folha de partilha do sistema
// para o guardar em Ficheiros, enviar por email ou abrir noutra app.
export async function downloadAndShare(path, filename, mimeType) {
  const { File, Paths } = await import("expo-file-system");
  const Sharing = await import("expo-sharing");
  const token = await readToken();
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  try {
    await File.downloadFileAsync(`${API_URL}/api${path}`, file, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new Error("Não foi possível descarregar o ficheiro. Confirma que tens acesso e tenta outra vez.");
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
  return file.uri;
}

// Envio com ficheiro (publicações e stories). file: { uri, mimeType, fileName } do seletor de imagens.
export async function upload(path, fields, file, fieldName = "media") {
  const token = await readToken();
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) form.append(key, String(value));
  if (file) {
    const type = file.mimeType || (file.type === "video" ? "video/mp4" : "image/jpeg");
    form.append(fieldName, { uri: file.uri, type, name: file.fileName || `tchilar.${type.split("/")[1] || "jpg"}` });
  }
  let response;
  try {
    response = await fetch(`${API_URL}/api${path}`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  } catch {
    throw new Error("Sem ligação ao Tchilar. Tenta outra vez.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await checkExpired(response, data, token);
    throw new Error(data.error || "Não foi possível enviar.");
  }
  return data;
}
const TOKEN_KEY = "tchilar-token";
const LEGACY_TOKEN_KEY = "biva-token";

// O token da sessão fica no cofre do sistema (Keychain no iOS, Keystore no Android), não em texto simples.
export const readToken = async () => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) return token;
  const legacyToken = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY);
  if (legacyToken) {
    await SecureStore.setItemAsync(TOKEN_KEY, legacyToken);
  }
  return legacyToken;
};
export const saveToken = async token => {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY);
};
export const clearToken = async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY);
};

// Endereço completo de uma foto ou vídeo (a API devolve caminhos como /uploads/abc.jpg).
export const mediaUri = path => (!path ? null : /^https?:/.test(path) ? path : `${API_URL}${path}`);

// Sessão terminada (expirou, foi terminada noutro dispositivo ou a palavra-passe mudou): a API responde 401 com
// sessionExpired. A app apaga o token e a sessão (session.js) volta ao ecrã de entrar, com uma mensagem.
let sessionExpiredHandler = null;
export const onSessionExpired = handler => { sessionExpiredHandler = handler; };
async function checkExpired(response, data, token) {
  if (response.status === 401 && token && data?.sessionExpired) {
    await clearToken();
    sessionExpiredHandler?.();
  }
}

// Nome deste telemóvel, para a lista "Onde tens sessão iniciada" (ex.: "iPhone 15 · iOS 18.1").
const DEVICE_LABEL = [Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Android"), `${Platform.OS === "ios" ? "iOS" : "Android"} ${Device.osVersion || ""}`.trim()].join(" · ");

// Estado da ligação, visto pelos próprios pedidos: um pedido que não chega ao servidor = sem internet;
// a primeira resposta que chega = ligação de volta. O aviso "Sem ligação" (components/OfflineBanner) ouve isto.
let online = true;
const connectionListeners = new Set();
function setOnline(value) {
  if (online === value) return;
  online = value;
  connectionListeners.forEach(listener => listener(value));
}
export const isOnline = () => online;
export function onConnectionChange(listener) { connectionListeners.add(listener); return () => connectionListeners.delete(listener); }

export async function api(path, { method = "GET", body } = {}) {
  const token = await readToken();
  let response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Tchilar-Device": DEVICE_LABEL
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    setOnline(false);
    throw new Error("Sem ligação à internet. Confirma o Wi-Fi ou os dados móveis e tenta outra vez.");
  }
  setOnline(true);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await checkExpired(response, data, token);
    const error = new Error(data.error || "Não foi possível concluir o pedido.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
