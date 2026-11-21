// PayPay Africa (Angola): a pessoa aprova o pagamento na app PayPay (botão que abre a app ou QR code).
// Documentação: https://portal.paypayafrica.com/dist/guide/apidoc_pt.html
//
// Como a API funciona (resumo da documentação):
// - Um só endereço (fornecido pela equipa comercial da PayPay) recebe POST em JSON com
//   partner_id, service, timestamp (hora de Angola), biz_content, sign...
// - biz_content: o JSON do pedido CIFRADO com a NOSSA chave privada RSA (PKCS#1 v1.5, aos pedaços
//   de keyLen/8 - 11 bytes), em Base64.
// - sign: SHA1withRSA com a NOSSA chave privada sobre "a=1&b=2..." (parâmetros não vazios, sem sign
//   nem sign_type, por ordem ASCII), em Base64.
// - Notificações: POST application/x-www-form-urlencoded, assinadas pela PayPay (verificamos com a
//   chave pública DELES). Resposta: exatamente "success".
// O conteúdo de uma notificação nunca é prova de pagamento: o estado é sempre confirmado com trade_query.
const crypto = require("crypto");

const DEFAULT_API_URL = "https://gateway.paypayafrica.com/recv.do";

// Chaves: aceita PEM completo, PEM com "\n" escritos à mão (como no .env) ou só o Base64 (PKCS#8 / SPKI).
function toKey(value, kind) {
  const text = String(value || "").replace(/\\n/g, "\n").trim();
  if (!text) return null;
  if (text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "").match(/.{1,64}/g).join("\n");
  return kind === "private" ? `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----` : `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

// "a=1&b=2": sem valores vazios, sem sign/sign_type, chaves por ordem ASCII.
function signString(params) {
  return Object.keys(params)
    .filter(key => key !== "sign" && key !== "sign_type" && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map(key => `${key}=${typeof params[key] === "object" ? JSON.stringify(params[key]) : params[key]}`)
    .join("&");
}

function signPayPay(params, privateKey) {
  return crypto.sign("RSA-SHA1", Buffer.from(signString(params), "utf8"), toKey(privateKey, "private")).toString("base64");
}

function verifyPayPaySignature(params, publicKey) {
  if (!params?.sign || !publicKey) return false;
  try {
    return crypto.verify("RSA-SHA1", Buffer.from(signString(params), "utf8"), toKey(publicKey, "public"), Buffer.from(String(params.sign), "base64"));
  } catch {
    return false;
  }
}

// Cifra o JSON do pedido com a chave PRIVADA, aos pedaços (117 bytes numa chave de 1024 bits).
function encryptBizContent(object, privateKey) {
  const key = crypto.createPrivateKey(toKey(privateKey, "private"));
  const chunkSize = key.asymmetricKeyDetails.modulusLength / 8 - 11;
  const data = Buffer.from(JSON.stringify(object), "utf8");
  const parts = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    parts.push(crypto.privateEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, data.subarray(offset, offset + chunkSize)));
  }
  return Buffer.concat(parts).toString("base64");
}

// "yyyy-MM-dd HH:mm:ss" na hora de Angola (GMT+1, sem horário de verão).
function angolaTimestamp(now = Date.now()) {
  return new Date(now + 3600_000).toISOString().replace("T", " ").slice(0, 19);
}

const formatAmount = amountKz => (Math.round(Number(amountKz) * 100) / 100).toFixed(2);
// out_trade_no: 6 a 32 letras/números (sem hífens).
const tradeNoFor = paymentId => `TCHILAR${String(paymentId).padStart(6, "0")}`;
const paymentIdFromTradeNo = tradeNo => {
  const match = /^TCHILAR(\d{6,})$/.exec(String(tradeNo || ""));
  return match ? Number(match[1]) : null;
};

// Estados da PayPay → os nossos. TRADE_SUCCESS e TRADE_FINISHED = pago.
function paypayState(status) {
  if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") return "paid";
  if (status === "TRADE_CLOSED") return "failed";
  return "pending";
}

function createPayPayAfrica({ partnerId, privateKey, paypayPublicKey, saleProductCode, apiUrl = DEFAULT_API_URL, language = "pt", fetchImpl = fetch, now = Date.now }) {
  async function call(service, biz) {
    const params = {
      charset: "UTF-8", format: "JSON", language, partner_id: String(partnerId), request_no: crypto.randomUUID().replace(/-/g, ""),
      service, sign_type: "RSA", timestamp: angolaTimestamp(now()), version: "1.0", biz_content: encryptBizContent(biz, privateKey)
    };
    params.sign = signPayPay(params, privateKey);
    // A documentação pede os valores codificados como num URL antes de enviar (a assinatura é feita antes).
    const body = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, encodeURIComponent(value)]));
    const response = await fetchImpl(apiUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    /** @type {any} */
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== "S0001") {
      throw new Error(`PayPay ${service} falhou (${response.status}) ${data.code || ""} ${data.sub_code || ""} ${data.sub_msg || data.msg || ""}`.trim());
    }
    return typeof data.biz_content === "string" ? JSON.parse(data.biz_content) : data.biz_content || {};
  }

  return {
    method: "paypay",
    // Pagamento pela app PayPay. A PayPay só aceita prazos de 40 minutos a 7 dias.
    async createPayment({ paymentId, amountKz, subject, payerIp, returnUrl }) {
      const amount = formatAmount(amountKz);
      const outTradeNo = tradeNoFor(paymentId);
      const result = await call("instant_trade", {
        cashier_type: "SDK",
        payer_ip: String(payerIp || "127.0.0.1").replace(/^::ffff:/, ""),
        sale_product_code: String(saleProductCode),
        timeout_express: "40m",
        trade_info: {
          currency: "AOA", out_trade_no: outTradeNo, payee_identity: String(partnerId), payee_identity_type: "1",
          price: amount, quantity: "1", subject: String(subject || "Tchilar").slice(0, 120), total_amount: amount
        },
        ...(returnUrl && { return_url: returnUrl })
      });
      if (!result.trade_token && !result.dynamic_link) throw new Error("PayPay: a ordem não trouxe o link de pagamento.");
      return {
        outTradeNo,
        tradeNo: result.trade_no || null,
        dynamicLink: result.dynamic_link || null,
        deeplink: result.trade_token ? `paypayao://trade/pay?action=pay&tradeToken=${encodeURIComponent(result.trade_token)}` : result.dynamic_link,
        expiresAt: new Date(now() + 40 * 60_000)
      };
    },
    // Estado confirmado na PayPay, com o valor pago.
    async getState(outTradeNo) {
      const result = await call("trade_query", { out_trade_no: outTradeNo });
      return { state: paypayState(result.status), amount: Number(result.amount) };
    },
    verifyNotification: params => verifyPayPaySignature(params, paypayPublicKey)
  };
}

module.exports = {
  createPayPayAfrica, encryptBizContent, signPayPay, verifyPayPaySignature, signString, angolaTimestamp,
  paypayState, tradeNoFor, paymentIdFromTradeNo
};
