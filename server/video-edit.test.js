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
    "x".repeat(3001),
    JSON.stringify({ brightness: 300 }),
    JSON.stringify({ contrast: 99.5 }),
    JSON.stringify({ mirror: "sim" }),
    JSON.stringify({ originalVolume: 2 }),
    JSON.stringify({ music: { trackId: "abc" } }),
    JSON.stringify({ music: { trackId: 3, volume: 1.5 } }),
    JSON.stringify({ music: { trackId: 3, offset: -2 } }),
    JSON.stringify({ music: [3] })
  ]) {
    assert.ok(parseVideoEdit(bad).error, bad.slice(0, 40));
  }
});

test("music, adjustments, mirror and volumes are kept", () => {
  const { edit, error } = parseVideoEdit(JSON.stringify({
    brightness: 110, contrast: 100, saturation: 80, mirror: true, originalVolume: 0.35,
    music: { trackId: 7, offset: 12.345, volume: 0.8 }
  }));
  assert.equal(error, undefined);
  assert.deepEqual(edit, {
    start: 0, end: null, speed: 1, filter: "none", muted: false, originalVolume: 0.35,
    brightness: 110, saturation: 80, mirror: true,
    music: { trackId: 7, offset: 12.35, volume: 0.8, fade: true }
  });
});

test("old 'muted' edits still work and volume 0 means muted", () => {
  assert.equal(parseVideoEdit(JSON.stringify({ muted: true })).edit.muted, true);
  const silent = parseVideoEdit(JSON.stringify({ originalVolume: 0, music: { trackId: 1 } })).edit;
  assert.equal(silent.muted, true);
  assert.equal(silent.originalVolume, undefined);
});
