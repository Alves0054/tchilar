// Testes de integração com PostgreSQL a sério: cria um schema temporário, corre todas as migrações,
// arranca a API real contra ele e apaga tudo no fim. Usa TEST_DATABASE_URL (ou DATABASE_URL).
// Sem base de dados configurada, os testes são saltados (os testes unitários continuam a correr).
require("dotenv").config({ quiet: true });
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { maintainGroupAccess } = require("./groups");

const baseDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = baseDatabaseUrl ? false : "sem TEST_DATABASE_URL nem DATABASE_URL";
const schema = `it_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

let app, payments, pool, adminPool, server, baseUrl, jwt, sharp, sms;
let migrationTempDir;
const users = {};
const smsCodes = new Map();

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
  // Para os testes de sessões poderem usar um IP próprio (X-Forwarded-For) e não dependerem de quantos
  // registos e logins os testes anteriores já gastaram do limite de 10 tentativas por IP.
  process.env.TRUST_PROXY = "1";
  // Os testes fazem milhares de escritas do mesmo IP: o limite geral fica alto; o dos pagamentos fica no normal (30).
  process.env.RATE_LIMIT_WRITES = "100000";
  process.env.RATE_LIMIT_PAYMENTS = "100000";
  // SMS: chaves falsas do Twilio (os testes trocam o envio e a verificação por uma versão em memória, ver smsCodes).
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test";
  process.env.TWILIO_VERIFY_SERVICE_SID = "VAtest";
  for (const key of ["MEDIA_API_URL", "MEDIA_HLS_URL", "MEDIA_HOOK_SECRET", "MEDIA_WHIP_URL", "MEDIA_RTMP_URL"]) process.env[key] = "";
  ({ app, payments, pool, sms } = require("./index"));
  // Nenhum SMS sai dos testes: o último código "enviado" para cada número fica em smsCodes.
  sms.send = async phone => { smsCodes.set(phone, String(100000 + smsCodes.size)); return { sent: true }; };
  sms.check = async (phone, code) => smsCodes.get(phone) === code && smsCodes.delete(phone);
  const migrationsDirectory = path.join(__dirname, "migrations");
  migrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tchilar-it-migrations-"));
  for (const file of fs.readdirSync(migrationsDirectory).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)
    && Number(name.split("_")[0]) < 53)) {
    fs.copyFileSync(path.join(migrationsDirectory, file), path.join(migrationTempDir, file));
  }
  const { runMigrations } = require("./migrate");
  await runMigrations(pool, migrationTempDir);
  jwt = require("jsonwebtoken");
  sharp = require("sharp");

  for (const name of ["ana", "bruno", "carla", "dino"]) {
    const row = (await pool.query(
      "INSERT INTO users(username,email,password_hash,display_name,email_verified,is_creator) VALUES($1,$2,'x',$3,TRUE,$4) RETURNING id,username",
      [name, `${name}@example.com`, name[0].toUpperCase() + name.slice(1), name === "carla"])).rows[0];
    users[name] = { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  }
  await runMigrations(pool, migrationsDirectory);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (skip) return;
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
  await adminPool.end();
  if (migrationTempDir) fs.rmSync(migrationTempDir, { recursive: true, force: true });
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

  // Pagamento: fica pendente até ser confirmado; depois a pessoa é membro e o dono ganha 80%.
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
  assert.equal(earnings.body.sources.groupsKz, 2000);
});

test("monthly secret groups: pay a month, renew in the last days, reminder and removal when it ends", { skip }, async () => {
  const stamp = Date.now();
  const owner = await makeUser(`gm_owner_${stamp}`);
  const fan = await makeUser(`gm_fan_${stamp}`);
  await setBirth(owner, yearsAgo(30));
  await setBirth(fan, yearsAgo(25));
  const body = { name: `Clube Mensal ${stamp}`, isSecret: true, accessBilling: "monthly", accessPrice: 25000 };
  assert.equal((await call("POST", "/groups", owner, body)).status, 400, "mensal: no máximo 20 000 Kz");
  assert.equal((await call("POST", "/groups", owner, { ...body, accessBilling: "anual" })).status, 400);
  assert.equal((await call("POST", "/groups", owner, { ...body, accessBilling: "once", accessPrice: 60000 })).status, 400, "único: no máximo 50 000 Kz");
  const created = await call("POST", "/groups", owner, { ...body, accessPrice: 3000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.group.access_billing, "monthly");
  const id = created.body.group.id;

  // Pagar o primeiro mês: fica membro com acesso durante 30 dias.
  const pay = async () => {
    await call("POST", `/groups/${id}/access`, fan, { name: body.name });
    const row = (await pool.query("SELECT id,billing FROM group_access_purchases WHERE group_id=$1 AND user_id=$2 AND status='pending' ORDER BY id DESC LIMIT 1", [id, fan.id])).rows[0];
    assert.equal(row.billing, "monthly");
    await payments.fulfill("group_access", row.id, {});
    return row.id;
  };
  const first = await pay();
  const detail = (await call("GET", `/groups/${id}`, fan)).body.group;
  assert.equal(detail.is_member, true);
  const days = until => Math.round((new Date(until).getTime() - Date.now()) / 86_400_000);
  assert.equal(days(detail.my_access_until), 30);
  assert.equal(detail.access_billing, "monthly");
  const receipt = (await call("GET", `/payments/group_access/${first}/receipt`, fan)).body.payment;
  assert.match(receipt.description, /^Mensalidade do grupo «.+» \(1 mês\)$/);

  // Renovar só nos últimos 7 dias; renovar cedo soma 30 dias ao que falta.
  assert.equal((await call("POST", `/groups/${id}/access`, fan, { name: body.name })).status, 409, "ainda faltam 30 dias");
  await pool.query("UPDATE group_members SET access_until=NOW() + INTERVAL '5 days' WHERE group_id=$1 AND user_id=$2", [id, fan.id]);
  await pay();
  assert.equal(days((await call("GET", `/groups/${id}`, fan)).body.group.my_access_until), 35);
  assert.equal((await call("GET", "/payouts", owner)).body.sources.groupsKz, 4800, "80% de dois meses de 3 000 Kz");

  // 3 dias antes: aviso. Depois do fim: sai do grupo e deixa de o ver.
  await pool.query("UPDATE group_members SET access_until=NOW() + INTERVAL '2 days', renewal_reminded_at=NULL WHERE group_id=$1 AND user_id=$2", [id, fan.id]);
  await maintainGroupAccess({ pool });
  await maintainGroupAccess({ pool }); // o aviso só vai uma vez
  const reminders = await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND text LIKE 'O teu acesso ao grupo%acaba%'", [fan.id]);
  assert.equal(reminders.rowCount, 1);
  await pool.query("UPDATE group_members SET access_until=NOW() - INTERVAL '1 minute' WHERE group_id=$1 AND user_id=$2", [id, fan.id]);
  await maintainGroupAccess({ pool });
  assert.equal((await call("GET", `/groups/${id}`, fan)).status, 404, "sem acesso, o grupo secreto volta a ficar escondido");
  assert.equal((await call("GET", `/posts?groupId=${id}`, fan)).status, 403);
  assert.ok((await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role='owner'", [id, owner.id])).rowCount, "o dono nunca sai");

  // Pode voltar a entrar pagando outro mês.
  await pay();
  assert.equal(days((await call("GET", `/groups/${id}`, fan)).body.group.my_access_until), 30);
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

test("page owners can upload public logo and cover images", { skip }, async () => {
  const created = await call("POST", "/pages", users.ana, { name: "Imagens da página" });
  const id = created.body.page.id;
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#D4AF37" } }).png().toBuffer();
  const upload = async (kind, user) => {
    const form = new FormData();
    form.append("image", new Blob([png], { type: "image/png" }), "imagem.png");
    const response = await fetch(`${baseUrl}/pages/${id}/${kind}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${user.token}` },
      body: form
    });
    return { status: response.status, body: await response.json() };
  };
  const unauthorized = await upload("logo", users.bruno);
  assert.equal(unauthorized.status, 403);
  const logo = await upload("logo", users.ana);
  const cover = await upload("cover", users.ana);
  assert.equal(logo.status, 200);
  assert.equal(cover.status, 200);
  assert.equal(logo.body.kind, "logo");
  assert.equal(cover.body.kind, "cover");

  const page = (await call("GET", "/pages", users.bruno)).body.pages.find(item => item.id === id);
  assert.equal(page.logo_url, logo.body.url);
  assert.equal(page.cover_url, cover.body.url);
  try {
    const served = await fetch(baseUrl.replace(/\/api$/, "") + logo.body.url);
    assert.equal(served.status, 200);
    assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).format, "webp");
  } finally {
    await require("node:fs/promises").unlink(require("node:path").join(__dirname, "..", "uploads", require("node:path").basename(logo.body.url))).catch(() => {});
    await require("node:fs/promises").unlink(require("node:path").join(__dirname, "..", "uploads", require("node:path").basename(cover.body.url))).catch(() => {});
  }
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

test("phone number: required at registration, any CPLP country, unverified until the SMS code and never public", { skip }, async () => {
  const stamp = Date.now();
  const ip = { "x-forwarded-for": "10.0.2.1" };
  const register = extra => call("POST", "/auth/register", null, {
    username: `tel_${stamp}_${extra.n}`, email: `tel${stamp}${extra.n}@example.com`, password: "uma frase bem comprida",
    displayName: "Tel", birthDate: yearsAgo(25), ...extra.body }, ip);
  const savedPhone = async n => (await pool.query("SELECT phone FROM users WHERE username=$1", [`tel_${stamp}_${n}`])).rows[0].phone;
  assert.equal((await register({ n: 1, body: { phone: "12345" } })).status, 400, "número inválido");
  assert.equal((await register({ n: 2, body: { phone: "+244 923 456 789" } })).status, 201, "aceita +244 e espaços");
  assert.equal(await savedPhone(2), "+244923456789", "guardado no formato internacional");
  assert.equal((await register({ n: 3, body: { phone: "923456789" } })).status, 201,
    "por confirmar, o mesmo número pode estar em duas contas (não revela quem usa o Tchilar nem deixa ocupar o número de outros)");
  assert.equal((await register({ n: 4, body: {} })).status, 400, "é obrigatório");
  assert.equal((await register({ n: 5, body: { phone: "11 91234-5678", phoneCountry: "BR" } })).status, 201, "Brasil, com o país escolhido");
  assert.equal(await savedPhone(5), "+5511912345678");
  assert.equal((await register({ n: 6, body: { phone: "+351 912 345 678" } })).status, 201, "Portugal, com indicativo");
  assert.equal(await savedPhone(6), "+351912345678");
  assert.equal((await register({ n: 7, body: { phone: "+33 612 345 678" } })).status, 400, "fora da CPLP");

  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "923456789" })).status, 200, "não revela que o número tem conta");
  // Trocar um número já guardado pede a palavra-passe da conta.
  const bcrypt = require("bcryptjs");
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash("palavra da carla", 4), users.carla.id]);
  const noPassword = await call("PATCH", "/auth/me", users.carla, { phone: "00244 912 000 111" });
  assert.equal(noPassword.status, 403);
  assert.equal(noPassword.body.code, "password_required");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "00244 912 000 111", password: "errada" })).status, 403);
  assert.equal((await call("GET", "/auth/me", users.carla)).body.user.phone, "+244923456789", "sem a palavra-passe o número não muda");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "923 456 789" })).status, 200, "guardar o mesmo número não pede palavra-passe");
  const saved = await call("PATCH", "/auth/me", users.carla, { phone: "00244 912 000 111", password: "palavra da carla" });
  assert.equal(saved.body.user.phone, "+244912000111");
  assert.equal((await call("GET", "/auth/me", users.carla)).body.user.phone, "+244912000111");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { bio: "sem mexer no telemóvel" })).body.user.phone, "+244912000111");
  assert.equal(JSON.stringify((await call("GET", "/users/carla", users.ana)).body).includes("912000111"), false, "não aparece no perfil público");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "" })).status, 403, "remover também pede a palavra-passe");
  assert.equal((await call("PATCH", "/auth/me", users.carla, { phone: "", password: "palavra da carla" })).body.user.phone, null, "vazio apaga");
});

test("SMS codes are limited: one per minute, five per number a day, and a daily ceiling for the whole site", { skip }, async () => {
  const bcrypt = require("bcryptjs");
  const jwt = require("jsonwebtoken");
  const stamp = Date.now();
  const number = `+3519120${String(stamp).slice(-5)}`;
  const row = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,phone) VALUES($1,$2,$3,'Limites',TRUE,$4) RETURNING id,username,auth_version`,
    [`sms_${stamp}`, `sms${stamp}@example.com`, await bcrypt.hash("uma frase bem comprida", 4), number])).rows[0];
  const person = { ...row, token: jwt.sign({ id: row.id, username: row.username, version: row.auth_version }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  const send = (n, body = {}) => call("POST", "/auth/phone/send-code", person, body, { "x-forwarded-for": `10.0.9.${n}` });
  const age = minutes => pool.query("UPDATE sms_sends SET created_at=created_at - ($2 || ' minutes')::interval WHERE phone=$1", [number, String(minutes)]);

  assert.deepEqual((await call("GET", "/auth/phone/channels", null)).body.channels, ["sms"]);
  const first = await send(1);
  assert.equal(first.status, 200, first.body.error);
  assert.equal(first.body.channel, "sms");
  const again = await send(2);
  assert.equal(again.status, 429, "um código por minuto");
  assert.equal(again.body.reason, "cooldown");
  for (let i = 0; i < 4; i += 1) {
    await age(2);
    assert.equal((await send(10 + i)).status, 200, `envio ${i + 2}`);
  }
  await age(2);
  const sixth = await send(20);
  assert.equal(sixth.status, 429, "no máximo 5 por número por dia");
  assert.equal(sixth.body.reason, "phone_daily");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM sms_sends WHERE phone=$1 AND purpose='confirm'", [number])).rows[0].n, 5);

  // Teto do Tchilar: com SMS_DAILY_LIMIT atingido, ninguém recebe mais códigos hoje.
  await pool.query("DELETE FROM sms_sends WHERE phone=$1", [number]);
  // Pelo menos um envio hoje (de outro número), para o teto não ser 0 (0 quer dizer "sem teto").
  await pool.query("INSERT INTO sms_sends(phone,channel,purpose) VALUES('+244900000001','sms','confirm')");
  const today = (await pool.query(`SELECT COUNT(*)::int AS n FROM sms_sends
    WHERE created_at > date_trunc('day', NOW() AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda'`)).rows[0].n;
  process.env.SMS_DAILY_LIMIT = String(today);
  try {
    const capped = await send(30);
    assert.equal(capped.status, 429);
    assert.equal(capped.body.reason, "daily_limit");
    assert.match(capped.body.error, /email/);
  } finally {
    delete process.env.SMS_DAILY_LIMIT;
  }
});

