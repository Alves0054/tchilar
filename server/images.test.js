const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { IMAGE_PROFILES, optimizeImageFile, optimizeUpload } = require("./images");

async function tempDir() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "biva-images-"));
}

// Imagem com ruído (difícil de comprimir) para o teste de tamanho ser realista.
async function noisyJpeg(file, width, height, withGps = false) {
  const raw = Buffer.alloc(width * height * 3);
  for (let index = 0; index < raw.length; index++) raw[index] = (index * 7919) % 251;
  let image = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 98 });
  if (withGps) image = image.withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "38/1 43/1 0/1" } });
  await image.toFile(file);
}

test("converts to webp, resizes to the profile and deletes the original", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "photo.jpg");
  await noisyJpeg(input, 3000, 2000);
  const outputName = await optimizeImageFile(input, "post");
  assert.equal(outputName, "photo.webp");
  assert.equal(fs.existsSync(input), false);
  const meta = await sharp(path.join(dir, outputName)).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width, meta.height), IMAGE_PROFILES.post.width);
});

test("never enlarges small images and keeps the aspect ratio", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "small.png");
  await sharp({ create: { width: 300, height: 120, channels: 3, background: "#0077B6" } }).png().toFile(input);
  const meta = await sharp(path.join(dir, await optimizeImageFile(input, "avatar"))).metadata();
  assert.deepEqual([meta.width, meta.height], [300, 120]);
});

test("cover only limits the width so tall images can be repositioned", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "tall.png");
  await sharp({ create: { width: 2400, height: 3600, channels: 3, background: "#00B4D8" } }).png().toFile(input);
  const meta = await sharp(path.join(dir, await optimizeImageFile(input, "cover"))).metadata();
  assert.deepEqual([meta.width, meta.height], [1920, 2880]);
});

test("strips EXIF metadata such as GPS location", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "gps.jpg");
  await noisyJpeg(input, 400, 300, true);
  assert.ok((await sharp(input).metadata()).exif, "the fixture should carry EXIF");
  const meta = await sharp(path.join(dir, await optimizeImageFile(input, "post"))).metadata();
  assert.equal(meta.exif, undefined);
});

test("middleware rejects files that are not real images and removes them", async () => {
  const dir = await tempDir();
  const fake = path.join(dir, "fake.png");
  await fs.promises.writeFile(fake, "isto não é uma imagem");
  const req = { file: { path: fake, filename: "fake.png", mimetype: "image/png", size: 21 } };
  let status;
  let body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await optimizeUpload("post")(req, res, () => assert.fail("next should not be called"));
  } finally {
    console.error = originalError;
  }
  assert.equal(status, 400);
  assert.match(body.error, /imagem/);
  assert.equal(fs.existsSync(fake), false);
});

test("middleware leaves videos untouched", async () => {
  const req = { file: { path: "/nao/existe.mp4", filename: "existe.mp4", mimetype: "video/mp4", size: 10 } };
  let called = false;
  await optimizeUpload("post")(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.file.filename, "existe.mp4");
});

test("re-encodes a webp upload in place (same file name as the result)", async () => {
  const dir = await tempDir();
  const input = path.join(dir, "already.webp");
  await noisyJpeg(path.join(dir, "source.jpg"), 900, 900);
  await sharp(path.join(dir, "source.jpg")).webp({ quality: 100 }).toFile(input);
  const before = (await fs.promises.stat(input)).size;
  const outputName = await optimizeImageFile(input, "avatar");
  assert.equal(outputName, "already.webp");
  const after = await fs.promises.stat(path.join(dir, outputName));
  assert.ok(after.size < before, `expected ${after.size} < ${before}`);
  assert.equal(fs.existsSync(path.join(dir, "already.tmp.webp")), false);
});
