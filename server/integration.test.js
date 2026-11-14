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

let app, payments, pool, adminPool, server, baseUrl, jwt, sharp;
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
  // Os testes nunca enviam emails a sério, mesmo que o .env tenha SMTP configurado.
  process.env.SMTP_HOST = "";
  for (const key of ["MEDIA_API_URL", "MEDIA_HLS_URL", "MEDIA_HOOK_SECRET", "MEDIA_WHIP_URL", "MEDIA_RTMP_URL"]) process.env[key] = "";
  ({ app, payments, pool } = require("./index"));
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
  const result = await call("POST", "/posts", user, { body: "Olá Tchilar", ...extra });
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

// ---------------------------------------------------------------------------------------------
// Grupos secretos: +18, entrada paga, só se encontram pelo nome exato
// ---------------------------------------------------------------------------------------------
const setBirth = (user, date) => pool.query("UPDATE users SET birth_date=$2 WHERE id=$1", [user.id, date]);
const yearsAgo = years => { const d = new Date(); d.setFullYear(d.getFullYear() - years); return d.toISOString().slice(0, 10); };

test("secret groups: adults only, hidden from the list, paid entry by exact name", { skip }, async () => {
  await setBirth(users.ana, yearsAgo(30));
  await setBirth(users.bruno, yearsAgo(25));
  await setBirth(users.carla, yearsAgo(16));
  await setBirth(users.dino, null);

  // Criar: menores e pessoas sem data de nascimento não podem; o preço é obrigatório.
  const body = { name: "Clube Noturno Luanda", description: "Só convidados", isSecret: true, accessPrice: 2500 };
  assert.equal((await call("POST", "/groups", users.carla, body)).status, 403);
  assert.equal((await call("POST", "/groups", users.dino, body)).status, 403);
  assert.equal((await call("POST", "/groups", users.ana, { ...body, accessPrice: 10 })).status, 400);
  const created = await call("POST", "/groups", users.ana, body);
  assert.equal(created.status, 201);
  const id = created.body.group.id;

  // Não aparece na lista para quem não é membro; aparece para o dono.
  assert.ok(!(await call("GET", "/groups", users.bruno)).body.groups.some(g => g.id === id));
  assert.ok(!(await call("GET", "/groups")).body.groups.some(g => g.id === id), "nem para visitantes");
  assert.ok((await call("GET", "/groups", users.ana)).body.groups.some(g => g.id === id));

  // Procura: só o nome exato (sem contar maiúsculas) e só para maiores de 18.
  const search = async (user, name) => (await call("GET", `/groups/secret?name=${encodeURIComponent(name)}`, user)).body.groups.map(g => g.id);
  assert.deepEqual(await search(users.bruno, "clube noturno luanda"), [id]);
  assert.deepEqual(await search(users.bruno, "Clube Noturno"), [], "parte do nome não chega");
  assert.deepEqual(await search(users.carla, "Clube Noturno Luanda"), [], "menor não encontra");
  assert.deepEqual(await search(users.dino, "Clube Noturno Luanda"), [], "sem data de nascimento não encontra");

  // Não se entra de graça, nem sem saber o nome, nem sendo menor.
  assert.equal((await call("POST", `/groups/${id}/join`, users.bruno)).status, 404);
  assert.equal((await call("POST", `/groups/${id}/access`, users.bruno, { name: "outro nome" })).status, 404);
  assert.equal((await call("POST", `/groups/${id}/access`, users.carla, { name: body.name })).status, 404);

  // Pagamento: fica pendente até ser confirmado; depois a pessoa é membro e o dono ganha 70%.
  await call("POST", `/groups/${id}/access`, users.bruno, { name: body.name });
  const purchase = (await pool.query("SELECT id,status,amount_kz::float AS amount FROM group_access_purchases WHERE group_id=$1 AND user_id=$2", [id, users.bruno.id])).rows[0];
  assert.deepEqual([purchase.status, purchase.amount], ["pending", 2500]);
  assert.equal((await call("GET", `/posts?groupId=${id}`, users.bruno)).status, 403, "sem pagamento confirmado não vê");
  await payments.fulfill("group_access", purchase.id, {});
  await payments.fulfill("group_access", purchase.id, {}); // confirmação repetida não duplica nada
  assert.equal((await call("GET", `/posts?groupId=${id}`, users.bruno)).status, 200);
  assert.ok((await call("GET", "/groups", users.bruno)).body.groups.some(g => g.id === id && g.is_member));
  assert.equal((await call("POST", `/groups/${id}/access`, users.bruno, { name: body.name })).status, 409, "já é membro");
  const earnings = await call("GET", "/payouts", users.ana);
  assert.equal(earnings.status, 200);
  assert.equal(earnings.body.sources.groupsKz, 1750);
});

