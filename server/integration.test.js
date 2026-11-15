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

const call = async (method, path, user, body, extraHeaders = {}) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...extraHeaders },
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

test("approval groups: the owner approves or declines who joins", { skip }, async () => {
  assert.equal((await call("POST", "/groups", users.ana, { name: "Tipo inválido", groupType: "nada" })).status, 400);
  const created = await call("POST", "/groups", users.ana, { name: "Vendas no Bairro", privacy: "approval", groupType: "compra-venda", category: "compra-venda", subcategory: "telemoveis" });
  assert.equal(created.status, 201);
  const id = created.body.group.id;
  const listed = async user => (await call("GET", "/groups", user)).body.groups.find(g => g.id === id);
  const seen = await listed(users.bruno);
  assert.deepEqual([seen.group_type, seen.category, seen.subcategory, seen.requires_approval], ["compra-venda", "compra-venda", "telemoveis", true], "aparece na lista");

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
  assert.equal((await call("POST", "/pages", users.ana, { name: "Errada", pageType: "restaurante", category: "musica", subcategory: "restaurantes" })).status, 400);
  const created = await call("POST", "/pages", users.ana, { name: "Café da Ilha", pageType: "restaurante", category: "alimentacao", subcategory: "cafes" });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.page.page_type, created.body.page.category, created.body.page.subcategory], ["restaurante", "alimentacao", "cafes"]);
  const plain = await call("POST", "/pages", users.ana, { name: "Sem tipo" });
  assert.deepEqual([plain.body.page.page_type, plain.body.page.category], ["comunidade", "sociedade"]);
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
  const quiet = (await call("POST", "/groups", hugo, { name: "Grupo calmo", category: "viagens" })).body.group;
  const busy = (await call("POST", "/groups", gil, { name: "Grupo do Gil", category: "desporto" })).body.group;
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

test("phone number: optional, Angolan, unverified so never exclusive, never on the public profile", { skip }, async () => {
  const stamp = Date.now();
  const register = extra => call("POST", "/auth/register", null, {
    username: `tel_${stamp}_${extra.n}`, email: `tel${stamp}${extra.n}@example.com`, password: "uma frase bem comprida",
    displayName: "Tel", birthDate: yearsAgo(25), ...extra.body });
  assert.equal((await register({ n: 1, body: { phone: "12345" } })).status, 400, "número inválido");
  assert.equal((await register({ n: 2, body: { phone: "+244 923 456 789" } })).status, 201, "aceita +244 e espaços");
  assert.equal((await pool.query("SELECT phone FROM users WHERE username=$1", [`tel_${stamp}_2`])).rows[0].phone, "923456789");
  assert.equal((await register({ n: 3, body: { phone: "923456789" } })).status, 201, "sem SMS não bloqueia nem revela o dono do número");
  assert.equal((await register({ n: 4, body: {} })).status, 201, "é opcional");

  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "923456789" })).status, 200, "não revela que o número tem conta");
  const saved = await call("PATCH", "/auth/me", users.carla, { phone: "00244 912 000 111" });
  assert.equal(saved.body.user.phone, "912000111");
  assert.equal((await call("GET", "/auth/me", users.carla)).body.user.phone, "912000111");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { bio: "sem mexer no telemóvel" })).body.user.phone, "912000111");
  assert.equal(JSON.stringify((await call("GET", "/users/carla", users.ana)).body).includes("912000111"), false, "não aparece no perfil público");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "" })).body.user.phone, null, "vazio apaga");
});

test("search finds people, posts, hashtags, groups and pages without leaking hidden things", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const word = `kizomba${stamp}`;
  const visible = await newPost(users.ana, { body: `Noite de ${word} em Luanda #${word} #Angola` });
  await newPost(users.bruno, { body: `Treino de ${word}` });
  const exclusive = await newPost(users.carla, { body: `Só para fãs #${word}`, isExclusive: true });
  const group = (await call("POST", "/groups", users.ana, { name: `Dança ${word}`, description: "Aulas ao sábado" })).body.group;
  const page = (await call("POST", "/pages", users.bruno, { name: `Escola ${word}`, pageType: "loja", category: "negocios" })).body.page;

  const posts = (await call("GET", `/posts?q=${word}`, null)).body.posts.map(post => post.id); // sem sessão: sem subscrições
  assert.ok(posts.includes(visible.id));
  assert.equal(posts.includes(exclusive.id), false, "exclusivas só para subscritores");
  const tagged = (await call("GET", `/posts?tag=${encodeURIComponent("#" + word)}`, null)).body.posts.map(post => post.id);
  assert.deepEqual(tagged, [visible.id], "a hashtag tem de ser exata e visível");
  assert.equal((await call("GET", "/posts?tag=nao%20vale", users.dino)).status, 400);
  assert.equal((await call("GET", "/posts?q=100%25", users.dino)).status, 200, "% e _ são texto, não curingas");

  const all = (await call("GET", `/search?q=${word}`, users.dino)).body;
  assert.ok(all.hashtags.some(item => item.tag === word && item.posts === 1), "a exclusiva não conta");
  assert.ok(all.groups.some(item => item.id === group.id));
  assert.ok(all.pages.some(item => item.id === page.id));
  assert.ok((await call("GET", "/search?q=carla", users.dino)).body.users.some(item => item.username === "carla"));
  assert.equal((await call("GET", `/search?q=${word}`)).status, 401);
});

