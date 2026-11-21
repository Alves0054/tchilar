const test = require("node:test");
const assert = require("node:assert/strict");
const { createDevVerify, createSms, createTwilioVerify, parseChannels } = require("./sms");

const fakeFetch = responses => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: Object.fromEntries(new URLSearchParams(options.body)) });
    const [status, data] = responses.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  return { calls, fetchImpl };
};

test("Twilio Verify: sends the SMS in Portuguese and checks the code with the service credentials", async () => {
  const { calls, fetchImpl } = fakeFetch([[201, { status: "pending" }], [200, { status: "approved" }], [200, { status: "pending" }]]);
  const verify = createTwilioVerify({ accountSid: "AC123", authToken: "segredo", serviceSid: "VA456", fetchImpl });
  assert.deepEqual(await verify.send("+244923456789"), { sent: true });
  assert.equal(calls[0].url, "https://verify.twilio.com/v2/Services/VA456/Verifications");
  assert.deepEqual(calls[0].body, { To: "+244923456789", Channel: "sms", Locale: "pt" });
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("AC123:segredo").toString("base64")}`);
  assert.equal(await verify.check("+244923456789", "123456"), true);
  assert.equal(calls[1].url, "https://verify.twilio.com/v2/Services/VA456/VerificationCheck");
  assert.deepEqual(calls[1].body, { To: "+244923456789", Code: "123456" });
  assert.equal(await verify.check("+244923456789", "000000"), false, "código errado: o Twilio responde pending");
});

test("Twilio Verify: the code can go by WhatsApp when that channel is switched on", async () => {
  assert.deepEqual(parseChannels("whatsapp,sms"), ["whatsapp", "sms"]);
  assert.deepEqual(parseChannels(" SMS , fax"), ["sms"], "canais desconhecidos são ignorados");
  assert.deepEqual(parseChannels(""), ["sms"]);
  const { calls, fetchImpl } = fakeFetch([[201, { status: "pending" }], [201, { status: "pending" }], [201, { status: "pending" }]]);
  const verify = createTwilioVerify({ accountSid: "AC", authToken: "t", serviceSid: "VA", fetchImpl, channels: ["whatsapp", "sms"] });
  await verify.send("+244923456789");
  assert.equal(calls[0].body.Channel, "whatsapp", "o primeiro canal da lista é o predefinido");
  await verify.send("+244923456789", "sms");
  assert.equal(calls[1].body.Channel, "sms");
  await verify.send("+244923456789", "fax");
  assert.equal(calls[2].body.Channel, "whatsapp", "um canal que não está ligado nunca é usado");
  assert.deepEqual(createSms({ accountSid: "AC", authToken: "t", serviceSid: "VA", channels: "whatsapp", fetchImpl }).channels, ["whatsapp"]);
});

test("Twilio Verify: expired codes, too many SMS and bad numbers become friendly answers", async () => {
  const { fetchImpl } = fakeFetch([[404, { code: 20404 }], [429, { code: 60203 }], [400, { code: 60200 }], [500, { code: 1, message: "falha" }]]);
  const verify = createTwilioVerify({ accountSid: "AC", authToken: "t", serviceSid: "VA", fetchImpl });
  assert.equal(await verify.check("+244923456789", "123456"), false);
  assert.match((await verify.send("+244923456789")).error, /vários códigos/);
  assert.match((await verify.send("+244923456789")).error, /Confirma o número/);
  await assert.rejects(() => verify.send("+244923456789"), /Twilio Verify falhou \(500\)/);
});

test("development codes: 6 digits, one use, expire after 10 minutes and after 5 wrong tries", async () => {
  let clock = 0;
  const logged = [];
  const verify = createDevVerify({ log: text => logged.push(text), now: () => clock });
  const { devCode } = await verify.send("+244923456789");
  assert.match(devCode, /^\d{6}$/);
  assert.match(logged[0], /\+244923456789: \d{6}/);
  assert.equal(await verify.check("+244923456789", devCode), true);
  assert.equal(await verify.check("+244923456789", devCode), false, "só serve uma vez");

  const second = (await verify.send("+244923456789")).devCode;
  clock += 11 * 60 * 1000;
  assert.equal(await verify.check("+244923456789", second), false, "expirou");

  const third = (await verify.send("+244923456789")).devCode;
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await verify.check("+244923456789", "999999x"), false);
  assert.equal(await verify.check("+244923456789", third), false, "bloqueado depois de 5 tentativas");
});

test("without Twilio keys there is no SMS in production, only development codes", () => {
  assert.equal(createSms({ isProduction: true }), null);
  assert.equal(createSms({ isProduction: false, log: () => {} }).mode, "dev");
  assert.equal(createSms({ accountSid: "AC", authToken: "t", serviceSid: "VA", isProduction: true }).mode, "twilio");
});