test("private groups: the owner approves or declines who joins", { skip }, async () => {
  assert.equal((await call("POST", "/groups", users.ana, { name: "Tema inválido", topic: "nada" })).status, 400);
  const created = await call("POST", "/groups", users.ana, { name: "Vendas no Bairro", privacy: "private", topic: "compra-venda" });
  assert.equal(created.status, 201);
  const id = created.body.group.id;
  const listed = async user => (await call("GET", "/groups", user)).body.groups.find(g => g.id === id);
  assert.deepEqual([(await listed(users.bruno)).topic, (await listed(users.bruno)).requires_approval], ["compra-venda", true], "aparece na lista");

  // Pedir entrada não torna ninguém membro; o dono vê o pedido.
  assert.equal((await call("POST", `/groups/${id}/join`, users.bruno)).status, 202);
  assert.equal((await call("POST", `/groups/${id}/join`, users.carla)).status, 202);
  assert.deepEqual([(await listed(users.bruno)).is_member, (await listed(users.bruno)).has_requested], [false, true]);
  assert.equal((await call("GET", `/posts?groupId=${id}`, users.bruno)).status, 403, "à espera não vê as publicações");
  assert.equal((await listed(users.ana)).pending_requests, 2);
  assert.equal((await call("GET", `/groups/${id}/requests`, users.bruno)).status, 404, "só o dono vê os pedidos");
  const requests = (await call("GET", `/groups/${id}/requests`, users.ana)).body.requests.map(r => r.username);
  assert.deepEqual(requests.sort(), [users.bruno.username, users.carla.username].sort());

  // Aprovar torna membro; recusar apaga o pedido; decidir duas vezes não dá.
  assert.equal((await call("POST", `/groups/${id}/requests/${users.bruno.id}`, users.carla, { approve: true })).status, 404);
  assert.equal((await call("POST", `/groups/${id}/requests/${users.bruno.id}`, users.ana, { approve: true })).status, 200);
  assert.equal((await call("POST", `/groups/${id}/requests/${users.carla.id}`, users.ana, { approve: false })).status, 200);
  assert.equal((await call("POST", `/groups/${id}/requests/${users.carla.id}`, users.ana, { approve: true })).status, 404);
  assert.equal((await call("GET", `/posts?groupId=${id}`, users.bruno)).status, 200);
  assert.deepEqual([(await listed(users.carla)).is_member, (await listed(users.carla)).has_requested], [false, false]);
});

test("pages need a type and a category that belongs to it", { skip }, async () => {
  assert.equal((await call("POST", "/pages", users.ana, { name: "Errada", pageType: "figura", category: "restaurante" })).status, 400);
  const created = await call("POST", "/pages", users.ana, { name: "Café da Ilha", pageType: "negocio", category: "restaurante" });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.page.page_type, created.body.page.category], ["negocio", "restaurante"]);
  const plain = await call("POST", "/pages", users.ana, { name: "Sem tipo" });
  assert.deepEqual([plain.body.page.page_type, plain.body.page.category], ["comunidade", "comunidade"]);
});