test("push: the phone of the person gets the notification once, and a revoked session stops it", { skip }, async () => {
  const { createPush } = require("./push");
  const token = `ExponentPushToken[it${Date.now()}abcdef]`;
  const deviceKey = crypto.randomBytes(32).toString("hex");
  const owner = async () => (await pool.query("SELECT user_id FROM push_tokens WHERE token=$1", [token])).rows[0].user_id;
  assert.equal((await call("POST", "/push-tokens", users.bruno, { token: "not-a-token", platform: "ios", deviceKey })).status, 400);
  assert.equal((await call("POST", "/push-tokens", users.bruno, { token, platform: "android" })).status, 400, "sem chave do telemóvel");
  assert.equal((await call("POST", "/push-tokens", users.bruno, { token, platform: "android", deviceKey })).status, 204);
  // Quem só sabe o token (outra chave) não o desvia.
  assert.equal((await call("POST", "/push-tokens", users.carla, { token, platform: "android", deviceKey: crypto.randomBytes(32).toString("hex") })).status, 409);
  assert.equal(await owner(), users.bruno.id);
  // O mesmo telemóvel (mesma chave) a entrar noutra conta: os avisos passam para a conta nova.
  assert.equal((await call("POST", "/push-tokens", users.carla, { token, platform: "android", deviceKey })).status, 204);
  assert.equal(await owner(), users.carla.id);
  assert.equal((await call("POST", "/push-tokens", users.bruno, { token, platform: "android", deviceKey })).status, 204);
  const sent = [];
  const fetchImpl = async (_url, options) => {
    const chunk = JSON.parse(options.body);
    sent.push(...chunk);
    return { ok: true, json: async () => ({ data: chunk.map(() => ({ status: "ok" })) }) };
  };
  const push = createPush({ pool, fetchImpl, log: { error() {} } });
  await push.processPending(); // limpa o que os outros testes deixaram por enviar
  sent.length = 0;

  await call("POST", `/messages/${users.bruno.id}`, users.ana, { body: "Olá Bruno, isto é privado" });
  await push.processPending();
  const mine = sent.filter(message => message.to === token);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, "Ana");
  assert.equal(mine[0].data.url, `/chat/${users.ana.id}`);
  assert.equal(mine[0].body.includes("privado"), false, "o texto da mensagem não vai no aviso");
  await push.processPending();
  assert.equal(sent.filter(message => message.to === token).length, 1, "nunca envia o mesmo aviso duas vezes");

  // Terminar as sessões (auth_version+1) desliga o telemóvel antigo.
  await pool.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1", [users.bruno.id]);
  await call("POST", `/messages/${users.bruno.id}`, users.ana, { body: "Outra" });
  await push.processPending();
  assert.equal(sent.filter(message => message.to === token).length, 1);
  await pool.query("UPDATE users SET auth_version=auth_version-1 WHERE id=$1", [users.bruno.id]);
  assert.equal((await call("DELETE", "/push-tokens", users.bruno, { token })).status, 204);
  assert.equal((await pool.query("SELECT 1 FROM push_tokens WHERE token=$1", [token])).rowCount, 0);
});

