const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { NOTIFY_CATEGORIES, canReach, readPreferences, updatePreferences } = require("./preferences");

test("preferences default to everything on and open to everyone", () => {
  const prefs = readPreferences(null);
  assert.deepEqual(prefs.notify, { interactions: true, people: true, messages: true, lives: true, community: true });
  assert.equal(prefs.showActivity, true, "a atividade aparece por omissão");
  assert.equal(readPreferences({ showActivity: false }).showActivity, false);
  assert.ok(updatePreferences(null, { showActivity: "não" }).error);
  assert.equal(updatePreferences(null, { showActivity: false }).preferences.showActivity, false);
  assert.equal(prefs.messages, "everyone");
  assert.equal(prefs.comments, "everyone");
});

test("stored garbage falls back to defaults", () => {
  const prefs = readPreferences({ notify: { likes: false, lives: "no" }, messages: "friends", extra: 1 });
  assert.equal(prefs.notify.lives, true);
  assert.equal(prefs.messages, "everyone");
  assert.equal("extra" in prefs, false);
});

test("partial updates merge and invalid ones are refused", () => {
  const { preferences } = updatePreferences({ notify: { lives: false } }, { notify: { interactions: false }, messages: "following" });
  assert.equal(preferences.notify.lives, false);
  assert.equal(preferences.notify.interactions, false);
  assert.equal(preferences.messages, "following");
  assert.ok(updatePreferences({}, { notify: { money: false } }).error);
  assert.ok(updatePreferences({}, { notify: { lives: "false" } }).error);
  assert.ok(updatePreferences({}, { comments: "friends" }).error);
  assert.ok(updatePreferences({}, { theme: "dark" }).error);
  assert.ok(updatePreferences({}, []).error);
});

test("reach rules: everyone, following, nobody, and replies always pass", () => {
  assert.equal(canReach("everyone"), true);
  assert.equal(canReach("following", { follows: false }), false);
  assert.equal(canReach("following", { follows: true }), true);
  assert.equal(canReach("nobody", { follows: true }), false);
  assert.equal(canReach("nobody", { replied: true }), true);
});

test("the database trigger knows every notification category type", () => {
  const sql = fs.readFileSync(path.join(__dirname, "migrations", "024_preferences.sql"), "utf8");
  for (const [category, types] of Object.entries(NOTIFY_CATEGORIES)) {
    assert.match(sql, new RegExp(`THEN '${category}'`));
    for (const type of types) assert.match(sql, new RegExp(`'${type}'`));
  }
});
