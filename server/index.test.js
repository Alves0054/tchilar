process.env.JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
process.env.STRIPE_SECRET_KEY = "sk_test_only_dummy_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_only_secret";
process.env.PAYOUT_ENCRYPTION_KEY = "0".repeat(64);
// Os testes nunca enviam emails a sério, mesmo que o .env tenha SMTP (o dotenv não substitui o que já existe).
process.env.SMTP_HOST = "";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { app, pool } = require("./index");

let server;
let baseUrl;
let postDeleteMock = null;
let queryMock = null;

before(async () => {
  const query = pool.query.bind(pool);
  pool.query = (sql, values) => {
    if (queryMock) {
      const mocked = queryMock(sql, values);
      if (mocked) return Promise.resolve(mocked);
    }
    if (sql === "SELECT auth_version,suspended_at,is_admin FROM users WHERE id=$1" && Number(values[0]) === 1) {
      return Promise.resolve({ rowCount: 1, rows: [{ auth_version: 0, suspended_at: null, is_admin: false }] });
    }
    if (sql === "DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id,media_url" && postDeleteMock) {
      return Promise.resolve(postDeleteMock(values));
    }
    return query(sql, values);
  };
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

test("health endpoint reports the API service", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "tchilar" });
});

test("CORS accepts the development loopback address", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://127.0.0.1:5173" }
  });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
});

test("protected endpoints reject requests without a token", async () => {
  const response = await fetch(`${baseUrl}/api/friends`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Autenticação necessária." });
});

test("registration validates input before accessing PostgreSQL", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "x", email: "not-an-email", password: "short", displayName: "" })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /username/i);
});

test("malformed JSON receives a client error", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid"
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "O corpo do pedido contém JSON inválido." });
});

test("unknown API routes return a JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Rota não encontrada." });
});

test("creating a post requires a body or media", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`${baseUrl}/api/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: "" })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Escreve uma publicação ou escolhe uma fotografia/vídeo." });
});

test("stories require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/stories`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Autenticação necessária." });
});

test("creating a story requires text or media", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`${baseUrl}/api/stories`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: " " })
  });
  assert.equal(response.status, 400, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "Escreve uma mensagem ou escolhe uma fotografia." });
});

