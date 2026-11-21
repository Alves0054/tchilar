/* global self, URL */
// Service worker do Tchilar: mostra as notificações que chegam com o site fechado (web push).
// Não guarda páginas em cache: só trata dos avisos.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Só caminhos do próprio site (/posts/3, /messages/7...): um aviso nunca abre outro domínio.
const safePath = value => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/notifications";

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Tchilar", {
    body: data.body || "Tens uma notificação nova.",
    icon: "/tchilar-logo.png",
    badge: "/favicon.png",
    tag: data.tag,
    lang: "pt",
    data: { url: safePath(data.url) }
  }));
});

// Clicar no aviso: volta a uma janela do Tchilar já aberta (e leva-a à página certa) ou abre uma nova.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate ? open.navigate(target) : undefined;
    }
    return self.clients.openWindow(target);
  })());
});