test("home screen: what is happening, what to discover, who to talk to", { skip }, async () => {
  // Pessoas só deste teste, para não herdar amizades ou bloqueios dos outros.
  const people = {};
  for (const name of ["eva", "filipe", "gil", "hugo"]) {
    const row = (await pool.query(
      "INSERT INTO users(username,email,password_hash,display_name,email_verified,province) VALUES($1,$2,'x',$3,TRUE,$4) RETURNING id,username",
      [name, `${name}@example.com`, name, name === "hugo" ? "Benguela" : "Luanda"])).rows[0];
    people[name] = { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  }
  const { eva, filipe, gil, hugo } = people;
  const befriend = (a, b) => pool.query("INSERT INTO friendships(user_a_id,user_b_id) VALUES($1,$2)", [Math.min(a.id, b.id), Math.max(a.id, b.id)]);
  await befriend(eva, filipe);
  await befriend(filipe, gil);
  const home = async user => (await call("GET", "/home", user)).body;

  // Com quem posso interagir: o amigo de um amigo aparece primeiro, com o número de amigos em comum.
  const suggested = (await home(eva)).discover.people;
  assert.equal(suggested[0].username, "gil");
  assert.equal(suggested[0].mutual_count, 1);
  assert.ok(!suggested.some(person => person.username === "filipe"), "quem já é amigo não é sugerido");

  // Online: só amigos que usaram a app há pouco e não esconderam a atividade.
  await call("GET", "/home", filipe);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual((await home(eva)).now.online.map(person => person.username), ["filipe"]);
  assert.equal((await call("GET", "/friends", eva)).body.friends.find(f => f.username === "filipe").online, true);
  await call("PATCH", "/auth/me/preferences", filipe, { showActivity: false });
  assert.deepEqual((await home(eva)).now.online, [], "escondeu a atividade");

  // Descobrir: o grupo onde está um amigo vem antes; depois de entrar deixa de ser sugerido.
  const quiet = (await call("POST", "/groups", hugo, { name: "Grupo calmo", topic: "viagens" })).body.group;
  const busy = (await call("POST", "/groups", gil, { name: "Grupo do Gil", topic: "desporto" })).body.group;
  await call("POST", `/groups/${busy.id}/join`, filipe);
  const groups = (await home(eva)).discover.groups.map(group => group.id);
  assert.ok(groups.indexOf(busy.id) < groups.indexOf(quiet.id), "o grupo com amigos vem primeiro");
  await call("POST", `/groups/${busy.id}/join`, eva);
  assert.ok(!(await home(eva)).discover.groups.some(group => group.id === busy.id));

  // O que está a acontecer: conversa nova num grupo teu e eventos de hoje.
  await newPost(gil, { groupId: busy.id });
  const active = (await home(eva)).now.groups.find(group => group.id === busy.id);
  assert.equal(active.new_posts, 1);
  assert.equal((await home(eva)).now.groups.length, 1, "as tuas próprias publicações não contam");
  await pool.query("INSERT INTO events(creator_id,name,starts_at) VALUES($1,'Hoje',NOW() + INTERVAL '1 minute'),($1,'Daqui a uma semana',NOW() + INTERVAL '7 days')", [hugo.id]);
  assert.deepEqual((await home(eva)).now.events.map(event => event.name), ["Hoje"]);
});

test("birth date is required at sign-up and cannot be changed afterwards", { skip }, async () => {
  const register = extra => call("POST", "/auth/register", null, {
    username: `novo_${Date.now()}`, email: `novo${Date.now()}@example.com`, password: "uma frase bem comprida", displayName: "Novo", ...extra });
  assert.match((await register({})).body.error, /data de nascimento/i);
  assert.equal((await register({ birthDate: yearsAgo(10) })).status, 400, "menos de 13 anos");

  await setBirth(users.dino, null);
  assert.equal((await call("PATCH", "/auth/me/audience", users.dino, { birthDate: yearsAgo(20) })).status, 200, "indicar pela primeira vez");
  assert.equal((await call("PATCH", "/auth/me/audience", users.dino, { birthDate: yearsAgo(40) })).status, 409, "não pode mudar");
  assert.equal((await call("PATCH", "/auth/me/audience", users.dino, { birthDate: null, province: "Luanda" })).status, 200);
  const saved = (await pool.query("SELECT to_char(birth_date,'YYYY-MM-DD') AS d FROM users WHERE id=$1", [users.dino.id])).rows[0].d;
  assert.equal(saved, yearsAgo(20), "apagar também não muda a data");
});

test("payments: each person sees their receipts and the team sees, filters and exports them all", { skip }, async () => {
  const stars = (await pool.query(
    "INSERT INTO star_purchases(user_id,stars,amount_kz,status,paid_at) VALUES($1,100,1500,'paid',NOW()) RETURNING id", [users.ana.id])).rows[0].id;
  await pool.query("INSERT INTO star_purchases(user_id,stars,amount_kz,status) VALUES($1,50,800,'pending')", [users.ana.id]);
  await pool.query(`INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,status,provider_ref,entity,paid_at)
    VALUES('stars',$1,$2,'reference',1500,'paid','987654321','11333',NOW())`, [stars, users.ana.id]);

  const mine = await call("GET", "/payments", users.ana);
  assert.equal(mine.status, 200);
  const paid = mine.body.payments.find(item => item.kind === "stars" && item.id === stars);
  assert.ok(paid, "the paid purchase is listed");
  assert.equal(mine.body.payments.filter(item => item.kind === "stars").length, 1, "pending purchases are not payments");
  assert.equal(paid.method, "reference");
  assert.equal(paid.reference, "987654321");
  assert.match(paid.receipt, /^BV-\d{4}-E\d{6}$/);
  assert.equal(paid.customer.email, undefined);

  const receipt = await call("GET", `/payments/stars/${stars}/receipt`, users.ana);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.payment.amount, 1500);
  assert.equal((await call("GET", `/payments/stars/${stars}/receipt`, users.dino)).status, 404, "nobody else sees the receipt");
  assert.equal((await call("GET", "/payments/bitcoin/1/receipt", users.ana)).status, 400);

  // A equipa só entra com dois passos ativos.
  await pool.query("UPDATE users SET is_admin=TRUE WHERE id=$1", [users.bruno.id]);
  assert.equal((await call("GET", "/admin/payments", users.bruno)).status, 403);
  assert.equal((await call("GET", "/admin/payments", users.ana)).status, 403);
  await pool.query("UPDATE users SET totp_enabled_at=NOW() WHERE id=$1", [users.bruno.id]);

  const all = await call("GET", "/admin/payments?kind=stars&method=reference", users.bruno);
  assert.equal(all.status, 200);
  assert.ok(all.body.payments.some(item => item.id === stars));
  assert.ok(all.body.payments.every(item => item.kind === "stars" && item.method === "reference"));
  assert.ok(all.body.totals.received >= 1500);
  const found = await call("GET", `/admin/payments?q=${encodeURIComponent(paid.receipt)}`, users.bruno);
  assert.deepEqual(found.body.payments.map(item => item.id), [stars]);
  assert.equal(found.body.payments[0].customer.email, "ana@example.com");
  assert.equal((await call("GET", "/admin/payments?q=ninguem-com-este-nome", users.bruno)).body.totals.count, 0);
  assert.equal((await call("GET", `/admin/payments/stars/${stars}`, users.bruno)).body.payment.provider_ref, "987654321");

  const csv = await fetch(`${baseUrl}/admin/payments.csv?kind=stars`, { headers: { Authorization: `Bearer ${users.bruno.token}` } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const text = await csv.text();
  assert.ok(text.includes(paid.receipt));
  assert.ok(text.includes("ana@example.com"));
  await pool.query("UPDATE users SET is_admin=FALSE, totp_enabled_at=NULL WHERE id=$1", [users.bruno.id]);
});

test("admin panel: overview, people, manual refunds and the log of what the team did", { skip }, async () => {
  await pool.query("UPDATE users SET is_admin=TRUE, totp_enabled_at=NOW() WHERE id=$1", [users.bruno.id]);
  const target = (await pool.query(
    "INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES('ivo','ivo@example.com','x','Ivo',FALSE) RETURNING id")).rows[0].id;
  const ivo = { id: target, token: jwt.sign({ id: target, username: "ivo", version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };

  const overview = await call("GET", "/admin/overview", users.bruno);
  assert.equal(overview.status, 200);
  assert.equal(overview.body.daily.length, 30, "one row per day, zeros included");
  const home = await call("GET", "/home", users.ana);
  assert.ok(home.body.discover.people.every(person => !("same_province" in person)), "the province is only used for ordering");
  assert.ok(overview.body.people.total >= 5);
  assert.ok(overview.body.people.unverified >= 1);
  assert.equal((await call("GET", "/admin/overview", users.ana)).status, 403);

  const search = await call("GET", "/admin/users?q=@ivo", users.bruno);
  assert.deepEqual(search.body.users.map(user => user.username), ["ivo"]);
  assert.ok((await call("GET", "/admin/users?filter=unverified", users.bruno)).body.users.some(user => user.id === target));

  assert.equal((await call("POST", `/admin/users/${target}/verify-email`, users.bruno)).status, 200);
  assert.equal((await call("POST", `/admin/users/${target}/verify-email`, users.bruno)).status, 409);

  assert.equal((await call("POST", `/admin/users/${target}/suspend`, users.bruno, {})).status, 400, "a reason is required");
  assert.equal((await call("POST", `/admin/users/${users.bruno.id}/suspend`, users.bruno, { reason: "x" })).status, 400);
  assert.equal((await call("POST", `/admin/users/${target}/suspend`, users.bruno, { reason: "Burla nas vendas" })).status, 200);
  assert.equal((await call("GET", "/auth/me", ivo)).status, 401, "the suspended account loses its sessions");
  const card = await call("GET", `/admin/users/${target}`, users.bruno);
  assert.equal(card.body.user.suspended_reason, "Burla nas vendas");
  assert.equal(card.body.user.email_verified, true);
  assert.deepEqual(card.body.actions.map(item => item.action), ["user_suspend", "user_verify_email"]);
  assert.equal((await call("POST", `/admin/users/${target}/unsuspend`, users.bruno, {})).status, 200);
  assert.equal((await call("POST", `/admin/users/${target}/unsuspend`, users.bruno, {})).status, 409);

  // Promoção recusada e paga por Referência: a equipa devolve à mão e confirma aqui.
  const ad = (await pool.query(`INSERT INTO ads(owner_id,title,budget,status,ends_at,paid_at,refund_status)
    VALUES($1,'Loja da Ana',5000,'rejected',NOW(),NOW(),'manual') RETURNING id`, [users.ana.id])).rows[0].id;
  const due = await call("GET", "/admin/payments?status=refund_due", users.bruno);
  assert.ok(due.body.payments.some(item => item.kind === "ad" && item.id === ad));
  assert.equal((await call("POST", `/admin/payments/ad/${ad}/refunded`, users.bruno, {})).status, 400);
  assert.equal((await call("POST", `/admin/payments/ad/${ad}/refunded`, users.bruno, { note: "Transferência 123" })).status, 200);
  assert.equal((await call("POST", `/admin/payments/ad/${ad}/refunded`, users.bruno, { note: "outra vez" })).status, 409);
  assert.equal((await call("GET", `/admin/payments/ad/${ad}`, users.bruno)).body.payment.status, "refunded");

  const log = await call("GET", "/admin/actions", users.bruno);
  assert.deepEqual(log.body.actions.slice(0, 4).map(item => item.action), ["refund_done", "user_unsuspend", "user_suspend", "user_verify_email"]);
  assert.equal(log.body.actions[0].admin.username, "bruno");
  assert.equal(log.body.actions[2].target_user.username, "ivo");
  assert.ok((await call("GET", "/admin/actions?action=refund_done", users.bruno)).body.actions.every(item => item.action === "refund_done"));
  await pool.query("UPDATE users SET is_admin=FALSE, totp_enabled_at=NULL WHERE id=$1", [users.bruno.id]);
});

test("team roles: finance sees money, moderation sees content, only super manages the team", { skip }, async () => {
  await pool.query("UPDATE users SET is_admin=TRUE, admin_role='super', totp_enabled_at=NOW() WHERE id=$1", [users.bruno.id]);
  await pool.query("UPDATE users SET is_admin=TRUE, admin_role='finance', totp_enabled_at=NOW() WHERE id=$1", [users.carla.id]);
  assert.equal((await call("GET", "/admin/payments", users.carla)).status, 200);
  assert.equal((await call("GET", "/admin/content", users.carla)).status, 403);
  assert.equal((await call("GET", "/admin/actions", users.carla)).status, 403);
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.carla, { role: "moderation" })).status, 403);

  await pool.query("UPDATE users SET totp_enabled_at=NOW() WHERE id=$1", [users.dino.id]);
  assert.equal((await call("POST", `/admin/users/${users.bruno.id}/role`, users.bruno, { role: "finance" })).status, 400, "nobody changes their own role");
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.bruno, { role: "chefe" })).status, 400);
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.bruno, { role: "moderation" })).status, 200);
  assert.equal((await call("GET", "/admin/content?type=post", users.dino)).status, 200);
  assert.equal((await call("GET", "/admin/payments", users.dino)).status, 403);
  // A moderação vê a ficha da pessoa, mas não os pagamentos nem os levantamentos.
  const card = (await call("GET", `/admin/users/${users.ana.id}`, users.dino)).body;
  assert.equal(card.money_hidden, true);
  assert.deepEqual([card.payments, card.payouts, card.spent], [[], [], null]);
  assert.equal((await call("GET", `/admin/users/${users.ana.id}`, users.carla)).body.money_hidden, false, "finance sees the money");
  const me = (await call("GET", "/auth/me", users.dino)).body;
  assert.equal((me.user || me).admin_role, "moderation");
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.bruno, { role: null })).status, 200);
  assert.equal((await call("GET", "/admin/content", users.dino)).status, 401, "losing the role ends the sessions");
  const dinoVersion = (await pool.query("SELECT auth_version FROM users WHERE id=$1", [users.dino.id])).rows[0].auth_version;
  users.dino.token = jwt.sign({ id: users.dino.id, username: "dino", version: dinoVersion }, process.env.JWT_SECRET, { expiresIn: "1h" });
  await pool.query("UPDATE users SET totp_enabled_at=NULL WHERE id=$1", [users.dino.id]);
  assert.ok((await call("GET", "/admin/actions?action=role_change", users.bruno)).body.actions.length >= 2);
});

