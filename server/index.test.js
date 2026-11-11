process.env.JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
process.env.STRIPE_SECRET_KEY = "sk_test_only_dummy_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_only_secret";

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
    if (sql === "SELECT auth_version FROM users WHERE id=$1" && Number(values[0]) === 1) {
      return Promise.resolve({ rowCount: 1, rows: [{ auth_version: 0 }] });
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
  assert.deepEqual(await response.json(), { ok: true, service: "creator-social" });
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
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
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
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
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
    headers: { Authorization: "Bearer " + jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET) }
  });
  assert.equal(invalidId.status, 400);
});

test("post deletion is scoped to the authenticated owner", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
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
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
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
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
  const response = await fetch(`${baseUrl}/api/messages/1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Destinatário inválido." });
});

test("uploads reject unsupported file formats", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
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

test("stripe events without NOVA+ metadata are ignored", async () => {
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
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
  const response = await fetch(`${baseUrl}/api/subscriptions/1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 400);
});

test("subscription price updates are validated before database access", async () => {
  const token = jwt.sign({ id: 1, username: "tester" }, process.env.JWT_SECRET);
  for (const subscriptionPrice of [0, -5, 1500, 4.999, "abc"]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionPrice })
    });
    assert.equal(response.status, 400, `price ${subscriptionPrice}`);
  }
});
