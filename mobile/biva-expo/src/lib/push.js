// Notificações push: pede autorização, regista o token deste telemóvel na API e abre o ecrã certo
// quando se toca num aviso. O envio é feito pelo servidor (server/push.js) através do Expo.
//
// Precisa da app instalada (build do EAS, em desenvolvimento ou nas lojas) e de um projeto Expo
// (extra.eas.projectId em app.json, criado com "eas init"). No Expo Go o Android não recebe push:
// nesse caso, a app continua a funcionar e só não regista o telemóvel.
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "./api";

let currentToken = null;
const DEVICE_KEY = "tchilar-device-key";

// Chave secreta deste telemóvel (criada uma vez, guardada no cofre do sistema). Prova ao servidor que é o
// mesmo telemóvel quando outra conta entra nele, e impede que alguém que só sabe o token o desvie.
async function deviceKey() {
  let key = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!key) {
    const bytes = Crypto.getRandomBytes(32);
    key = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(DEVICE_KEY, key);
  }
  return key;
}

// Com a app aberta, os avisos aparecem na mesma (como no WhatsApp), com som e o número no ícone.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true })
});

const projectId = () => Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || null;
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Devolve { ok, reason } para a app poder explicar porque não há notificações neste telemóvel.
export async function registerForPush({ ask = true } = {}) {
  if (!Device.isDevice) return { ok: false, reason: "As notificações só funcionam num telemóvel a sério." };
  if (inExpoGo && Platform.OS === "android") return { ok: false, reason: "No Expo Go o Android não recebe notificações. Funciona na app instalada." };
  if (!projectId()) return { ok: false, reason: "Falta ligar a app a um projeto Expo (eas init)." };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Notificações", importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("messages", { name: "Mensagens", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200] });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return { ok: false, reason: "Não deste autorização para notificações. Podes ligá-las nas definições do telemóvel." };
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
  await api("/push-tokens", { method: "POST", body: { token, platform: Platform.OS, deviceKey: await deviceKey() } });
  currentToken = token;
  return { ok: true };
}

// Ao terminar sessão: este telemóvel deixa de receber avisos desta conta.
export async function unregisterPush() {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  await api("/push-tokens", { method: "DELETE", body: { token } }).catch(() => {});
}

// Tocar num aviso abre o ecrã indicado pelo servidor (data.url), mesmo com a app fechada.
export function listenToPushTaps() {
  const open = response => {
    const url = response?.notification?.request?.content?.data?.url;
    if (typeof url === "string" && url.startsWith("/")) router.push(url);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) setTimeout(() => open(last), 300);
  const subscription = Notifications.addNotificationResponseReceivedListener(open);
  return () => subscription.remove();
}