test("refunds take back what was given and return the money (or leave it for the team)", { skip }, async () => {
  // Estrelas pagas em demonstração: reembolso imediato e as Estrelas saem do saldo.
  const stars = (await pool.query("INSERT INTO star_purchases(user_id,stars,amount_kz,status,paid_at) VALUES($1,100,1500,'paid',NOW()) RETURNING id", [users.ana.id])).rows[0].id;
  await pool.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,100,'purchase')", [users.ana.id]);
  const balance = async () => (await pool.query("SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS b FROM star_ledger WHERE user_id=$1", [users.ana.id])).rows[0].b;
  const before = await balance();
  assert.equal((await call("POST", `/admin/payments/stars/${stars}/refund`, users.carla, {})).status, 400, "a reason is required");
  const refund = await call("POST", `/admin/payments/stars/${stars}/refund`, users.carla, { note: "Comprou por engano" });
  assert.equal(refund.status, 200);
  assert.equal(refund.body.status, "refunded");
  assert.equal(await balance(), before - 100);
  assert.equal((await call("POST", `/admin/payments/stars/${stars}/refund`, users.carla, { note: "outra vez" })).status, 409);

  // Estrelas já gastas não se devolvem.
  const spent = (await pool.query("INSERT INTO star_purchases(user_id,stars,amount_kz,status,paid_at) VALUES($1,50,800,'paid',NOW()) RETURNING id", [users.bruno.id])).rows[0].id;
  await pool.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,50,'purchase'),($1,-45,'gift_sent')", [users.bruno.id]);
  const blocked = await call("POST", `/admin/payments/stars/${spent}/refund`, users.carla, { note: "Pediu" });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /já usou/);

  // Entrada num grupo secreto paga por Referência: sai do grupo e o dinheiro fica por devolver à mão.
  const group = (await pool.query("INSERT INTO social_groups(owner_id,name,is_secret,access_price) VALUES($1,'Clube do Reembolso',TRUE,2000) RETURNING id", [users.carla.id])).rows[0].id;
  const access = (await pool.query(`INSERT INTO group_access_purchases(group_id,user_id,owner_id,amount_kz,status,paid_at)
    VALUES($1,$2,$3,2000,'paid',NOW()) RETURNING id`, [group, users.ana.id, users.carla.id])).rows[0].id;
  await pool.query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2)", [group, users.ana.id]);
  await pool.query(`INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,status,provider_ref,entity,paid_at)
    VALUES('group_access',$1,$2,'reference',2000,'paid','555111222','11333',NOW())`, [access, users.ana.id]);
  const groupRefund = await call("POST", `/admin/payments/group_access/${access}/refund`, users.carla, { note: "Grupo enganoso" });
  assert.equal(groupRefund.body.status, "refund_due");
  assert.equal((await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [group, users.ana.id])).rowCount, 0);
  assert.equal((await call("GET", `/admin/payments/group_access/${access}`, users.carla)).body.payment.status, "refund_due");
  assert.equal((await call("POST", `/admin/payments/group_access/${access}/refunded`, users.carla, { note: "Transferência 42" })).status, 200);
  assert.equal((await call("GET", `/admin/payments/group_access/${access}`, users.carla)).body.payment.status, "refunded");
  const owner = await pool.query("SELECT COALESCE(SUM(amount_kz),0)::float AS v FROM group_access_purchases WHERE owner_id=$1 AND status='paid' AND refund_status IS NULL", [users.carla.id]);
  assert.equal(owner.rows[0].v, 0, "the owner no longer earns from a refunded entry");
});

