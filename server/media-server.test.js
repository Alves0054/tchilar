const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  authorizeMedia, createMediaClient, hashStreamKey, mediaConfig, newStreamKey, publishToken, summarizePath, userFromPath, verifyPublishToken
} = require("./media-server");
const { LivePresence, pollInterval } = require("./live-presence");
const { parseLiveInput } = require("./live-routes");

const SECRET = "segredo-de-teste-com-32-caracteres!";

test("media mode needs the API, the HLS address and a long hook secret", () => {
  assert.equal(mediaConfig({}), null);
  assert.equal(mediaConfig({ MEDIA_API_URL: "http://127.0.0.1:9997", MEDIA_HLS_URL: "https://cdn.x/", MEDIA_HOOK_SECRET: "curto" }), null);
  const config = mediaConfig({ MEDIA_API_URL: "http://127.0.0.1:9997/", MEDIA_HLS_URL: "https://cdn.x/", MEDIA_HOOK_SECRET: SECRET, MEDIA_RTMP_URL: "rtmp://live.x" });
  assert.deepEqual(config, { apiUrl: "http://127.0.0.1:9997", hlsUrl: "https://cdn.x", secret: SECRET, whipUrl: "", rtmpUrl: "rtmp://live.x" });
});

test("only live/u<id> paths belong to a person", () => {
  assert.equal(userFromPath("live/u12"), 12);
  for (const path of ["live/u0", "live/u12/x", "u12", "live/uabc", "../live/u12", ""]) assert.equal(userFromPath(path), null, path);
});

test("browser publish tokens are bound to the person and expire", () => {
  const now = Date.now();
  const token = publishToken(7, SECRET, now);
  assert.ok(verifyPublishToken(token, 7, SECRET, now));
  assert.equal(verifyPublishToken(token, 8, SECRET, now), false);
  assert.equal(verifyPublishToken(token, 7, "outro-segredo-qualquer-com-32-car", now), false);
  assert.equal(verifyPublishToken(token, 7, SECRET, now + 7 * 3600 * 1000), false);
  assert.equal(verifyPublishToken(`${token}x`, 7, SECRET, now), false);
});

test("the MediaMTX hook allows the right stream key only while the live is open", async () => {
  const key = newStreamKey();
  let open = true;
  const lookups = {
    publisher: async id => id === 12 ? { stream_key_hash: hashStreamKey(key), suspended_at: null } : null,
    liveOn: async () => (open ? { id: 1 } : null)
  };
  const ask = (request) => authorizeMedia({ action: "publish", path: "live/u12", ...request }, SECRET, lookups);
  assert.equal((await ask({ query: `key=${key}` })).ok, true, "RTMP: chave na query");
  assert.equal((await ask({ query: "", token: key })).ok, true, "WHIP do OBS: bearer token");
  assert.equal((await ask({ query: `t=${encodeURIComponent(publishToken(12, SECRET))}` })).ok, true, "estúdio do browser");
  assert.equal((await ask({ query: "key=sk_errada" })).ok, false);
  assert.equal((await ask({ query: `t=${publishToken(13, SECRET)}` })).ok, false, "token de outra pessoa");
  assert.equal((await authorizeMedia({ action: "publish", path: "live/u13", query: `key=${key}` }, SECRET, lookups)).ok, false, "chave noutro caminho");
  assert.equal((await authorizeMedia({ action: "read", path: "live/u12" }, SECRET, lookups)).ok, true);
  assert.equal((await authorizeMedia({ action: "api", path: "live/u12" }, SECRET, lookups)).ok, false);
  open = false;
  assert.equal((await ask({ query: `key=${key}` })).ok, false, "sem direto aberto não emite");
  assert.equal((await authorizeMedia({ action: "read", path: "live/u12" }, SECRET, lookups)).ok, false);
});

test("suspended accounts cannot publish even with the right key", async () => {
  const key = newStreamKey();
  const lookups = { publisher: async () => ({ stream_key_hash: hashStreamKey(key), suspended_at: new Date() }), liveOn: async () => ({ id: 1 }) };
  assert.equal((await authorizeMedia({ action: "publish", path: "live/u12", query: `key=${key}` }, SECRET, lookups)).ok, false);
});

test("path summaries report resolution and bitrate between refreshes", () => {
  const item = { ready: true, tracks2: [{ codec: "H264", codecProps: { width: 1920, height: 1080 } }, { codec: "Opus" }], bytesReceived: 1_000_000, source: { type: "rtmpConn", id: "a" } };
  const first = summarizePath(item, null, 1000);
  assert.deepEqual([first.width, first.height, first.kbps], [1920, 1080, 0]);
  const second = summarizePath({ ...item, bytesReceived: 1_500_000 }, first, 2000);
  assert.equal(second.kbps, 4000);
});

