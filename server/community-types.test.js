const { test } = require("node:test");
const assert = require("node:assert/strict");
const { groupCategories, groupTypes, pageTypes, parseGroupKind, parseGroupPrivacy, parsePageType } = require("./community-types");

test("groups: 16 types, 32 categories, and a subcategory must belong to its category", () => {
  assert.equal(groupTypes.length, 16);
  assert.equal(groupCategories.length, 32);
  assert.deepEqual(parseGroupKind(undefined, undefined), { type: "comunitario", category: "comunidade", subcategory: null });
  assert.deepEqual(parseGroupKind("compra-venda", undefined), { type: "compra-venda", category: "compra-venda", subcategory: null }, "categoria sugerida pelo tipo");
  assert.deepEqual(parseGroupKind("jogos", "jogos", "free-fire"), { type: "jogos", category: "jogos", subcategory: "free-fire" });
  assert.ok(parseGroupKind("jogos", "jogos", "kuduro").error, "kuduro não é de Jogos");
  assert.ok(parseGroupKind("inventado", "jogos").error);
  assert.ok(parseGroupKind("jogos", "inventada").error);
  for (const type of groupTypes) assert.ok(groupCategories.some(area => area.key === type.category), type.key);
});

test("group privacy accepts the four options and the old isSecret flag", () => {
  assert.equal(parseGroupPrivacy({ privacy: "private" }).value, "private");
  assert.equal(parseGroupPrivacy({ privacy: "approval" }).value, "approval");
  assert.equal(parseGroupPrivacy({ isSecret: true }).value, "secret");
  assert.equal(parseGroupPrivacy({}).value, "public");
  assert.ok(parseGroupPrivacy({ privacy: "hidden" }).error);
  assert.ok(parseGroupPrivacy({ isSecret: "sim" }).error);
});

test("pages: 30 types, 19 categories, and a subcategory must belong to its category", () => {
  const { pageCategories } = require("./community-types");
  assert.equal(pageTypes.length, 30);
  assert.equal(pageCategories.length, 19);
  assert.deepEqual(parsePageType("restaurante", "alimentacao", "restaurantes"), { type: "restaurante", category: "alimentacao", subcategory: "restaurantes" });
  assert.deepEqual(parsePageType("banda", undefined), { type: "banda", category: "musica", subcategory: null }, "sem categoria: a sugerida para o tipo");
  assert.deepEqual(parsePageType("loja", "agricultura", ""), { type: "loja", category: "agricultura", subcategory: null }, "subcategoria opcional");
  assert.deepEqual(parsePageType(undefined, undefined), { type: "comunidade", category: "sociedade", subcategory: null });
  assert.ok(parsePageType("loja", "musica", "restaurantes").error, "restaurantes não é de Música e áudio");
  assert.ok(parsePageType("inventado", "musica").error);
  assert.ok(parsePageType("loja", "inventada").error);
  for (const type of pageTypes) assert.ok(pageCategories.some(area => area.key === type.category), `${type.key}: categoria sugerida existe`);
});

test("story backgrounds come from the list and can be left empty", () => {
  const { parseStoryBackground } = require("./community-types");
  assert.equal(parseStoryBackground(undefined).value, null);
  assert.equal(parseStoryBackground("").value, null);
  assert.equal(parseStoryBackground("kizomba").value, "kizomba");
  assert.equal(parseStoryBackground("oceano").value, "oceano");
  assert.ok(parseStoryBackground("url(evil)").error);
});

test("every themed story background has its image file", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { themes, colors } = require("./story-backgrounds.json");
  for (const theme of themes) assert.ok(fs.existsSync(path.join(__dirname, "..", "public", theme.image)), theme.image);
  for (const item of [...themes, ...colors]) assert.ok(item.key.length <= 30, item.key);
});

test("keys are unique and short enough for the database columns", () => {
  const topicKeys = [...groupTypes, ...groupCategories].map(item => item.key);
  for (const area of groupCategories) {
    const keys = area.subcategories.map(item => item.key);
    assert.equal(new Set(keys).size, keys.length, `subcategorias repetidas em ${area.key}`);
    for (const key of keys) assert.ok(key.length <= 40, key);
  }
  assert.equal(new Set(groupTypes.map(t => t.key)).size, groupTypes.length);
  assert.equal(new Set(groupCategories.map(c => c.key)).size, groupCategories.length);
  assert.equal(new Set(pageTypes.map(type => type.key)).size, pageTypes.length);
  for (const type of pageTypes) assert.ok(type.key.length <= 30, type.key);
  const { pageCategories } = require("./community-types");
  assert.equal(new Set(pageCategories.map(area => area.key)).size, pageCategories.length);
  for (const area of pageCategories) {
    const keys = area.subcategories.map(item => item.key);
    assert.equal(new Set(keys).size, keys.length, `subcategorias repetidas em ${area.key}`);
    for (const key of [area.key, ...keys]) assert.ok(key.length <= 30, key);
  }
  for (const key of topicKeys) assert.ok(key.length <= 30, key);
});