test("payments left halfway: the team checks them and confirms with proof", { skip }, async () => {
  const purchase = (await pool.query("INSERT INTO star_purchases(user_id,stars,amount_kz) VALUES($1,30,500) RETURNING id", [users.ana.id])).rows[0].id;
  const attempt = (await pool.query(`INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,status,provider_ref,entity,expires_at)
    VALUES('stars',$1,$2,'reference',500,'pending','999000111','11333',NOW() - INTERVAL '1 day') RETURNING id`, [purchase, users.ana.id])).rows[0].id;
  const expired = await call("GET", "/admin/payment-attempts?status=expired", users.carla);
  const row = expired.body.attempts.find(item => item.id === attempt);
  assert.ok(row, "an expired reference is listed");
  assert.equal(row.product_paid, false);
  assert.equal(row.purpose_label, "Estrelas");
  assert.equal((await call("POST", `/admin/payment-attempts/${attempt}/confirm`, users.carla, {})).status, 400);
  assert.equal((await call("POST", `/admin/payment-attempts/${attempt}/confirm`, users.carla, { note: "Comprovativo BAI 777" })).status, 200);
  assert.equal((await pool.query("SELECT status FROM star_purchases WHERE id=$1", [purchase])).rows[0].status, "paid");
  assert.equal((await call("POST", `/admin/payment-attempts/${attempt}/confirm`, users.carla, { note: "de novo" })).status, 409);
});

