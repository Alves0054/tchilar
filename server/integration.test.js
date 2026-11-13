// Testes de integração com PostgreSQL a sério: cria um schema temporário, corre todas as migrações,
// arranca a API real contra ele e apaga tudo no fim. Usa TEST_DATABASE_URL (ou DATABASE_URL).
// Sem base de dados configurada, os testes são saltados (os testes unitários continuam a correr).
require("dotenv").config({ quiet: true });
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const baseDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = baseDatabaseUrl ? false : "sem TEST_DATABASE_URL nem DATABASE_URL";
const schema = `it_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

let app, pool, adminPool, server, baseUrl, jwt, sharp;
const users = {};

before(async () => {
  if (skip) return;
  const { Pool } = require("pg");
  adminPool = new Pool({ connectionString: baseDatabaseUrl });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  // A API lê estas variáveis ao carregar: base de dados isolada, diretos em modo P2P (sem MediaMTX).
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET ||= "integration-only-secret-with-at-least-thirty-two-chars";
  process.env.PAYOUT_ENCRYPTION_KEY ||= "1".repeat(64);
  for (const key of ["MEDIA_API_URL", "MEDIA_HLS_URL", "MEDIA_HOOK_SECRET", "MEDIA_WHIP_URL", "MEDIA_RTMP_URL"]) process.env[key] = "";
  ({ app, pool } = require("./index"));
  await require("./migrate").runMigrations(pool);
  jwt = require("jsonwebtoken");
  sharp = require("sharp");
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  for (const name of ["ana", "bruno", "carla", "dino"]) {
    const row = (await pool.query(
      "INSERT INTO users(username,email,password_hash,display_name,email_verified,is_creator) VALUES($1,$2,'x',$3,TRUE,$4) RETURNING id,username",
      [name, `${name}@example.com`, name[0].toUpperCase() + name.slice(1), name === "carla"])).rows[0];
    users[name] = { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  }
});

after(async () => {
  if (skip) return;
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
  await adminPool.end();
});

const call = async (method, path, user, body) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const newPost = async (user, extra = {}) => {
  const result = await call("POST", "/posts", user, { body: "Olá Biva", ...extra });
  assert.ok(result.body.post?.id, `criar publicação: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.post;
};
const counters = async id => (await pool.query("SELECT like_count,comment_count,share_count,star_count FROM posts WHERE id=$1", [id])).rows[0];

test("post counters follow likes, comments and shares", { skip }, async () => {
  const post = await newPost(users.ana);
  assert.ok(post.id);
  assert.equal((await call("POST", `/posts/${post.id}/like`, users.bruno)).body.likes, 1);
  assert.equal((await call("POST", `/posts/${post.id}/like`, users.carla)).body.likes, 2);
  assert.equal((await call("POST", `/posts/${post.id}/like`, users.bruno)).body.likes, 1, "gostar outra vez retira o gosto");
  assert.equal((await call("POST", `/posts/${post.id}/comments`, users.bruno, { body: "Boa!" })).status, 201);
  assert.equal((await call("POST", `/posts/${post.id}/share`, users.dino, { profile: true })).status < 300, true);
  assert.deepEqual(await counters(post.id), { like_count: 1, comment_count: 1, share_count: 1, star_count: 0 });

  const feed = (await call("GET", "/posts", users.dino)).body.posts.find(item => item.id === post.id);
  assert.equal(Number(feed.likes), 1);
  assert.equal(Number(feed.comments), 1);
  assert.equal(Number(feed.shares), 1);

  // Apagar a partilha desconta na original; apagar o comentário também.
  const share = (await pool.query("SELECT id FROM posts WHERE shared_post_id=$1", [post.id])).rows[0];
  await pool.query("DELETE FROM posts WHERE id=$1", [share.id]);
  await pool.query("DELETE FROM comments WHERE post_id=$1", [post.id]);
  assert.deepEqual(await counters(post.id), { like_count: 1, comment_count: 0, share_count: 0, star_count: 0 });
});

test("stars received on a post are counted", { skip }, async () => {
  const post = await newPost(users.carla);
  await pool.query("INSERT INTO star_ledger(user_id,amount,kind,post_id) VALUES($1,5,'gift_received',$2),($1,3,'gift_received',$2),($1,7,'purchase',NULL)",
    [users.carla.id, post.id]);
  assert.equal((await counters(post.id)).star_count, 8);
});

test("message and comment reach rules are enforced", { skip }, async () => {
  const { ana, bruno } = users;
  await call("PATCH", "/auth/me/preferences", ana, { messages: "nobody" });
  assert.equal((await call("POST", `/messages/${ana.id}`, bruno, { body: "olá" })).status, 403);
  await call("PATCH", "/auth/me/preferences", ana, { messages: "following" });
  assert.equal((await call("POST", `/messages/${ana.id}`, bruno, { body: "olá" })).status, 403);
  await call("POST", `/users/${bruno.id}/follow`, ana);
  assert.ok((await call("POST", `/messages/${ana.id}`, bruno, { body: "olá" })).status < 300);

  const post = await newPost(ana);
  await call("PATCH", "/auth/me/preferences", ana, { comments: "nobody" });
  assert.equal((await call("POST", `/posts/${post.id}/comments`, bruno, { body: "x" })).status, 403);
  assert.ok((await call("POST", `/posts/${post.id}/comments`, ana, { body: "a autora comenta sempre" })).status < 300);
  await call("PATCH", "/auth/me/preferences", ana, { comments: "everyone", messages: "everyone" });
});