test("kicking uses the right MediaMTX endpoint for the source", async () => {
  const calls = [];
  const fake = async (url, options) => {
    calls.push([url, options?.method || "GET"]);
    if (url.includes("/paths/list")) return { ok: true, json: async () => ({ items: [{ name: "live/u3", ready: true, bytesReceived: 10, source: { type: "rtmpConn", id: "c1" } }] }) };
    return { ok: true };
  };
  const client = createMediaClient({ apiUrl: "http://m:9997", hlsUrl: "https://cdn", whipUrl: "https://w" }, fake);
  await client.refresh();
  assert.equal(await client.kick("live/u3"), true);
  assert.deepEqual(calls.at(-1), ["http://m:9997/v3/rtmpconns/kick/c1", "POST"]);
  assert.equal(client.hlsUrl(3), "https://cdn/live/u3/index.m3u8");
  assert.equal(client.whipUrl(3), "https://w/live/u3/whip");
});

test("presence counts each person once and forgets who stopped watching", () => {
  const presence = new LivePresence({ windowMs: 1000 });
  presence.touch(1, 10, 0);
  presence.touch(1, 10, 100);
  presence.touch(1, 11, 200);
  assert.equal(presence.count(1), 2);
  presence.prune(1150);
  assert.deepEqual(presence.stats(1), { viewers: 1, peak: 2, unique: 2 });
  presence.leave(1, 11);
  assert.equal(presence.count(1), 0);
});

test("presence handles 100 000 viewers quickly", () => {
  const presence = new LivePresence();
  const started = performance.now();
  for (let user = 1; user <= 100_000; user++) presence.touch(1, user, 0);
  presence.prune(10);
  assert.equal(presence.count(1), 100_000);
  assert.ok(performance.now() - started < 1500, "contar 100 mil pessoas deve ser rápido");
});

test("polling slows down as the audience grows", () => {
  assert.ok(pollInterval(10) < pollInterval(10_000));
  assert.ok(pollInterval(10_000) <= pollInterval(150_000));
});

test("live details are validated", () => {
  assert.deepEqual(parseLiveInput({ title: "  Kizomba   ao vivo ", category: "musica", source: "obs", description: "Olá" }, { mediaEnabled: true }).live,
    { title: "Kizomba ao vivo", description: "Olá", category: "musica", source: "obs" });
  assert.ok(parseLiveInput({ title: "x", source: "obs" }, { mediaEnabled: false }).error);
  assert.ok(parseLiveInput({ title: "" }, { mediaEnabled: true }).error);
  assert.ok(parseLiveInput({ title: "x", category: "hack" }, { mediaEnabled: true }).error);
  assert.ok(parseLiveInput({ title: "x", description: "a".repeat(501) }, { mediaEnabled: true }).error);
  assert.equal(parseLiveInput({ title: "x", source: "outra" }, { mediaEnabled: false }).live.source, "browser");
});

const { LiveReactions, REACTION_GAP_MS } = require("./live-reactions");

test("reactions are counted in memory, only known kinds and not faster than the gap", () => {
  const reactions = new LiveReactions();
  assert.equal(reactions.add(1, 10, "heart", 0), true);
  assert.equal(reactions.add(1, 10, "heart", REACTION_GAP_MS - 1), false, "demasiado rápido");
  assert.equal(reactions.add(1, 10, "like", REACTION_GAP_MS), true);
  assert.equal(reactions.add(1, 11, "heart", 1), true, "outra pessoa não espera");
  assert.equal(reactions.add(1, 12, "bomba", 0), false);
  assert.deepEqual(reactions.of(1), { heart: 2, like: 1, spark: 0 });
  assert.deepEqual(reactions.of(2), { heart: 0, like: 0, spark: 0 });
  reactions.forget(1);
  assert.equal(reactions.of(1).heart, 0);
});

test("the MediaMTX control API only accepts the app with the hook secret", async () => {
  const { MEDIA_API_USER } = require("./media-server");
  const secret = "s".repeat(32);
  const lookups = { liveOn: async () => null, publisher: async () => null };
  assert.equal((await authorizeMedia({ action: "api", user: MEDIA_API_USER, password: secret }, secret, lookups)).ok, true);
  assert.equal((await authorizeMedia({ action: "api", user: MEDIA_API_USER, password: "errado" }, secret, lookups)).ok, false);
  assert.equal((await authorizeMedia({ action: "api", user: "outro", password: secret }, secret, lookups)).ok, false);
  assert.equal((await authorizeMedia({ action: "api" }, secret, lookups)).ok, false);
  assert.equal((await authorizeMedia({ action: "metrics", user: MEDIA_API_USER, password: secret }, secret, lookups)).ok, false);
  assert.equal((await authorizeMedia({ action: "pprof", user: MEDIA_API_USER, password: secret }, secret, lookups)).ok, false);
});

test("the media client authenticates every call to the control API", async () => {
  const seen = [];
  const fakeFetch = async (url, options = {}) => { seen.push(options.headers?.Authorization); return { ok: true, json: async () => ({ items: [] }) }; };
  const client = createMediaClient({ apiUrl: "http://media:9997", hlsUrl: "http://media:8888", secret: "s".repeat(32) }, fakeFetch);
  await client.refresh();
  assert.equal(seen.length, 1);
  assert.equal(seen[0], `Basic ${Buffer.from(`tchilar-api:${"s".repeat(32)}`).toString("base64")}`);
});