test("data requests: people ask, the team exports, answers or deletes the account", { skip }, async () => {
  assert.equal((await call("POST", "/data-requests", users.ana, { kind: "correct" })).status, 400, "a correction needs details");
  const created = await call("POST", "/data-requests", users.ana, { kind: "export", details: "Quero uma cópia" });
  assert.equal(created.status, 201);
  assert.equal((await call("POST", "/data-requests", users.ana, { kind: "export" })).status, 409);
  assert.equal((await call("GET", "/admin/data-requests", users.carla)).status, 403, "only super handles personal data");
  const open = await call("GET", "/admin/data-requests", users.bruno);
  const request = open.body.requests.find(item => item.id === created.body.request.id);
  assert.ok(request);
  const exported = await call("GET", `/admin/data-requests/${request.id}/export`, users.bruno);
  assert.equal(exported.body.account.username, "ana");
  assert.equal((await call("POST", `/admin/data-requests/${request.id}/close`, users.bruno, { status: "done", answer: "Enviámos o ficheiro por email." })).status, 200);
  const mine = await call("GET", "/data-requests", users.ana);
  assert.equal(mine.body.requests.find(item => item.id === request.id).status, "done");

  const zeca = (await pool.query("INSERT INTO users(username,email,password_hash,display_name) VALUES('zeca','zeca@example.com','x','Zeca') RETURNING id")).rows[0].id;
  const zecaUser = { token: jwt.sign({ id: zeca, username: "zeca", version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  const deletion = (await call("POST", "/data-requests", zecaUser, { kind: "delete" })).body.request.id;
  assert.equal((await call("POST", `/admin/data-requests/${deletion}/delete-account`, users.bruno, { confirm: "outro" })).status, 400);
  assert.equal((await call("POST", `/admin/data-requests/${deletion}/delete-account`, users.bruno, { confirm: "zeca" })).status, 200);
  assert.equal((await pool.query("SELECT 1 FROM users WHERE id=$1", [zeca])).rowCount, 0);
  assert.equal((await pool.query("SELECT status FROM data_requests WHERE id=$1", [deletion])).rows[0].status, "done");
});

test("moderation without a report: hide and restore posts, hide groups, delete comments", { skip }, async () => {
  const post = await newPost(users.ana, { body: "Venda ilegal de bilhetes" });
  const found = await call("GET", "/admin/content?type=post&q=bilhetes", users.bruno);
  assert.ok(found.body.items.some(item => item.id === post.id));
  assert.equal((await call("POST", `/admin/content/post/${post.id}/hide`, users.bruno, {})).status, 400, "a reason is required");
  assert.equal((await call("POST", `/admin/content/post/${post.id}/hide`, users.bruno, { reason: "Venda proibida" })).status, 200);
  assert.ok((await pool.query("SELECT hidden_at FROM posts WHERE id=$1", [post.id])).rows[0].hidden_at);
  assert.equal((await call("POST", `/admin/content/post/${post.id}/hide`, users.bruno, { reason: "outra" })).status, 409);
  assert.equal((await call("POST", `/admin/content/post/${post.id}/restore`, users.bruno)).status, 200);
  assert.equal((await call("POST", `/admin/content/comment/${post.id}/hide`, users.bruno, { reason: "x" })).status, 400, "comments are deleted, not hidden");

  const group = (await call("POST", "/groups", users.ana, { name: "Grupo a esconder" })).body.group;
  assert.equal((await call("POST", `/admin/content/group/${group.id}/hide`, users.bruno, { reason: "Burlas" })).status, 200);
  assert.ok(!(await call("GET", "/groups", users.dino)).body.groups.some(item => item.id === group.id));
  assert.equal((await call("POST", `/groups/${group.id}/join`, users.dino)).status, 404);
  const notes = await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='moderation' ORDER BY id DESC LIMIT 1", [users.ana.id]);
  assert.match(notes.rows[0].text, /escondeu o teu grupo «Grupo a esconder»: Burlas/);
});

test("announcements reach the chosen audience", { skip }, async () => {
  assert.equal((await call("GET", "/admin/broadcasts/audience?audience=province:Marte", users.bruno)).status, 400);
  const count = await call("GET", "/admin/broadcasts/audience?audience=creators", users.bruno);
  assert.ok(count.body.people >= 1);
  assert.equal((await call("POST", "/admin/broadcasts", users.bruno, { title: "", body: "x", audience: "all", channel: "notification" })).status, 400);
  const sent = await call("POST", "/admin/broadcasts", users.bruno, { title: "Manutenção", body: "Amanhã às 2h o Tchilar fica parado 10 minutos.", audience: "creators", channel: "notification" });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.recipients, count.body.people);
  const got = await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='announcement'", [users.carla.id]);
  assert.match(got.rows.at(-1).text, /^Manutenção: Amanhã/);
  assert.equal((await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='announcement'", [users.ana.id])).rowCount, 0, "not a creator");
  assert.equal((await call("GET", "/admin/broadcasts", users.bruno)).body.broadcasts[0].title, "Manutenção");
});

test("payouts in a batch: one file for the bank, then mark them all as paid", { skip }, async () => {
  const { encrypt, loadKey } = require("./payouts");
  const key = loadKey({ payoutKey: process.env.PAYOUT_ENCRYPTION_KEY });
  const iban = "AO06004000010123456789012";
  const ids = [];
  for (const user of [users.ana, users.dino]) {
    ids.push((await pool.query(`INSERT INTO payout_requests(user_id,amount,holder_name,bank_name,iban_encrypted,iban_last4)
      VALUES($1,5000,$2,'BAI',$3,'9012') RETURNING id`, [user.id, user.username, encrypt(key, iban)])).rows[0].id);
  }
  const file = await fetch(`${baseUrl}/admin/payouts.csv`, { headers: { Authorization: `Bearer ${users.carla.token}` } });
  assert.equal(file.status, 200);
  const csv = await file.text();
  assert.ok(csv.includes(iban), "the bank file has the full IBAN");
  assert.ok(csv.includes(`"Tchilar levantamento ${ids[0]}"`));
  assert.equal((await call("POST", "/admin/payouts/batch", users.carla, { ids, reference: "" })).status, 400);
  const batch = await call("POST", "/admin/payouts/batch", users.carla, { ids: [...ids, 999999], reference: "LOTE-BAI-01" });
  assert.deepEqual(batch.body.paid.sort(), [...ids].sort());
  assert.deepEqual(batch.body.skipped, [999999]);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM payout_requests WHERE id = ANY($1) AND status='paid' AND reference='LOTE-BAI-01'", [ids])).rows[0].n, 2);
  await pool.query("UPDATE users SET is_admin=FALSE, admin_role=NULL, totp_enabled_at=NULL WHERE id IN ($1,$2)", [users.bruno.id, users.carla.id]);
});
