// Notificações no browser (web push). O service worker (public/sw.js) mostra os avisos com o site fechado.
// Estados para as Definições: unsupported (browser sem push), off (servidor sem chaves VAPID), blocked
// (a pessoa recusou nas permissões do browser), disabled (pode ligar) e enabled.
import { api } from "./core.jsx";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// A chave VAPID vem em base64url; o browser quer os bytes.
function keyBytes(base64url) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function webPushStatus() {
  if (!supported()) return "unsupported";
  const { publicKey } = await api("/web-push/key").catch(() => ({ publicKey: null }));
  if (!publicKey) return "off";
  if (Notification.permission === "denied") return "blocked";
  const subscription = await currentSubscription().catch(() => null);
  return subscription && Notification.permission === "granted" ? "enabled" : "disabled";
}

// Pede autorização, regista o browser no serviço de push e entrega a subscrição à API.
export async function enableWebPush() {
  if (!supported()) throw new Error("Este browser não recebe notificações.");
  const { publicKey } = await api("/web-push/key");
  if (!publicKey) throw new Error("Os avisos no browser ainda não estão ligados.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied"
    ? "Bloqueaste as notificações do Tchilar neste browser. Podes autorizá-las no cadeado ao lado do endereço."
    : "Não autorizaste as notificações.");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Uma subscrição feita com outra chave (o servidor mudou de chaves) já não serve.
  if (subscription && subscription.options?.applicationServerKey) {
    const old = new Uint8Array(subscription.options.applicationServerKey);
    const fresh = keyBytes(publicKey);
    if (old.length !== fresh.length || old.some((byte, index) => byte !== fresh[index])) { await subscription.unsubscribe(); subscription = null; }
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api("/web-push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
  return "enabled";
}

// Desliga neste browser. Ao terminar sessão, o token já saiu do browser e vem em headers.
export async function disableWebPush({ headers = {} } = {}) {
  if (!supported()) return "unsupported";
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return "disabled";
  await api("/web-push/subscriptions", { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
  return "disabled";
}

// Ao abrir o site com sessão: se este browser já tinha os avisos ligados, volta a entregar a subscrição
// (pode ter mudado, ou a pessoa entrou com outra conta neste browser).
export async function refreshWebPush() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  await api("/web-push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
}
