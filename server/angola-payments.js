// Pagamentos angolanos:
// - Pagamento por Referência (Entidade + Referência + Valor) através da ProxyPay API v2
//   (https://developer.proxypay.co.ao/v2/). Notificação por webhook assinado com HMAC-SHA-256.
// - Multicaixa Express através da Paybyrd (https://docs.paybyrd.com). O pedido chega à app do cliente
//   pelo número de telemóvel (ou por QR code). Como a Paybyrd não documenta a assinatura das
//   notificações, o estado é SEMPRE confirmado com um GET à Paybyrd antes de se dar o pagamento por feito.
const crypto = require("crypto");

// ---------------------------------------------------------------------------------------------
// Validações
// ---------------------------------------------------------------------------------------------

// Telemóvel angolano: 9 dígitos a começar por 9 (aceita +244 / 00244 à frente).
function normalizeAngolanPhone(value) {
  const digits = String(value || "").replace(/[\s().-]/g, "").replace(/^(\+|00)244/, "");
  return /^9\d{8}$/.test(digits) ? digits : null;
}

// ProxyPay: compara a assinatura X-Signature (HMAC-SHA-256 do corpo bruto, hex minúsculo).
function verifyProxyPaySignature(rawBody, signature, apiKey) {
  if (!signature || !apiKey) return false;
  const expected = crypto.createHmac("sha256", apiKey).update(rawBody).digest("hex");
  const given = String(signature).trim().toLowerCase();
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const formatAmount = amountKz => (Math.round(Number(amountKz) * 100) / 100).toFixed(2);

// ---------------------------------------------------------------------------------------------
// ProxyPay (referências)
// ---------------------------------------------------------------------------------------------
function createProxyPay({ apiKey, entityId, environment = "sandbox", fetchImpl = fetch }) {
  const base = environment === "production" ? "https://api.proxypay.co.ao" : "https://api.sandbox.proxypay.co.ao";
  const headers = { Authorization: `Token ${apiKey}`, Accept: "application/vnd.proxypay.v2+json" };

  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ProxyPay ${method} ${path} falhou (${response.status}) ${detail.slice(0, 200)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    method: "reference",
    entityId: String(entityId),
    environment,
    // Cria uma referência válida até `endDate` (AAAA-MM-DD). Devolve o número da referência.
    async createReference({ amountKz, endDate, customFields = {} }) {
      const referenceId = await call("POST", "/reference_ids");
      await call("PUT", `/references/${referenceId}`, {
        amount: formatAmount(amountKz),
        end_datetime: endDate,
        custom_fields: Object.fromEntries(Object.entries(customFields).map(([key, value]) => [key, String(value)]))
      });
      return String(referenceId);
    },
    deleteReference: referenceId => call("DELETE", `/references/${referenceId}`),
    // Fila de pagamentos (alternativa ao webhook): lista e confirma depois de processar.
    listPayments: () => call("GET", "/payments?n=100"),
    acknowledgePayment: paymentId => call("DELETE", `/payments/${paymentId}`),
    // Só no sandbox: simula o pagamento de uma referência.
    mockPayment: (referenceId, amountKz) => call("POST", "/payments", { reference_id: Number(referenceId), amount: formatAmount(amountKz) }),
    verifySignature: (rawBody, signature) => verifyProxyPaySignature(rawBody, signature, apiKey)
  };
}

// ---------------------------------------------------------------------------------------------
// Paybyrd (Multicaixa Express)
// ---------------------------------------------------------------------------------------------
const PAYBYRD_SUCCESS = new Set(["success", "paid", "captured", "acquirersuccess"]);
const PAYBYRD_FAILURE = new Set(["failed", "fail", "canceled", "cancelled", "expired", "error", "denied", "rejected", "acquirerfailed"]);

// Converte a resposta da Paybyrd num estado nosso: paid | failed | pending.
function paybyrdState(transaction) {
  const status = String(transaction?.status || "").toLowerCase().replace(/\s+/g, "");
  if (PAYBYRD_SUCCESS.has(status)) return "paid";
  if (PAYBYRD_FAILURE.has(status)) return "failed";
  return "pending";
}

function createPaybyrd({ apiKey, currency = "AOA", fetchImpl = fetch }) {
  const base = "https://gateway.paybyrd.com/api/v2";
  const headers = { "x-api-key": apiKey, Accept: "application/json", "Content-Type": "application/json" };

  async function call(method, path, body) {
    const response = await fetchImpl(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    /** @type {any} Resposta da Paybyrd (formato da API deles). */
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Paybyrd ${method} ${path} falhou (${response.status}) ${data.description || ""}`.trim());
    return data;
  }

  return {
    method: "express",
    // Envia o pedido de pagamento para a app Multicaixa Express do número indicado.
    async createExpressPayment({ amountKz, phone, orderRef, redirectUrl }) {
      const amount = formatAmount(amountKz);
      // Formato do número como nos exemplos da Paybyrd: "<indicativo>#<número>".
      const phoneNumber = `244#${phone}`;
      const data = await call("POST", "/payment", {
        type: "OnlineTransfer",
        brand: "MULTICAIXAEXPRESS",
        amount,
        isoAmount: Math.round(Number(amount) * 100),
        currency,
        orderRef,
        phoneNumber,
        shopper: { phoneNumber },
        ...(redirectUrl && { redirectUrl })
      });
      return {
        transactionId: data.transactionId,
        state: paybyrdState(data),
        qrCodeUrl: data.multicaixaExpress?.qrCodeUrl || null,
        deeplink: data.multicaixaExpress?.deeplinkRedirect || data.multicaixaExpress?.deeplink || null,
        expiresAt: data.multicaixaExpress?.expiresAt || data.expiresAt || null
      };
    },
    async getState(transactionId) {
      return paybyrdState(await call("GET", `/transactions/${encodeURIComponent(transactionId)}`));
    }
  };
}

module.exports = { createPaybyrd, createProxyPay, normalizeAngolanPhone, paybyrdState, verifyProxyPaySignature };
