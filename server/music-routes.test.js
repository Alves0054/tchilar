const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTrackFields } = require("./music-routes");

test("a personal track needs a title and a valid duration", () => {
  assert.ok(parseTrackFields({ title: "", duration: 30 }, { isAdmin: false }).error);
  assert.ok(parseTrackFields({ title: "Ok", duration: 0 }, { isAdmin: false }).error);
  assert.ok(parseTrackFields({ title: "Ok", duration: 901 }, { isAdmin: false }).error);
  const fields = parseTrackFields({ title: "  Noite   em Luanda ", artist: "Eu", genre: "kizomba", duration: "184.567" }, { isAdmin: false });
  assert.deepEqual(fields, { title: "Noite em Luanda", artist: "Eu", genre: "kizomba", license: "", duration: 184.57, library: false });
});

test("unknown genres fall back to 'outro'", () => {
  assert.equal(parseTrackFields({ title: "X", genre: "<script>", duration: 10 }, { isAdmin: false }).genre, "outro");
});

test("only admins can add to the library, and only with a license", () => {
  assert.equal(parseTrackFields({ title: "X", duration: 10, library: "true", license: "CC0" }, { isAdmin: false }).library, false);
  assert.ok(parseTrackFields({ title: "X", duration: 10, library: "true" }, { isAdmin: true }).error);
  assert.equal(parseTrackFields({ title: "X", duration: 10, library: "true", license: "Pixabay Content License" }, { isAdmin: true }).library, true);
});