// Contas próprias para estes testes (equipa com papéis diferentes, criador e comprador).
const makeUser = async (name, extra = {}) => {
  const row = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,is_creator,is_admin,admin_role,totp_enabled_at)
     VALUES($1,$2,'x',$3,TRUE,$4,$5,$6,$7) RETURNING id,username`,
    [name, `${name}@example.com`, name, Boolean(extra.creator), Boolean(extra.role), extra.role || null, extra.role ? new Date() : null])).rows[0];
  return { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
};

test("monthly challenges: 40 templates, launch to everyone, prizes by place in stars and money", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const sup = await makeUser(`sup_${stamp}`, { role: "super" });
  const mod = await makeUser(`mod_${stamp}`, { role: "moderation" });
  const p1 = await makeUser(`p1_${stamp}`);
  const p2 = await makeUser(`p2_${stamp}`);
  const fan = await makeUser(`fan_${stamp}`);

  const catalog = (await call("GET", "/admin/challenge-templates", mod)).body;
  assert.ok(catalog.templates.length >= 40);
  assert.equal(catalog.canGiveCash, false);
  assert.equal((await call("GET", "/admin/challenge-templates", p1)).status, 403);
  const bronze = catalog.templates.find(t => t.code === "bom-dia-angola");
  const lenda = catalog.templates.find(t => t.code === "criador-do-mes");
  assert.deepEqual(lenda.prizes[0], { place: 1, stars: 1000, cashKz: 25000 });

  // Dinheiro é com as finanças/super.
  assert.equal((await call("POST", "/admin/challenges/launch", mod, { templateIds: [lenda.id] })).status, 403);
  assert.equal((await call("PATCH", `/admin/challenge-templates/${bronze.id}`, mod, { prizes: [{ stars: 10, cashKz: 100 }] })).status, 403);
  assert.equal((await call("PATCH", `/admin/challenge-templates/${bronze.id}`, mod, { title: "Bom dia, Angola!" })).status, 200);
  assert.equal((await call("PATCH", `/admin/challenge-templates/${lenda.id}`, sup, { prizes: [{ stars: 1000, cashKz: 30000 }, { stars: 500, cashKz: 10000 }] })).status, 200);

  const before = Number((await pool.query("SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND type='challenge'", [fan.id])).rows[0].count);
  const launched = await call("POST", "/admin/challenges/launch", sup, { templateIds: [lenda.id, bronze.id] });
  assert.equal(launched.status, 201);
  assert.equal(launched.body.challenges.length, 2);
  const after = Number((await pool.query("SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND type='challenge'", [fan.id])).rows[0].count);
  assert.equal(after, before + 1, "cada pessoa recebe um aviso por lançamento");
  const challengeId = launched.body.challenges.find(c => c.title === lenda.title).id;

  // Só contam publicações feitas depois de o desafio começar.
  const old = (await pool.query("INSERT INTO posts(user_id,body,created_at) VALUES($1,'antiga',NOW() - INTERVAL '2 days') RETURNING id", [p1.id])).rows[0];
  assert.equal((await call("POST", `/challenges/${challengeId}/entries`, p1, { postId: old.id })).status, 400);
  const a = await newPost(p1, { body: "A minha melhor foto" });
  const b = await newPost(p2, { body: "A minha também" });
  assert.equal((await call("POST", `/challenges/${challengeId}/entries`, p1, { postId: a.id })).status, 201);
  assert.equal((await call("POST", `/challenges/${challengeId}/entries`, p2, { postId: b.id })).status, 201);
  await call("POST", `/posts/${b.id}/like`, fan);

  assert.equal((await call("POST", `/challenges/${challengeId}/close`, mod)).status, 403, "prémio em dinheiro: só finanças encerra");
  const closed = await call("POST", `/challenges/${challengeId}/close`, sup);
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body.awards.map(item => [item.place, item.username, item.stars, item.cashKz]),
    [[1, p2.username, 1000, 30000], [2, p1.username, 500, 10000]]);
  const detail = (await call("GET", `/challenges/${challengeId}`, fan)).body;
  assert.equal(detail.awards.length, 2);
  // O dinheiro entra no saldo de ganhos; as estrelas no saldo de estrelas.
  assert.equal((await call("GET", "/payouts", p2)).body.sources.prizesKz, 30000);
  assert.equal((await call("GET", "/payouts", p2)).body.available, 30000);
  assert.equal((await call("POST", `/challenges/${challengeId}/close`, sup)).status, 409, "não encerra duas vezes");
});

test("academy courses: creators sell, the team reviews, buyers unlock lessons and the creator gets 85%", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const mod = await makeUser(`cmod_${stamp}`, { role: "moderation" });
  const creator = await makeUser(`prof_${stamp}`, { creator: true });
  const buyer = await makeUser(`aluno_${stamp}`);

  assert.equal((await call("POST", "/courses", buyer, { title: "Curso" })).status, 403, "só criadores");
  assert.equal((await call("POST", "/courses", creator, { title: "Curso", priceKz: 100 })).status, 400, "preço mínimo");
  const id = (await call("POST", "/courses", creator, { title: "Reels que vendem", summary: "Do zero ao primeiro cliente", priceKz: 2000, category: "marketing" })).body.id;
  assert.equal((await call("POST", `/courses/${id}/submit`, creator)).status, 400, "sem aulas não publica");
  assert.equal((await call("POST", `/courses/${id}/lessons`, creator, { title: "Boas-vindas", body: "Olá!", isPreview: true })).status, 201);
  assert.equal((await call("POST", `/courses/${id}/lessons`, creator, { title: "O segredo", body: "Conteúdo pago" })).status, 201);
  assert.equal((await call("POST", `/courses/${id}/submit`, creator)).body.status, "review");
  assert.equal((await call("GET", `/courses/${id}`, buyer)).status, 404, "em revisão não aparece");
  assert.equal((await call("POST", `/admin/courses/${id}/review`, mod, { action: "reject" })).status, 400, "recusar pede motivo");
  assert.equal((await call("POST", `/admin/courses/${id}/review`, mod, { action: "approve" })).body.status, "published");

  const locked = (await call("GET", `/courses/${id}`, buyer)).body;
  assert.equal(locked.course.has_access, false);
  assert.deepEqual(locked.lessons.map(lesson => [lesson.title, lesson.locked, lesson.body ?? null]), [["Boas-vindas", false, "Olá!"], ["O segredo", true, null]]);
  assert.ok((await call("GET", "/courses", buyer)).body.courses.some(course => course.id === id));

  await call("POST", `/courses/${id}/buy`, buyer, {});
  const purchase = (await pool.query("SELECT id,status FROM course_purchases WHERE course_id=$1 AND user_id=$2", [id, buyer.id])).rows[0];
  assert.equal(purchase.status, "pending");
  assert.equal((await call("GET", `/courses/${id}`, buyer)).body.course.has_access, false, "sem pagamento confirmado não abre");
  await payments.fulfill("course", purchase.id, {});
  await payments.fulfill("course", purchase.id, {});
  const open = (await call("GET", `/courses/${id}`, buyer)).body;
  assert.equal(open.course.has_access, true);
  assert.equal(open.lessons[1].body, "Conteúdo pago");
  assert.equal((await call("POST", `/courses/${id}/buy`, buyer, {})).status, 409, "já tem o curso");
  assert.equal((await call("GET", "/payouts", creator)).body.sources.coursesKz, 1700, "85% de 2000 Kz");
  assert.ok((await call("GET", "/courses/mine", buyer)).body.purchased.some(course => course.id === id));
  assert.equal((await call("DELETE", `/courses/${id}`, creator)).status, 409, "vendido: não se apaga");

  // Mudar o que se vê na loja manda o curso de volta à revisão.
  assert.equal((await call("PATCH", `/courses/${id}`, creator, { priceKz: 3000 })).body.status, "review");
});

test("event page: details, who is going (friends first) and blocked people hidden", { skip }, async () => {
  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const created = await call("POST", "/events", users.ana, { name: "Kizomba no Kinaxixi", description: "Aula aberta", location: "Luanda", startsAt });
  const id = created.body.event.id;
  await call("POST", `/events/${id}/rsvp`, users.bruno);
  const page = await call("GET", `/events/${id}`, users.dino);
  assert.equal(page.status, 200);
  assert.equal(page.body.event.name, "Kizomba no Kinaxixi");
  assert.equal(page.body.event.attendee_count, 2);
  assert.equal(page.body.event.is_attending, false);
  assert.deepEqual(page.body.attendees.map(person => person.username).sort(), ["ana", "bruno"]);
  assert.equal((await call("GET", `/events/${id}`, users.ana)).body.event.is_creator, true);
  assert.equal((await call("GET", "/events/999999", users.dino)).status, 404);
});

test("sessions never expire on their own: only signing out everywhere, a new password or suspension ends them", { skip }, async () => {
  const bcrypt = require("bcryptjs");
  const stamp = Date.now().toString(36);
  const email = `sessao${stamp}@example.com`;
  await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,'Sessão',TRUE)",
    [`sessao_${stamp}`, email, await bcrypt.hash("uma frase bem comprida", 4)]);

  const web = (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida" })).body.token;
  const app = (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida", client: "app" })).body.token;
  assert.equal(jwt.decode(web).exp, undefined, "site: sem prazo");
  assert.equal(jwt.decode(app).exp, undefined, "app: sem prazo");
  assert.equal(jwt.decode(app).app, true);
  assert.equal((await call("GET", "/auth/me", { token: app })).status, 200);

  // Terminar as outras sessões corta todas menos a de quem pediu.
  const kept = (await call("POST", "/auth/logout-all", { token: web })).body.token;
  const cut = await call("GET", "/auth/me", { token: app });
  assert.equal(cut.status, 401);
  assert.equal(cut.body.sessionExpired, true);
  assert.equal((await call("GET", "/auth/me", { token: kept })).status, 200);
  assert.equal(jwt.decode(kept).exp, undefined);
});

test("sessions per device: list, end one device, real sign-out, new-login alert", { skip }, async () => {
  const bcrypt = require("bcryptjs");
  const stamp = Date.now().toString(36);
  const email = `aparelho${stamp}@example.com`;
  const id = (await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,'Aparelhos',TRUE) RETURNING id",
    [`aparelho_${stamp}`, email, await bcrypt.hash("uma frase bem comprida", 4)])).rows[0].id;
  const login = async (body, headers) => (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida", ...body }, headers)).body.token;

  const web = await login({});
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND type='privacy'", [id])).rows[0].n, 0, "o primeiro início de sessão não avisa");
  const phone = await login({ client: "app" }, { "x-tchilar-device": "iPhone 15 · iOS 18" });
  assert.ok(jwt.decode(phone).sid, "o token leva o id da sessão");
  const alert = (await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='privacy'", [id])).rows;
  assert.equal(alert.length, 1, "novo aparelho → aviso");
  assert.match(alert[0].text, /iPhone 15/);

  const list = (await call("GET", "/auth/sessions", { token: web })).body.sessions;
  assert.equal(list.length, 2);
  assert.equal(list.find(item => item.current).client, "web");
  const phoneSession = list.find(item => !item.current);
  assert.equal(phoneSession.device, "iPhone 15 · iOS 18");

  // Terminar o telemóvel a partir do site: só o telemóvel sai.
  assert.equal((await call("DELETE", `/auth/sessions/${phoneSession.id}`, { token: web })).status, 200);
  assert.equal((await call("GET", "/auth/me", { token: phone })).status, 401);
  assert.equal((await call("GET", "/auth/me", { token: web })).status, 200);
  assert.equal((await call("DELETE", `/auth/sessions/${phoneSession.id}`, { token: web })).status, 404);

  // Sair a sério: o token deixa de valer mesmo que alguém o tenha guardado.
  assert.equal((await call("POST", "/auth/logout", { token: web })).status, 200);
  assert.equal((await call("GET", "/auth/me", { token: web })).status, 401);

  // Token sem sessão e sem prazo (forjado ou antigo) não entra; com sessão inventada também não.
  assert.equal((await call("GET", "/auth/me", { token: jwt.sign({ id, username: "x", version: 0 }, process.env.JWT_SECRET) })).status, 401);
  assert.equal((await call("GET", "/auth/me", { token: jwt.sign({ id, username: "x", version: 0, sid: "00000000-0000-4000-8000-000000000000" }, process.env.JWT_SECRET) })).status, 401);
});

test("live gifts: 15 gifts from 100 Kz to 25 000 Kz, paid in stars, louder sounds for the big ones", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const make = async name => {
    const row = (await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,'x',$1,TRUE) RETURNING id,username",
      [`${name}_${stamp}`, `${name}${stamp}@example.com`])).rows[0];
    return { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  };
  const host = await make("anfitriao");
  const fan = await make("fa");

  const config = (await call("GET", "/lives/config", fan)).body;
  assert.equal(config.gifts.length, 15);
  assert.deepEqual([config.gifts[0].kz, config.gifts[14].kz], [100, 25000]);
  assert.deepEqual([config.gifts[0].stars, config.gifts[14].stars], [10, 2500], "1 estrela = 10 Kz");
  const sounds = config.gifts.map(gift => gift.sound);
  assert.ok(sounds.every((level, index) => index === 0 || level >= sounds[index - 1]), "o som nunca desce com o valor");
  assert.equal(sounds.at(-1), 8);

  const live = (await call("POST", "/lives", host, { title: "Noite de presentes", category: "musica" })).body.id;
  assert.equal((await call("POST", `/lives/${live}/stars`, fan, { gift: "coroa" })).status, 402, "sem estrelas não oferece");
  assert.equal((await call("POST", `/lives/${live}/stars`, fan, { gift: "nao-existe" })).status, 400);
  await pool.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,400,'purchase')", [fan.id]);

  const sent = await call("POST", `/lives/${live}/stars`, fan, { gift: "coroa" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.balance, 100, "a coroa custa 300 estrelas (3 000 Kz)");
  const feed = (await call("GET", `/lives/${live}/feed`, fan)).body;
  const giftComment = feed.comments.find(comment => comment.gift === "coroa");
  assert.ok(giftComment, "o presente aparece no chat do direto");
  assert.equal(giftComment.stars, 300);
  assert.equal(feed.stars, 300, "quem transmite recebe as estrelas");
  assert.equal((await call("POST", `/lives/${live}/stars`, host, { gift: "rosa" })).status, 400, "não se oferece a si próprio");
  assert.equal((await call("POST", `/lives/${live}/stars`, fan, { amount: 5 })).status, 200, "as estrelas soltas continuam a funcionar");
  await call("POST", `/lives/${live}/end`, host);
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

test("post page: one post by id, notifications point to it, private posts stay private", { skip }, async () => {
  const post = await newPost(users.ana, { body: "Uma publicação com página própria" });
  const page = await call("GET", `/posts/${post.id}`, users.bruno);
  assert.equal(page.status, 200);
  assert.equal(page.body.post.id, post.id);
  assert.equal(page.body.post.username, "ana");
  assert.equal((await call("GET", `/posts/${post.id}`, null)).status, 200, "pública: abre sem conta");
  assert.equal((await call("GET", "/posts/999999999", users.bruno)).status, 404);
  assert.equal((await call("GET", "/posts/abc", users.bruno)).status, 400);

  await call("POST", `/posts/${post.id}/like`, users.bruno);
  const notification = (await call("GET", "/notifications", users.ana)).body.notifications.find(item => item.type === "like" && item.post_id === post.id);
  assert.ok(notification, "o gosto leva à publicação");

  const exclusive = await newPost(users.ana, { body: "Só para subscritores", isExclusive: true });
  if (exclusive.is_exclusive) assert.equal((await call("GET", `/posts/${exclusive.id}`, users.bruno)).status, 404, "exclusiva: só subscritores");
});

test("monthly challenges launch by themselves: one per level, stars only, once a month", { skip }, async () => {
  const { launchMonthlyChallenges } = require("./index");
  await pool.query("DELETE FROM challenges WHERE template_id IS NOT NULL");
  const created = await launchMonthlyChallenges();
  const starLevels = (await pool.query(`SELECT DISTINCT level FROM challenge_templates t WHERE active
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.prizes) p WHERE COALESCE((p->>'cashKz')::numeric,0) > 0) ORDER BY level`)).rows.map(row => row.level);
  assert.ok(starLevels.length >= 1);
  assert.deepEqual(created.map(item => item.level).sort(), starLevels, "um desafio por nível (dos que só dão estrelas)");
  const prizes = (await pool.query("SELECT prizes FROM challenges WHERE id = ANY($1)", [created.map(item => item.id)])).rows;
  assert.ok(prizes.every(row => row.prizes.every(prize => !Number(prize.cashKz))), "sem dinheiro: isso é com a equipa de finanças");
  assert.ok(created.every(item => new Date(item.ends_at) > new Date()), "termina no fim do mês");
  assert.deepEqual(await launchMonthlyChallenges(), [], "só uma vez por mês");
  assert.ok((await call("GET", "/challenges", users.bruno)).body.challenges.some(item => item.id === created[0].id), "aparece na lista de desafios");
});

test("courses can be reported, but not your own and not unpublished ones", { skip }, async () => {
  const course = (await pool.query("INSERT INTO courses(owner_id,title,summary,status,published_at) VALUES($1,'Curso de teste','Resumo','published',NOW()) RETURNING id", [users.ana.id])).rows[0].id;
  const draft = (await pool.query("INSERT INTO courses(owner_id,title) VALUES($1,'Rascunho') RETURNING id", [users.ana.id])).rows[0].id;
  assert.equal((await call("POST", "/reports", users.bruno, { targetType: "course", targetId: course, reason: "spam" })).status, 201);
  assert.equal((await call("POST", "/reports", users.ana, { targetType: "course", targetId: course, reason: "spam" })).status, 400, "o próprio curso não");
  assert.equal((await call("POST", "/reports", users.bruno, { targetType: "course", targetId: draft, reason: "spam" })).status, 404, "rascunhos não estão à vista");
  const row = (await pool.query("SELECT target_user_id FROM reports WHERE target_type='course' AND target_id=$1", [course])).rows[0];
  assert.equal(row.target_user_id, users.ana.id);
});

test("groups inside: team roles, invites, pinned posts, polls, chat, files, events, stats and reports", { skip }, async () => {
  const { ana, bruno, carla, dino } = users;
  const group = (await call("POST", "/groups", ana, { name: "Clube Free Fire Luanda", privacy: "private", groupType: "jogos", subcategory: "free-fire", category: "jogos", rules: "Respeito sempre." })).body.group;
  assert.equal(group.invite_only, true);
  const id = group.id;

  // Privado: só entra quem é convidado.
  assert.equal((await call("POST", `/groups/${id}/join`, bruno)).status, 403);
  assert.equal((await call("POST", `/groups/${id}/invites`, ana, { username: bruno.username })).status, 201);
  assert.equal((await call("GET", `/groups/${id}`, bruno)).body.group.has_invite, true);
  assert.equal((await call("POST", `/groups/${id}/join`, bruno)).status, 200);
  await call("POST", `/groups/${id}/invites`, ana, { username: carla.username });
  await call("POST", `/groups/${id}/join`, carla);
  const detail = (await call("GET", `/groups/${id}`, bruno)).body.group;
  assert.deepEqual([detail.my_role, detail.rules, detail.request_count], ["member", "Respeito sempre.", undefined]);
  assert.equal((await call("GET", `/groups/${id}`, dino)).body.group.is_member, false, "de fora vê o grupo, não é membro");

  // Papéis: o dono nomeia; um moderador não pode remover quem está acima.
  assert.equal((await call("POST", `/groups/${id}/members/${carla.id}/role`, bruno, { role: "moderator" })).status, 403, "membros não nomeiam");
  assert.equal((await call("POST", `/groups/${id}/members/${bruno.id}/role`, ana, { role: "moderator" })).status, 200);
  assert.equal((await call("DELETE", `/groups/${id}/members/${ana.id}`, bruno)).status, 403);
  const members = (await call("GET", `/groups/${id}/members`, carla)).body.members;
  assert.deepEqual(members.map(m => m.role), ["owner", "moderator", "member"]);
  assert.equal((await call("PATCH", `/groups/${id}`, bruno, { rules: "Outra" })).status, 403, "moderador não muda as regras");
  assert.equal((await call("PATCH", `/groups/${id}`, ana, { rules: "Sem spam.", privacy: "approval" })).status, 200);

  // Publicações fixadas (moderador) e esconder por não cumprir as regras.
  const post = (await call("POST", "/posts", carla, { body: "Torneio sábado!", groupId: id })).body.post;
  assert.equal((await call("POST", `/groups/${id}/pins/${post.id}`, carla)).status, 403);
  assert.equal((await call("POST", `/groups/${id}/pins/${post.id}`, bruno)).status, 200);
  assert.deepEqual((await call("GET", `/posts?groupId=${id}&pinned=1`, carla)).body.posts.map(p => p.id), [post.id]);
  const spam = (await call("POST", "/posts", carla, { body: "Compra aqui", groupId: id })).body.post;
  assert.equal((await call("POST", `/groups/${id}/posts/${spam.id}/hide`, bruno)).status, 200);
  assert.ok(!(await call("GET", `/posts?groupId=${id}`, bruno)).body.posts.some(p => p.id === spam.id));

  // Sondagem.
  assert.equal((await call("POST", `/groups/${id}/polls`, carla, { question: "Que dia?", options: ["Sábado"] })).status, 400);
  const pollId = (await call("POST", `/groups/${id}/polls`, carla, { question: "Que dia?", options: ["Sábado", "Domingo"], days: 3 })).body.poll.id;
  const polls = (await call("GET", `/groups/${id}/polls`, bruno)).body.polls;
  const sabado = polls[0].options[0].id;
  assert.equal((await call("POST", `/groups/${id}/polls/${pollId}/vote`, bruno, { optionIds: [sabado, polls[0].options[1].id] })).status, 400, "só uma resposta");
  assert.equal((await call("POST", `/groups/${id}/polls/${pollId}/vote`, bruno, { optionIds: [sabado] })).status, 200);
  const after = (await call("GET", `/groups/${id}/polls`, bruno)).body.polls[0];
  assert.deepEqual([after.voters, after.options[0].votes, after.options[0].mine], [1, 1, true]);
  assert.equal((await call("GET", `/groups/${id}/polls`, dino)).status, 403, "de fora não vê");

  // Chat.
  const first = (await call("POST", `/groups/${id}/chat`, bruno, { body: "Olá malta" })).body.message;
  await call("POST", `/groups/${id}/chat`, carla, { body: "Bom dia" });
  const newer = (await call("GET", `/groups/${id}/chat?after=${first.id}`, ana)).body.messages;
  assert.deepEqual(newer.map(m => m.body), ["Bom dia"]);
  assert.equal((await call("POST", `/groups/${id}/chat`, dino, { body: "?" })).status, 403);

  // Evento do grupo: não aparece na lista pública e só membros o abrem.
  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const event = (await call("POST", `/groups/${id}/events`, carla, { name: "Torneio", startsAt, location: "Talatona" })).body.event;
  assert.ok((await call("GET", `/groups/${id}/events`, bruno)).body.events.some(e => e.id === event.id));
  assert.ok(!(await call("GET", "/events", dino)).body.events.some(e => e.id === event.id));
  assert.equal((await call("GET", `/events/${event.id}`, dino)).status, 404);

  // Ficheiro: só membros, com link assinado; descarrega como anexo.
  const form = new FormData();
  form.append("file", new Blob(["regras do torneio"], { type: "text/plain" }), "Regras do torneio.txt");
  const sent = await fetch(`${baseUrl}/groups/${id}/files`, { method: "POST", headers: { Authorization: `Bearer ${carla.token}` }, body: form });
  assert.equal(sent.status, 201);
  const files = (await call("GET", `/groups/${id}/files`, bruno)).body.files;
  assert.equal(files[0].name, "Regras do torneio.txt");
  const download = await fetch(baseUrl.replace(/\/api$/, "") + files[0].url);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  const raw = files[0].url.split("?")[0];
  assert.equal((await fetch(baseUrl.replace(/\/api$/, "") + raw)).status, 403, "sem assinatura não descarrega");
  await call("DELETE", `/groups/${id}/files/${files[0].id}`, carla);

  // Estatísticas (equipa) e denúncia do grupo.
  assert.equal((await call("GET", `/groups/${id}/stats`, carla)).status, 403);
  const stats = (await call("GET", `/groups/${id}/stats`, bruno)).body;
  assert.equal(stats.stats.members, 3);
  assert.ok(stats.stats.active_30d >= 2);
  assert.equal(stats.weekly.length, 8);
  assert.equal((await call("POST", "/reports", dino, { targetType: "group", targetId: id, reason: "spam" })).status, 201);
});

test("group calls: start, join, signal between participants, max size, leave ends the call", { skip }, async () => {
  const { ana, bruno, carla, dino } = users;
  const group = (await call("POST", "/groups", ana, { name: "Chamadas do Clube" })).body.group;
  const id = group.id;
  await call("POST", `/groups/${id}/join`, bruno);
  assert.equal((await call("POST", `/groups/${id}/call`, dino, { kind: "video" })).status, 404, "só membros");

  const started = await call("POST", `/groups/${id}/call`, ana, { kind: "video" });
  assert.equal(started.status, 201);
  assert.equal(started.body.call.kind, "video");
  assert.ok(Array.isArray(started.body.iceServers) && started.body.iceServers.length > 0);
  const notified = (await call("GET", "/notifications", bruno)).body.notifications.find(n => n.type === "group_call" && n.group_id === id);
  assert.ok(notified, "os membros são avisados e a notificação abre o grupo");

  // O segundo "começar" entra na mesma chamada (mesmo que peça só voz).
  const joined = await call("POST", `/groups/${id}/call`, bruno, { kind: "voice" });
  assert.equal(joined.body.call.id, started.body.call.id);
  assert.equal(joined.body.call.kind, "video");
  assert.equal(joined.body.call.participants.length, 2);

  // Sinalização: a Ana (número mais baixo) oferece ao Bruno; o Bruno recebe uma vez.
  const [low, high] = ana.id < bruno.id ? [ana, bruno] : [bruno, ana];
  assert.equal((await call("POST", `/groups/${id}/call/signal`, low, { to: high.id, kind: "offer", payload: JSON.stringify({ sdp: "v=0" }) })).status, 201);
  assert.equal((await call("POST", `/groups/${id}/call/signal`, low, { to: carla.id, kind: "offer", payload: "x" })).status, 404, "a Carla não está na chamada");
  const beat = (await call("POST", `/groups/${id}/call/heartbeat`, high, { muted: true, camera: false })).body;
  assert.deepEqual(beat.signals.map(s => [s.from_user, s.kind]), [[low.id, "offer"]]);
  assert.equal((await call("POST", `/groups/${id}/call/heartbeat`, high, { muted: true, camera: false })).body.signals.length, 0, "entregue só uma vez");
  const me = (await call("GET", `/groups/${id}/call`, low)).body.call.participants.find(p => p.user_id === high.id);
  assert.deepEqual([me.muted, me.camera], [true, false]);

  // Sair: com toda a gente fora, a chamada termina e a seguinte é nova.
  await call("POST", `/groups/${id}/call/leave`, ana);
  await call("POST", `/groups/${id}/call/leave`, bruno);
  assert.equal((await call("GET", `/groups/${id}/call`, ana)).body.call, null);
  const again = await call("POST", `/groups/${id}/call`, bruno, { kind: "voice" });
  assert.notEqual(again.body.call.id, started.body.call.id);
  assert.equal(again.body.call.kind, "voice");
  await call("POST", `/groups/${id}/call/leave`, bruno);
});

test("direct calls from messages: ring, answer, decline, add people up to 8", { skip }, async () => {
  const { ana, bruno, carla, dino } = users;
  assert.equal((await call("POST", "/calls", ana, { to: [] })).status, 400);
  const started = await call("POST", "/calls", ana, { to: [bruno.id], kind: "voice" });
  assert.equal(started.status, 201);
  const callId = started.body.call.id;
  assert.equal(started.body.call.kind, "voice");

  // Está a tocar para o Bruno (e só para ele).
  const ringing = (await call("GET", "/calls/incoming", bruno)).body.call;
  assert.equal(ringing.id, callId);
  assert.equal(ringing.caller_id, ana.id);
  assert.equal((await call("GET", "/calls/incoming", carla)).body.call, null);
  assert.ok((await call("GET", "/notifications", bruno)).body.notifications.some(n => n.type === "call" && n.call_id === callId));
  assert.equal((await call("POST", `/calls/${callId}/join`, carla)).status, 404, "quem não foi convidado não entra");

  // Atender: deixa de tocar; a Ana vê o Bruno na chamada.
  assert.equal((await call("POST", `/calls/${callId}/join`, bruno)).status, 201);
  assert.equal((await call("GET", "/calls/incoming", bruno)).body.call, null);
  const beat = (await call("POST", `/calls/${callId}/heartbeat`, ana, {})).body;
  assert.deepEqual(beat.call.participants.map(p => p.user_id).sort(), [ana.id, bruno.id].sort());

  // Adicionar a Carla durante a chamada; a Carla recusa.
  assert.equal((await call("POST", `/calls/${callId}/invite`, bruno, { username: carla.username })).status, 201);
  assert.equal((await call("GET", "/calls/incoming", carla)).body.call.id, callId);
  assert.equal((await call("POST", `/calls/${callId}/decline`, carla)).status, 200);
  assert.equal((await call("GET", "/calls/incoming", carla)).body.call, null);

  // Mais de 8 pessoas não.
  assert.equal((await call("POST", "/calls", dino, { to: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).status, 400);

  await call("POST", `/calls/${callId}/leave`, ana);
  await call("POST", `/calls/${callId}/leave`, bruno);
  assert.equal((await call("POST", `/calls/${callId}/join`, bruno)).status, 410, "chamada terminada");
});
