const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseVideoEdit } = require("./video-edit");

test("no edit or default values store nothing", () => {
  assert.deepEqual(parseVideoEdit(undefined), { edit: null });
  assert.deepEqual(parseVideoEdit(""), { edit: null });
  assert.deepEqual(parseVideoEdit(JSON.stringify({ start: 0, speed: 1, filter: "none", muted: false, text: "  " })), { edit: null });
});

test("a full edit is normalised", () => {
  const { edit, error } = parseVideoEdit(JSON.stringify({
    start: 1.234, end: 9.876, speed: 1.5, filter: "quente", muted: true, text: "  Olá   Luanda ", textPosition: "top", textStyle: "box"
  }));
  assert.equal(error, undefined);
  assert.deepEqual(edit, { start: 1.23, end: 9.88, speed: 1.5, filter: "quente", muted: true, text: "Olá Luanda", textPosition: "top", textStyle: "box" });
});

test("invalid edits are refused", () => {
  for (const bad of [
    "{not json",
    JSON.stringify([1, 2]),
    JSON.stringify({ start: -1 }),
    JSON.stringify({ start: 5, end: 5.1 }),
    JSON.stringify({ start: 0, end: 400 }),
    JSON.stringify({ speed: 3 }),
    JSON.stringify({ filter: "url(javascript:alert(1))" }),
    JSON.stringify({ muted: "yes" }),
    JSON.stringify({ text: "x".repeat(81) }),
    JSON.stringify({ text: "ok", textPosition: "left" }),
    "x".repeat(2001)
  ]) {
    assert.ok(parseVideoEdit(bad).error, bad.slice(0, 40));
  }
});
