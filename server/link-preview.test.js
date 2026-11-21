const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CRAWLER_PATTERN, crawlerPage, findPreview, injectPreview, shorten } = require("./link-preview");

const urls = path => ({ pageUrl: `https://tchilar.ao${path}`, siteUrl: "https://tchilar.ao", mediaUrl: "https://api.tchilar.ao" });
const fakePool = rows => {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push([sql, params]); return { rows }; } };
};

test("profile preview shows the person, their photo and only public data", async () => {
  const pool = fakePool([{ username: "joana", display_name: "Joana M.", bio: "Fotógrafa em Luanda", avatar_url: "/uploads/a.jpg", profession: "Fotógrafa", followers: 1200 }]);
  const preview = await findPreview(pool, "/u/Joana");
  assert.equal(pool.calls[0][1][0], "joana", "o nome de utilizador vai em minúsculas");
  assert.match(pool.calls[0][0], /suspended_at IS NULL/, "perfis suspensos não aparecem");
  assert.equal(preview.title, "Joana M. (@joana) no Tchilar");
  assert.match(preview.description, /^Fotógrafa em Luanda — Fotógrafa · 1[.\s ]?200 seguidores$/);
  const html = injectPreview("<head><!-- preview --><title>Tchilar</title><!-- /preview --></head>", preview, urls("/u/joana"));
  assert.match(html, /og:image" content="https:\/\/api\.tchilar\.ao\/uploads\/a\.jpg"/, "as fotos vêm da API");
  assert.match(html, /og:url" content="https:\/\/tchilar\.ao\/u\/joana"/);
  assert.match(html, /summary_large_image/);
});

test("post preview never shows exclusive, group or hidden posts", async () => {
  const pool = fakePool([]);
  assert.equal(await findPreview(pool, "/posts/42"), null);
  const sql = pool.calls[0][0];
  for (const rule of ["hidden_at IS NULL", "group_id IS NULL", "is_exclusive", "suspended_at IS NULL"]) assert.ok(sql.includes(rule), rule);

  const image = await findPreview(fakePool([{ body: "Pôr do sol na Ilha", media_url: "/uploads/p.jpg", media_type: "image", username: "rui", display_name: "Rui", avatar_url: "/uploads/r.jpg" }]), "/posts/42");
  assert.equal(image.image, "/uploads/p.jpg");
  assert.equal(image.description, "Pôr do sol na Ilha");
  const video = await findPreview(fakePool([{ body: "", media_url: "/uploads/v.mp4", media_type: "video", username: "rui", display_name: "Rui", avatar_url: "/uploads/r.jpg" }]), "/posts/42");
  assert.equal(video.image, "/uploads/r.jpg", "num vídeo mostra a foto de quem publicou");
  assert.equal(video.description, "Vê o vídeo no Tchilar.");
});

test("course preview only for courses on sale, with price and author", async () => {
  const pool = fakePool([{ title: "Fotografia com telemóvel", summary: "Do zero às boas fotos", cover_url: null, price: 5000, by_team: false, display_name: "Joana" }]);
  const preview = await findPreview(pool, "/academia/cursos/7");
  assert.match(pool.calls[0][0], /status='published'/);
  assert.equal(preview.title, "Fotografia com telemóvel — Academia Tchilar");
  assert.match(preview.description, /Joana · 5[.\s ]?000 Kz$/);
  assert.equal(preview.image, "/tchilar-logo-full.png");
});

test("other pages keep the general preview without touching the database", async () => {
  const pool = fakePool([]);
  for (const path of ["/", "/messages/3", "/u/../admin", "/posts/abc", "/academia"]) assert.equal(await findPreview(pool, path), null, path);
  assert.equal(pool.calls.length, 0);
  const html = injectPreview("<!-- preview -->x<!-- /preview -->", null, urls("/"));
  assert.match(html, /<title>Tchilar<\/title>/);
  assert.match(html, /og:image" content="https:\/\/tchilar\.ao\/tchilar-logo-full\.png"/, "o logótipo vem do site");
});

test("text from people is escaped and shortened on a whole word", () => {
  const html = injectPreview("<!-- preview --><!-- /preview -->", { title: "<script>alert(1)</script>", description: "\"x\" & y", image: "/uploads/a.jpg", type: "article" }, urls("/posts/1"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;x&quot; &amp; y/);
  const long = shorten("palavra ".repeat(60), 50);
  assert.ok(long.length <= 50);
  assert.ok(long.endsWith("palavra…"));
});

test("crawler page sends people to the site and robots get the tags", () => {
  const page = crawlerPage({ title: "Rui no Tchilar", description: "Olá", image: "/uploads/r.jpg", type: "profile" }, urls("/u/rui"));
  assert.match(page, /http-equiv="refresh" content="0;url=https:\/\/tchilar\.ao\/u\/rui"/);
  assert.match(page, /og:title" content="Rui no Tchilar"/);
  for (const agent of ["WhatsApp/2.23.20.0", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)", "LinkedInBot/1.0"]) assert.ok(CRAWLER_PATTERN.test(agent), agent);
  assert.equal(CRAWLER_PATTERN.test("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1"), false);
});