test("notification categories switched off are not stored", { skip }, async () => {
  const { dino, carla } = users;
  await call("PATCH", "/auth/me/preferences", dino, { notify: { interactions: false } });
  const post = await newPost(dino);
  await call("POST", `/posts/${post.id}/like`, carla);
  await call("POST", `/users/${dino.id}/follow`, carla);
  const types = (await pool.query("SELECT type FROM notifications WHERE user_id=$1", [dino.id])).rows.map(row => row.type);
  assert.ok(!types.includes("like"));
  assert.ok(types.includes("follow"));
});

test("blocking hides posts and stops messages both ways", { skip }, async () => {
  const { carla, bruno } = users;
  const post = await newPost(carla);
  assert.ok((await call("POST", `/users/${bruno.id}/block`, carla)).status < 300);
  assert.equal((await call("POST", `/messages/${carla.id}`, bruno, { body: "olá" })).status, 403);
  assert.equal((await call("POST", `/messages/${bruno.id}`, carla, { body: "olá" })).status, 403);
  assert.equal((await call("POST", `/posts/${post.id}/like`, bruno)).status, 404);
  await call("DELETE", `/users/${bruno.id}/block`, carla);
  assert.equal((await call("POST", `/posts/${post.id}/like`, bruno)).status, 200);
});

test("exclusive posts are closed to people without a subscription", { skip }, async () => {
  const { carla, dino } = users;
  await pool.query("UPDATE users SET subscription_price=2500 WHERE id=$1", [carla.id]);
  const post = await newPost(carla, { isExclusive: true });
  assert.equal((await call("POST", `/posts/${post.id}/comments`, dino, { body: "x" })).status, 403);
  await pool.query(`INSERT INTO subscriptions(subscriber_id,creator_id,status,current_period_end,provider)
    VALUES($1,$2,'active',NOW() + INTERVAL '30 days','manual')`, [dino.id, carla.id]);
  assert.ok((await call("POST", `/posts/${post.id}/comments`, dino, { body: "agora sim" })).status < 300);
});

test("profile photos are optimised and fake images refused", { skip }, async () => {
  const send = async buffer => {
    const form = new FormData();
    form.append("image", new Blob([buffer], { type: "image/png" }), "foto.png");
    const response = await fetch(`${baseUrl}/auth/me/avatar`, { method: "POST", headers: { Authorization: `Bearer ${users.ana.token}` }, body: form });
    return response.status;
  };
  const png = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#0077B6" } }).png().toBuffer();
  assert.equal(await send(png), 200);
  const avatar = (await pool.query("SELECT avatar_url FROM users WHERE id=$1", [users.ana.id])).rows[0].avatar_url;
  const served = await fetch(baseUrl.replace(/\/api$/, "") + avatar);
  const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width <= 640);
  assert.equal(await send(Buffer.from("<html>não sou imagem</html>")), 400);
  await require("node:fs/promises").unlink(require("node:path").join(__dirname, "..", "uploads", require("node:path").basename(avatar))).catch(() => {});
});

test("live moderation: pin, mute and end", { skip }, async () => {
  const { carla: host, dino: fan } = users;
  const live = await call("POST", "/lives", host, { title: "Teste ao vivo", category: "musica" });
  assert.equal(live.status, 201);
  const sent = await call("POST", `/lives/${live.body.id}/comments`, fan, { body: "Boa noite!" });
  assert.ok(sent.status < 300);
  const commentId = (await pool.query("SELECT id FROM live_comments WHERE live_id=$1", [live.body.id])).rows[0].id;
  assert.equal((await call("POST", `/lives/${live.body.id}/pin`, fan, { commentId })).status, 403, "só quem emite ou modera fixa");
  assert.equal((await call("POST", `/lives/${live.body.id}/pin`, host, { commentId })).status, 200);
  assert.equal((await call("POST", `/lives/${live.body.id}/mute`, host, { username: fan.username, minutes: 5 })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 2100)); // modo lento do chat: 2 s entre mensagens
  const muted = await call("POST", `/lives/${live.body.id}/comments`, fan, { body: "ainda posso?" });
  assert.equal(muted.status, 403);
  assert.equal((await call("POST", `/lives/${live.body.id}/end`, host)).status, 200);
  assert.equal((await pool.query("SELECT status FROM lives WHERE id=$1", [live.body.id])).rows[0].status, "ended");
});

test("live list uses the count saved by the API copy that tracks that live", { skip }, async () => {
  const live = await call("POST", "/lives", users.ana, { title: "Contado noutra cópia", category: "conversa" });
  assert.equal(live.status, 201);
  // Nenhum espectador passou por esta cópia: o número vem da base de dados (gravado pela outra cópia).
  await pool.query("UPDATE lives SET current_viewers=42 WHERE id=$1", [live.body.id]);
  const listed = (await call("GET", "/lives", users.bruno)).body.lives.find(item => item.id === live.body.id);
  assert.equal(listed.viewers, 42);
  assert.equal("current_viewers" in listed, false);
  await call("POST", `/lives/${live.body.id}/end`, users.ana);
});