test("sign in with the phone number instead of the email, only once the number is confirmed", { skip }, async () => {
  const bcrypt = require("bcryptjs");
  const stamp = Date.now().toString(36);
  const id = (await pool.query(
    "INSERT INTO users(username,email,password_hash,display_name,email_verified,phone) VALUES($1,$2,$3,'Telefone',TRUE,'+258841234567') RETURNING id",
    [`numero_${stamp}`, `numero${stamp}@example.com`, await bcrypt.hash("uma frase bem comprida", 4)])).rows[0].id;
  const ip = { "x-forwarded-for": "10.0.2.2" };
  const login = body => call("POST", "/auth/login", null, { password: "uma frase bem comprida", ...body }, ip);

  assert.equal((await login({ identifier: "+258841234567" })).status, 401, "número por confirmar não serve para entrar");
  await pool.query("UPDATE users SET phone_verified_at=NOW() WHERE id=$1", [id]);
  const international = await login({ identifier: "+258 84 123 4567" });
  assert.equal(international.status, 200, international.body.error);
  assert.equal(international.body.user.id, id);
  assert.equal((await login({ identifier: "841234567", phoneCountry: "MZ" })).body.user?.id, id, "número nacional com o país");
  assert.equal((await login({ email: "00258841234567" })).body.user?.id, id, "apps antigas mandam tudo em 'email'");
  assert.equal((await login({ identifier: "841234567" })).status, 400, "sem país, um número moçambicano não é angolano válido");
  assert.equal((await login({ identifier: "+258841234567", password: "errada errada" })).status, 401);
  assert.equal((await login({ identifier: "+244999999999" })).status, 401, "número sem conta: a mesma resposta que palavra-passe errada");
});