test("invalid post filters are rejected before database access", async () => {
  const response = await fetch(`${baseUrl}/api/posts?groupId=not-a-number`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Filtro de publicações inválido." });
});

test("invalid media type filters are rejected before database access", async () => {
  const response = await fetch(`${baseUrl}/api/posts?mediaType=audio`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Filtro de publicações inválido." });
});

test("deleting a post requires authentication and a valid id", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/posts/1`, { method: "DELETE" });
  assert.equal(unauthenticated.status, 401);
  const invalidId = await fetch(`${baseUrl}/api/posts/not-a-number`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" }) }
  });
  assert.equal(invalidId.status, 400);
});

test("post deletion is scoped to the authenticated owner", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  postDeleteMock = values => {
    assert.deepEqual(values, [42, 1]);
    return { rowCount: 1, rows: [{ id: 42, media_url: "" }] };
  };
  try {
    const response = await fetch(`${baseUrl}/api/posts/42`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
  } finally {
    postDeleteMock = null;
  }
});

test("post deletion returns not found when the authenticated user is not the owner", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  postDeleteMock = () => ({ rowCount: 0, rows: [] });
  try {
    const response = await fetch(`${baseUrl}/api/posts/42`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token }
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Publicação não encontrada." });
  } finally {
    postDeleteMock = null;
  }
});

test("invalid message recipients are rejected before database access", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`${baseUrl}/api/messages/1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Destinatário inválido." });
});

test("uploads reject unsupported file formats", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const form = new FormData();
  form.append("body", "");
  form.append("media", new Blob(["<svg></svg>"], { type: "image/svg+xml" }), "image.svg");
  const response = await fetch(`${baseUrl}/api/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Formato de ficheiro não suportado." });
});

const Stripe = require("stripe");
const stripeForTests = new Stripe(process.env.STRIPE_SECRET_KEY);

function signedWebhook(event) {
  const payload = JSON.stringify(event);
  const header = stripeForTests.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET
  });
  return fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": header },
    body: payload
  });
}

test("stripe webhook rejects requests without a valid signature", async () => {
  const response = await fetch(`${baseUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=forged" },
    body: JSON.stringify({ type: "customer.subscription.updated" })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Assinatura do webhook inválida." });
});

test("stripe webhook ignores unrelated events", async () => {
  const response = await signedWebhook({ id: "evt_1", object: "event", type: "invoice.created", data: { object: {} } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
});

test("stripe subscription events store status and paid period", async () => {
  const writes = [];
  queryMock = (sql, values) => {
    if (sql.includes("INSERT INTO subscriptions")) {
      writes.push(values);
      return { rowCount: 1, rows: [] };
    }
    return null;
  };
  try {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const response = await signedWebhook({
      id: "evt_2",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          object: "subscription",
          status: "active",
          cancel_at_period_end: true,
          metadata: { subscriber_id: "7", creator_id: "9" },
          items: { data: [{ current_period_end: periodEnd }] }
        }
      }
    });
    assert.equal(response.status, 200);
    assert.equal(writes.length, 1);
    const [subscriberId, creatorId, status, currentPeriodEnd, canceling, providerId] = writes[0];
    assert.deepEqual([subscriberId, creatorId, status, canceling, providerId], [7, 9, "active", true, "sub_123"]);
    assert.equal(currentPeriodEnd.getTime(), periodEnd * 1000);
  } finally {
    queryMock = null;
  }
});

test("stripe events without Tchilar metadata are ignored", async () => {
  let wrote = false;
  queryMock = sql => {
    if (sql.includes("INSERT INTO subscriptions")) wrote = true;
    return null;
  };
  try {
    const response = await signedWebhook({
      id: "evt_3",
      object: "event",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_other", object: "subscription", status: "canceled", metadata: {} } }
    });
    assert.equal(response.status, 200);
    assert.equal(wrote, false);
  } finally {
    queryMock = null;
  }
});

test("users cannot subscribe to themselves", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`${baseUrl}/api/subscriptions/1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400);
});

test("subscription price updates are validated before database access", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  for (const subscriptionPrice of [0, -5, 4.99, 600000, 2500.999, "abc"]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionPrice })
    });
    assert.equal(response.status, 400, `price ${subscriptionPrice}`);
  }
});

const userToken = () => jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const authJson = body => ({
  headers: { Authorization: `Bearer ${userToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

test("password reset links are never returned outside explicit development mode", async () => {
  queryMock = sql => {
    if (sql.startsWith("SELECT id,email FROM users WHERE email=$1")) return { rowCount: 1, rows: [{ id: 7, email: "a@b.co" }] };
    if (sql.includes("auth_tokens")) return { rowCount: 1, rows: [] };
    return null;
  };
  try {
    const response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.co" })
    });
    const text = await response.text();
    assert.doesNotMatch(text, /reset-password\?token=|resetUrl/);
  } finally {
    queryMock = null;
  }
});

test("profile website must be an http(s) address", async () => {
  for (const website of ["javascript:alert(1)", "not a url", "ftp://exemplo.ao"]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, { method: "PATCH", ...authJson({ website }) });
    assert.equal(response.status, 400, website);
  }
});

test("feed rejects unknown scopes and requires login for the following feed", async () => {
  assert.equal((await fetch(`${baseUrl}/api/posts?feed=trending`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/posts?before=abc`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/posts?feed=following`)).status, 401);
});

test("reports are validated before touching the database", async () => {
  const badType = await fetch(`${baseUrl}/api/reports`, { method: "POST", ...authJson({ targetType: "group", targetId: 1, reason: "spam" }) });
  assert.equal(badType.status, 400);
  const badReason = await fetch(`${baseUrl}/api/reports`, { method: "POST", ...authJson({ targetType: "post", targetId: 1, reason: "boring" }) });
  assert.equal(badReason.status, 400);
});

test("moderation endpoints are only for admins", async () => {
  const response = await fetch(`${baseUrl}/api/admin/reports`, { headers: { Authorization: `Bearer ${userToken()}` } });
  assert.equal(response.status, 403);
});

test("unread message count is not swallowed by the conversation route", async () => {
  queryMock = (sql, values) => {
    if (sql.startsWith("SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id=$1 AND read_at IS NULL")) {
      assert.deepEqual(values, [1]);
      return { rowCount: 1, rows: [{ count: 3 }] };
    }
    return null;
  };
  try {
    const response = await fetch(`${baseUrl}/api/messages/unread-count`, { headers: { Authorization: `Bearer ${userToken()}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { unread: 3 });
  } finally {
    queryMock = null;
  }
});

test("deleting the account requires the password", async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`, { method: "DELETE", ...authJson({}) });
  assert.equal(response.status, 400);
});

test("users cannot block themselves", async () => {
  const response = await fetch(`${baseUrl}/api/users/1/block`, { method: "POST", headers: { Authorization: `Bearer ${userToken()}` } });
  assert.equal(response.status, 400);
});

test("sharing requires a destination and at most five groups", async () => {
  const cases = [
    [{ body: "olá" }, /Escolhe onde/],
    [{ profile: false, groupIds: [] }, /Escolhe onde/],
    [{ groupIds: [1, 2, 3, 4, 5, 6] }, /até 5 grupos/],
    [{ profile: true, groupIds: ["abc"] }, /Destino inválido/],
    [{ profile: true, body: "x".repeat(5001) }, /5000/]
  ];
  for (const [payload, message] of cases) {
    const response = await fetch(`${baseUrl}/api/posts/1/share`, { method: "POST", ...authJson(payload) });
    assert.equal(response.status, 400, JSON.stringify(payload).slice(0, 60));
    assert.match((await response.json()).error, message);
  }
});

test("creator endpoints and ad management require a session", async () => {
  for (const [method, url] of [["GET", "/api/creator/overview"], ["GET", "/api/creator/content"], ["GET", "/api/creator/monetization"], ["GET", "/api/ads/mine"], ["POST", "/api/ads"], ["POST", "/api/posts/views"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});

test("ad status changes only accept active or paused", async () => {
  const response = await fetch(`${baseUrl}/api/ads/1`, { method: "PATCH", ...authJson({ status: "ended" }) });
  assert.equal(response.status, 400);
});

test("partner programme and promotion payments require a session", async () => {
  for (const [method, url] of [["GET", "/api/creator/partner"], ["POST", "/api/creator/partner/join"], ["POST", "/api/ads/1/impression"], ["POST", "/api/ads/1/checkout"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});

test("verification status and checkout require a session", async () => {
  for (const [method, url] of [["GET", "/api/creator/verification"], ["POST", "/api/creator/verification/checkout"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});

test("stars, invites, campaigns and audience require a session", async () => {
  for (const [method, url] of [["GET", "/api/stars"], ["POST", "/api/stars/purchase"], ["POST", "/api/posts/1/stars"], ["GET", "/api/referrals"],
    ["GET", "/api/campaigns"], ["POST", "/api/campaigns"], ["PATCH", "/api/auth/me/audience"], ["POST", "/api/challenges/1/entries"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});

test("star gifts, packs, campaigns and audience data are validated before database access", async () => {
  const cases = [
    ["/api/posts/1/stars", "POST", { amount: 7 }, /estrelas inválida/],
    ["/api/stars/purchase", "POST", { pack: 99 }, /Pacote/],
    ["/api/campaigns", "POST", { creatorId: 1, title: "x", brief: "y", budget: 5000 }, /Criador inválido/],
    ["/api/campaigns", "POST", { creatorId: 2, title: "Campanha", brief: "Brief", budget: 100 }, /orçamento/],
    ["/api/auth/me/audience", "PATCH", { province: "Lisboa" }, /Província/],
    ["/api/auth/me/audience", "PATCH", { province: "Luanda", birthDate: "2020-01-01" }, /13 anos/]
  ];
  for (const [url, method, payload, message] of cases) {
    const response = await fetch(`${baseUrl}${url}`, { method, ...authJson(payload) });
    assert.equal(response.status, 400, `${method} ${url}`);
    assert.match((await response.json()).error, message);
  }
});

test("only admins can create or close challenges", async () => {
  for (const url of ["/api/challenges", "/api/challenges/1/close"]) {
    const response = await fetch(`${baseUrl}${url}`, { method: "POST", ...authJson({ title: "Desafio", days: 7 }) });
    assert.equal(response.status, 403, url);
  }
});

test("the province list has the 21 Angolan provinces", async () => {
  const response = await fetch(`${baseUrl}/api/provinces`);
  assert.equal((await response.json()).provinces.length, 21);
});

test("payouts require a session and validate the Angolan IBAN", async () => {
  for (const [method, url] of [["GET", "/api/payouts"], ["PUT", "/api/payouts/account"], ["POST", "/api/payouts/requests"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
  for (const payload of [{ holderName: "Rita", bankName: "BAI", iban: "PT50000000000000000000000" }, { holderName: "Rita", bankName: "BAI", iban: "AO06123" }, { holderName: "", bankName: "BAI", iban: "x" }]) {
    const response = await fetch(`${baseUrl}/api/payouts/account`, { method: "PUT", ...authJson(payload) });
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
});

test("promotion review, payouts admin and finance are admin-only", async () => {
  for (const [method, url] of [["GET", "/api/admin/ads"], ["POST", "/api/admin/ads/1/approve"], ["POST", "/api/admin/ads/1/reject"],
    ["GET", "/api/admin/payouts"], ["POST", "/api/admin/payouts/1/paid"], ["GET", "/api/admin/finance"]]) {
    const options = method === "GET" ? { headers: { Authorization: `Bearer ${userToken()}` } } : authJson({});
    const response = await fetch(`${baseUrl}${url}`, { method, ...options });
    assert.equal(response.status, 403, `${method} ${url}`);
  }
});

test("lives: starting, chatting, gifting and signalling require a session", async () => {
  for (const [method, url] of [["POST", "/api/lives"], ["POST", "/api/lives/1/heartbeat"], ["POST", "/api/lives/1/comments"],
    ["POST", "/api/lives/1/stars"], ["POST", "/api/lives/1/signals"], ["GET", "/api/lives/1/signals"], ["POST", "/api/lives/1/end"]]) {
    const response = await fetch(`${baseUrl}${url}`, { method });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});

test("lives validate title, gift amount and signal shape before database access", async () => {
  const cases = [
    ["/api/lives", { title: "" }, /título/],
    ["/api/lives", { title: "x".repeat(121) }, /título/],
    ["/api/lives/1/stars", { amount: 7 }, /estrelas inválida/],
    ["/api/lives/1/signals", { to: 2, kind: "hack", payload: "" }, /Sinal inválido/],
    ["/api/lives/1/signals", { to: 2, kind: "offer", payload: "x".repeat(20001) }, /Sinal inválido/]
  ];
  for (const [url, payload, message] of cases) {
    const response = await fetch(`${baseUrl}${url}`, { method: "POST", ...authJson(payload) });
    assert.equal(response.status, 400, url);
    assert.match((await response.json()).error, message);
  }
});

test("live config exposes STUN servers and the video viewer limit", async () => {
  const response = await fetch(`${baseUrl}/api/lives/config`);
  const body = await response.json();
  assert.ok(body.iceServers.some(server => String(server.urls).startsWith("stun:")));
  assert.equal(body.maxVideoViewers, 8);
});

test("security headers are sent on every response", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const csp = response.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(self\)/);
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("new passwords need at least 8 characters and cannot be trivial", async () => {
  for (const password of ["abc1234", "12345678", "aaaaaaaaaa"]) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "valid_name", email: "ok@example.com", password, displayName: "Ok" })
    });
    assert.equal(response.status, 400, password);
    assert.match((await response.json()).error, /palavra-passe/i);
  }
});

test("account security endpoints require a session", async () => {
  for (const [method, path] of [["POST", "/api/auth/logout-all"], ["POST", "/api/auth/password"], ["GET", "/api/auth/2fa"], ["POST", "/api/auth/2fa/setup"]]) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.status, 401, path);
  }
});

test("changing the password validates the new password before checking the old one", async () => {
  const token = jwt.sign({ id: 1, username: "ana", version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const response = await fetch(`${baseUrl}/api/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: "whatever", newPassword: "short" })
  });
  assert.equal(response.status, 400);
});

test("TURN config hides IPs with relay-only and short-lived credentials", () => {
  const { turnServer } = require("./live-routes");
  const crypto = require("crypto");
  assert.deepEqual(turnServer(7, {}).iceTransportPolicy, "all");
  const now = 1_700_000_000_000;
  const config = turnServer(7, { LIVE_TURN_URL: "turn:turn.example.com:3478, turns:turn.example.com:5349", LIVE_TURN_SECRET: "s3cret" }, now);
  assert.equal(config.iceTransportPolicy, "relay");
  assert.equal(config.iceServers.length, 1);
  const [server] = config.iceServers;
  assert.deepEqual(server.urls, ["turn:turn.example.com:3478", "turns:turn.example.com:5349"]);
  assert.equal(server.username, `${1_700_000_000 + 12 * 3600}:7`);
  assert.equal(server.credential, crypto.createHmac("sha1", "s3cret").update(server.username).digest("base64"));
  const open = turnServer(7, { LIVE_TURN_URL: "turn:t.example.com", LIVE_TURN_RELAY_ONLY: "false" }, now);
  assert.equal(open.iceTransportPolicy, "all");
  assert.equal(open.iceServers.length, 2);
});

test("tokens signed with another algorithm are refused", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { algorithm: "HS512" });
  const response = await fetch(`${baseUrl}/api/friends`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 401);
});

test("registration refuses a display name over 100 characters", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "nome_longo", email: "nome@example.com", password: "uma-palavra-boa", displayName: "a".repeat(101) })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /100 caracteres/);
});

test("internal errors return a reference and log the stack without the query string", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  queryMock = sql => (sql.includes("email_verified") && sql.includes("FROM users WHERE id=$1") ? Promise.reject(new Error("base de dados em baixo")) : null);
  const logged = [];
  const original = console.error;
  console.error = message => logged.push(message);
  try {
    const response = await fetch(`${baseUrl}/api/auth/me?access=segredo`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.match(body.reference, /^[0-9a-f]{8}$/);
    assert.ok(body.error.includes(body.reference));
    const entry = JSON.parse(logged.find(line => typeof line === "string" && line.includes(body.reference)));
    assert.equal(entry.path, "/api/auth/me");
    assert.equal(entry.userId, 1);
    assert.match(entry.stack, /base de dados em baixo/);
    assert.ok(!JSON.stringify(entry).includes("segredo"));
  } finally {
    console.error = original;
    queryMock = null;
  }
});

test("browser error reports are logged with their reference and validated", async () => {
  const logged = [];
  const original = console.error;
  console.error = message => logged.push(message);
  try {
    const ok = await fetch(`${baseUrl}/api/client-errors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: "ab12cd34", context: "render", message: "x is undefined", stack: "at Feed", path: "/live?access=segredo" })
    });
    assert.equal(ok.status, 204);
    const entry = JSON.parse(logged.find(line => typeof line === "string" && line.includes("ab12cd34")));
    assert.equal(entry.kind, "client");
    assert.equal(entry.path, "/live");
    const bad = await fetch(`${baseUrl}/api/client-errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: "<script>" }) });
    assert.equal(bad.status, 400);
  } finally {
    console.error = original;
  }
});
