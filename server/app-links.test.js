const { test } = require("node:test");
const assert = require("node:assert/strict");
const { androidAssetLinks, appleAssociation } = require("./app-links");

const SHA = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");

test("apple association needs a real Team ID and lists the app paths", () => {
  assert.equal(appleAssociation(""), null);
  assert.equal(appleAssociation("abc"), null);
  const file = appleAssociation("ABCDE12345");
  assert.deepEqual(file.applinks.details[0].appIDs, ["ABCDE12345.ao.tchilar.app"]);
  assert.ok(file.applinks.details[0].components.some(item => item["/"] === "/u/*"));
});

test("android asset links accept one or more SHA-256 fingerprints and ignore junk", () => {
  assert.equal(androidAssetLinks(""), null);
  assert.equal(androidAssetLinks("nope"), null);
  const file = androidAssetLinks(`${SHA.toLowerCase()}, nope`);
  assert.deepEqual(file[0].target.sha256_cert_fingerprints, [SHA]);
  assert.equal(file[0].target.package_name, "ao.tchilar.app");
});