test("SMS: confirm the number, the number moves to whoever confirms it, and recover the account by SMS", { skip }, async () => {
  const bcrypt = require("bcryptjs");
  const stamp = Date.now().toString(36);
  const number = "+351912000777";
  const make = async (name, verified) => {
    const row = (await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name,email_verified,phone,phone_verified_at)
       VALUES($1,$2,$3,$4,TRUE,$5,${verified ? "NOW()" : "NULL"}) RETURNING id,username,auth_version`,
      [`${name}_${stamp}`, `${name}${stamp}@example.com`, await bcrypt.hash("uma frase bem comprida", 4), name, number])).rows[0];
    return { ...row, token: jwt.sign({ id: row.id, username: row.username, version: row.auth_version }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  };
  const old = await make("antigo", true);
  const fresh = await make("novo", false);
  const ip = { "x-forwarded-for": "10.0.3.1" };

  // Confirmar o número: código errado, depois o certo.
  const sent = await call("POST", "/auth/phone/send-code", fresh, {}, ip);
  assert.equal(sent.status, 200, sent.body.error);
  assert.equal(sent.body.devCode, undefined, "o código nunca vai na resposta fora de desenvolvimento");
  assert.equal((await call("POST", "/auth/phone/verify", fresh, { code: "000000" }, ip)).status, 400);
  const verified = await call("POST", "/auth/phone/verify", fresh, { code: smsCodes.get(number) }, ip);
  assert.equal(verified.status, 200, verified.body.error);
  assert.ok(verified.body.user.phone_verified_at);
  const previous = (await pool.query("SELECT phone_verified_at FROM users WHERE id=$1", [old.id])).rows[0];
  assert.equal(previous.phone_verified_at, null, "quem tinha o número confirmado perde-o");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND type='privacy'", [old.id])).rows[0].n, 1);
  assert.equal((await call("POST", "/auth/phone/send-code", fresh, {}, ip)).status, 409, "já confirmado");

  // Mudar de número volta a pedir confirmação.
  assert.equal((await call("PATCH", "/auth/me", fresh, { phone: "+351912000778", password: "uma frase bem comprida" }, ip)).body.user.phone_verified_at, null);
  await pool.query("UPDATE users SET phone=$1,phone_verified_at=NOW() WHERE id=$2", [number, fresh.id]);

  // Recuperar a conta: o pedido responde igual com ou sem conta; só o número confirmado recebe código.
  // (O código de confirmação acabou de sair para este número: "passa o minuto" de espera entre códigos.)
  await pool.query("UPDATE sms_sends SET created_at=created_at - INTERVAL '2 minutes' WHERE phone=$1", [number]);
  const unknown = await call("POST", "/auth/forgot-password/phone", null, { phone: "+351912000999" }, { "x-forwarded-for": "10.0.3.2" });
  assert.equal(unknown.status, 200);
  assert.equal(smsCodes.has("+351912000999"), false, "sem conta não sai SMS");
  const asked = await call("POST", "/auth/forgot-password/phone", null, { phone: "912 000 777", phoneCountry: "PT" }, { "x-forwarded-for": "10.0.3.3" });
  assert.equal(asked.body.message, unknown.body.message);
  const reset = body => call("POST", "/auth/reset-password/phone", null, { phone: number, password: "outra frase bem comprida", ...body }, { "x-forwarded-for": "10.0.3.4" });
  assert.equal((await reset({ code: "000000" })).status, 400);
  assert.equal((await reset({ code: smsCodes.get(number), password: "curta" })).status, 400, "palavra-passe fraca");
  const done = await reset({ code: smsCodes.get(number) });
  assert.equal(done.status, 200, done.body.error);
  assert.equal((await call("GET", "/auth/me", fresh)).status, 401, "as sessões antigas terminam");
  const login = await call("POST", "/auth/login", null, { identifier: number, password: "outra frase bem comprida" }, { "x-forwarded-for": "10.0.3.5" });
  assert.equal(login.status, 200, login.body.error);
  assert.equal(login.body.user.id, fresh.id);
});

test("official Tchilar page is followed by all users and assigned to its configured email", { skip }, async () => {
  const official = (await pool.query("SELECT id,is_official,owner_id,admin_email FROM pages WHERE is_official")).rows[0];
  assert.ok(official, "migration creates the official page");
  assert.equal(official.is_official, true);
  assert.equal(official.owner_id, null, "the requested email is not registered yet");
  assert.equal(official.admin_email, "oficial@tchilar.invalid");
  assert.equal((await pool.query("SELECT 1 FROM page_followers WHERE page_id=$1 AND user_id=$2", [official.id, users.ana.id])).rowCount, 1,
    "accounts that existed before the migration are followed");

  const stamp = Date.now();
  const registeredAdmin = await call("POST", "/auth/register", null, {
    username: `tchilar_admin_${stamp}`,
    email: "oficial@tchilar.invalid",
    password: "uma frase de teste bastante longa",
    displayName: "Administrador Tchilar",
    birthDate: yearsAgo(30),
    phone: "923000431"
  });
  assert.equal(registeredAdmin.status, 201, registeredAdmin.body.error);
  assert.equal((await pool.query("SELECT owner_id FROM pages WHERE is_official")).rows[0].owner_id, null,
    "registering with the admin email does not give the page before the email is confirmed");

  // Confirmar o email (o que a ligação do email faz) passa a página para essa conta.
  await pool.query("UPDATE users SET email_verified=TRUE WHERE id=$1", [registeredAdmin.body.user.id]);
  const assigned = (await pool.query("SELECT owner_id FROM pages WHERE is_official")).rows[0];
  assert.equal(assigned.owner_id, registeredAdmin.body.user.id, "the confirmed email becomes page owner without granting site-wide admin");
  assert.equal((await pool.query("SELECT 1 FROM page_followers WHERE page_id=$1 AND user_id=$2", [official.id, registeredAdmin.body.user.id])).rowCount, 0,
    "the owner is not listed as a follower of the page");

  const newUser = await call("POST", "/auth/register", null, {
    username: `novo_tchilar_${stamp}`,
    email: `novo_tchilar_${stamp}@example.com`,
    password: "uma frase de teste bastante longa",
    displayName: "Nova pessoa",
    birthDate: yearsAgo(25),
    phone: "912000443"
  });
  assert.equal(newUser.status, 201, newUser.body.error);
  assert.equal((await pool.query("SELECT 1 FROM page_followers WHERE page_id=$1 AND user_id=$2", [official.id, newUser.body.user.id])).rowCount, 1,
    "new registrations are followed automatically");

  const listed = (await call("GET", "/pages", users.ana)).body.pages.find(page => page.id === official.id);
  assert.equal(listed.is_official, true);
  assert.equal(listed.owner_username, registeredAdmin.body.user.username);
  assert.equal(listed.is_following, true);
  const anonymous = (await call("GET", "/pages", null)).body.pages.find(page => page.id === official.id);
  assert.equal(anonymous.is_following, false);
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

test("page owners manage page events, lives and external offers; visitors cannot create them", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const owner = await makeUser(`page_owner_${stamp}`);
  const visitor = await makeUser(`page_visitor_${stamp}`);
  const page = (await call("POST", "/pages", owner, { name: "Ateliê Digital", pageType: "loja", category: "negocios" })).body.page;

  const startsAt = new Date(Date.now() + 3 * 86400000).toISOString();
  assert.equal((await call("POST", "/events", visitor, { name: "Aula", startsAt, pageId: page.id })).status, 403);
  const image = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#0077B6" } }).png().toBuffer();
  const form = new FormData();
  form.append("name", "Aula aberta");
  form.append("startsAt", startsAt);
  form.append("pageId", String(page.id));
  form.append("image", new Blob([image], { type: "image/png" }), "evento.png");
  const response = await fetch(`${baseUrl}/events`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: form });
  assert.equal(response.status, 201);
  const event = (await response.json()).event;
  assert.equal(event.page_id, page.id);
  assert.ok(event.image_url);
  const eventImageUrl = baseUrl.replace(/\/api$/, "") + event.image_url;
  const imageResponse = await fetch(eventImageUrl);
  assert.equal(imageResponse.status, 200);
  assert.equal((await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata()).format, "webp");
  const listedEvent = (await call("GET", `/events?pageId=${page.id}`, visitor)).body.events[0];
  assert.equal(listedEvent.page_name, page.name);
  assert.equal(listedEvent.image_url, event.image_url);
  assert.equal((await call("GET", `/events/${event.id}`, visitor)).body.event.image_url, event.image_url);
  assert.equal((await call("POST", `/events/${event.id}/rsvp`, visitor)).status, 200);
  assert.equal((await call("DELETE", `/events/${event.id}`, visitor)).status, 404);
  assert.equal((await call("DELETE", `/events/${event.id}`, owner)).status, 200);
  assert.equal((await fetch(eventImageUrl)).status, 404);

  await pool.query("INSERT INTO page_followers(page_id,user_id) VALUES($1,$2)", [page.id, visitor.id]);
  assert.equal((await call("POST", "/lives", visitor, { title: "Direto alheio", pageId: page.id })).status, 403);
  const liveId = (await call("POST", "/lives", owner, { title: "Aula ao vivo", pageId: page.id })).body.id;
  const live = (await call("GET", `/lives/${liveId}`, visitor)).body.live;
  assert.deepEqual([live.page_id, live.page_name], [page.id, page.name]);
  assert.ok((await call("GET", "/notifications", visitor)).body.notifications.some(item => item.type === "live"));
  await call("POST", `/lives/${liveId}/end`, owner);

  const offerInput = {
    title: "Curso de design", description: "Aulas gravadas para iniciantes.", priceKz: 10000,
    discountPercent: 15, promoCode: "DESIGN15", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    checkoutUrl: "https://wa.me/244923456789"
  };
  assert.equal((await call("POST", `/pages/${page.id}/offers`, visitor, offerInput)).status, 403);
  // Loja: desligada por omissão; sem ela não há ofertas nem separador "Loja".
  assert.equal(page.shop_enabled, false);
  assert.equal((await call("POST", `/pages/${page.id}/offers`, owner, offerInput)).status, 409, "sem loja ligada");
  assert.deepEqual((await call("GET", `/pages/${page.id}/offers`, visitor)).body, { offers: [], shop_enabled: false });
  assert.equal((await call("PATCH", `/pages/${page.id}/about`, visitor, { shop_enabled: true })).status, 403);
  const withShop = await call("PATCH", `/pages/${page.id}/about`, owner, { shop_enabled: true });
  assert.equal(withShop.body.page.shop_enabled, true);
  assert.equal((await call("GET", "/pages", visitor)).body.pages.find(item => item.id === page.id).shop_enabled, true);
  const shopFromStart = (await call("POST", "/pages", owner, { name: "Loja já aberta", pageType: "loja", category: "negocios", shopEnabled: true })).body.page;
  assert.equal(shopFromStart.shop_enabled, true, "pode ligar a loja ao criar a página");
  assert.equal((await call("POST", `/pages/${page.id}/offers`, owner, { ...offerInput, checkoutUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await call("POST", `/pages/${page.id}/offers`, owner, { ...offerInput, discountPercent: 0 })).status, 400);
  const created = await call("POST", `/pages/${page.id}/offers`, owner, offerInput);
  assert.equal(created.status, 201);
  assert.equal(created.body.offer.promo_code, "DESIGN15");
  assert.equal((await call("POST", `/pages/${page.id}/offers`, owner, offerInput)).status, 409);
  const listed = (await call("GET", `/pages/${page.id}/offers`, visitor)).body.offers;
  assert.equal(listed.length, 1);
  const offerPost = (await call("GET", `/posts?pageId=${page.id}`, visitor)).body.posts[0];
  assert.match(offerPost.body, /DESIGN15/);
  assert.equal((await call("DELETE", `/pages/${page.id}/offers/${created.body.offer.id}`, visitor)).status, 404);
  assert.equal((await call("DELETE", `/pages/${page.id}/offers/${created.body.offer.id}`, owner)).status, 200);
  assert.equal((await call("GET", `/pages/${page.id}/offers`, visitor)).body.offers.length, 0);
  assert.equal((await call("GET", `/posts?pageId=${page.id}`, visitor)).body.posts.length, 0, "removing an offer hides its automatic feed post");
});

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

  const ip = { "x-forwarded-for": "10.0.1.1" };
  const web = (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida" }, ip)).body.token;
  const app = (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida", client: "app" }, ip)).body.token;
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
  const login = async (body, headers) => (await call("POST", "/auth/login", null, { email, password: "uma frase bem comprida", ...body },
    { "x-forwarded-for": "10.0.1.2", ...headers })).body.token;

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
  assert.equal(receipt.body.payment.seller, null, "Estrelas são vendidas pelo próprio Tchilar");

  // Subscrição: quem vende é o criador, com os dados para recibos que pôs na conta.
  const billingCreator = await makeUser(`billing_${Date.now()}`);
  const sub = (await pool.query(`INSERT INTO subscription_payments(subscriber_id,creator_id,amount_kz,status,paid_at)
    VALUES($1,$2,2000,'paid',NOW()) RETURNING id`, [users.ana.id, billingCreator.id])).rows[0].id;
  const subReceipt = async () => (await call("GET", `/payments/subscription/${sub}/receipt`, users.ana)).body.payment.seller;
  assert.equal((await subReceipt()).name, (await pool.query("SELECT display_name FROM users WHERE id=$1", [billingCreator.id])).rows[0].display_name,
    "sem dados para recibos aparece o nome do perfil");
  assert.equal((await call("PATCH", "/auth/me/billing", billingCreator, { sellerName: "Carla", sellerNif: "12" })).status, 400);
  const saved = await call("PATCH", "/auth/me/billing", billingCreator, { sellerName: "Carla Lda", sellerNif: "500 111 222 3", sellerAddress: "Luanda" });
  assert.equal(saved.body.user.billing_nif, "5001112223");
  assert.deepEqual(await subReceipt(), { name: "Carla Lda", nif: "5001112223", address: "Luanda" });
  await call("PATCH", "/auth/me/billing", billingCreator, { sellerName: "", sellerNif: "", sellerAddress: "" });
  assert.equal((await subReceipt()).nif, null, "apagar os dados tira o NIF dos recibos");

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
  assert.equal((await call("GET", "/admin/promotion-codes", users.carla)).status, 200);
  assert.equal((await call("GET", "/admin/content", users.carla)).status, 403);
  assert.equal((await call("GET", "/admin/actions", users.carla)).status, 403);
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.carla, { role: "moderation" })).status, 403);

  await pool.query("UPDATE users SET totp_enabled_at=NOW() WHERE id=$1", [users.dino.id]);
  assert.equal((await call("POST", `/admin/users/${users.bruno.id}/role`, users.bruno, { role: "finance" })).status, 400, "nobody changes their own role");
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.bruno, { role: "chefe" })).status, 400);
  assert.equal((await call("POST", `/admin/users/${users.dino.id}/role`, users.bruno, { role: "moderation" })).status, 200);
  assert.equal((await call("GET", "/admin/content?type=post", users.dino)).status, 200);
  assert.equal((await call("GET", "/admin/payments", users.dino)).status, 403);
  assert.equal((await call("GET", "/admin/promotion-codes", users.dino)).status, 403);
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

test("each person chooses where to receive: bank, Express, PayPay, PayPal or RedotPay", { skip }, async () => {
  const { decrypt, loadKey } = require("./payouts");
  const key = loadKey({ payoutKey: process.env.PAYOUT_ENCRYPTION_KEY });
  const methods = (await call("GET", "/payouts", users.dino)).body.methods.map(item => item.id);
  assert.deepEqual(methods, ["iban", "express", "paypay", "paypal", "redotpay"]);
  const cases = [
    [{ method: "express", holderName: "Dino", destination: "923 456 789" }, "Multicaixa Express", "+244923456789"],
    [{ method: "paypay", holderName: "Dino", destination: "+244 912 345 678" }, "PayPay África", "+244912345678"],
    [{ method: "paypal", holderName: "Dino", destination: "Dino@Example.com" }, "PayPal", "dino@example.com"],
    [{ method: "redotpay", holderName: "Dino", destination: "87654321" }, "RedotPay", "87654321"],
    // Pedido antigo (só banco): continua a funcionar.
    [{ holderName: "Dino", bankName: "BFA", iban: "AO06 0040 0001 0123 4567 8901 2" }, "BFA", "AO06004000010123456789012"]
  ];
  for (const [payload, label, stored] of cases) {
    const saved = await call("PUT", "/payouts/account", users.dino, payload);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const account = (await call("GET", "/payouts", users.dino)).body.account;
    assert.equal(account.method, payload.method || "iban");
    assert.ok(account.method === "iban" ? account.bank_name === label : account.method_label === label);
    assert.ok(!account.destination.includes(stored), "only a masked destination goes back to the person");
    const row = (await pool.query("SELECT method,iban_encrypted FROM payout_accounts WHERE user_id=$1", [users.dino.id])).rows[0];
    assert.ok(!row.iban_encrypted.includes(stored), "the destination is stored encrypted");
    assert.equal(decrypt(key, row.iban_encrypted), stored);
  }
  for (const payload of [{ method: "express", holderName: "Dino", destination: "+351912345678" }, { method: "paypal", holderName: "Dino", destination: "dino" },
    { method: "redotpay", holderName: "Dino", destination: "x" }, { method: "western", holderName: "Dino", destination: "x" }, { method: "paypal", holderName: "", destination: "d@example.com" }]) {
    assert.equal((await call("PUT", "/payouts/account", users.dino, payload)).status, 400, JSON.stringify(payload));
  }
  await pool.query("DELETE FROM payout_accounts WHERE user_id=$1", [users.dino.id]);
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
  // Com imagem (multipart, como a app e o site enviam): a imagem fica guardada e aparece na lista do grupo.
  const eventForm = new FormData();
  eventForm.append("name", "Torneio com cartaz");
  eventForm.append("startsAt", startsAt);
  eventForm.append("image", new Blob([await sharp({ create: { width: 800, height: 450, channels: 3, background: "#E30613" } }).png().toBuffer()], { type: "image/png" }), "cartaz.png");
  const withImage = await fetch(`${baseUrl}/groups/${id}/events`, { method: "POST", headers: { Authorization: `Bearer ${carla.token}` }, body: eventForm });
  assert.equal(withImage.status, 201);
  const imageEvent = (await withImage.json()).event;
  assert.match(imageEvent.image_url, /^\/uploads\//);
  assert.equal((await call("GET", `/groups/${id}/events`, bruno)).body.events.find(e => e.id === imageEvent.id).image_url, imageEvent.image_url);
  // Quem não é membro não consegue criar (e a imagem enviada não fica guardada).
  const outsiderForm = new FormData();
  outsiderForm.append("name", "Intruso");
  outsiderForm.append("startsAt", startsAt);
  const outsider = await fetch(`${baseUrl}/groups/${id}/events`, { method: "POST", headers: { Authorization: `Bearer ${dino.token}` }, body: outsiderForm });
  assert.equal(outsider.status, 403);
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

test("a creator's published course goes back to review when lessons or the cover change", { skip }, async () => {
  const course = (await pool.query("INSERT INTO courses(owner_id,title,summary,status,published_at) VALUES($1,'Curso aprovado','Resumo','published',NOW()) RETURNING id", [users.bruno.id])).rows[0].id;
  const status = async () => (await pool.query("SELECT status FROM courses WHERE id=$1", [course])).rows[0].status;
  const added = await call("POST", `/courses/${course}/lessons`, users.bruno, { title: "Aula nova", body: "Conteúdo novo que ninguém reviu" });
  assert.equal(added.status, 201);
  assert.equal(added.body.status, "review");
  assert.equal(await status(), "review", "acrescentar uma aula a um curso à venda volta à revisão");

  await pool.query("UPDATE courses SET status='published' WHERE id=$1", [course]);
  assert.equal((await call("PATCH", `/courses/${course}/lessons/${added.body.id}`, users.bruno, { title: "Aula mudada" })).body.status, "review");
  await pool.query("UPDATE courses SET status='published' WHERE id=$1", [course]);
  assert.equal((await call("DELETE", `/courses/${course}/lessons/${added.body.id}`, users.bruno)).body.status, "review");
});

test("sessions expire after 6 months without use, but not while they are being used", { skip }, async () => {
  const { createSession } = require("./sessions");
  const stamp = Date.now().toString(36);
  const user = (await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,'x','Inativo',TRUE) RETURNING id,username",
    [`inativo_${stamp}`, `inativo${stamp}@example.com`])).rows[0];
  // Dois aparelhos com sessão (sem passar pelo login, que tem limite de tentativas).
  const token = async () => jwt.sign({ id: user.id, username: user.username, version: 0, sid: await createSession(pool, user.id, { client: "web" }) }, process.env.JWT_SECRET);
  const old = await token();
  const recent = await token();
  const age = (value, days) => pool.query(`UPDATE user_sessions SET last_seen_at=NOW() - ($2::int * INTERVAL '1 day') WHERE id=$1`, [jwt.decode(value).sid, days]);

  await age(old, 181);
  await age(recent, 1);
  const expired = await call("GET", "/auth/me", { token: old });
  assert.equal(expired.status, 401, "6 meses sem uso: termina");
  assert.equal(expired.body.sessionExpired, true);
  assert.equal((await call("GET", "/auth/me", { token: recent })).status, 200, "usada ontem: continua");
  const list = (await call("GET", "/auth/sessions", { token: recent })).body.sessions;
  assert.equal(list.length, 1, "a sessão expirada já não aparece na lista de aparelhos");
});

test("PayPal and RedotPay payments deliver once, and never when underpaid", { skip }, async () => {
  const { createPayments } = require("./payments");
  const delivered = [];
  const fakeRedot = { currency: "USD", createOrder: async ({ paymentId }) => ({ orderSn: `SN${paymentId}`, payUrl: `https://pay.example/${paymentId}`, amount: "10.00" }) };
  let captureState = "pending";
  const fakePaypal = { currency: "USD", createOrder: async ({ paymentId }) => ({ orderId: `PP${paymentId}`, approveUrl: `https://paypal.example/${paymentId}`, value: "10.00" }), capture: async () => captureState };
  const pay = createPayments({ stripe: null, isProduction: true, appUrl: "https://tchilar.ao", currency: "aoa", pool, paypal: fakePaypal, redotpay: fakeRedot });
  pay.register("teste_global", async refId => { delivered.push(refId); });
  assert.deepEqual(pay.methods, ["paypal", "redotpay"]);

  const redot = await pay.start({ purpose: "teste_global", refId: 501, amountKz: 9200, name: "Teste", userId: users.ana.id, successPath: "/estrelas?pagamento=sucesso", cancelPath: "/estrelas", method: "redotpay" });
  assert.equal(redot.checkoutUrl, `https://pay.example/${redot.paymentId}`);
  const notice = { outerOrderSn: `tchilar-${redot.paymentId}`, orderStatus: 2, orderAmount: "10.00", orderCurrency: "USD" };
  assert.equal(await pay.handleRedotPayNotification({ ...notice, orderAmount: "9.00" }), "underpaid");
  assert.deepEqual(delivered, [], "pago a menos: nada é entregue");
  assert.equal(await pay.handleRedotPayNotification(notice), "settled");
  await pay.handleRedotPayNotification(notice);
  assert.deepEqual(delivered, [501], "aviso repetido não entrega duas vezes");

  const paypal = await pay.start({ purpose: "teste_global", refId: 502, amountKz: 9200, name: "Teste", userId: users.ana.id, successPath: "/estrelas?pagamento=sucesso", cancelPath: "/estrelas", method: "paypal" });
  assert.equal((await pay.capturePayPal(paypal.paymentId, "OUTRA")).ok, false, "regresso com outra ordem não conta");
  assert.equal((await pay.capturePayPal(paypal.paymentId, `PP${paypal.paymentId}`)).path, "/estrelas", "ainda não aprovado: volta à página de origem");
  captureState = "paid";
  const done = await pay.capturePayPal(paypal.paymentId, `PP${paypal.paymentId}`);
  assert.deepEqual([done.ok, done.path], [true, "/estrelas?pagamento=sucesso"]);
  assert.deepEqual(delivered, [501, 502]);
  assert.equal((await pay.status(paypal.paymentId, users.ana.id)).status, "paid");
});

test("PayPay Africa payments deliver once, only with the full amount confirmed by PayPay", { skip }, async () => {
  const { createPayments } = require("./payments");
  const delivered = [];
  let query = { state: "pending", amount: 0 };
  const fakePaypay = {
    createPayment: async ({ paymentId, payerIp }) => ({ outTradeNo: `TCHILAR${String(paymentId).padStart(6, "0")}`, deeplink: `paypayao://trade/pay?ip=${payerIp}`, dynamicLink: "https://paypay.example/x", expiresAt: new Date(Date.now() + 40 * 60_000) }),
    getState: async () => query
  };
  const pay = createPayments({ stripe: null, isProduction: true, appUrl: "https://tchilar.ao", currency: "aoa", pool, paypay: fakePaypay,
    payerIp: () => "41.63.1.2", qrCode: async text => `data:qr,${text}` });
  pay.register("teste_paypay", async refId => { delivered.push(refId); });
  assert.deepEqual(pay.methods, ["paypay"]);
  assert.deepEqual(pay.upcoming, ["express", "reference", "card", "paypal", "redotpay"], "os outros aparecem como Em breve");

  const started = await pay.start({ purpose: "teste_paypay", refId: 601, amountKz: 1500, name: "Teste", userId: users.ana.id, successPath: "/estrelas?pagamento=sucesso", cancelPath: "/estrelas", method: "paypay" });
  assert.equal(started.method, "paypay");
  assert.equal(started.deeplink, "paypayao://trade/pay?ip=41.63.1.2");
  assert.equal(started.qrCodeUrl, "data:qr,https://paypay.example/x");
  const tradeNo = `TCHILAR${String(started.paymentId).padStart(6, "0")}`;

  assert.equal((await pay.status(started.paymentId, users.ana.id)).status, "pending");
  query = { state: "paid", amount: 1000 };
  await pay.refreshPayPayByTradeNo(tradeNo);
  assert.deepEqual(delivered, [], "pago a menos: nada é entregue");
  assert.equal(await pay.refreshPayPayByTradeNo("TCHILAR999999"), false, "ordem desconhecida não conta");
  query = { state: "paid", amount: 1500 };
  assert.equal(await pay.refreshPayPayByTradeNo(tradeNo), true);
  await pay.refreshPayPayByTradeNo(tradeNo);
  assert.deepEqual(delivered, [601], "aviso repetido não entrega duas vezes");
  assert.equal((await pay.status(started.paymentId, users.ana.id)).status, "paid");
});

test("subscriptions paid month by month: access, renewal reminder, creator share, receipt and refund", { skip }, async () => {
  const creator = users.carla;
  // Pessoa nova (as outras já subscreveram a Carla noutros testes).
  const row = (await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES('subscritora','subscritora@example.com','x','Subscritora',TRUE) RETURNING id,username")).rows[0];
  const fan = { ...row, token: jwt.sign({ id: row.id, username: row.username, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  await pool.query("UPDATE users SET subscription_price=2000 WHERE id=$1", [creator.id]);
  const exclusive = await newPost(creator, { body: "Só para quem subscreve", isExclusive: true });
  const created = (await pool.query("INSERT INTO subscription_payments(subscriber_id,creator_id,amount_kz) VALUES($1,$2,2000) RETURNING id", [fan.id, creator.id])).rows[0];
  assert.equal((await call("GET", `/posts/${exclusive.id}`, fan)).status, 404, "antes de pagar: fechado");

  await payments.fulfill("subscription", created.id, {});
  await payments.fulfill("subscription", created.id, {}); // confirmação repetida do fornecedor
  assert.equal((await call("GET", `/posts/${exclusive.id}`, fan)).status, 200, "pago: aberto");
  const profile = (await call("GET", `/users/${creator.username}`, fan)).body.user;
  assert.equal(profile.is_subscribed, true);
  assert.equal(profile.subscription_manual, true, "não se cobra sozinha");
  assert.equal(profile.subscription_can_renew, false, "renovar só nos últimos 7 dias");
  assert.equal((await call("POST", `/subscriptions/${creator.id}`, fan, { method: "reference" })).status, 409, "mês já pago");
  const earned = (await call("GET", "/payouts", creator)).body.sources.subscriptionsKz;
  assert.equal(earned, 1700, "85% de 2000 Kz");

  // 2 dias antes do fim: um aviso de renovação, uma só vez.
  await pool.query("UPDATE subscriptions SET current_period_end=NOW() + INTERVAL '2 days' WHERE subscriber_id=$1 AND creator_id=$2", [fan.id, creator.id]);
  const before = (await pool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND type='subscription'", [fan.id])).rows[0].n;
  const { registerLocalSubscriptions } = require("./local-subscriptions");
  const reminders = registerLocalSubscriptions({ pool, transaction: async op => op(pool), payments: { register() {} } });
  await reminders.remindRenewals();
  await reminders.remindRenewals();
  const notices = (await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='subscription' ORDER BY id", [fan.id])).rows;
  assert.equal(notices.length, before + 1, "um aviso de renovação, não dois");
  assert.match(notices.at(-1).text, /termina a .* Renova no perfil/);
  assert.equal((await call("GET", `/users/${creator.username}`, fan)).body.user.subscription_can_renew, true);

  // Recibo e reembolso pela equipa: o acesso acaba logo.
  const receipts = (await pool.query("SELECT 1 FROM subscription_payments WHERE id=$1 AND status='paid'", [created.id])).rowCount;
  assert.equal(receipts, 1);
  await pool.query("UPDATE users SET is_admin=TRUE, admin_role='finance', totp_enabled_at=NOW() WHERE id=$1", [users.ana.id]);
  const refund = await call("POST", `/admin/payments/subscription/${created.id}/refund`, users.ana, { note: "Pedido do subscritor" });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  assert.equal((await call("GET", `/posts/${exclusive.id}`, fan)).status, 404, "reembolsado: fechado outra vez");
  assert.equal((await call("GET", "/payouts", creator)).body.sources.subscriptionsKz, earned - 1700, "o mês devolvido sai do saldo");
  await pool.query("UPDATE users SET is_admin=FALSE, admin_role=NULL, totp_enabled_at=NULL WHERE id=$1", [users.ana.id]);
});

test("verification plans activate for one month only after payment and only once", { skip }, async () => {
  const originalStart = payments.start;
  let checkout;
  payments.start = async options => {
    checkout = options;
    return { method: "reference", paymentId: 999, entity: "12345", reference: "123456789", amount: options.amountKz };
  };
  try {
    await pool.query("DELETE FROM follows WHERE following_id=$1", [users.ana.id]);
    await pool.query(
      "INSERT INTO friendships(user_a_id,user_b_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [Math.min(users.ana.id, users.bruno.id), Math.max(users.ana.id, users.bruno.id)]);
    const available = await call("GET", "/creator/verification", users.ana);
    assert.deepEqual(available.body.plans.map(plan => [plan.id, plan.priceKz, plan.minimum_followers]), [
      ["kazola", 5000, 10000], ["bolado", 10000, 15000], ["benga", 20000, 20000]
    ]);
    assert.equal(available.body.followers, 0, "friends do not count as followers");
    assert.equal(available.body.eligible, false);
    assert.ok(available.body.plans.every(plan => !plan.eligible));
    assert.equal((await call("POST", "/creator/verification/checkout", users.ana, { tier: "benga" })).status, 403);
    assert.equal((await call("POST", "/creator/verification/checkout", users.ana, { tier: "unknown" })).status, 400);

    const prefix = `vf${Date.now()}_`;
    const newFollowers = await pool.query(`
      INSERT INTO users(username,email,password_hash,display_name,email_verified)
      SELECT $1 || g::text,$1 || g::text || '@example.com','x','Seguidor ' || g::text,TRUE
      FROM generate_series(1,20000) g RETURNING id`, [prefix]);
    const addFollowers = rows => pool.query(
      "INSERT INTO follows(follower_id,following_id) SELECT follower_id,$2 FROM unnest($1::int[]) AS followers(follower_id)",
      [rows.map(row => row.id), users.ana.id]);
    // Kazola 10 000, Bolado 15 000, Benga 20 000 seguidores.
    const step = async (from, to) => { await addFollowers(newFollowers.rows.slice(from, to)); return (await call("GET", "/creator/verification", users.ana)).body; };
    const eligibleAt = body => body.plans.map(plan => [plan.id, plan.eligible]);
    let state = await step(0, 9999);
    assert.equal(state.followers, 9999);
    assert.equal(state.eligible, false);
    assert.equal((await call("POST", "/creator/verification/checkout", users.ana, { tier: "kazola" })).status, 403);
    state = await step(9999, 10000);
    assert.deepEqual(eligibleAt(state), [["kazola", true], ["bolado", false], ["benga", false]]);
    state = await step(10000, 14999);
    assert.equal(state.plans.find(plan => plan.id === "bolado").eligible, false);
    state = await step(14999, 15000);
    assert.deepEqual(eligibleAt(state), [["kazola", true], ["bolado", true], ["benga", false]]);
    assert.equal((await call("POST", "/creator/verification/checkout", users.ana, { tier: "benga" })).status, 403);
    state = await step(15000, 20000);
    assert.equal(state.followers, 20_000);
    assert.deepEqual(eligibleAt(state), [["kazola", true], ["bolado", true], ["benga", true]]);

    const started = await call("POST", "/creator/verification/checkout", users.ana, { tier: "bolado", method: "reference" });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.equal(checkout.purpose, "verification");
    const beforePayment = (await pool.query("SELECT verification_tier FROM users WHERE id=$1", [users.ana.id])).rows[0];
    assert.equal(beforePayment.verification_tier, null, "checkout alone must not grant the badge");

    await payments.fulfill("verification", checkout.refId, { method: "reference" });
    const paid = (await pool.query("SELECT verification_tier,verification_expires_at FROM users WHERE id=$1", [users.ana.id])).rows[0];
    assert.equal(paid.verification_tier, "bolado");
    assert.ok(new Date(paid.verification_expires_at).getTime() > Date.now() + 27 * 86_400_000);
    const expiry = new Date(paid.verification_expires_at).getTime();
    const profile = (await call("GET", `/users/${users.ana.username}`, users.bruno)).body.user;
    assert.equal(profile.is_verified, true);
    assert.equal(profile.verification_tier, "bolado");

    await pool.query("UPDATE users SET is_creator=TRUE WHERE id=$1", [users.ana.id]);
    await pool.query("UPDATE users SET is_creator=TRUE,verification_tier='benga',verification_expires_at=NOW() + INTERVAL '1 month' WHERE id=$1", [users.bruno.id]);
    const marketplace = (await call("GET", "/creators", null)).body.creators;
    const bengaPosition = marketplace.findIndex(creator => creator.id === users.bruno.id);
    const boladoPosition = marketplace.findIndex(creator => creator.id === users.ana.id);
    assert.ok(bengaPosition >= 0 && boladoPosition >= 0 && bengaPosition < boladoPosition,
      `Benga (${bengaPosition}) must rank above Bolado (${boladoPosition}) in the brand marketplace`);

    await payments.fulfill("verification", checkout.refId, { method: "reference" });
    const repeated = (await pool.query("SELECT verification_expires_at FROM users WHERE id=$1", [users.ana.id])).rows[0];
    assert.equal(new Date(repeated.verification_expires_at).getTime(), expiry, "duplicate confirmation must not extend the month twice");
    assert.equal((await call("POST", "/creator/verification/checkout", users.ana, { tier: "benga" })).status, 409);

    // Páginas: o selo compra-se para a página, com os seguidores da página, e só quem a criou o pode fazer.
    const page = (await call("POST", "/pages", users.ana, { name: `Página verificada ${prefix}`, pageType: "restaurante", category: "alimentacao", subcategory: "cafes" })).body.page;
    assert.ok(page?.id, "page created");
    assert.equal((await call("GET", `/pages/${page.id}/verification`, users.bruno)).status, 404, "only the owner manages verification");
    assert.equal((await call("POST", `/pages/${page.id}/verification/checkout`, users.bruno, { tier: "kazola" })).status, 404);
    let pageState = (await call("GET", `/pages/${page.id}/verification`, users.ana)).body;
    assert.equal(pageState.followers, 1, "account followers do not count for the page (only the creator follows a new page)");
    assert.equal(pageState.active, null, "the account badge is not the page badge");
    assert.equal((await call("POST", `/pages/${page.id}/verification/checkout`, users.ana, { tier: "kazola" })).status, 403);
    await pool.query("INSERT INTO page_followers(page_id,user_id) SELECT $1,unnest($2::int[])",
      [page.id, newFollowers.rows.slice(0, 15000).map(row => row.id)]);
    pageState = (await call("GET", `/pages/${page.id}/verification`, users.ana)).body;
    assert.deepEqual(eligibleAt(pageState), [["kazola", true], ["bolado", true], ["benga", false]]);
    const pageCheckout = await call("POST", `/pages/${page.id}/verification/checkout`, users.ana, { tier: "bolado", method: "reference" });
    assert.equal(pageCheckout.status, 201, JSON.stringify(pageCheckout.body));
    assert.match(checkout.successPath, new RegExp(`^/pages/${page.id}\\?`));
    await payments.fulfill("verification", checkout.refId, { method: "reference" });
    const pagePaid = (await pool.query("SELECT verification_tier,verification_expires_at FROM pages WHERE id=$1", [page.id])).rows[0];
    assert.equal(pagePaid.verification_tier, "bolado");
    assert.ok(new Date(pagePaid.verification_expires_at).getTime() > Date.now() + 27 * 86_400_000);
    const accountAfter = (await pool.query("SELECT verification_expires_at FROM users WHERE id=$1", [users.ana.id])).rows[0];
    assert.equal(new Date(accountAfter.verification_expires_at).getTime(), expiry, "paying for the page must not extend the account badge");
    const listed = (await call("GET", "/pages", users.bruno)).body.pages.find(item => item.id === page.id);
    assert.equal(listed.verification_tier, "bolado");
    assert.equal((await call("POST", `/pages/${page.id}/verification/checkout`, users.ana, { tier: "kazola" })).status, 409);
  } finally {
    payments.start = originalStart;
  }
});

test("promotion codes: the purchase keeps the amount actually paid and max uses is never exceeded", { skip }, async () => {
  // Pagamentos de demonstração próprios (sem métodos): o resultado não depende das chaves que o .env tiver.
  const demo = require("./payments").createPayments({ stripe: null, isProduction: false, appUrl: "http://x", currency: "aoa", pool });
  demo.register("stars", id => pool.query("UPDATE star_purchases SET status='paid',paid_at=NOW() WHERE id=$1", [id]));
  const code = `METADE${Date.now().toString(36).toUpperCase()}`;
  const promo = (await pool.query(
    "INSERT INTO promotion_codes(code,discount_percent,max_uses,applicable_purposes) VALUES($1,50,1,'{stars}') RETURNING id", [code])).rows[0];
  const buy = async () => {
    const id = (await pool.query("INSERT INTO star_purchases(user_id,stars,amount_kz) VALUES($1,100,1000) RETURNING id", [users.ana.id])).rows[0].id;
    return { id, result: await demo.start({ purpose: "stars", refId: id, amountKz: 1000, userId: users.ana.id, name: "Estrelas", promoCode: code }) };
  };

  const first = await buy();
  assert.equal(first.result.activated, true);
  const saved = (await pool.query("SELECT amount_kz::float AS amount, status FROM star_purchases WHERE id=$1", [first.id])).rows[0];
  assert.deepEqual(saved, { amount: 500, status: "paid" }, "o registo guarda o valor pago, não o preço cheio");
  assert.equal((await pool.query("SELECT used_count FROM promotion_codes WHERE id=$1", [promo.id])).rows[0].used_count, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM promotion_code_uses WHERE code_id=$1", [promo.id])).rows[0].n, 1);

  const second = await buy();
  assert.match(second.result.error, /inválido, expirou/, "o código de 1 uso já foi gasto");
  assert.equal((await pool.query("SELECT amount_kz::float AS amount FROM star_purchases WHERE id=$1", [second.id])).rows[0].amount, 1000);
});

test("video monetization: only videos watched to the end count, and the Partner Program is 'coming soon'", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const creator = await makeUser(`video_creator_${stamp}`);
  const viewer = await makeUser(`video_viewer_${stamp}`);
  const video = (await pool.query("INSERT INTO posts(user_id,body,media_url,media_type) VALUES($1,'Vídeo','/uploads/v.mp4','video') RETURNING id", [creator.id])).rows[0].id;
  const photo = (await pool.query("INSERT INTO posts(user_id,body,media_url,media_type) VALUES($1,'Foto','/uploads/f.jpg','image') RETURNING id", [creator.id])).rows[0].id;

  assert.equal((await call("POST", `/posts/${video}/watched`, viewer)).body.recorded, true);
  assert.equal((await call("POST", `/posts/${video}/watched`, viewer)).body.recorded, false, "uma vez por pessoa e por dia");
  assert.equal((await call("POST", `/posts/${video}/watched`, creator)).body.recorded, false, "o próprio não conta");
  assert.equal((await call("POST", `/posts/${photo}/watched`, viewer)).body.recorded, false, "só vídeos");
  await call("POST", "/posts/views", viewer, { ids: [video, photo] });

  const partner = (await call("GET", "/creator/partner", creator)).body;
  assert.equal(partner.open, false, "brevemente");
  assert.equal(partner.checks.find(check => check.key === "views").current, 1, "só a visualização completa conta");
  assert.equal((await call("POST", "/creator/partner/join", creator)).status, 409);

  // Mesmo um parceiro antigo com visualizações de meses fechados não acumula dinheiro enquanto o programa não abrir.
  await pool.query("UPDATE users SET partner_since=NOW() - INTERVAL '90 days' WHERE id=$1", [creator.id]);
  await pool.query("INSERT INTO video_full_views(post_id,viewer_id,viewed_on) VALUES($1,$2,CURRENT_DATE - 60)", [video, viewer.id]);
  const earnings = await call("GET", "/payouts", creator);
  assert.equal(earnings.status, 200, earnings.body.error);
  assert.equal(earnings.body.sources.partnerKz, 0);
  assert.equal(earnings.body.accruing.partnerKz, 0);
});

test("email queue: account emails first, daily limit, retries and expired links", { skip }, async () => {
  const { REDACTED, createEmailQueue, retryDelayMs } = require("./email-queue");
  const sent = [];
  let failNext = 0;
  const transport = { sendMail: async message => {
    if (failNext > 0) { failNext -= 1; throw new Error("421 tente mais tarde"); }
    sent.push(message);
  } };
  await pool.query("DELETE FROM email_queue");
  const queue = createEmailQueue({ pool, transport, from: "Tchilar <teste@example.com>", dailyLimit: 3, hourlyLimit: 0, logger: { error() {} } });

  // Avisos entram primeiro na fila, mas o email de conta passa à frente.
  for (let i = 1; i <= 3; i += 1) await queue.enqueue({ to: `aviso${i}@example.com`, subject: "Aviso", text: "Olá" });
  await queue.enqueue({ to: "conta@example.com", subject: "Confirma", text: "Liga", kind: "account", expiresAt: new Date(Date.now() + 3600_000) });
  await queue.enqueue({ to: "velho@example.com", subject: "Confirma", text: "Liga", kind: "account", expiresAt: new Date(Date.now() - 1000) });

  assert.deepEqual(await queue.processBatch(), { sent: 3, failed: 0 }, "o limite diário (3) trava o resto");
  assert.equal(sent[0].to, "conta@example.com", "o email de conta sai primeiro");
  assert.equal(sent[0].from, "Tchilar <teste@example.com>");
  assert.deepEqual(await queue.processBatch(), { sent: 0, failed: 0 }, "sem margem até passarem 24 h");
  let stats = await queue.stats();
  assert.equal(stats.waiting, 1);
  assert.equal(stats.sent_day, 3);
  assert.equal(stats.expired_week, 1, "a ligação expirada não é enviada");
  const kept = Object.fromEntries((await pool.query("SELECT to_email,body FROM email_queue")).rows.map(row => [row.to_email, row.body]));
  assert.equal(kept["conta@example.com"], REDACTED, "a ligação de uso único não fica guardada depois de enviada");
  assert.equal(kept["velho@example.com"], REDACTED, "nem quando expira");
  assert.equal(kept["aviso1@example.com"], "Olá", "os avisos ficam como foram escritos");

  // Passadas 24 h há margem outra vez; um erro do fornecedor volta à fila com espera.
  await pool.query("UPDATE email_queue SET sent_at=sent_at - INTERVAL '25 hours' WHERE status='sent'");
  failNext = 1;
  assert.deepEqual(await queue.processBatch(), { sent: 0, failed: 1 });
  const retry = (await pool.query("SELECT status,attempts,last_error,next_attempt_at > NOW() AS later FROM email_queue WHERE status='pending'")).rows[0];
  assert.deepEqual([retry.status, retry.attempts, retry.later], ["pending", 1, true]);
  assert.match(retry.last_error, /421/);
  await pool.query("UPDATE email_queue SET next_attempt_at=NOW() WHERE status='pending'");
  assert.deepEqual(await queue.processBatch(), { sent: 1, failed: 0 }, "a nova tentativa sai");

  // Ao fim de 5 tentativas desiste; esperas de 1, 2, 4... minutos, no máximo 1 hora.
  await queue.enqueue({ to: "falha@example.com", subject: "Aviso", text: "Olá" });
  await pool.query("UPDATE email_queue SET attempts=4 WHERE to_email='falha@example.com'");
  failNext = 1;
  await queue.processBatch();
  assert.equal((await pool.query("SELECT status FROM email_queue WHERE to_email='falha@example.com'")).rows[0].status, "failed");
  assert.deepEqual([1, 2, 3, 10].map(retryDelayMs), [60_000, 120_000, 240_000, 3_600_000]);
  stats = await queue.stats();
  assert.equal(stats.failed_week, 1);
  // O histórico com mais de 30 dias é apagado.
  await pool.query("UPDATE email_queue SET created_at=NOW() - INTERVAL '31 days' WHERE to_email='falha@example.com'");
  await queue.processBatch();
  assert.equal((await pool.query("SELECT 1 FROM email_queue WHERE to_email='falha@example.com'")).rowCount, 0);

  // Sem SMTP a fila não faz nada (em desenvolvimento a ligação vai para o terminal).
  assert.deepEqual(await createEmailQueue({ pool, transport: null }).processBatch(), { sent: 0, failed: 0 });
  await pool.query("DELETE FROM email_queue");
});

test("data saver: post photos have a light version served with ?size=sm", { skip }, async () => {
  const author = await makeUser(`saver_${Date.now().toString(36)}`);
  const image = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#E30613" } }).png().toBuffer();
  const form = new FormData();
  form.append("body", "Pôr do sol na Ilha");
  form.append("media", new Blob([image], { type: "image/png" }), "foto.png");
  const response = await fetch(`${baseUrl}/posts`, { method: "POST", headers: { Authorization: `Bearer ${author.token}` }, body: form });
  assert.equal(response.status, 201, await response.clone().text());
  const mediaUrl = (await pool.query("SELECT media_url FROM posts WHERE user_id=$1", [author.id])).rows[0].media_url;
  const origin = baseUrl.replace(/\/api$/, "");
  const full = await sharp(Buffer.from(await (await fetch(origin + mediaUrl)).arrayBuffer())).metadata();
  const small = await sharp(Buffer.from(await (await fetch(`${origin}${mediaUrl}?size=sm`)).arrayBuffer())).metadata();
  assert.equal(full.width, 1600);
  assert.ok(small.width <= 480, "a versão leve tem no máximo 480 px");
  // Apagar a publicação apaga também a versão leve.
  const postId = (await pool.query("SELECT id FROM posts WHERE user_id=$1", [author.id])).rows[0].id;
  assert.equal((await call("DELETE", `/posts/${postId}`, author)).status, 200);
  const uploads = path.join(__dirname, "..", "uploads");
  assert.equal(fs.existsSync(path.join(uploads, path.basename(mediaUrl).replace(/\.webp$/, ".sm.webp"))), false);
});

test("invites: monthly ranking, with private provinces respected", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const open = await makeUser(`inv_open_${stamp}`);
  const hidden = await makeUser(`inv_hidden_${stamp}`);
  await pool.query("UPDATE users SET province='Huíla', show_province_to_brands=(id=$1) WHERE id IN ($1,$2)", [open.id, hidden.id]);
  const invite = async (by, n) => {
    for (let i = 0; i < n; i += 1) {
      const friend = await makeUser(`inv_${by.username}_${i}`);
      await pool.query("UPDATE users SET referred_by=$2,referral_rewarded_at=NOW() WHERE id=$1", [friend.id, by.id]);
    }
  };
  await invite(open, 2);
  await invite(hidden, 3);
  const national = (await call("GET", "/referrals/ranking", open)).body;
  const position = name => national.ranking.find(row => row.username === name)?.position;
  assert.ok(position(hidden.username) < position(open.username), "mais amigos, melhor lugar");
  assert.equal(national.me.invited, 2);
  const huila = (await call("GET", `/referrals/ranking?province=${encodeURIComponent("Huíla")}`, open)).body;
  assert.deepEqual(huila.ranking.map(row => row.username), [open.username], "quem não mostra a província não aparece na lista da província");
  const self = (await call("GET", `/referrals/ranking?province=${encodeURIComponent("Huíla")}`, hidden)).body;
  assert.equal(self.me.invited, 3, "a própria pessoa vê sempre a sua posição");
  assert.equal((await call("GET", "/referrals/ranking?province=Lisboa", open)).status, 400);
});

test("shops: WhatsApp orders and the verified business seal", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const owner = await makeUser(`shop_owner_${stamp}`);
  const other = await makeUser(`shop_other_${stamp}`);
  const moderator = await makeUser(`shop_mod_${stamp}`, { role: "moderation" });
  const page = (await call("POST", "/pages", owner, { name: "Loja da Kianda", pageType: "loja", category: "negocios" })).body.page;
  assert.equal((await call("POST", `/pages/${page.id}/business`, owner, { nif: "5417123456" })).status, 409, "sem loja não há selo");
  assert.equal((await call("PATCH", `/pages/${page.id}/about`, owner, { shop_enabled: true, whatsapp: "923 456 789" })).body.page.whatsapp, "244923456789");
  assert.equal((await call("PATCH", `/pages/${page.id}/about`, owner, { whatsapp: "123" })).status, 400);
  assert.equal((await call("POST", `/pages/${page.id}/business`, other, { nif: "5417123456" })).status, 403);
  assert.equal((await call("POST", `/pages/${page.id}/business`, owner, { nif: "12" })).status, 400);
  assert.equal((await call("POST", `/pages/${page.id}/business`, owner, { nif: "5417 123 456" })).status, 201);
  const pending = (await call("GET", "/admin/business", moderator)).body.requests.find(row => row.id === page.id);
  assert.equal(pending.business_nif, "5417123456");
  assert.equal((await call("GET", "/admin/business", owner)).status, 403);
  assert.equal((await call("POST", `/admin/business/${page.id}`, moderator, { approve: false })).status, 400, "recusar pede motivo");
  assert.equal((await call("POST", `/admin/business/${page.id}`, moderator, { approve: true })).status, 200);
  const offers = (await call("GET", `/pages/${page.id}/offers`, other)).body;
  assert.deepEqual([offers.whatsapp, offers.business_verified], ["244923456789", true]);
  const listed = (await call("GET", "/pages", other)).body.pages.find(row => row.id === page.id);
  assert.equal(listed.business_verified, true);
  assert.equal(listed.business_nif, null, "o NIF só aparece a quem gere a página");
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='business'", [owner.id])).rowCount);
});

test("event tickets: paid with money, 85% for the organizer after the event, QR check-in, refunds when cancelled", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const organizer = await makeUser(`tix_org_${stamp}`);
  const buyer = await makeUser(`tix_buyer_${stamp}`);
  const late = await makeUser(`tix_late_${stamp}`);
  const finance = await makeUser(`tix_fin_${stamp}`, { role: "finance" });
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  assert.equal((await call("POST", "/events", organizer, { name: "Show", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 50 })).status, 400, "mínimo 100 Kz");
  const event = (await call("POST", "/events", organizer, { name: "Show de semba", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 2000, ticketsTotal: 2 })).body.event;
  assert.equal(event.ticket_price_kz, 2000);
  // Quem vende é obrigatório num evento pago (aparece no recibo) e o NIF tem de ser válido.
  assert.equal((await call("POST", "/events", organizer, { name: "Sem vendedor", startsAt, ticketPriceKz: 1000 })).status, 400);
  assert.equal((await call("POST", "/events", organizer, { name: "NIF mau", startsAt, sellerName: "X", sellerNif: "12", ticketPriceKz: 1000 })).status, 400);
  const publicView = (await call("GET", `/events/${event.id}`, buyer)).body.event;
  assert.equal(publicView.seller_name, "Kianda Eventos");
  assert.ok(!publicView.seller_nif, "o NIF de quem vende não aparece a toda a gente");
  assert.equal((await call("GET", `/events/${event.id}`, organizer)).body.event.seller_nif, "5000000000");
  assert.equal((await call("POST", `/events/${event.id}/rsvp`, buyer)).status, 409, "num evento pago entra-se com bilhete");

  // Comprar abre o pagamento; só depois de confirmado há bilhete.
  await call("POST", `/events/${event.id}/tickets`, buyer, {}); // sem meios de pagamento nos testes: fica à espera
  const pending = (await pool.query("SELECT id::int AS id,status,code FROM event_tickets WHERE event_id=$1 AND user_id=$2", [event.id, buyer.id])).rows[0];
  assert.deepEqual([pending.status, pending.code], ["pending", null]);
  assert.deepEqual((await call("GET", `/events/${event.id}`, buyer)).body.event.my_tickets, [], "sem pagamento confirmado não há bilhete");
  await payments.fulfill("event_ticket", pending.id, {});
  await payments.fulfill("event_ticket", pending.id, {}); // confirmação repetida não muda nada
  const detail = (await call("GET", `/events/${event.id}`, buyer)).body.event;
  const code = detail.my_tickets[0].code;
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(detail.tickets_sold, 1);
  assert.equal(detail.is_attending, true);
  assert.equal((await call("POST", `/events/${event.id}/tickets`, buyer, { quantity: 11 })).status, 400, "no máximo 10 por compra");
  const qr = await fetch(`${baseUrl}/events/${event.id}/tickets/mine/qr?code=${code}`, { headers: { Authorization: `Bearer ${buyer.token}` } });
  assert.equal(qr.headers.get("content-type"), "image/png");
  // QR do email: imagem sem sessão, mas só com a assinatura daquele bilhete.
  const codeId = (await pool.query("SELECT id::int AS id FROM event_ticket_codes WHERE ticket_id=$1", [pending.id])).rows[0].id;
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(`ticket-code-qr:${codeId}`).digest("base64url").slice(0, 32);
  assert.equal((await fetch(`${baseUrl}/tickets/codes/${codeId}/qr.png?s=${signature}`)).headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${baseUrl}/tickets/codes/${codeId}/qr.png?s=${"x".repeat(32)}`)).status, 404, "sem a assinatura certa não abre");
  assert.equal((await fetch(`${baseUrl}/tickets/codes/${codeId + 1}/qr.png?s=${signature}`)).status, 404, "a assinatura é só daquele bilhete");

  // Recibo e lista de pagamentos da equipa.
  const receipt = (await call("GET", "/admin/payments?kind=event_ticket", finance)).body;
  assert.ok(JSON.stringify(receipt).includes("Bilhete «Show de semba»"));
  const myReceipt = (await call("GET", `/payments/event_ticket/${pending.id}/receipt`, buyer)).body.payment;
  assert.deepEqual(myReceipt.seller, { name: "Kianda Eventos", nif: "5000000000", address: null }, "o recibo diz quem vende");
  assert.deepEqual([myReceipt.lines[0].quantity, myReceipt.lines[0].unit, myReceipt.lines[0].total], [1, 2000, 2000]);

  // Validação à entrada: só quem organiza, cada bilhete uma vez.
  assert.equal((await call("POST", `/events/${event.id}/check-in`, buyer, { code })).status, 403);
  assert.equal((await call("POST", `/events/${event.id}/check-in`, organizer, { code: "ZZZZZZZZ" })).status, 404);
  assert.equal((await call("POST", `/events/${event.id}/check-in`, organizer, { code: code.toLowerCase() })).body.person.username, buyer.username);
  assert.equal((await call("POST", `/events/${event.id}/check-in`, organizer, { code })).status, 409);
  const list = (await call("GET", `/events/${event.id}/tickets`, organizer)).body;
  assert.deepEqual([list.sold, list.checked_in, list.gross_kz, list.net_kz], [1, 1, 2000, 1700]);
  assert.ok(list.tickets.every(row => !("code" in row)) && !JSON.stringify(list).includes(code), "quem organiza nunca vê os códigos");

  // Os 85% só se podem levantar 1 dia depois do evento; até lá ficam à espera.
  let payouts = (await call("GET", "/payouts", organizer)).body;
  assert.equal(payouts.sources.ticketsKz, 0);
  assert.equal(payouts.accruing.ticketsKz, 1700);

  // Lotação: um pagamento a meio guarda o lugar durante 30 minutos.
  const other = await makeUser(`tix_other_${stamp}`);
  await call("POST", `/events/${event.id}/tickets`, other, {});
  assert.match((await call("POST", `/events/${event.id}/tickets`, late, {})).body.error, /esgotaram/);

  // Cancelar antes do evento: o bilhete pago fica por devolver e sai dos ganhos de quem organiza.
  assert.equal((await call("DELETE", `/events/${event.id}`, organizer)).status, 200);
  const refunded = (await pool.query("SELECT refund_status,event_id FROM event_tickets WHERE id=$1", [pending.id])).rows[0];
  assert.deepEqual([refunded.refund_status, refunded.event_id], ["manual", null], "o registo fica para o recibo e a devolução");
  payouts = (await call("GET", "/payouts", organizer)).body;
  assert.deepEqual([payouts.sources.ticketsKz, payouts.accruing.ticketsKz], [0, 0]);
  assert.ok((await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='event_refund'", [buyer.id])).rowCount);

  // Depois do evento: o dinheiro conta e um evento com bilhetes já não se apaga.
  const past = (await call("POST", "/events", organizer, { name: "Já foi", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 1000 })).body.event;
  await call("POST", `/events/${past.id}/tickets`, buyer, {});
  const ticketId = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2", [past.id, buyer.id])).rows[0].id;
  await payments.fulfill("event_ticket", ticketId, {});
  await pool.query("UPDATE events SET starts_at=NOW() - INTERVAL '2 days' WHERE id=$1", [past.id]);
  await pool.query("UPDATE event_tickets SET available_at=NOW() - INTERVAL '1 day' WHERE id=$1", [ticketId]);
  assert.equal((await call("GET", "/payouts", organizer)).body.sources.ticketsKz, 850, "85% de 1000 Kz");
  assert.equal((await call("DELETE", `/events/${past.id}`, organizer)).status, 409);
  assert.equal((await call("POST", `/events/${past.id}/tickets`, late, {})).status, 409, "depois de começar já não se vende");

  // Apagar a página de um evento futuro também deixa o bilhete por devolver.
  const page = (await call("POST", "/pages", organizer, { name: `Bilhetes ${stamp}`, pageType: "loja", category: "negocios" })).body.page;
  const pageEvent = (await call("POST", "/events", organizer, { name: "Na página", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 500, pageId: page.id })).body.event;
  await call("POST", `/events/${pageEvent.id}/tickets`, late, {});
  const lateTicket = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2", [pageEvent.id, late.id])).rows[0].id;
  await payments.fulfill("event_ticket", lateTicket, {});
  assert.equal((await call("DELETE", `/pages/${page.id}`, organizer)).status, 200);
  assert.equal((await pool.query("SELECT refund_status FROM event_tickets WHERE id=$1", [lateTicket])).rows[0].refund_status, "manual");
  assert.equal((await call("GET", "/payouts", organizer)).body.sources.ticketsKz, 850, "o bilhete cancelado não conta");

  // Pagamento que chega depois de o evento ser cancelado (ex.: Referência paga dias depois): fica por devolver.
  const cancelled = (await call("POST", "/events", organizer, { name: "Cancelado", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 700 })).body.event;
  await call("POST", `/events/${cancelled.id}/tickets`, late, {});
  const slow = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2", [cancelled.id, late.id])).rows[0].id;
  assert.equal((await call("DELETE", `/events/${cancelled.id}`, organizer)).status, 200);
  await payments.fulfill("event_ticket", slow, {});
  const slowRow = (await pool.query("SELECT status,refund_status,(SELECT COUNT(*) FROM event_ticket_codes c WHERE c.ticket_id=t.id)::int AS codes FROM event_tickets t WHERE id=$1", [slow])).rows[0];
  assert.deepEqual([slowRow.status, slowRow.refund_status, slowRow.codes], ["paid", "manual", 0]);
  await pool.query("UPDATE event_tickets SET available_at=NOW() - INTERVAL '1 day' WHERE id=$1", [slow]);
  assert.equal((await call("GET", "/payouts", organizer)).body.sources.ticketsKz, 850, "não conta para quem organizava");

  // Lotação cheia quando um pagamento atrasado chega: fica por devolver em vez de vender a mais.
  const small = (await call("POST", "/events", organizer, { name: "Pequeno", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 300, ticketsTotal: 1 })).body.event;
  await call("POST", `/events/${small.id}/tickets`, late, {});
  const slowOne = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2", [small.id, late.id])).rows[0].id;
  await pool.query("UPDATE event_tickets SET created_at=NOW() - INTERVAL '1 hour' WHERE id=$1", [slowOne]); // o lugar guardado expirou
  await call("POST", `/events/${small.id}/tickets`, buyer, {});
  const fastOne = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2", [small.id, buyer.id])).rows[0].id;
  await payments.fulfill("event_ticket", fastOne, {});
  await payments.fulfill("event_ticket", slowOne, {});
  assert.equal((await pool.query("SELECT refund_status FROM event_tickets WHERE id=$1", [slowOne])).rows[0].refund_status, "manual");
  assert.equal((await call("GET", `/events/${small.id}`, organizer)).body.event.tickets_sold, 1, "nunca acima da lotação");

  // Várias entradas numa compra: cada uma com o seu código; o preço multiplica; a lotação conta as entradas.
  const group = (await call("POST", "/events", organizer, { name: "Em grupo", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 400, ticketsTotal: 5 })).body.event;
  assert.match((await call("POST", `/events/${group.id}/tickets`, late, { quantity: 6 })).body.error, /restam 5 bilhetes/);
  await call("POST", `/events/${group.id}/tickets`, late, { quantity: 3 });
  const trio = (await pool.query("SELECT id::int AS id,quantity,amount_kz::float AS amount FROM event_tickets WHERE event_id=$1 AND user_id=$2", [group.id, late.id])).rows[0];
  assert.deepEqual([trio.quantity, trio.amount], [3, 1200]);
  await payments.fulfill("event_ticket", trio.id, {});
  const lateTickets = (await call("GET", `/events/${group.id}`, late)).body.event;
  assert.equal(lateTickets.my_tickets.length, 3);
  assert.equal(new Set(lateTickets.my_tickets.map(item => item.code)).size, 3, "um código por entrada");
  assert.equal(lateTickets.tickets_sold, 3);
  const second = await call("POST", `/events/${group.id}/check-in`, organizer, { code: lateTickets.my_tickets[1].code });
  assert.deepEqual(second.body.of, { position: 2, quantity: 3 });
  assert.equal((await call("POST", `/events/${group.id}/check-in`, organizer, { code: lateTickets.my_tickets[1].code })).status, 409);
  const groupList = (await call("GET", `/events/${group.id}/tickets`, organizer)).body;
  assert.deepEqual([groupList.sold, groupList.checked_in, groupList.tickets[0].quantity, groupList.tickets[0].checked_in], [3, 1, 3, 1]);
  // A mesma pessoa pode comprar mais, até à lotação.
  // Ninguém "esgota" um evento a pedir compras sem pagar: no máximo 10 lugares guardados por pessoa.
  const hoard = (await call("POST", "/events", organizer, { name: "Sem açambarcar", startsAt, sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 100, ticketsTotal: 30 })).body.event;
  await call("POST", `/events/${hoard.id}/tickets`, buyer, { quantity: 10 });
  assert.equal((await call("POST", `/events/${hoard.id}/tickets`, buyer, { quantity: 1 })).status, 429);
  assert.equal((await call("GET", `/events/${hoard.id}`, buyer)).body.event.tickets_sold, 0);
  await pool.query("UPDATE event_tickets SET created_at=NOW() - INTERVAL '31 minutes' WHERE event_id=$1", [hoard.id]);
  assert.notEqual((await call("POST", `/events/${hoard.id}/tickets`, buyer, { quantity: 1 })).status, 429, "passados 30 min pode tentar outra vez");

  await call("POST", `/events/${group.id}/tickets`, late, { quantity: 2 });
  const more = (await pool.query("SELECT id::int AS id FROM event_tickets WHERE event_id=$1 AND user_id=$2 AND status='pending'", [group.id, late.id])).rows[0].id;
  await payments.fulfill("event_ticket", more, {});
  assert.equal((await call("GET", `/events/${group.id}`, late)).body.event.my_tickets.length, 5);
  assert.match((await call("POST", `/events/${group.id}/tickets`, buyer, {})).body.error, /esgotaram/);
});

test("paid lives: entry in stars before video, chat and P2P signals", { skip }, async () => {
  const stamp = Date.now().toString(36);
  const host = await makeUser(`plive_host_${stamp}`);
  const fan = await makeUser(`plive_fan_${stamp}`);
  const broke = await makeUser(`plive_broke_${stamp}`);
  await pool.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,80,'purchase')", [fan.id]);
  const live = await call("POST", "/lives", host, { title: "Aula de kizomba", entryStars: 50 });
  assert.equal(live.status, 201, live.body.error);
  const id = live.body.id;
  const seen = (await call("GET", `/lives/${id}`, fan)).body.live;
  assert.deepEqual([seen.entry_stars, seen.has_access, seen.playback], [50, false, null]);
  assert.equal((await call("GET", `/lives/${id}`, host)).body.live.has_access, true);
  assert.equal((await call("POST", `/lives/${id}/comments`, fan, { body: "Olá" })).status, 402);
  assert.equal((await call("POST", `/lives/${id}/heartbeat`, fan)).status, 402);
  assert.equal((await call("POST", `/lives/${id}/signals`, fan, { to: host.id, kind: "offer", payload: "x" })).status, 402);
  assert.equal((await call("POST", `/lives/${id}/ticket`, broke)).status, 402);
  const paid = await call("POST", `/lives/${id}/ticket`, fan);
  assert.equal(paid.status, 201, paid.body.error);
  assert.equal(paid.body.balance, 30);
  assert.equal((await call("POST", `/lives/${id}/ticket`, fan)).body.has_access, true, "paga uma vez só");
  assert.equal((await call("GET", `/lives/${id}`, fan)).body.live.has_access, true);
  assert.ok((await call("POST", `/lives/${id}/comments`, fan, { body: "Olá" })).status < 300);
  assert.equal((await call("POST", `/lives/${id}/heartbeat`, fan)).status, 200);
  const received = (await pool.query("SELECT COALESCE(SUM(amount),0)::int AS n FROM star_ledger WHERE user_id=$1 AND live_id=$2 AND kind='gift_received'", [host.id, id])).rows[0].n;
  assert.equal(received, 50);
  await call("POST", `/lives/${id}/end`, host);
});

test("general limits: too many payment starts from one IP get 429", { skip }, async () => {
  const someone = await makeUser(`limits_${Date.now().toString(36)}`);
  const ip = { "x-forwarded-for": "10.9.9.9" };
  const statuses = [];
  process.env.RATE_LIMIT_PAYMENTS = "30"; // o valor normal, só neste teste
  // Maiúsculas e barra no fim chegam à mesma rota e contam no mesmo limite.
  for (let i = 0; i < 31; i += 1) statuses.push((await call("POST", i % 2 ? "/STARS/Purchase/" : "/stars/purchase", someone, { pack: "nao-existe" }, ip)).status);
  assert.notEqual(statuses[0], 429);
  assert.equal(statuses[30], 429, "o 31.º pagamento começado em 10 minutos é recusado");
  assert.notEqual((await call("POST", "/stars/purchase", someone, { pack: "nao-existe" }, { "x-forwarded-for": "10.9.9.10" })).status, 429, "conta por IP");
  process.env.RATE_LIMIT_PAYMENTS = "100000";
});

test("login: per-account limits (one place and many places), the same answer for unknown accounts", { skip }, async () => {
  const target = await makeUser(`brute_${Date.now().toString(36)}`);
  const email = `${target.username}@example.com`;
  // Do mesmo IP: a 11.ª falha para a conta é travada (mesmo escrevendo o email com maiúsculas).
  const sameIp = [];
  for (let i = 0; i < 11; i += 1) sameIp.push((await call("POST", "/auth/login", null, { email: i % 2 ? email.toUpperCase() : email, password: `x-${i}` }, { "x-forwarded-for": "10.70.0.1" })).status);
  assert.equal(sameIp[10], 429);
  // De muitos IPs: só a 61.ª falha numa hora trava a conta (um estranho não a bloqueia com poucas tentativas).
  const manyIps = [];
  for (let i = 0; i < 50; i += 1) manyIps.push((await call("POST", "/auth/login", null, { email, password: `y-${i}` }, { "x-forwarded-for": `10.71.${i}.1` })).status);
  assert.ok(manyIps.every(status => status === 401));
  assert.equal((await call("POST", "/auth/login", null, { email, password: "z" }, { "x-forwarded-for": "10.72.0.1" })).status, 429, "60 falhas numa hora travam a conta");
  const unknown = await call("POST", "/auth/login", null, { email: "ninguem-aqui@example.com", password: "qualquer coisa" }, { "x-forwarded-for": "10.78.0.1" });
  assert.deepEqual([unknown.status, unknown.body.error], [401, "Credenciais inválidas."], "conta que não existe responde igual");
});

test("events: edit (with warnings), reminders a day and an hour before, and search", { skip }, async () => {
  const { sendEventReminders } = require("./index");
  const stamp = Date.now().toString(36);
  const host = await makeUser(`evhost_${stamp}`);
  const guest = await makeUser(`evguest_${stamp}`);
  const outsider = await makeUser(`evout_${stamp}`);
  const startsAt = new Date(Date.now() + 20 * 3600000).toISOString();
  const event = (await call("POST", "/events", host, { name: `Semba no largo ${stamp}`, startsAt, location: "Largo da Independência" })).body.event;
  await call("POST", `/events/${event.id}/rsvp`, guest);

  // Editar: só quem organiza; mudar a data avisa quem vai.
  assert.equal((await call("PATCH", `/events/${event.id}`, outsider, { name: "Roubado" })).status, 404);
  assert.equal((await call("PATCH", `/events/${event.id}`, host, { startsAt: new Date(Date.now() - 60000).toISOString() })).status, 400);
  const later = new Date(Date.now() + 26 * 3600000).toISOString();
  const edited = await call("PATCH", `/events/${event.id}`, host, { name: `Semba no largo ${stamp} (2.ª)`, startsAt: later });
  assert.equal(edited.status, 200, edited.body.error);
  assert.equal(edited.body.notified, true);
  const changed = (await pool.query("SELECT text,event_id FROM notifications WHERE user_id=$1 AND type='event_update'", [guest.id])).rows[0];
  assert.match(changed.text, /mudou \(nova data/);
  assert.equal(changed.event_id, event.id);

  // Antecipar a data de um evento pago não encurta a espera do dinheiro dos bilhetes.
  const paidEvent = (await call("POST", "/events", host, { name: `Pago ${stamp}`, startsAt: new Date(Date.now() + 10 * 86400000).toISOString(), sellerName: "Kianda Eventos", sellerNif: "5000000000", ticketPriceKz: 500 })).body.event;
  await call("POST", `/events/${paidEvent.id}/tickets`, guest, {});
  const held = (await pool.query("SELECT id::int AS id,available_at FROM event_tickets WHERE event_id=$1", [paidEvent.id])).rows[0];
  await payments.fulfill("event_ticket", held.id, {});
  assert.equal((await call("PATCH", `/events/${paidEvent.id}`, host, { startsAt: new Date(Date.now() + 3 * 86400000).toISOString() })).status, 200);
  const after = (await pool.query("SELECT available_at FROM event_tickets WHERE id=$1", [held.id])).rows[0].available_at;
  assert.ok(new Date(after) >= new Date(held.available_at), "a espera nunca encurta");

  // Lembretes: nada fora da janela; 1 dia antes e 1 hora antes, uma vez cada.
  await sendEventReminders();
  assert.equal((await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='event_reminder'", [guest.id])).rowCount, 0, "faltam 26 h");
  await pool.query("UPDATE events SET starts_at=NOW() + INTERVAL '20 hours' WHERE id=$1", [event.id]);
  await sendEventReminders();
  await sendEventReminders();
  const dayReminders = (await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='event_reminder'", [guest.id])).rows;
  assert.equal(dayReminders.length, 1, "o lembrete do dia sai uma vez");
  assert.match(dayReminders[0].text, /^Lembrete: «Semba no largo .*» é (hoje|amanhã) às/);
  assert.equal((await pool.query("SELECT 1 FROM notifications WHERE user_id=$1 AND type='event_reminder'", [host.id])).rowCount, 0, "quem organiza não recebe");
  await pool.query("UPDATE events SET starts_at=NOW() + INTERVAL '60 minutes' WHERE id=$1", [event.id]);
  await sendEventReminders();
  const hour = (await pool.query("SELECT text FROM notifications WHERE user_id=$1 AND type='event_reminder' ORDER BY id DESC LIMIT 1", [guest.id])).rows[0];
  assert.match(hour.text, /começa daqui a (1 hora|\d+ min)/);

  // Pesquisa: o evento aparece pelo nome e pelo local.
  const byName = (await call("GET", `/search?q=${encodeURIComponent(`Semba no largo ${stamp}`)}`, outsider)).body.events;
  assert.equal(byName[0]?.id, event.id);
  assert.ok((await call("GET", "/search?q=Independ", outsider)).body.events.some(item => item.id === event.id));
});
