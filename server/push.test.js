const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TOKEN_PATTERN, buildMessage, buildWebPayload, createPush, parseWebSubscription, pushPath, sitePath } = require("./push");

test("push opens the right screen in the app", () => {
  assert.equal(pushPath({ type: "message", actor_id: 7 }), "/chat/7");
  assert.equal(pushPath({ type: "payment" }), "/settings/pagamentos");
  assert.equal(pushPath({ type: "like", actor_username: "joana" }), "/u/joana");
  assert.equal(pushPath({ type: "like", actor_username: "joana", post_id: 12 }), "/post/12", "gosto numa publicação abre a publicação");
  assert.equal(pushPath({ type: "privacy", text: "Novo início de sessão: Chrome · Windows." }), "/settings/seguranca");
  assert.equal(pushPath({ type: "group_call", actor_username: "joana", group_id: 4 }), "/group/4", "chamada no grupo abre o grupo");
  assert.equal(pushPath({ type: "call", actor_username: "joana", call_id: 9 }), "/call/direct/9", "está a ligar-te abre a chamada");
  assert.equal(pushPath({ type: "system" }), "/notifications");
});

test("push message carries the actor, the text and never more than 180 characters", () => {
  const message = buildMessage({ id: 3, token: "ExponentPushToken[abcdefghijklmnop]", actor_name: "Joana", text: "x".repeat(300), type: "like", badge: 2 });
  assert.equal(message.title, "Joana");
  assert.equal(message.body.length, 180);
  assert.equal(message.badge, 2);
  assert.deepEqual(message.data, { url: "/notifications", notificationId: 3 });
  assert.equal(buildMessage({ token: "t", text: "Olá", type: "payment" }).title, "Tchilar");
});

test("only Expo push tokens are accepted", () => {
  assert.ok(TOKEN_PATTERN.test("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  assert.ok(TOKEN_PATTERN.test("ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]"));
  assert.equal(TOKEN_PATTERN.test("https://evil.example/hook"), false);
  assert.equal(TOKEN_PATTERN.test("ExponentPushToken[a b]"), false);
});

test("pending notifications are sent in batches and dead tokens are removed", async () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, user_id: 1, type: "like", text: "Gostou", token: `ExponentPushToken[token${String(index).padStart(10, "0")}]`, badge: 1 }));
  const queries = [];
  const pool = { query: async (sql, params) => { queries.push([sql, params]); return sql.includes("WITH claimed") ? { rows } : { rows: [] }; } };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const chunk = JSON.parse(options.body);
    calls.push(chunk.length);
    // O primeiro telemóvel desinstalou a app.
    return { ok: true, json: async () => ({ data: chunk.map(message => message.to === rows[0].token ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }) }) };
  };
  const push = createPush({ pool, fetchImpl, log: { error() {} } });
  assert.equal(await push.processPending(), 149);
  assert.deepEqual(calls, [100, 50], "no máximo 100 avisos por pedido ao Expo");
  const removal = queries.find(([sql]) => sql.startsWith("DELETE FROM push_tokens"));
  assert.deepEqual(removal[1], [[rows[0].token]]);
});

test("a failing push service does not break the loop", async () => {
  const pool = { query: async () => ({ rows: [{ id: 1, token: "ExponentPushToken[aaaaaaaaaaaaaaa]", text: "x", type: "like" }] }) };
  const push = createPush({ pool, fetchImpl: async () => { throw new Error("offline"); }, log: { error() {} } });
  assert.equal(await push.processPending(), 0);
});

test("browser push opens the right page on the site", () => {
  assert.equal(sitePath({ type: "message", actor_id: 7 }), "/messages/7");
  assert.equal(sitePath({ type: "like", actor_username: "joana", post_id: 12 }), "/posts/12");
  assert.equal(sitePath({ type: "call", call_id: 9 }), "/calls/9");
  assert.equal(sitePath({ type: "payout" }), "/creator/ganhos");
  assert.equal(sitePath({ type: "system" }), "/notifications");
  assert.deepEqual(JSON.parse(buildWebPayload({ id: 5, type: "like", actor_name: "Rui", text: "y".repeat(300), post_id: 3 })),
    { title: "Rui", body: "y".repeat(180), url: "/posts/3", tag: "n5" });
});

test("only real browser push services are accepted as subscriptions", () => {
  const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
  assert.ok(parseWebSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys }));
  assert.ok(parseWebSubscription({ endpoint: "https://web.push.apple.com/QK2", keys }));
  assert.ok(parseWebSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x", keys }));
  assert.equal(parseWebSubscription({ endpoint: "https://evil.example/hook", keys }), null, "nunca envia para um endereço qualquer");
  assert.equal(parseWebSubscription({ endpoint: "https://fcm.googleapis.com.evil.example/x", keys }), null);
  assert.equal(parseWebSubscription({ endpoint: "http://fcm.googleapis.com/x", keys }), null, "só https");
  assert.equal(parseWebSubscription({ endpoint: "https://fcm.googleapis.com:8443/x", keys }), null);
  assert.equal(parseWebSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "x", auth: "y" } }), null);
});

test("browsers get one notice per notification and cancelled browsers are removed", async () => {
  // A mesma notificação vem em duas linhas (a pessoa tem dois telemóveis); o browser só a recebe uma vez.
  const rows = [
    { id: 1, user_id: 1, type: "like", text: "Gostou", token: "ExponentPushToken[aaaaaaaaaaaaaaa]", badge: 1 },
    { id: 1, user_id: 1, type: "like", text: "Gostou", token: "ExponentPushToken[bbbbbbbbbbbbbbb]", badge: 1 },
    { id: 2, user_id: 2, type: "follow", text: "Começou a seguir-te", token: null, badge: 1 }
  ];
  const subs = [
    { endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a", user_id: 1 },
    { endpoint: "https://fcm.googleapis.com/gone", p256dh: "k", auth: "a", user_id: 2 }
  ];
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push([sql, params]);
    if (sql.includes("WITH claimed")) return { rows };
    if (sql.includes("FROM web_push_subscriptions w")) return { rows: subs };
    return { rows: [] };
  } };
  const sent = [];
  const webPush = { publicKey: "pk", send: async (subscription, payload) => {
    if (subscription.endpoint.endsWith("/gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    sent.push([subscription.endpoint, JSON.parse(payload).tag]);
  } };
  const fetchImpl = async (_url, options) => ({ ok: true, json: async () => ({ data: JSON.parse(options.body).map(() => ({ status: "ok" })) }) });
  const push = createPush({ pool, fetchImpl, webPush, log: { error() {} } });
  assert.equal(await push.processPending(), 3, "2 telemóveis + 1 browser");
  assert.deepEqual(sent, [["https://fcm.googleapis.com/a", "n1"]]);
  const removal = queries.find(([sql]) => sql.startsWith("DELETE FROM web_push_subscriptions"));
  assert.deepEqual(removal[1], [["https://fcm.googleapis.com/gone"]]);
  const subsQuery = queries.find(([sql]) => sql.includes("FROM web_push_subscriptions w"))[0];
  assert.match(subsQuery, /revoked_at IS NULL/, "sessão terminada = browser deixa de receber");
});
