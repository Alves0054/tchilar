const { test } = require("node:test");
const assert = require("node:assert/strict");
const { groupTopics, pageTypes, parseGroupPrivacy, parseGroupTopic, parsePageType } = require("./community-types");

test("group topics come from the list, with Geral when none is chosen", () => {
  assert.equal(parseGroupTopic(undefined).value, "geral");
  assert.equal(parseGroupTopic("compra-venda").value, "compra-venda");
  assert.ok(parseGroupTopic("qualquer coisa").error);
  assert.ok(parseGroupTopic(3).error);
});

test("group privacy accepts the three options and the old isSecret flag", () => {
  assert.equal(parseGroupPrivacy({ privacy: "private" }).value, "private");
  assert.equal(parseGroupPrivacy({ isSecret: true }).value, "secret");
  assert.equal(parseGroupPrivacy({}).value, "public");
  assert.ok(parseGroupPrivacy({ privacy: "hidden" }).error);
  assert.ok(parseGroupPrivacy({ isSecret: "sim" }).error);
});

test("a page category must belong to the chosen page type", () => {
  assert.deepEqual(parsePageType("negocio", "restaurante"), { type: "negocio", category: "restaurante" });
  assert.deepEqual(parsePageType(undefined, undefined), { type: "comunidade", category: "comunidade" });
  assert.ok(parsePageType("figura", "restaurante").error, "restaurante não é uma figura pública");
  assert.ok(parsePageType("inventado", "loja").error);
  assert.ok(parsePageType("negocio", undefined).error);
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
  const topicKeys = groupTopics.map(topic => topic.key);
  assert.equal(new Set(topicKeys).size, topicKeys.length);
  assert.equal(new Set(pageTypes.map(type => type.key)).size, pageTypes.length);
  for (const type of pageTypes) {
    const keys = type.categories.map(item => item.key);
    assert.equal(new Set(keys).size, keys.length, `categorias repetidas em ${type.key}`);
    for (const key of [type.key, ...keys]) assert.ok(key.length <= 30, key);
  }
  for (const key of topicKeys) assert.ok(key.length <= 30, key);
});
