const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTicketEmail, spacedCode } = require("./ticket-email");

const base = {
  eventName: "Noite de Semba", startsAt: "2026-11-29T20:00:00Z", location: "Cine Atlântico, Luanda", organizer: "Kianda Eventos",
  buyerName: "Maria Silva", code: "K7M2Q9XR", amountKz: 2000, method: "Multicaixa Express", receipt: "BV-2026-B000123",
  ticketUrl: "https://tchilar.ao/events/12", qrUrl: "https://api.tchilar.ao/api/tickets/5/qr.png?s=abc", logoUrl: "https://tchilar.ao/tchilar-logo-full.png",
  company: { name: "Alves Estúdio", nif: "5001541781", address: "Luanda, Angola" }
};

test("ticket email: subject, greeting, event, code, payment and company footer", () => {
  const mail = buildTicketEmail(base);
  assert.equal(mail.subject, "O teu bilhete para Noite de Semba");
  assert.match(mail.html, /Olá Maria, já tens lugar\./);
  assert.match(mail.html, /Domingo, 29 de novembro/, "hora de Luanda");
  assert.match(mail.html, />21:00</);
  assert.match(mail.html, /K7M2 Q9XR/);
  assert.match(mail.html, /src="https:\/\/api\.tchilar\.ao\/api\/tickets\/5\/qr\.png\?s=abc"/);
  assert.match(mail.html, /2 000 Kz/);
  assert.match(mail.html, /Alves Estúdio · NIF 5001541781 · Luanda, Angola/);
  assert.match(mail.text, /Código do bilhete: K7M2Q9XR/);
  assert.match(mail.text, /Alves Estúdio · NIF 5001541781/);
  assert.equal(spacedCode("ABCDEFGH"), "ABCD EFGH");
  assert.match(buildTicketEmail({ ...base, amountKz: 1250.5 }).text, /1 250,50 Kz/);
});

test("ticket email: text written by people never becomes HTML", () => {
  const mail = buildTicketEmail({ ...base, eventName: "<script>alert(1)</script>", location: "\"><img src=x onerror=alert(1)>", buyerName: "Ana <b>" });
  assert.doesNotMatch(mail.html, /<script>|<img src=x|<b>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /Olá Ana, já tens lugar/);
});
