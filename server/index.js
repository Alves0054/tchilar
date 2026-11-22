require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const { createEmailQueue } = require("./email-queue");
const { connectRateLimitStore, makeRateLimit } = require("./rate-limit");
// Com REDIS_URL, os limites de pedidos são partilhados entre todas as cópias da API.
connectRateLimitStore();
// O helmet exporta a função também como "default" (é isso que os tipos dele descrevem).
const { default: helmet } = require("helmet");
const Stripe = require("stripe");
const { runMigrations } = require("./migrate");
const { optimizeUpload, smallVariantName } = require("./images");
const { activatePaidAd, registerCreatorRoutes } = require("./creator-routes");
const { launchMonthlyChallenges, registerGrowthRoutes } = require("./growth-routes");
const { sendEventReminders } = require("./event-reminders");
const { registerHomeRoutes } = require("./home-routes");
const { registerPaymentRoutes } = require("./payment-records");
const { logAdminAction, registerAdminRoutes } = require("./admin-routes");
const { registerAdminOperations } = require("./admin-operations");
const { registerLiveRoutes, turnServer } = require("./live-routes");
const { registerGroupCalls } = require("./group-calls");
const { createPayments } = require("./payments");
const { normalizePromotionCode, resolvePromotionCode } = require("./promotion-codes");
const { createPaybyrd, createProxyPay } = require("./angola-payments");
const { PHONE_ERROR, parsePhoneNumber } = require("./phones");
const { SMS_CODE_PATTERN, createSms } = require("./sms");
const { recordSms, smsAllowed } = require("./sms-guard");
const { createPayPal, createRedotPay } = require("./global-payments");
const { createPayPayAfrica } = require("./paypay-africa");
const { AsyncLocalStorage } = require("async_hooks");

// Telemóvel da conta (opcional e privado). undefined = não mexer; "" ou null = apagar.
// Telemóvel da conta: países da CPLP, guardado em formato internacional (+244923456789). "country" (AO, BR, PT...)
// só conta para números escritos sem indicativo; por omissão é Angola.
function parsePhone(raw, country) {
  if (raw === undefined) return { skip: true };
  if (raw === null || (typeof raw === "string" && !raw.trim())) return { value: null };
  const phone = parsePhoneNumber(raw, typeof country === "string" ? country : undefined);
  return phone ? { value: phone.e164 } : { error: PHONE_ERROR };
}
const { registerFinanceRoutes } = require("./finance-routes");
const { decrypt, encrypt, loadKey } = require("./payouts");
const { generateSecret, otpauthUri, verifyCode } = require("./totp");
const { parseVideoEdit } = require("./video-edit");
const { canReach, onlineSql, readPreferences, updatePreferences } = require("./preferences");
const { POST_MUSIC_SQL, registerMusicRoutes } = require("./music-routes");
const { parseBirthDate } = require("./growth");
const { adultSql, parseAccessPrice, sameGroupName } = require("./groups");
const { createPush, createWebPushSender } = require("./push");
const { registerCourseRoutes } = require("./courses");
const { registerAppLinks } = require("./app-links");
const { crawlerPage, findPreview, injectPreview } = require("./link-preview");
const { RENEWAL_WINDOW_DAYS, canRenew, registerLocalSubscriptions } = require("./local-subscriptions");
const { SESSION_IDLE_DAYS, createSession, deviceLabel, registerSessionRoutes, touchSession, validSession } = require("./sessions");
const { DOCUMENT_TYPES, registerGroupFeatures } = require("./group-features");
const { parseGroupKind, parseGroupPrivacy, parsePageType, parseStoryBackground } = require("./community-types");
const QRCode = require("qrcode");
const { deleteBlockedReason, parseSellerInput, parseTicketInput, registerEventTickets } = require("./event-tickets");
const { MODERATION_ACTIONS, REPORT_REASONS, blockedBetween, shouldAutoHide } = require("./moderation");
const {
  ACTIVE_SUBSCRIPTION_SQL,
  MAX_PRICE,
  MIN_PRICE,
  mapStripeStatus,
  parseSubscriptionPrice,
  periodEndFromStripe
} = require("./subscriptions");

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
// Só em NODE_ENV=development explícito; qualquer outro valor (ou nenhum) é tratado como produção.
const isDevelopment = process.env.NODE_ENV === "development";
const exposeDevAuthLinks = isDevelopment && process.env.DEV_EXPOSE_AUTH_LINKS === "true";
// SMS (Twilio Verify): confirmar o telemóvel e recuperar a conta. Sem as chaves, só funciona em desenvolvimento
// (código no terminal); em produção fica indisponível.
const sms = createSms({
  accountSid: (process.env.TWILIO_ACCOUNT_SID || "").trim(), authToken: (process.env.TWILIO_AUTH_TOKEN || "").trim(),
  serviceSid: (process.env.TWILIO_VERIFY_SERVICE_SID || "").trim(), isProduction: !isDevelopment,
  channels: process.env.SMS_CHANNELS
});
// Pagamentos de demonstração (ativam sem cobrar) precisam de DUAS coisas: desenvolvimento E pedido explícito.
// Assim, um servidor de desenvolvimento aberto por um túnel público não oferece estrelas nem promoções grátis.
const demoPayments = isDevelopment && process.env.PAYMENTS_DEMO === "true";
const appUrl = process.env.APP_URL || allowedOrigins[0] || "http://localhost:5173";
const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined
  })
  : null;
// Todos os emails passam pela fila (limites do fornecedor, novas tentativas, conta antes de avisos).
const emailQueue = createEmailQueue({ pool, transport: mailTransport, from: process.env.SMTP_FROM });
const authRateLimit = makeRateLimit("auth", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas tentativas. Tenta novamente mais tarde." }
});
// Ações de segurança com sessão iniciada (mudar palavra-passe, 2FA): limite próprio, para não gastar
// as tentativas de login. 20 em 15 min chega para uso normal e torna inútil adivinhar códigos de 6 dígitos.
const accountSecurityRateLimit = makeRateLimit("accountSecurity", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas tentativas. Tenta novamente daqui a 15 minutos." }
});
// Mudar o telemóvel: o aviso "já está noutra conta" diz se um número usa o Tchilar (sem SMS não há como evitar).
// Por conta (não por IP), 10 mudanças por hora chegam para corrigir enganos e tornam inútil testar números em série.
const phoneChangeRateLimit = makeRateLimit("phoneChange", {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: req => `user:${req.user?.id}`,
  skip: req => !isRecord(req.body) || req.body.phone === undefined,
  message: { error: "Mudaste o telemóvel demasiadas vezes. Tenta novamente daqui a uma hora." }
});
const recoveryRateLimit = makeRateLimit("recovery", {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Tenta novamente mais tarde." }
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const subscriptionCurrency = (process.env.SUBSCRIPTION_CURRENCY || "aoa").toLowerCase();
// Pagamentos únicos (promoções, estrelas, campanhas): cada produto regista o que fazer quando o pagamento chega.
// Falha fechada: os pagamentos de demonstração (sem cobrança) só existem com NODE_ENV=development.
// Qualquer outro ambiente sem Stripe (produção, staging, NODE_ENV esquecido) recusa os pagamentos.
// Métodos angolanos (opcionais): Pagamento por Referência (ProxyPay) e Multicaixa Express (Paybyrd).
const proxypay = process.env.PROXYPAY_API_KEY && process.env.PROXYPAY_ENTITY_ID
  ? createProxyPay({ apiKey: process.env.PROXYPAY_API_KEY, entityId: process.env.PROXYPAY_ENTITY_ID, environment: process.env.PROXYPAY_ENV === "production" ? "production" : "sandbox" })
  : null;
const paybyrd = process.env.PAYBYRD_API_KEY ? createPaybyrd({ apiKey: process.env.PAYBYRD_API_KEY, currency: subscriptionCurrency.toUpperCase() }) : null;
// PayPal e RedotPay cobram em dólares: PAYMENTS_KZ_PER_USD diz quantos kwanzas vale 1 dólar (a equipa atualiza).
const paypalEnvironment = String(process.env.PAYPAL_ENV || "live").trim().toLowerCase() === "live" ? "live" : "sandbox";
const paypal = process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
  ? createPayPal({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET, environment: paypalEnvironment,
    currency: (process.env.PAYPAL_CURRENCY || "USD").toUpperCase(), kzPerUnit: process.env.PAYMENTS_KZ_PER_USD })
  : null;
const redotpayCredentials = {
  appKey: (process.env.REDOTPAY_APP_KEY || "").trim(),
  privateKey: (process.env.REDOTPAY_PRIVATE_KEY || "").trim(),
  platformPublicKey: (process.env.REDOTPAY_PLATFORM_PUBLIC_KEY || "").trim()
};
const redotpayExchangeRate = Number(process.env.PAYMENTS_KZ_PER_USD);
const redotpay = Object.values(redotpayCredentials).every(Boolean) && Number.isFinite(redotpayExchangeRate) && redotpayExchangeRate > 0
  ? createRedotPay({ ...redotpayCredentials, keyVersion: process.env.REDOTPAY_KEY_VERSION || "1",
    environment: process.env.REDOTPAY_ENV === "production" ? "production" : "sandbox", currency: (process.env.REDOTPAY_CURRENCY || "USD").toUpperCase(),
    kzPerUnit: redotpayExchangeRate })
  : null;
// PayPay Africa (kwanzas): dados pela equipa comercial da PayPay + o nosso par de chaves RSA.
const paypay = process.env.PAYPAY_PARTNER_ID && process.env.PAYPAY_PRIVATE_KEY && process.env.PAYPAY_SALE_PRODUCT_CODE
  ? createPayPayAfrica({ partnerId: process.env.PAYPAY_PARTNER_ID, privateKey: process.env.PAYPAY_PRIVATE_KEY, paypayPublicKey: process.env.PAYPAY_PUBLIC_KEY,
    saleProductCode: process.env.PAYPAY_SALE_PRODUCT_CODE, ...(process.env.PAYPAY_API_URL && { apiUrl: process.env.PAYPAY_API_URL }) })
  : null;
// O IP de quem paga (a PayPay pede-o em cada pagamento), guardado durante cada pedido à API.
const requestContext = new AsyncLocalStorage();
// Endereço público da API (para o PayPal saber para onde devolver a pessoa). Sem API_PUBLIC_URL, usa o do site (/api passa por lá).
const apiPublicUrl = process.env.API_PUBLIC_URL || appUrl;
const payments = createPayments({ stripe, isProduction: !demoPayments, appUrl, apiUrl: apiPublicUrl, currency: subscriptionCurrency, pool, proxypay, paybyrd, paypal, redotpay, paypay,
  payerIp: () => requestContext.getStore()?.ip || null, qrCode: text => QRCode.toDataURL(text, { margin: 1, width: 240 }), allowSimulation: demoPayments });
payments.register("ad", (adId, details) => activatePaidAd(pool, adId, details));
// Subscrições pagas mês a mês (Express, Referência, PayPal, RedotPay).
const localSubscriptions = registerLocalSubscriptions({ pool, transaction, payments });

// Atrás do nginx (ou outro proxy), o IP real vem em X-Forwarded-For. Sem isto, os limites de tentativas
// contariam todas as pessoas como uma só (o IP do proxy). TRUST_PROXY = número de proxies à frente.
if (Number(process.env.TRUST_PROXY) > 0) app.set("trust proxy", Number(process.env.TRUST_PROXY));

// Cabeçalhos de segurança. A CSP só deixa correr scripts do próprio site: mesmo que alguém consiga
// injetar HTML, o browser recusa executar código vindo de outro lado.
const apiOrigin = (() => {
  try { return process.env.VITE_API_URL ? new URL(process.env.VITE_API_URL).origin : null; } catch { return null; }
})();
// Servidor de vídeo dos diretos (MediaMTX e a CDN do HLS): o browser envia (WHIP) e recebe (HLS) daí.
const originOf = value => { try { return value ? new URL(value).origin : null; } catch { return null; } };
const mediaOrigins = [...new Set([originOf(process.env.MEDIA_WHIP_URL), originOf(process.env.MEDIA_HLS_URL)].filter(Boolean))];
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", ...mediaOrigins],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", ...(apiOrigin ? [apiOrigin] : []), ...mediaOrigins],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isDevelopment ? null : []
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-site" },
  hsts: isDevelopment ? false : { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
// A câmara e o microfone só podem ser usados pelo próprio site (diretos); a localização por ninguém.
app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
  next();
});

// A app de telemóvel (React Native) não é um browser: não envia Origin e o CORS não se aplica a ela.
app.use(cors({ origin: allowedOrigins }));

// A Stripe assina o corpo original do pedido: este endpoint tem de ler o corpo em bruto,
// por isso é registado antes do express.json().
app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!stripe || !stripeWebhookSecret) return res.status(503).json({ error: "Pagamentos não configurados." });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] || "", stripeWebhookSecret);
  } catch {
    return res.status(400).json({ error: "Assinatura do webhook inválida." });
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    // Pagamentos únicos (promoções, estrelas, campanhas): cada um ativa-se sozinho quando o pagamento chega.
    await payments.handleCheckoutSession(session);
    if (session.mode === "subscription" && session.subscription) {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      await applyStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId));
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    await payments.handleCheckoutSession(event.data.object);
  } else if (event.type.startsWith("customer.subscription.")) {
    await applyStripeSubscription(event.data.object);
  }
  res.json({ received: true });
});

// ProxyPay: pagamentos por referência. Só aceita notificações com assinatura HMAC válida.
app.post("/api/webhooks/proxypay", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
  if (!proxypay) return res.status(503).json({ error: "Pagamentos por referência não configurados." });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!proxypay.verifySignature(raw, req.headers["x-signature"])) return res.status(401).json({ error: "Assinatura inválida." });
  let payment;
  try {
    payment = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Corpo inválido." });
  }
  try {
    await payments.handleProxyPayPayment(payment);
    res.json({ received: true });
  } catch (error) {
    console.error("ProxyPay webhook:", error.message);
    res.status(500).json({ error: "Erro ao processar." });
  }
});

// Paybyrd: Multicaixa Express. O conteúdo da notificação não é usado como prova: o estado
// é sempre confirmado com a Paybyrd antes de se dar o pagamento por feito.
app.post("/api/webhooks/paybyrd", express.json({ limit: "100kb" }), async (req, res) => {
  const body = req.body || {};
  const transactionId = body.transactionId || body.content?.transactionId || body.data?.transactionId || body.transaction?.transactionId;
  try {
    await payments.refreshExpressByTransaction(transactionId);
  } catch (error) {
    console.error("Paybyrd webhook:", error.message);
  }
  res.json({ received: true });
});

// RedotPay: só aceita avisos assinados pela RedotPay (chave pública deles, por ambiente) e com menos de 5 minutos.
app.post("/api/webhooks/redotpay", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }
  const requestId = typeof payload.requestId === "string" ? payload.requestId : crypto.randomUUID();
  if (!redotpay) return res.status(503).json({ code: "FAIL", requestId, msg: "RedotPay não configurado." });
  if (!redotpay.verifyWebhook(raw, req.headers)) return res.status(401).json({ code: "FAIL", requestId, msg: "Assinatura inválida." });
  try {
    await payments.handleRedotPayNotification(payload);
    res.json({ code: "SUCCESS", requestId });
  } catch (error) {
    console.error("RedotPay webhook:", error.message);
    res.status(500).json({ code: "FAIL", requestId, msg: "Erro ao processar." });
  }
});

// PayPay Africa: aviso assinado pela PayPay (formulário, não JSON). Só serve para perguntar o estado
// à PayPay; a resposta tem de ser exatamente "success" (senão a PayPay repete o aviso).
app.post("/api/webhooks/paypay", express.urlencoded({ extended: false, limit: "100kb" }), async (req, res) => {
  if (!paypay) return res.status(503).type("text/plain").send("fail");
  const params = req.body && typeof req.body === "object" ? req.body : {};
  if (!paypay.verifyNotification(params)) return res.status(401).type("text/plain").send("fail");
  try {
    await payments.refreshPayPayByTradeNo(typeof params.out_trade_no === "string" ? params.out_trade_no : null);
    res.type("text/plain").send("success");
  } catch (error) {
    console.error("PayPay webhook:", error.message);
    res.status(500).type("text/plain").send("fail");
  }
});

// PayPal: a pessoa volta aqui depois de aprovar. Capturamos o pagamento e mandamo-la para a página certa.
app.get("/api/payments/paypal/return", async (req, res) => {
  const id = parseId(req.query.payment);
  let target = "/";
  try {
    const result = id ? await payments.capturePayPal(id, typeof req.query.token === "string" ? req.query.token : null) : { path: "/" };
    target = result.path || "/";
  } catch (error) {
    console.error("PayPal return:", error.message);
  }
  // Só caminhos do próprio site (nunca endereços de fora).
  res.redirect(303, new URL(target.startsWith("/") && !target.startsWith("//") ? target : "/", appUrl).toString());
});

// Limites gerais por IP, além dos limites próprios do login, recuperação, SMS, pesquisa e denúncias:
// - escritas (publicar, comentar, mensagens, criar...): RATE_LIMIT_WRITES por 5 min (300 por omissão);
// - começar pagamentos (bilhetes, cursos, estrelas, subscrições...): RATE_LIMIT_PAYMENTS por 10 min (30 por omissão).
// Os sinais dos diretos (heartbeat, sinais WebRTC, reações) ficam de fora: são muitos e já têm controlo próprio.
const writeLimit = () => Math.max(1, Number(process.env.RATE_LIMIT_WRITES) || 300);
const paymentLimit = () => Math.max(1, Number(process.env.RATE_LIMIT_PAYMENTS) || 30);
const LIVE_SIGNAL_PATH = /^\/api\/lives\/\d+\/(heartbeat|signals|react|leave)$/;
const PAYMENT_START_PATH = /^\/api\/(events\/\d+\/tickets|lives\/\d+\/ticket|courses\/\d+\/buy|stars\/purchase|groups\/\d+\/access|subscriptions\/\d+|creator\/verification\/checkout|pages\/\d+\/verification\/checkout|campaigns(\/\d+\/[a-z-]+)?|ads(\/\d+\/checkout)?|creator\/partner\/join)$/;
// O Express aceita /API/Stars/Purchase/ como /api/stars/purchase: compara-se sempre o caminho normalizado.
const cleanPath = req => String(req.path || "").toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "");
const isWrite = req => {
  const path = cleanPath(req);
  return !["GET", "HEAD", "OPTIONS"].includes(req.method) && path.startsWith("/api/")
    && !path.startsWith("/api/webhooks/") && !path.startsWith("/api/media/") && !LIVE_SIGNAL_PATH.test(path);
};
const writeRateLimit = makeRateLimit("writes", {
  windowMs: 5 * 60 * 1000, limit: writeLimit, standardHeaders: "draft-8", legacyHeaders: false,
  skip: req => !isWrite(req),
  message: { error: "Estás a fazer demasiadas ações seguidas. Espera uns minutos e tenta outra vez." }
});
const paymentRateLimit = makeRateLimit("paymentStarts", {
  windowMs: 10 * 60 * 1000, limit: paymentLimit, standardHeaders: "draft-8", legacyHeaders: false,
  skip: req => req.method !== "POST" || !PAYMENT_START_PATH.test(cleanPath(req)),
  message: { error: "Demasiados pagamentos começados. Espera 10 minutos e tenta outra vez." }
});
app.use(writeRateLimit);
app.use(paymentRateLimit);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use((req, _res, next) => requestContext.run({ ip: req.ip }, next));

const mimeExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => {
      callback(null, `${crypto.randomBytes(16).toString("hex")}${mimeExtensions[file.mimetype] || ""}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(mimeExtensions, file.mimetype)) {
      return callback(new Error("Formato de ficheiro não suportado."));
    }
    callback(null, true);
  }
});

const imageExtensions = Object.fromEntries(Object.entries(mimeExtensions).filter(([mime]) => mime.startsWith("image/")));
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => {
      callback(null, `${crypto.randomBytes(16).toString("hex")}${imageExtensions[file.mimetype] || ""}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(imageExtensions, file.mimetype)) {
      return callback(new Error("Formato de ficheiro não suportado."));
    }
    callback(null, true);
  }
});

// Documentos dos grupos (PDF, Word, Excel, PowerPoint, texto, ZIP, imagens), até 25 MB.
const documentUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, callback) => callback(null, `${crypto.randomBytes(16).toString("hex")}${DOCUMENT_TYPES[file.mimetype] || ""}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(DOCUMENT_TYPES, file.mimetype)) return callback(new Error("Formato não aceite. Envia PDF, Word, Excel, PowerPoint, texto, ZIP ou imagem."));
    callback(null, true);
  }
});

// Campos da própria conta devolvidos ao cliente (nunca inclui password_hash nem auth_version).
const OWN_ACCOUNT_FIELDS = "id,username,email,display_name,bio,avatar_url,cover_url,cover_position,location,website,profession,is_creator,subscription_price,email_verified,is_admin,admin_role,phone,phone_verified_at,billing_name,billing_nif,billing_address,created_at";

// Apaga um ficheiro de /uploads de forma segura (ignora valores vazios e ficheiros já removidos).
async function removeUpload(mediaUrl) {
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/uploads/")) return;
  try {
    await fs.promises.unlink(path.join(uploadDir, path.basename(mediaUrl)));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not remove upload:", error.code || error.name);
  }
  // A versão pequena (modo "Poupar dados"), quando existe.
  if (/\.webp$/i.test(mediaUrl)) await fs.promises.rm(path.join(uploadDir, smallVariantName(path.basename(mediaUrl))), { force: true }).catch(() => {});
}

async function initDb() {
  await runMigrations(pool);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Só limpa espaços. O tamanho máximo verifica-se em cada rota, para dar uma mensagem própria
// em vez de cortar o texto em silêncio.
function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function transaction(operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Database rollback failed:", rollbackError.code || rollbackError.name);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function canAccessPost(postId, userId) {
  const result = await pool.query(
    `SELECT p.user_id,p.is_exclusive,p.group_id,p.hidden_at,${blockedBetween("$2", "p.user_id")} AS blocked
     FROM posts p WHERE p.id=$1`,
    [postId, userId || 0]);
  if (!result.rowCount) return { exists: false, allowed: false };
  const post = result.rows[0];
  if (post.user_id === userId) return { exists: true, allowed: true, post };
  // Publicações escondidas pela moderação ou de pessoas bloqueadas comportam-se como inexistentes.
  if (post.hidden_at || post.blocked) return { exists: false, allowed: false };
  if (post.group_id) {
    if (!userId) return { exists: true, allowed: false, post };
    const membership = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",
      [post.group_id, userId]);
    return { exists: true, allowed: membership.rowCount > 0, post };
  }
  if (post.is_exclusive) {
    if (!userId) return { exists: true, allowed: false, post };
    const subscription = await pool.query(
      `SELECT 1 FROM subscriptions s WHERE s.subscriber_id=$1 AND s.creator_id=$2 AND ${ACTIVE_SUBSCRIPTION_SQL}`,
      [userId, post.user_id]);
    return { exists: true, allowed: subscription.rowCount > 0, post };
  }
  return { exists: true, allowed: true, post };
}

// Grava o estado de uma subscrição Stripe. É idempotente: a Stripe pode repetir eventos.
async function applyStripeSubscription(stripeSubscription) {
  const subscriberId = parseId(stripeSubscription?.metadata?.subscriber_id);
  const creatorId = parseId(stripeSubscription?.metadata?.creator_id);
  if (!subscriberId || !creatorId) return;
  const status = stripeSubscription.status === "canceled" ? "canceled" : mapStripeStatus(stripeSubscription.status);
  await pool.query(`
    INSERT INTO subscriptions(subscriber_id,creator_id,status,current_period_end,cancel_at_period_end,provider,provider_subscription_id,updated_at)
    VALUES($1,$2,$3,$4,$5,'stripe',$6,NOW())
    ON CONFLICT(subscriber_id,creator_id) DO UPDATE SET
      status=EXCLUDED.status,
      current_period_end=EXCLUDED.current_period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,
      provider='stripe',
      provider_subscription_id=EXCLUDED.provider_subscription_id,
      updated_at=NOW()
    -- Um evento atrasado de uma subscrição Stripe antiga não pode apagar uma subscrição nova.
    WHERE subscriptions.provider_subscription_id IS NULL
      OR subscriptions.provider_subscription_id=EXCLUDED.provider_subscription_id
      OR EXCLUDED.status='active'`,
  [subscriberId, creatorId, status, periodEndFromStripe(stripeSubscription),
    stripeSubscription.cancel_at_period_end === true, stripeSubscription.id]);
}

// Há bloqueio entre as duas contas (em qualquer sentido)?
async function isBlocked(userId, otherId) {
  const result = await pool.query(`SELECT ${blockedBetween("$1", "$2::int")} AS blocked`, [userId, otherId]);
  return result.rows[0]?.blocked === true;
}

const BLOCKED_ERROR = "Não é possível interagir com esta conta.";

// Administradores só entram no painel com a verificação em dois passos ativa: uma palavra-passe roubada
// não chega para suspender contas, aprovar levantamentos ou ver denúncias.
// Funções na equipa: "super" pode tudo; "finance" trata do dinheiro; "moderation" das pessoas e do conteúdo.
// requireRole("finance") deixa passar finance e super; requireAdmin deixa passar qualquer função.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Só a equipa do Tchilar pode aceder." });
    if (req.user.adminRole !== "super" && roles.length && !roles.includes(req.user.adminRole)) {
      return res.status(403).json({ error: "A tua função na equipa não dá acesso a esta área." });
    }
    pool.query("SELECT totp_enabled_at FROM users WHERE id=$1", [req.user.id]).then(result => {
      if (!result.rows[0]?.totp_enabled_at) {
        return res.status(403).json({ error: "Ativa a verificação em dois passos nas Definições para usar o painel de administração.", twoFactorSetupRequired: true });
      }
      next();
    }).catch(next);
  };
}
const requireAdmin = requireRole();

// Só aceita tokens HS256 assinados por nós (nunca "none" nem outro algoritmo).
const JWT_VERIFY = { algorithms: ["HS256"] };

// Sessões sem prazo: uma sessão (no site ou na app) dura até a pessoa terminar sessão, usar "Terminar outras
// sessões", mudar a palavra-passe ou a conta ser suspensa. Esses casos sobem auth_version e cortam todos os tokens
// antigos de uma vez (ver auth()). O campo "app" fica no token só para se saber de onde veio a sessão.
function sign(user, { app = false, sid = undefined } = {}) {
  return jwt.sign(
    { id: user.id, username: user.username, version: Number(user.auth_version || 0), ...(app && { app: true }), ...(sid && { sid }) },
    JWT_SECRET);
}
// Nova sessão para este aparelho e o token dela.
async function startSession(req, user, app) {
  const sid = await createSession(pool, user.id, { client: app ? "app" : "web", device: deviceLabel(req) });
  return sign(user, { app, sid });
}
const isAppClient = body => body?.client === "app";

// Regras para palavras-passe NOVAS (registo, recuperação, mudança). As já existentes continuam a funcionar.
// O bcrypt só lê os primeiros 72 bytes, por isso recusamos mais do que isso em vez de cortar em silêncio.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "12341234", "87654321", "11111111", "00000000",
  "password", "password1", "palavrapasse", "qwertyuiop", "abcdefgh", "iloveyou", "angola123", "tchilar1234"
]);
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) return "A palavra-passe deve ter pelo menos 8 caracteres.";
  if (Buffer.byteLength(password, "utf8") > 72) return "A palavra-passe é demasiado longa (máximo 72 bytes).";
  if (/^(.)\1+$/.test(password) || COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Essa palavra-passe é muito fácil de adivinhar. Escolhe outra.";
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createAuthToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("DELETE FROM auth_tokens WHERE user_id=$1 AND purpose=$2", [userId, purpose]);
  await pool.query(
    "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,NOW() + INTERVAL '1 hour')",
    [userId, purpose, hashToken(token)]);
  return token;
}

async function sendAccountEmail(email, purpose, token) {
  const route = purpose === "verify_email" ? "verify-email" : "reset-password";
  const url = new URL(`/${route}`, appUrl);
  url.searchParams.set("token", token);
  if (!mailTransport) {
    if (!isDevelopment) throw new Error("SMTP não está configurado.");
    // Sem SMTP em desenvolvimento: o link fica no terminal do servidor, nunca na resposta HTTP
    // (a menos que DEV_EXPOSE_AUTH_LINKS=true esteja explicitamente ligado).
    console.info(`[dev] Link de ${purpose === "verify_email" ? "confirmação" : "recuperação"} para ${email}: ${url}`);
    return exposeDevAuthLinks ? url.toString() : null;
  }
  const subject = purpose === "verify_email" ? "Confirma o teu email — Tchilar" : "Redefine a palavra-passe — Tchilar";
  const instruction = purpose === "verify_email"
    ? "Confirma o teu endereço de email"
    : "Redefine a tua palavra-passe";
  // A ligação vale 1 hora (createAuthToken): se a fila não a conseguir enviar até lá, o email é descartado.
  await emailQueue.enqueue({
    to: email,
    subject,
    text: `${instruction} através desta ligação (válida por 1 hora): ${url.toString()}`,
    kind: "account",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });
  emailQueue.kick();
  return null;
}

function signMedia(filename) {
  const access = jwt.sign({ purpose: "media", filename }, JWT_SECRET, { expiresIn: "15m" });
  return `/uploads/${encodeURIComponent(filename)}?access=${encodeURIComponent(access)}`;
}

// Link temporário para um ficheiro protegido (ex.: vídeo de uma aula paga). Só serve para esse ficheiro.
function signProtectedMedia(purpose, mediaUrl, minutes) {
  const filename = path.basename(mediaUrl);
  const access = jwt.sign({ purpose, filename }, JWT_SECRET, { expiresIn: `${minutes}m` });
  return `/uploads/${encodeURIComponent(filename)}?access=${encodeURIComponent(access)}`;
}

function signStoryMedia(storyId, filename) {
  const access = jwt.sign({ purpose: "story-media", storyId, filename }, JWT_SECRET, { expiresIn: "15m" });
  return `/uploads/${encodeURIComponent(filename)}?access=${encodeURIComponent(access)}`;
}

function serializePost(post) {
  if (post.shared_post_id !== undefined && post.shared_post_id !== null && "shared_id" in post) {
    const {
      shared_id, shared_body, shared_media_url, shared_media_type, shared_created_at,
      shared_username, shared_display_name, shared_avatar_url, shared_page_id, shared_page_name,
      shared_page_logo_url, shared_page_category, shared_page_official, shared_visible, ...rest
    } = post;
    // Só publicações públicas podem ser partilhadas, por isso o ficheiro não precisa de assinatura.
    post = {
      ...rest,
      shared: shared_visible ? {
        id: shared_id, body: shared_body, media_url: shared_media_url, media_type: shared_media_type,
        created_at: shared_created_at, username: shared_username, display_name: shared_display_name, avatar_url: shared_avatar_url,
        page_id: shared_page_id, page_name: shared_page_name, page_logo_url: shared_page_logo_url,
        page_category: shared_page_category, page_is_official: shared_page_official
      } : { unavailable: true }
    };
  } else if ("shared_id" in post) {
    const { shared_id, shared_body, shared_media_url, shared_media_type, shared_created_at,
      shared_username, shared_display_name, shared_avatar_url, shared_page_id, shared_page_name,
      shared_page_logo_url, shared_page_category, shared_page_official, shared_visible, ...rest } = post;
    post = rest;
  }
  return {
    ...post,
    media_url: post.media_url && (post.is_exclusive || post.group_id)
      ? signMedia(path.basename(post.media_url))
      : post.media_url
  };
}

// Conta + estado da sessão do token (session_ok: a sessão existe, não foi terminada e foi usada nos últimos 6 meses;
// null se o token não tem sid).
const SESSION_SQL = `SELECT u.auth_version,u.suspended_at,u.is_admin,u.admin_role,
  CASE WHEN $2::text IS NULL THEN NULL ELSE EXISTS(SELECT 1 FROM user_sessions s WHERE s.id=$2 AND s.user_id=u.id AND s.revoked_at IS NULL
    AND s.last_seen_at > NOW() - INTERVAL '${SESSION_IDLE_DAYS} days') END AS session_ok
  FROM users u WHERE u.id=$1`;
const sessionParams = claims => [claims.id, typeof claims.sid === "string" ? claims.sid : null];

// Presença: guarda "visto agora" no máximo uma vez por minuto por pessoa (em memória, por cópia da API),
// para não escrever na base de dados a cada pedido. Falhar aqui nunca impede o pedido.
const PRESENCE_WRITE_MS = 60 * 1000;
const lastPresenceWrite = new Map();
function touchPresence(userId) {
  const now = Date.now();
  if (now - (lastPresenceWrite.get(userId) || 0) < PRESENCE_WRITE_MS) return;
  lastPresenceWrite.set(userId, now);
  if (lastPresenceWrite.size > 50000) lastPresenceWrite.clear();
  pool.query("UPDATE users SET last_seen_at=NOW() WHERE id=$1", [userId]).catch(() => lastPresenceWrite.delete(userId));
}

function auth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Autenticação necessária." });
  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET, JWT_VERIFY);
  } catch {
    return res.status(401).json({ error: "A tua sessão terminou. Entra outra vez.", sessionExpired: true });
  }
  pool.query(SESSION_SQL, sessionParams(claims)).then(result => {
    if (!validSession(result.rows[0], claims)) {
      return res.status(401).json({ error: "A tua sessão terminou. Entra outra vez.", sessionExpired: true });
    }
    if (result.rows[0].suspended_at) {
      return res.status(403).json({ error: "A tua conta está suspensa. Contacta a equipa do Tchilar." });
    }
    req.user = { ...claims, isAdmin: result.rows[0].is_admin === true, adminRole: result.rows[0].is_admin ? result.rows[0].admin_role || "super" : null };
    touchPresence(claims.id);
    touchSession(pool, claims.sid);
    next();
  }).catch(next);
}

// Só para os sinais de vida dos diretos (centenas por segundo com muita audiência): a verificação
// da sessão fica 5 s em memória. Não serve para nada que altere dados; no pior caso, uma sessão
// revogada continua a contar como espectador durante 5 s.
const presenceSessions = new Map();
function presenceAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  let claims;
  try {
    claims = jwt.verify(authorization.startsWith("Bearer ") ? authorization.slice(7) : "", JWT_SECRET, JWT_VERIFY);
  } catch {
    return res.status(401).json({ error: "A tua sessão terminou. Entra outra vez.", sessionExpired: true });
  }
  const accept = row => {
    if (!validSession(row, claims) || row.suspended_at) {
      return res.status(401).json({ error: "A tua sessão terminou. Entra outra vez.", sessionExpired: true });
    }
    req.user = { ...claims, isAdmin: row.is_admin === true, adminRole: row.is_admin ? row.admin_role || "super" : null };
    next();
  };
  const cacheKey = `${claims.id}:${claims.sid || ""}`;
  const cached = presenceSessions.get(cacheKey);
  if (cached && Date.now() - cached.at < 5000) return accept(cached.row);
  pool.query(SESSION_SQL, sessionParams(claims)).then(result => {
    if (presenceSessions.size > 200_000) presenceSessions.clear();
    presenceSessions.set(cacheKey, { row: result.rows[0] || null, at: Date.now() });
    accept(result.rows[0]);
  }).catch(next);
}

function optionalAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) {
    let claims;
    try {
      claims = jwt.verify(authorization.slice(7), JWT_SECRET, JWT_VERIFY);
    } catch {
      return next();
    }
    return pool.query(SESSION_SQL, sessionParams(claims)).then(result => {
      if (validSession(result.rows[0], claims) && !result.rows[0].suspended_at) {
        req.user = { ...claims, isAdmin: result.rows[0].is_admin === true, adminRole: result.rows[0].is_admin ? result.rows[0].admin_role || "super" : null };
      }
      next();
    }).catch(next);
  }
  next();
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "tchilar" }));

// Erros vindos do browser (páginas que falharam). Só regista: texto curto, sem tokens, com limite por IP.
const clientErrorRateLimit = makeRateLimit("clientError", { windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados relatórios." } });
app.post("/api/client-errors", clientErrorRateLimit, (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);
  const reference = text(body.reference, 16);
  if (!reference || !/^[0-9a-f]{4,16}$/.test(reference)) return res.status(400).json({ error: "Relatório inválido." });
  console.error(JSON.stringify({
    level: "error",
    kind: "client",
    at: new Date().toISOString(),
    reference,
    context: text(body.context, 20),
    path: text(body.path, 200)?.split("?")[0] || null,
    message: text(body.message, 500),
    stack: text(body.stack, 4000),
    userAgent: text(req.headers["user-agent"], 200)
  }));
  res.status(204).end();
});

app.get("/api/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/uploads/:filename", optionalAuth, async (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename !== req.params.filename) {
    return res.status(400).json({ error: "Ficheiro inválido." });
  }
  try {
    const result = await pool.query(
      "SELECT id,is_exclusive,group_id FROM posts WHERE media_url=$1 LIMIT 1",
      [`/uploads/${filename}`]);
    if (!result.rowCount) {
      const storyResult = await pool.query(
        "SELECT id FROM stories WHERE media_url=$1 AND expires_at>NOW() LIMIT 1",
        [`/uploads/${filename}`]);
      if (!storyResult.rowCount) {
        // Fotos de perfil, capas e imagens de anúncios são públicas.
        // Vídeos das aulas dos cursos: só com o link assinado que o curso dá a quem tem acesso.
        const groupFile = await pool.query("SELECT name FROM group_files WHERE url=$1 LIMIT 1", [`/uploads/${filename}`]);
        if (groupFile.rowCount) {
          let access;
          try { access = jwt.verify(String(req.query.access || ""), JWT_SECRET, JWT_VERIFY); } catch { access = null; }
          if (access?.purpose !== "group-file" || access.filename !== filename) return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
          res.set("X-Content-Type-Options", "nosniff");
          res.set("Content-Security-Policy", "default-src 'none'; sandbox");
          res.set("Cache-Control", "private, max-age=1800");
          res.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(groupFile.rows[0].name)}`);
          return res.sendFile(path.join(uploadDir, filename), { dotfiles: "deny" }, error => { if (error) next(error); });
        }
        const lessonVideo = await pool.query("SELECT 1 FROM course_lessons WHERE video_url=$1 LIMIT 1", [`/uploads/${filename}`]);
        if (lessonVideo.rowCount) {
          let access;
          try { access = jwt.verify(String(req.query.access || ""), JWT_SECRET, JWT_VERIFY); } catch { access = null; }
          if (access?.purpose !== "lesson-media" || access.filename !== filename) return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
          res.set("X-Content-Type-Options", "nosniff");
          res.set("Content-Security-Policy", "default-src 'none'; sandbox");
          res.set("Cache-Control", "private, max-age=1800");
          return res.sendFile(path.join(uploadDir, filename), { dotfiles: "deny" }, error => { if (error) next(error); });
        }
        const profileImage = await pool.query(
          `SELECT 1 FROM users WHERE avatar_url=$1 OR cover_url=$1
           UNION ALL SELECT 1 FROM pages WHERE logo_url=$1 OR cover_url=$1
           UNION ALL SELECT 1 FROM courses WHERE cover_url=$1
           UNION ALL SELECT 1 FROM ads WHERE image_url=$1
           UNION ALL SELECT 1 FROM events WHERE image_url=$1
           UNION ALL SELECT 1 FROM music_tracks WHERE audio_url=$1 AND hidden_at IS NULL LIMIT 1`,
          [`/uploads/${filename}`]);
        if (!profileImage.rowCount) return res.status(404).json({ error: "Ficheiro não encontrado." });
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Content-Security-Policy", "default-src 'none'; sandbox");
        res.set("Cache-Control", "public, max-age=86400");
        return res.sendFile(path.join(uploadDir, filename), { dotfiles: "deny" }, error => {
          if (error) next(error);
        });
      }
      let access;
      try {
        access = jwt.verify(String(req.query.access || ""), JWT_SECRET, JWT_VERIFY);
      } catch {
        return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
      }
      if (access.purpose !== "story-media" || access.storyId !== storyResult.rows[0].id || access.filename !== filename) {
        return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
      }
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Content-Security-Policy", "default-src 'none'; sandbox");
      res.set("Cache-Control", "private, max-age=900");
      return res.sendFile(path.join(uploadDir, filename), { dotfiles: "deny" }, error => {
        if (error) next(error);
      });
    }
    const media = result.rows[0];
    if (media.is_exclusive || media.group_id) {
      const access = await canAccessPost(media.id, req.user?.id || 0);
      let permitted = access.allowed;
      if (!permitted && req.query.access) {
        try {
          const access = jwt.verify(String(req.query.access), JWT_SECRET, JWT_VERIFY);
          permitted = access.purpose === "media" && access.filename === filename;
        } catch {
          permitted = false;
        }
      }
      if (!permitted) return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    // Modo "Poupar dados": ?size=sm serve a versão pequena da foto, se existir (fotos antigas não a têm).
    let served = filename;
    if (req.query.size === "sm" && /\.webp$/i.test(filename)) {
      const small = smallVariantName(filename);
      if (await fs.promises.access(path.join(uploadDir, small)).then(() => true, () => false)) served = small;
    }
    res.sendFile(path.join(uploadDir, served), { dotfiles: "deny" }, error => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/promotion-codes/validate", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const purpose = typeof body.purpose === "string" ? body.purpose : "";
  const amount = Number(body.amountKz);
  if (!purpose || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Indica a compra a validar." });
  const result = await resolvePromotionCode(pool, { code: body.code, purpose, amountKz: amount, userId: req.user.id });
  if ("error" in result) return res.status(400).json({ error: result.error });
  res.json({
    valid: Boolean(result.code),
    code: result.code?.code || null,
    discountPercent: result.code?.discount_percent || 0,
    originalAmount: result.original,
    discountAmount: result.discount,
    amount: result.paid
  });
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const username = cleanText(body.username).toLowerCase();
    const email = cleanText(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = cleanText(body.displayName);
    const isCreator = body.isCreator === true;
    const subscriptionPrice = body.subscriptionPrice === undefined || body.subscriptionPrice === 0
      ? 0
      : parseSubscriptionPrice(body.subscriptionPrice);
    if (!/^[a-z0-9._]{3,40}$/.test(username)) {
      return res.status(400).json({ error: "O username deve ter 3 a 40 caracteres: letras, números, ponto ou underscore." });
    }
    if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Indica um email válido." });
    if (!displayName) return res.status(400).json({ error: "O nome público é obrigatório." });
    if (displayName.length > 100) return res.status(400).json({ error: "O nome público pode ter até 100 caracteres." });
    const passwordError = passwordProblem(body.password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (body.isCreator !== undefined && typeof body.isCreator !== "boolean") {
      return res.status(400).json({ error: "O valor de conta de criador é inválido." });
    }
    if (subscriptionPrice === null) {
      return res.status(400).json({ error: `O preço de subscrição deve estar entre ${MIN_PRICE} Kz e ${MAX_PRICE} Kz.` });
    }
    if (body.displayName.length > 100 || body.email.length > 160 || body.username.length > 40) {
      return res.status(400).json({ error: "Um ou mais campos excedem o limite permitido." });
    }
    // A data de nascimento é obrigatória e fica fixa: é ela que decide o acesso aos grupos +18.
    if (!body.birthDate) return res.status(400).json({ error: "Indica a tua data de nascimento." });
    const birth = parseBirthDate(body.birthDate);
    if (birth.error) return res.status(400).json({ error: birth.error });
    const phone = parsePhone(body.phone, body.phoneCountry);
    if (phone.error) return res.status(400).json({ error: phone.error });
    if (phone.skip || !phone.value) return res.status(400).json({ error: "O número de telemóvel é obrigatório." });
    const hash = await bcrypt.hash(password, 12);
    // Convite: o nome de utilizador de quem convidou (opcional; ignorado se não existir).
    const invite = typeof body.invite === "string" ? body.invite.trim().toLowerCase().slice(0, 40) : "";
    const referrer = invite ? await pool.query("SELECT id FROM users WHERE username=$1", [invite]) : { rows: [] };
    const result = await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name,is_creator,subscription_price,email_verified,referred_by,birth_date,phone)
       VALUES($1,$2,$3,$4,$5,$6,FALSE,$7,$8,$9) RETURNING id,username,email,display_name,is_creator,subscription_price,email_verified`,
      [username.toLowerCase(), email.toLowerCase(), hash, displayName, isCreator, subscriptionPrice, referrer.rows[0]?.id || null, birth.value, phone.value ?? null]
    );
    const user = result.rows[0];
    const verificationToken = await createAuthToken(user.id, "verify_email");
    const verificationUrl = await sendAccountEmail(email, "verify_email", verificationToken);
    res.status(201).json({
      user,
      message: "Conta criada. Confirma o teu email para iniciar sessão.",
      ...(verificationUrl && exposeDevAuthLinks && { verificationUrl })
    });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Username ou email já utilizado." });
    throw error;
  }
});

const usernameCheckRateLimit = makeRateLimit("usernameCheck", {
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Tenta novamente daqui a pouco." }
});

// Usado pelo registo para dizer, enquanto se escreve, se o nome de utilizador está livre.
app.get("/api/auth/username-available", usernameCheckRateLimit, async (req, res) => {
  const username = typeof req.query.username === "string" ? req.query.username.trim().toLowerCase() : "";
  if (!/^[a-z0-9._]{3,40}$/.test(username)) {
    return res.json({ available: false, reason: "format" });
  }
  const result = await pool.query("SELECT 1 FROM users WHERE username=$1", [username]);
  res.json({ available: result.rowCount === 0, reason: result.rowCount ? "taken" : null });
});

// Tentativas falhadas por conta, contadas pela mesma forma normalizada que a pesquisa da conta usa
// (email em minúsculas; telemóvel no formato internacional), para "923…", "+244923…" e "00244923…" serem a mesma conta.
// Dois limites, só com as falhas a contar:
// - conta + IP: 10 falhas em 15 min (trava quem tenta adivinhar a partir de um sítio);
// - conta, de qualquer IP: 60 falhas por hora (trava quem usa muitos IPs, sem deixar um estranho bloquear o dono
//   facilmente; a recuperação por email continua sempre disponível).
const loginAccountId = req => {
  const body = isRecord(req.body) ? req.body : {};
  const raw = String(typeof body.identifier === "string" ? body.identifier : body.email || "").trim();
  if (raw.includes("@")) return raw.toLowerCase().slice(0, 254);
  const phone = parsePhoneNumber(raw, typeof body.phoneCountry === "string" ? body.phoneCountry : undefined);
  return phone ? phone.e164 : raw.toLowerCase().replace(/\D/g, "").slice(0, 32);
};
const loginAccountIpRateLimit = makeRateLimit("loginAccountIp", {
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
  skipSuccessfulRequests: true, keyGenerator: req => `acct:${loginAccountId(req)}:ip:${req.ip}`,
  message: { error: "Demasiadas tentativas. Espera 15 minutos ou recupera a palavra-passe." }
});
const loginAccountRateLimit = makeRateLimit("loginAccount", {
  windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
  skipSuccessfulRequests: true, keyGenerator: req => `acct:${loginAccountId(req)}`,
  message: { error: "Demasiadas tentativas para esta conta. Espera um pouco ou recupera a palavra-passe pelo email." }
});
// Hash de uma palavra-passe que ninguém tem: quando a conta não existe, comparamos na mesma, para a resposta
// demorar o mesmo e não revelar que contas existem.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 12);

app.post("/api/auth/login", authRateLimit, loginAccountIpRateLimit, loginAccountRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  // "identifier" (ou "email", nas apps antigas): o email ou o número de telemóvel da conta.
  const identifier = cleanText(typeof body.identifier === "string" ? body.identifier : body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password) return res.status(400).json({ error: "Indica o email ou o telemóvel e a palavra-passe." });
  const byEmail = identifier.includes("@");
  const phone = byEmail ? null : parsePhoneNumber(identifier, typeof body.phoneCountry === "string" ? body.phoneCountry : undefined);
  if (!byEmail && !phone) return res.status(400).json({ error: `Não reconhecemos esse email ou número. ${PHONE_ERROR}` });
  const result = await pool.query(`
    SELECT ${OWN_ACCOUNT_FIELDS},auth_version,password_hash,suspended_at,totp_secret,totp_enabled_at,totp_last_step
    FROM users WHERE ${byEmail ? "email=$1" : "phone=$1 AND phone_verified_at IS NOT NULL"}`, [byEmail ? identifier.toLowerCase() : phone.e164]);
  const user = result.rows[0];
  const passwordOk = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !passwordOk) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  delete user.password_hash;
  if (user.suspended_at) {
    return res.status(403).json({ error: "A tua conta está suspensa. Contacta a equipa do Tchilar." });
  }
  delete user.suspended_at;
  if (!user.email_verified) {
    return res.status(403).json({ error: "Confirma o teu email antes de iniciar sessão." });
  }
  const { totp_secret: totpSecret, totp_enabled_at: totpEnabled, totp_last_step: lastStep } = user;
  delete user.totp_secret;
  delete user.totp_enabled_at;
  delete user.totp_last_step;
  // Segundo passo: a palavra-passe está certa, agora falta o código da app de autenticação.
  if (totpEnabled) {
    if (!body.code) return res.status(401).json({ error: "Escreve o código de 6 dígitos da tua app de autenticação.", twoFactorRequired: true });
    const step = verifyCode(decrypt(payoutKey, totpSecret), body.code, { lastStep });
    // O UPDATE condicional garante que dois pedidos com o mesmo código não passam os dois.
    const accepted = step !== null && (await pool.query(
      "UPDATE users SET totp_last_step=$1 WHERE id=$2 AND (totp_last_step IS NULL OR totp_last_step < $1)", [step, user.id])).rowCount === 1;
    if (!accepted) return res.status(401).json({ error: "Código inválido ou já usado. Espera pelo próximo.", twoFactorRequired: true });
  }
  // Aviso de novo início de sessão (só se já havia outros aparelhos com sessão aberta).
  const others = await pool.query("SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
  const token = await startSession(req, user, isAppClient(body));
  if (others.rows[0].n > 0) {
    await pool.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'privacy',$2)",
      [user.id, `Novo início de sessão: ${deviceLabel(req) || "aparelho desconhecido"}. Se não foste tu, termina essa sessão em Definições → Segurança e muda a palavra-passe.`]);
  }
  res.json({ user, token });
});

app.post("/api/auth/verify-email", recoveryRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Ligação de confirmação inválida ou expirada." });
  const verified = await transaction(async client => {
    const result = await client.query(`
      SELECT id,user_id FROM auth_tokens
      WHERE token_hash=$1 AND purpose='verify_email' AND expires_at>NOW()
      FOR UPDATE`, [hashToken(token)]);
    if (!result.rowCount) return false;
    await client.query("UPDATE users SET email_verified=TRUE WHERE id=$1", [result.rows[0].user_id]);
    await client.query("DELETE FROM auth_tokens WHERE id=$1", [result.rows[0].id]);
    return true;
  });
  if (!verified) return res.status(400).json({ error: "Ligação de confirmação inválida ou expirada." });
  res.json({ verified: true, message: "Email confirmado. Já podes iniciar sessão." });
});

app.post("/api/auth/verify-email/resend", recoveryRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const email = cleanText(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Indica um email válido." });
  const user = await pool.query(
    "SELECT id,email,email_verified FROM users WHERE email=$1",
    [email]);
  let verificationUrl;
  if (user.rowCount && !user.rows[0].email_verified) {
    const token = await createAuthToken(user.rows[0].id, "verify_email");
    verificationUrl = await sendAccountEmail(email, "verify_email", token);
  }
  res.json({
    message: "Se a conta existir e ainda não estiver confirmada, receberás uma ligação por email.",
    ...(verificationUrl && exposeDevAuthLinks && { verificationUrl })
  });
});

app.post("/api/auth/forgot-password", recoveryRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const email = cleanText(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Indica um email válido." });
  const user = await pool.query(
    "SELECT id,email FROM users WHERE email=$1 AND email_verified=TRUE",
    [email]);
  let resetUrl;
  if (user.rowCount) {
    const resetToken = await createAuthToken(user.rows[0].id, "reset_password");
    resetUrl = await sendAccountEmail(email, "reset_password", resetToken);
  }
  res.json({
    message: "Se existir uma conta confirmada com esse email, receberás instruções para redefinir a palavra-passe.",
    ...(resetUrl && exposeDevAuthLinks && { resetUrl })
  });
});

app.post("/api/auth/reset-password", recoveryRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Ligação inválida ou expirada." });
  const passwordError = passwordProblem(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const passwordHash = await bcrypt.hash(password, 12);
  const reset = await transaction(async client => {
    const result = await client.query(`
      SELECT id,user_id FROM auth_tokens
      WHERE token_hash=$1 AND purpose='reset_password' AND expires_at>NOW()
      FOR UPDATE`, [hashToken(token)]);
    if (!result.rowCount) return false;
    await client.query("UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2", [passwordHash, result.rows[0].user_id]);
    await client.query("DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='reset_password'", [result.rows[0].user_id]);
    return true;
  });
  if (!reset) return res.status(400).json({ error: "Ligação inválida ou expirada." });
  res.json({ reset: true, message: "Palavra-passe atualizada. Já podes iniciar sessão." });
});

// ----- Telemóvel por SMS (Twilio Verify) -----
// Confirmar o número da conta: envia um código para o número guardado e confere-o. Só um número confirmado serve
// para entrar e para recuperar a conta. Se outra conta tinha esse número confirmado (o operador pode ter passado o
// número a outra pessoa), perde-o: o número fica com quem provou agora que o tem.
const SMS_UNAVAILABLE = "O envio de SMS ainda não está disponível. Tenta mais tarde.";
const smsSendRateLimit = makeRateLimit("smsSend", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Pediste vários códigos seguidos. Espera 15 minutos e tenta outra vez." }
});
const smsReply = sent => ({ sent: true, ...(sent.devCode && exposeDevAuthLinks && { devCode: sent.devCode }) });

// Por onde podem ir os códigos (SMS e/ou WhatsApp, pela ordem do .env). O site e a app mostram um botão por canal.
app.get("/api/auth/phone/channels", (_req, res) => res.json({ channels: sms ? sms.channels : [] }));
const pickChannel = value => (sms.channels.includes(value) ? value : sms.channels[0]);

app.post("/api/auth/phone/send-code", auth, smsSendRateLimit, async (req, res) => {
  if (!sms) return res.status(503).json({ error: SMS_UNAVAILABLE });
  const account = (await pool.query("SELECT phone,phone_verified_at FROM users WHERE id=$1", [req.user.id])).rows[0];
  if (!account?.phone) return res.status(400).json({ error: "Guarda primeiro o teu número de telemóvel." });
  if (account.phone_verified_at) return res.status(409).json({ error: "Este número já está confirmado." });
  const allowed = await smsAllowed(pool, account.phone);
  if (!allowed.ok) return res.status(429).json({ error: allowed.error, reason: allowed.reason });
  const channel = pickChannel(req.body?.channel);
  const sent = await sms.send(account.phone, channel);
  if (sent.error) return res.status(400).json({ error: sent.error });
  await recordSms(pool, { phone: account.phone, userId: req.user.id, channel, purpose: "confirm" });
  res.json({ ...smsReply(sent), phone: account.phone, channel });
});

app.post("/api/auth/phone/verify", auth, accountSecurityRateLimit, async (req, res) => {
  if (!sms) return res.status(503).json({ error: SMS_UNAVAILABLE });
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!SMS_CODE_PATTERN.test(code)) return res.status(400).json({ error: "Escreve o código que recebeste por SMS." });
  const account = (await pool.query("SELECT phone,phone_verified_at FROM users WHERE id=$1", [req.user.id])).rows[0];
  if (!account?.phone) return res.status(400).json({ error: "Guarda primeiro o teu número de telemóvel." });
  if (account.phone_verified_at) return res.status(409).json({ error: "Este número já está confirmado." });
  if (!(await sms.check(account.phone, code))) return res.status(400).json({ error: "Código errado ou expirado. Pede um novo." });
  const user = await transaction(async client => {
    const previous = await client.query(
      "UPDATE users SET phone_verified_at=NULL WHERE phone=$1 AND id<>$2 AND phone_verified_at IS NOT NULL RETURNING id",
      [account.phone, req.user.id]);
    for (const row of previous.rows) {
      await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'privacy',$2)", [row.id,
        "O teu número de telemóvel foi confirmado noutra conta (por exemplo, se o operador o passou a outra pessoa). Deixou de servir para entrar na tua: indica e confirma outro em Definições → Conta."]);
    }
    return (await client.query(`UPDATE users SET phone_verified_at=NOW() WHERE id=$1 AND phone=$2 RETURNING ${OWN_ACCOUNT_FIELDS}`,
      [req.user.id, account.phone])).rows[0];
  });
  if (!user) return res.status(409).json({ error: "O número mudou entretanto. Pede um novo código." });
  res.json({ user, message: "Número confirmado. Já podes usá-lo para entrar." });
});

// Recuperar a conta pelo telemóvel: código por SMS para um número CONFIRMADO, depois nova palavra-passe.
// A resposta é sempre a mesma, exista ou não uma conta com esse número.
app.post("/api/auth/forgot-password/phone", recoveryRateLimit, smsSendRateLimit, async (req, res) => {
  if (!sms) return res.status(503).json({ error: SMS_UNAVAILABLE });
  const body = isRecord(req.body) ? req.body : {};
  const phone = parsePhoneNumber(typeof body.phone === "string" ? body.phone : "", typeof body.phoneCountry === "string" ? body.phoneCountry : undefined);
  if (!phone) return res.status(400).json({ error: PHONE_ERROR });
  const user = await pool.query("SELECT id FROM users WHERE phone=$1 AND phone_verified_at IS NOT NULL AND suspended_at IS NULL", [phone.e164]);
  let sent = {};
  if (user.rowCount) {
    // Limites por número: se já se pediram códigos a mais, a resposta é igual (não revela se o número tem conta).
    // O teto diário do Tchilar é dito às claras, porque não revela nada sobre ninguém.
    const allowed = await smsAllowed(pool, phone.e164);
    if (!allowed.ok && allowed.reason === "daily_limit") return res.status(429).json({ error: allowed.error, reason: allowed.reason });
    if (allowed.ok) {
      const channel = pickChannel(body.channel);
      sent = await sms.send(phone.e164, channel);
      if (sent.error) return res.status(400).json({ error: sent.error });
      await recordSms(pool, { phone: phone.e164, userId: user.rows[0].id, channel, purpose: "recover" });
    }
  }
  res.json({
    phone: phone.e164,
    message: "Se existir uma conta com este número confirmado, enviámos um código por SMS.",
    ...(sent.devCode && exposeDevAuthLinks && { devCode: sent.devCode })
  });
});

app.post("/api/auth/reset-password/phone", recoveryRateLimit, async (req, res) => {
  if (!sms) return res.status(503).json({ error: SMS_UNAVAILABLE });
  const body = isRecord(req.body) ? req.body : {};
  const phone = parsePhoneNumber(typeof body.phone === "string" ? body.phone : "", typeof body.phoneCountry === "string" ? body.phoneCountry : undefined);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!phone || !SMS_CODE_PATTERN.test(code)) return res.status(400).json({ error: "Código errado ou expirado. Pede um novo." });
  const passwordError = passwordProblem(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const found = await pool.query("SELECT id FROM users WHERE phone=$1 AND phone_verified_at IS NOT NULL AND suspended_at IS NULL", [phone.e164]);
  // Sem conta não foi enviado nenhum código: a resposta é a mesma de um código errado.
  if (!found.rowCount || !(await sms.check(phone.e164, code))) return res.status(400).json({ error: "Código errado ou expirado. Pede um novo." });
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query("UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2", [passwordHash, found.rows[0].id]);
  await pool.query("DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='reset_password'", [found.rows[0].id]);
  res.json({ reset: true, message: "Palavra-passe atualizada. Já podes entrar com o teu número." });
});

app.get("/api/auth/me", auth, async (req, res) => {
  const r = await pool.query(`SELECT ${OWN_ACCOUNT_FIELDS} FROM users WHERE id=$1`, [req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: r.rows[0] });
});

// Preferências da conta: notificações por categoria e quem pode enviar mensagens ou comentar.
app.get("/api/auth/me/preferences", auth, async (req, res) => {
  const r = await pool.query("SELECT preferences FROM users WHERE id=$1", [req.user.id]);
  res.json({ preferences: readPreferences(r.rows[0]?.preferences) });
});

app.patch("/api/auth/me/preferences", auth, async (req, res) => {
  const updated = await transaction(async client => {
    const current = await client.query("SELECT preferences FROM users WHERE id=$1 FOR UPDATE", [req.user.id]);
    const result = updatePreferences(current.rows[0]?.preferences, req.body);
    if (result.error) return result;
    await client.query("UPDATE users SET preferences=$1 WHERE id=$2", [JSON.stringify(result.preferences), req.user.id]);
    return result;
  });
  if (updated.error) return res.status(400).json({ error: updated.error });
  res.json({ preferences: updated.preferences });
});

// Respeita a escolha de quem recebe: "toda a gente", "só quem sigo" ou "ninguém".
// Uma resposta numa conversa que a própria pessoa começou passa sempre.
async function reachAllowed(kind, targetId, actorId) {
  const r = await pool.query(`
    SELECT u.preferences,
      EXISTS(SELECT 1 FROM follows WHERE follower_id=u.id AND following_id=$2) AS follows,
      ($3 = 'messages' AND EXISTS(SELECT 1 FROM messages WHERE sender_id=u.id AND receiver_id=$2)) AS replied
    FROM users u WHERE u.id=$1`, [targetId, actorId, kind]);
  if (!r.rowCount) return true;
  const row = r.rows[0];
  return canReach(readPreferences(row.preferences)[kind], { follows: row.follows, replied: row.replied });
}

// Mudar a palavra-passe com sessão iniciada. Aumentar auth_version invalida todas as sessões abertas;
// este dispositivo recebe logo um token novo para não ser posto fora.
app.post("/api/auth/password", accountSecurityRateLimit, auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const invalid = passwordProblem(next);
  if (invalid) return res.status(400).json({ error: invalid });
  const found = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!found.rowCount || !(await bcrypt.compare(current, found.rows[0].password_hash))) {
    return res.status(401).json({ error: "A palavra-passe atual está errada." });
  }
  const hash = await bcrypt.hash(next, 12);
  const updated = await pool.query(
    "UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2 RETURNING id,username,auth_version",
    [hash, req.user.id]);
  await pool.query("UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [req.user.id]);
  res.json({ token: await startSession(req, updated.rows[0], Boolean(req.user.app)), message: "Palavra-passe alterada. As outras sessões foram terminadas." });
});

// ----- Verificação em dois passos -----
app.get("/api/auth/2fa", auth, async (req, res) => {
  const result = await pool.query("SELECT totp_enabled_at,is_admin FROM users WHERE id=$1", [req.user.id]);
  res.json({ enabled: Boolean(result.rows[0]?.totp_enabled_at), required: result.rows[0]?.is_admin === true });
});

// 1.º passo: gera um segredo novo (ainda inativo) e devolve o código QR para a app ler.
app.post("/api/auth/2fa/setup", accountSecurityRateLimit, auth, async (req, res) => {
  const found = await pool.query("SELECT username,totp_enabled_at FROM users WHERE id=$1", [req.user.id]);
  if (found.rows[0]?.totp_enabled_at) return res.status(409).json({ error: "A verificação em dois passos já está ativa." });
  const secret = generateSecret();
  await pool.query("UPDATE users SET totp_secret=$1,totp_last_step=NULL WHERE id=$2", [encrypt(payoutKey, secret), req.user.id]);
  const uri = otpauthUri({ secret, account: found.rows[0].username });
  res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

// 2.º passo: a pessoa escreve o código que a app mostra; só então fica ativo (prova que a app ficou bem configurada).
app.post("/api/auth/2fa/enable", accountSecurityRateLimit, auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const found = await pool.query("SELECT totp_secret,totp_enabled_at FROM users WHERE id=$1", [req.user.id]);
  const row = found.rows[0];
  if (!row?.totp_secret || row.totp_enabled_at) return res.status(409).json({ error: "Começa a configuração outra vez." });
  const step = verifyCode(decrypt(payoutKey, row.totp_secret), body.code);
  if (step === null) return res.status(400).json({ error: "Código errado. Confirma que a hora do telemóvel está certa." });
  await pool.query("UPDATE users SET totp_enabled_at=NOW(),totp_last_step=$1 WHERE id=$2", [step, req.user.id]);
  res.json({ enabled: true, message: "Verificação em dois passos ativa. Vais precisar do código sempre que entrares." });
});

// Desligar pede a palavra-passe E um código: quem roubou só uma das duas coisas não consegue.
app.post("/api/auth/2fa/disable", accountSecurityRateLimit, auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const found = await pool.query("SELECT password_hash,totp_secret,totp_enabled_at,totp_last_step FROM users WHERE id=$1", [req.user.id]);
  const row = found.rows[0];
  if (!row?.totp_enabled_at) return res.status(409).json({ error: "A verificação em dois passos não está ativa." });
  const passwordOk = typeof body.password === "string" && await bcrypt.compare(body.password, row.password_hash);
  const step = verifyCode(decrypt(payoutKey, row.totp_secret), body.code, { lastStep: row.totp_last_step });
  if (!passwordOk || step === null) return res.status(401).json({ error: "Palavra-passe ou código errado." });
  await pool.query("UPDATE users SET totp_secret=NULL,totp_enabled_at=NULL,totp_last_step=NULL WHERE id=$1", [req.user.id]);
  res.json({ enabled: false, message: "Verificação em dois passos desligada." });
});

// Terminar sessão em todos os outros dispositivos (telemóvel perdido, computador partilhado...).
app.post("/api/auth/logout-all", auth, async (req, res) => {
  const updated = await pool.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1 RETURNING id,username,auth_version", [req.user.id]);
  await pool.query("UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [req.user.id]);
  res.json({ token: await startSession(req, updated.rows[0], Boolean(req.user.app)), message: "Sessão terminada em todos os outros dispositivos." });
});

// Trocar o token por um novo (mantido por compatibilidade com versões da app que o pedem; as sessões já não expiram).
// Só funciona com uma sessão válida; depois de ser terminada, é preciso entrar outra vez.
app.post("/api/auth/refresh", auth, async (req, res) => {
  const row = (await pool.query("SELECT id,username,auth_version FROM users WHERE id=$1", [req.user.id])).rows[0];
  if (!row) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ token: sign(row, { app: Boolean(req.user.app), sid: req.user.sid }) });
});

// Valida um campo de texto opcional do perfil. Devolve undefined (não enviado), o texto limpo, ou um erro.
function profileText(body, key, label, maxLength) {
  if (body[key] === undefined) return { value: undefined };
  if (typeof body[key] !== "string") return { error: `${label} é inválido.` };
  const value = body[key].trim();
  if (value.length > maxLength) return { error: `${label} deve ter até ${maxLength} caracteres.` };
  return { value };
}

function normalizeWebsite(value) {
  if (!value) return "";
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

app.patch("/api/auth/me", auth, phoneChangeRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const hasDisplayName = body.displayName !== undefined;
  const hasBio = body.bio !== undefined;
  const hasPrice = body.subscriptionPrice !== undefined;
  const subscriptionPrice = hasPrice ? parseSubscriptionPrice(body.subscriptionPrice) : null;
  const location = profileText(body, "location", "A localidade", 100);
  const profession = profileText(body, "profession", "A profissão", 100);
  const websiteText = profileText(body, "website", "O site", 200);
  for (const field of [location, profession, websiteText]) {
    if (field.error) return res.status(400).json({ error: field.error });
  }
  const website = websiteText.value === undefined ? undefined : normalizeWebsite(websiteText.value);
  if (website === null) return res.status(400).json({ error: "Indica um endereço de site válido (por exemplo, https://exemplo.ao)." });
  const phone = parsePhone(body.phone, body.phoneCountry);
  if (phone.error) return res.status(400).json({ error: phone.error });
  const hasExtra = [location.value, profession.value, website].some(value => value !== undefined) || !phone.skip;
  if (!hasDisplayName && !hasBio && !hasPrice && !hasExtra) return res.status(400).json({ error: "Indica pelo menos um campo para atualizar." });
  if (hasPrice && subscriptionPrice === null) {
    return res.status(400).json({ error: `O preço de subscrição deve estar entre ${MIN_PRICE} Kz e ${MAX_PRICE} Kz.` });
  }
  if (hasDisplayName && (typeof body.displayName !== "string" || !body.displayName.trim() || body.displayName.trim().length > 100)) {
    return res.status(400).json({ error: "O nome público deve ter até 100 caracteres." });
  }
  if (hasBio && (typeof body.bio !== "string" || body.bio.length > 500)) {
    return res.status(400).json({ error: "A biografia deve ter até 500 caracteres." });
  }
  if (hasPrice) {
    const account = await pool.query("SELECT is_creator FROM users WHERE id=$1", [req.user.id]);
    if (!account.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    if (!account.rows[0].is_creator) return res.status(403).json({ error: "Só contas de criador podem definir um preço de subscrição." });
  }
  // Alterar ou remover um telemóvel já guardado pede a palavra-passe (quem tiver a sessão aberta noutro
  // aparelho não o pode trocar). Guardar o primeiro número não pede.
  if (!phone.skip) {
    const current = (await pool.query("SELECT phone,password_hash FROM users WHERE id=$1", [req.user.id])).rows[0];
    if (!current) return res.status(404).json({ error: "Conta não encontrada." });
    if (current.phone && current.phone !== (phone.value ?? null)) {
      const password = typeof body.password === "string" ? body.password : "";
      const ok = password && current.password_hash ? await bcrypt.compare(password, current.password_hash).catch(() => false) : false;
      if (!ok) {
        return res.status(403).json({ error: password ? "A palavra-passe não está certa." : "Para alterar ou remover o telemóvel, confirma a tua palavra-passe.", code: "password_required" });
      }
    }
  }
  // Um número novo fica por confirmar (código por SMS em POST /auth/phone/send-code).
  const result = await pool.query(`
      UPDATE users SET display_name=COALESCE($1,display_name),bio=COALESCE($2,bio),
        subscription_price=COALESCE($3,subscription_price),
        location=COALESCE($5,location),profession=COALESCE($6,profession),website=COALESCE($7,website),
        phone=CASE WHEN $8::boolean THEN $9 ELSE phone END,
        phone_verified_at=CASE WHEN $8::boolean AND $9::text IS DISTINCT FROM phone THEN NULL ELSE phone_verified_at END
      WHERE id=$4
      RETURNING ${OWN_ACCOUNT_FIELDS}`,
  [hasDisplayName ? body.displayName.trim() : null, hasBio ? body.bio.trim() : null, subscriptionPrice, req.user.id,
    location.value ?? null, profession.value ?? null, website ?? null, !phone.skip, phone.value ?? null]);
  if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: result.rows[0] });
});

// Posição vertical da capa (0–100). Aceita número ou texto (vem de FormData).
function parseCoverPosition(value) {
  if (value === undefined || value === "") return 50;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : null;
}

// Foto de perfil e capa: só imagens, até 8 MB, convertidas para WebP. O ficheiro anterior é apagado.
for (const kind of ["avatar", "cover"]) {
  const column = kind === "avatar" ? "avatar_url" : "cover_url";
  app.post(`/api/auth/me/${kind}`, auth, imageUpload.single("image"), optimizeUpload(kind), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Escolhe uma imagem." });
    const position = kind === "cover" ? parseCoverPosition(req.body?.position) : null;
    if (kind === "cover" && position === null) {
      await removeUpload(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: "Posição da capa inválida." });
    }
    const previous = await pool.query(`SELECT ${column} AS url FROM users WHERE id=$1`, [req.user.id]);
    const result = await pool.query(
      kind === "cover"
        ? `UPDATE users SET cover_url=$1, cover_position=$3 WHERE id=$2 RETURNING ${OWN_ACCOUNT_FIELDS}`
        : `UPDATE users SET avatar_url=$1 WHERE id=$2 RETURNING ${OWN_ACCOUNT_FIELDS}`,
      kind === "cover" ? [`/uploads/${req.file.filename}`, req.user.id, position] : [`/uploads/${req.file.filename}`, req.user.id]);
    if (!result.rowCount) {
      await removeUpload(`/uploads/${req.file.filename}`);
      return res.status(404).json({ error: "Conta não encontrada." });
    }
    await removeUpload(previous.rows[0]?.url);
    res.json({ user: result.rows[0] });
  });

  app.delete(`/api/auth/me/${kind}`, auth, async (req, res) => {
    const previous = await pool.query(`SELECT ${column} AS url FROM users WHERE id=$1`, [req.user.id]);
    const result = await pool.query(
      `UPDATE users SET ${column}=''${kind === "cover" ? ",cover_position=50" : ""} WHERE id=$1 RETURNING ${OWN_ACCOUNT_FIELDS}`, [req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    await removeUpload(previous.rows[0]?.url);
    res.json({ user: result.rows[0] });
  });
}

// Reposicionar a capa atual sem voltar a enviar a imagem.
// Dados para recibos: o nome (ou empresa), NIF e morada que aparecem em «Vendido por» nos recibos
// de quem compra ao criador (bilhetes, grupos, cursos, subscrições). Tudo vazio apaga.
app.patch("/api/auth/me/billing", auth, async (req, res) => {
  const body = req.body || {};
  const empty = ["sellerName", "sellerNif", "sellerAddress"].every(key => !String(body[key] ?? "").trim());
  let seller = { name: null, nif: null, address: null };
  if (!empty) {
    seller = parseSellerInput(body, cleanText);
    if (seller.error) return res.status(400).json({ error: seller.error.replace(" que vende os bilhetes", "").replace(" de quem vende os bilhetes", "") });
  }
  const result = await pool.query(
    `UPDATE users SET billing_name=$2,billing_nif=$3,billing_address=$4 WHERE id=$1 RETURNING ${OWN_ACCOUNT_FIELDS}`,
    [req.user.id, seller.name, seller.nif, seller.address]);
  if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: result.rows[0] });
});

app.patch("/api/auth/me/cover-position", auth, async (req, res) => {
  const position = parseCoverPosition(req.body?.position);
  if (req.body?.position === undefined || position === null) return res.status(400).json({ error: "Posição da capa inválida." });
  const result = await pool.query(
    `UPDATE users SET cover_position=$1 WHERE id=$2 RETURNING ${OWN_ACCOUNT_FIELDS}`, [position, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: result.rows[0] });
});

// Lista de publicações (feed, perfil, grupo, página, pesquisa) ou uma só (onlyId: página da publicação).
async function listPosts(req, res, onlyId = null) {
  const query = onlyId ? {} : req.query;
  const currentUser = req.user?.id || 0;
  const rawUsername = query.username;
  const username = typeof rawUsername === "string" ? rawUsername.trim() : null;
  const rawGroupId = query.groupId;
  const rawPageId = query.pageId;
  const rawMediaType = query.mediaType;
  const groupId = rawGroupId === undefined ? null : parseId(rawGroupId);
  const pageId = rawPageId === undefined ? null : parseId(rawPageId);
  const mediaType = rawMediaType === undefined ? null : rawMediaType;
  // feed=following: só eu, amigos, quem sigo, páginas que sigo e grupos onde estou.
  const scope = query.feed === undefined ? "all" : query.feed;
  const before = query.before === undefined ? null : parseId(query.before);
  // Pesquisa: q procura no texto; tag procura uma hashtag exata (#luanda encontra "#Luanda", não "#luandense").
  const text = searchTerm(query.q);
  const tag = query.tag === undefined ? null : parseHashtag(query.tag);
  const limit = 20;
  if (!["all", "following"].includes(scope) || (query.before !== undefined && !before)) {
    return res.status(400).json({ error: "Filtro de publicações inválido." });
  }
  if ((query.q !== undefined && text === null) || (query.tag !== undefined && !tag)) {
    return res.status(400).json({ error: "Pesquisa inválida." });
  }
  if (scope === "following" && !req.user) {
    return res.status(401).json({ error: "Entra na tua conta para ver o feed de quem segues." });
  }
  if ((rawUsername !== undefined && (typeof rawUsername !== "string" || !username || username.length > 40))
    || (rawGroupId !== undefined && (typeof rawGroupId !== "string" || !groupId))
    || (rawPageId !== undefined && (typeof rawPageId !== "string" || !pageId))
    || (rawMediaType !== undefined && (typeof rawMediaType !== "string" || !["image", "video", "media"].includes(mediaType)))) {
    return res.status(400).json({ error: "Filtro de publicações inválido." });
  }
  if (groupId !== null && pageId !== null) {
    return res.status(400).json({ error: "Filtro de publicações inválido." });
  }
  if (groupId !== null) {
    if (!req.user) return res.status(401).json({ error: "Entra na tua conta para ver as publicações do grupo." });
    const membership = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2",
      [groupId, req.user.id]);
    if (!membership.rowCount) return res.status(403).json({ error: "Tens de pertencer ao grupo para ver as publicações." });
  }
  const r = await pool.query(`
    SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_creator,
      COALESCE(u.partner_since IS NOT NULL OR u.verification_expires_at > NOW(), FALSE) AS is_verified,
      CASE WHEN u.verification_expires_at > NOW() THEN u.verification_tier END AS verification_tier,
      p.star_count::int AS stars,
      g.name AS group_name, pg.name AS page_name, pg.logo_url AS page_logo_url,
      pg.category AS page_category, pg.is_official AS page_is_official,
      CASE WHEN pg.verification_expires_at > NOW() THEN pg.verification_tier END AS page_verification_tier,
      p.like_count AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
      (SELECT l.reaction FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS user_reaction,
      p.comment_count AS comments,
      p.share_count AS shares,
      sp.id AS shared_id, sp.body AS shared_body, sp.media_url AS shared_media_url, sp.media_type AS shared_media_type,
      sp.created_at AS shared_created_at, su.username AS shared_username, su.display_name AS shared_display_name,
      su.avatar_url AS shared_avatar_url, sp.page_id AS shared_page_id, spg.name AS shared_page_name,
      spg.logo_url AS shared_page_logo_url, spg.category AS shared_page_category, spg.is_official AS shared_page_official,
      (sp.id IS NOT NULL AND sp.hidden_at IS NULL AND NOT ${blockedBetween("$1", "sp.user_id")}) AS shared_visible,
      ${POST_MUSIC_SQL}
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN social_groups g ON g.id=p.group_id
    LEFT JOIN pages pg ON pg.id=p.page_id
    LEFT JOIN posts sp ON sp.id=p.shared_post_id
    LEFT JOIN users su ON su.id=sp.user_id
    LEFT JOIN pages spg ON spg.id=sp.page_id
    WHERE ($2::text IS NULL OR u.username=$2)
      AND ($3::int IS NULL OR p.group_id=$3)
      AND ($4::int IS NULL OR p.page_id=$4)
      AND ($5::text IS NULL OR p.media_type=$5 OR ($5='media' AND p.media_type IN ('image','video')))
      AND (p.group_id IS NULL OR EXISTS(
        SELECT 1 FROM group_members gm WHERE gm.group_id=p.group_id AND gm.user_id=$1
      ))
      AND (p.is_exclusive=FALSE OR p.user_id=$1 OR EXISTS(
        SELECT 1 FROM subscriptions s
        WHERE s.subscriber_id=$1 AND s.creator_id=p.user_id AND ${ACTIVE_SUBSCRIPTION_SQL}
      ))
      AND (p.hidden_at IS NULL OR p.user_id=$1)
      AND NOT ${blockedBetween("$1", "p.user_id")}
      AND ($6::text <> 'following' OR p.user_id=$1
        OR EXISTS(SELECT 1 FROM friendships f WHERE (f.user_a_id=$1 AND f.user_b_id=p.user_id) OR (f.user_b_id=$1 AND f.user_a_id=p.user_id))
        OR EXISTS(SELECT 1 FROM follows fo WHERE fo.follower_id=$1 AND fo.following_id=p.user_id)
        OR (p.page_id IS NOT NULL AND EXISTS(SELECT 1 FROM page_followers pf WHERE pf.page_id=p.page_id AND pf.user_id=$1))
        OR p.group_id IS NOT NULL)
      AND ($7::int IS NULL
        OR (p.created_at, p.id) < (SELECT c.created_at, c.id FROM posts c WHERE c.id=$7)
        OR (NOT EXISTS(SELECT 1 FROM posts c WHERE c.id=$7) AND p.id < $7))
      AND ($8::text IS NULL OR p.body ILIKE $8 ESCAPE '\\')
      AND ($9::text IS NULL OR p.body ~* $9)
      AND ($10::int IS NULL OR p.id=$10)
      AND ($11::boolean IS NOT TRUE OR p.pinned_at IS NOT NULL)
    ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit}
  `, [currentUser, username, groupId, pageId, mediaType, scope, before,
    text ? likePattern(text) : null, tag ? hashtagRegex(tag) : null, onlyId, query.pinned === "1" && groupId !== null]);
  if (onlyId) {
    // Não existe, foi escondida, é de alguém bloqueado, de um grupo onde não estás ou exclusiva de subscritores.
    if (!r.rowCount) return res.status(404).json({ error: "Esta publicação já não está disponível ou não tens acesso a ela." });
    return res.json({ post: serializePost(r.rows[0]) });
  }
  res.json({
    posts: r.rows.map(serializePost),
    nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null
  });
}
app.get("/api/posts", optionalAuth, (req, res) => listPosts(req, res));
// Página de cada publicação (aberta das notificações, de links partilhados e da pesquisa).
app.get("/api/posts/:id", optionalAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  return listPosts(req, res, id);
});

app.get("/api/stories", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT s.id,s.user_id,s.body,s.media_url,s.media_type,s.background,s.created_at,s.expires_at,
      u.username,u.display_name,u.avatar_url
    FROM stories s JOIN users u ON u.id=s.user_id
    WHERE s.expires_at>NOW() AND NOT ${blockedBetween("$1", "s.user_id")}
    ORDER BY s.created_at DESC
    LIMIT 100
  `, [req.user.id]);
  res.json({
    stories: result.rows.map(story => ({
      ...story,
      media_url: story.media_url
        ? signStoryMedia(story.id, path.basename(story.media_url))
        : ""
    }))
  });
});

app.post("/api/stories", auth, upload.single("media"), optimizeUpload("story"), async (req, res) => {
  const bodyData = isRecord(req.body) ? req.body : {};
  const body = cleanText(bodyData.body);
  if (body.length > 500) return res.status(400).json({ error: "O story não pode exceder 500 caracteres." });
  if (!body && !req.file) return res.status(400).json({ error: "Escreve uma mensagem ou escolhe uma fotografia." });
  // O fundo só conta para stories de texto: com foto ou vídeo, a imagem é o fundo.
  const background = parseStoryBackground(bodyData.background);
  if (background.error) return res.status(400).json({ error: background.error });

  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : "";
  const mediaType = req.file?.mimetype?.startsWith("video") ? "video" : req.file ? "image" : "";
  const result = await pool.query(`
    INSERT INTO stories(user_id,body,media_url,media_type,background)
    VALUES($1,$2,$3,$4,$5)
    RETURNING id,user_id,body,media_url,media_type,background,created_at,expires_at
  `, [req.user.id, body, mediaUrl, mediaType, req.file ? null : background.value]);
  const story = result.rows[0];
  res.status(201).json({
    story: {
      ...story,
      media_url: story.media_url ? signStoryMedia(story.id, path.basename(story.media_url)) : ""
    }
  });
});

app.delete("/api/stories/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Story inválido." });
  const result = await pool.query(
    "DELETE FROM stories WHERE id=$1 AND user_id=$2 RETURNING id",
    [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Story não encontrado." });
  res.json({ deleted: true });
});

app.post("/api/posts", auth, upload.single("media"), optimizeUpload("post"), async (req, res) => {
  const bodyData = isRecord(req.body) ? req.body : {};
  const body = cleanText(bodyData.body);
  const rawGroupId = bodyData.groupId;
  const rawPageId = bodyData.pageId;
  const groupId = rawGroupId ? parseId(rawGroupId) : null;
  const pageId = rawPageId ? parseId(rawPageId) : null;
  const isExclusive = bodyData.isExclusive === true || bodyData.isExclusive === "true";
  if (typeof bodyData.body !== "string" || bodyData.body.length > 5000) {
    return res.status(400).json({ error: "A publicação deve ter até 5000 caracteres." });
  }
  if (!body && !req.file) return res.status(400).json({ error: "Escreve uma publicação ou escolhe uma fotografia/vídeo." });
  if (bodyData.isExclusive !== undefined && !["true", "false", true, false].includes(bodyData.isExclusive)) {
    return res.status(400).json({ error: "O estado de conteúdo exclusivo é inválido." });
  }
  if ((rawGroupId && !groupId) || (rawPageId && !pageId)) return res.status(400).json({ error: "Grupo ou página inválidos." });
  if (groupId && pageId) return res.status(400).json({ error: "Escolhe um grupo ou uma página, não ambos." });
  if (isExclusive && (groupId || pageId)) {
    return res.status(400).json({ error: "Conteúdo exclusivo não pode ser publicado num grupo ou numa página." });
  }
  if (groupId) {
    const membership = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
    if (!membership.rowCount) return res.status(403).json({ error: "Tens de pertencer ao grupo para publicar." });
  }
  if (pageId) {
    const page = await pool.query("SELECT 1 FROM pages WHERE id=$1 AND owner_id=$2", [pageId, req.user.id]);
    if (!page.rowCount) return res.status(403).json({ error: "Só o responsável pela página pode publicar." });
  }
  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : "";
  const mediaType = req.file?.mimetype?.startsWith("video") ? "video" : req.file ? "image" : "";
  // Edições do editor de Reels: só fazem sentido num vídeo.
  const videoEdit = mediaType === "video" ? parseVideoEdit(bodyData.videoEdit) : { edit: null };
  if (videoEdit.error) {
    if (req.file) await removeUpload(mediaUrl);
    return res.status(400).json({ error: videoEdit.error });
  }
  if (videoEdit.edit?.music && !(await music.canUseTrack(videoEdit.edit.music.trackId, req.user.id))) {
    await removeUpload(mediaUrl);
    return res.status(400).json({ error: "Essa música já não está disponível. Escolhe outra." });
  }
  const r = await pool.query(
    `INSERT INTO posts(user_id,body,media_url,media_type,is_exclusive,group_id,page_id,video_edit)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, body, mediaUrl, mediaType, isExclusive, groupId, pageId, videoEdit.edit ? JSON.stringify(videoEdit.edit) : null]
  );
  growth.rewardReferral(req.user.id).catch(error => console.error("Referral reward failed:", error.message));
  res.status(201).json({ post: serializePost(r.rows[0]) });
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  const result = await pool.query(
    "DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id,media_url",
    [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Publicação não encontrada." });

  await removeUpload(result.rows[0].media_url);
  res.json({ deleted: true });
});

app.post("/api/posts/:id/like", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  const body = isRecord(req.body) ? req.body : {};
  const supportedReactions = ["like", "love", "haha", "wow", "sad", "angry"];
  const reaction = Object.hasOwn(body, "reaction") ? body.reaction : "like";
  if (reaction !== null && !supportedReactions.includes(reaction)) {
    return res.status(400).json({ error: "Reação inválida." });
  }
  const access = await canAccessPost(id, req.user.id);
  if (!access.exists) return res.status(404).json({ error: "Publicação não encontrada." });
  if (!access.allowed) return res.status(403).json({ error: "Não tens acesso a esta publicação." });
  const savedReaction = await transaction(async client => {
    const current = await client.query(
      "SELECT reaction FROM likes WHERE user_id=$1 AND post_id=$2 FOR UPDATE",
      [req.user.id, id]);
    const existing = current.rows[0]?.reaction || (current.rowCount ? "like" : null);
    const next = existing === reaction ? null : reaction;
    if (next === null && current.rowCount) {
      await client.query("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [req.user.id, id]);
    } else if (next && current.rowCount) {
      await client.query("UPDATE likes SET reaction=$3 WHERE user_id=$1 AND post_id=$2", [req.user.id, id, next]);
    } else if (next) {
      await client.query("INSERT INTO likes(user_id,post_id,reaction) VALUES($1,$2,$3)", [req.user.id, id, next]);
    }
    if (!existing && next && access.post.user_id !== req.user.id) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text,post_id)
        VALUES($1,$2,'like','Gostou da tua publicação.',$3)`, [access.post.user_id, req.user.id, id]);
    }
    return next;
  });
  const [count, distribution] = await Promise.all([
    pool.query("SELECT like_count AS count FROM posts WHERE id=$1", [id]),
    pool.query("SELECT reaction,COUNT(*)::int AS count FROM likes WHERE post_id=$1 GROUP BY reaction", [id])
  ]);
  res.json({
    liked: Boolean(savedReaction),
    reaction: savedReaction,
    likes: count.rows[0].count,
    reaction_counts: Object.fromEntries(distribution.rows.map(row => [row.reaction || "like", row.count]))
  });
});

app.get("/api/posts/:id/comments", optionalAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  const access = await canAccessPost(id, req.user?.id || 0);
  if (!access.exists) return res.status(404).json({ error: "Publicação não encontrada." });
  if (!access.allowed) return res.status(403).json({ error: "Não tens acesso a esta publicação." });
  const r = await pool.query(`
    SELECT c.id,c.body,c.created_at,u.id AS user_id,u.username,u.display_name,u.avatar_url
    FROM comments c JOIN users u ON u.id=c.user_id
    WHERE c.post_id=$1 AND NOT ${blockedBetween("$2", "c.user_id")}
    ORDER BY c.created_at ASC LIMIT 100`, [id, req.user?.id || 0]);
  res.json({ comments: r.rows });
});

app.post("/api/posts/:id/comments", auth, async (req, res) => {
  const id = parseId(req.params.id);
  const bodyData = isRecord(req.body) ? req.body : {};
  const body = cleanText(bodyData.body);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  if (typeof bodyData.body !== "string") return res.status(400).json({ error: "O comentário não pode estar vazio." });
  if (!body) return res.status(400).json({ error: "O comentário não pode estar vazio." });
  if (bodyData.body.length > 2000) return res.status(400).json({ error: "O comentário excede 2000 caracteres." });
  const access = await canAccessPost(id, req.user.id);
  if (!access.exists) return res.status(404).json({ error: "Publicação não encontrada." });
  if (!access.allowed) return res.status(403).json({ error: "Não tens acesso a esta publicação." });
  if (access.post.user_id !== req.user.id && !(await reachAllowed("comments", access.post.user_id, req.user.id))) {
    return res.status(403).json({ error: "O autor limitou quem pode comentar nas publicações." });
  }
  const comment = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO comments(user_id,post_id,body) VALUES($1,$2,$3)
      RETURNING id,body,created_at`, [req.user.id, id, body]);
    if (access.post.user_id !== req.user.id) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text,post_id)
        VALUES($1,$2,'comment','Comentou na tua publicação.',$3)`, [access.post.user_id, req.user.id, id]);
    }
    return result.rows[0];
  });
  res.status(201).json({ comment });
});

// ----- Pesquisa -----
// Texto de pesquisa: 1 a 100 caracteres. undefined → null (sem filtro); inválido → null também, quem chama decide.
function searchTerm(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim();
  return value.length >= 1 && value.length <= 100 ? value : null;
}
const likePattern = value => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
// Hashtag: letras (com acentos), números e _, até 50. Só estes caracteres entram na expressão regular.
function parseHashtag(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^#/, "");
  return /^[\p{L}\p{N}_]{1,50}$/u.test(value) ? value : null;
}
const hashtagRegex = tag => `(^|[^[:alnum:]_])#${tag}([^[:alnum:]_]|$)`;

const searchRateLimit = makeRateLimit("search", {
  windowMs: 60 * 1000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Demasiadas pesquisas. Espera um minuto." }
});

// Pesquisa geral: pessoas, grupos, páginas e hashtags. As publicações vêm de GET /api/posts?q= (ou ?tag=),
// que já aplica as regras de quem pode ver o quê. Grupos secretos nunca aparecem aqui.
app.get("/api/search", auth, searchRateLimit, async (req, res) => {
  const term = searchTerm(req.query.q);
  if (!term) return res.json({ users: [], groups: [], pages: [], hashtags: [], events: [] });
  const tagPrefix = parseHashtag(term.replace(/^#/, "").split(" ")[0]);
  const like = likePattern(term.replace(/^#/, ""));
  const [users, groups, pages, hashtags, events] = await Promise.all([
    pool.query(`
      SELECT id,username,display_name,avatar_url,is_creator,
        COALESCE(partner_since IS NOT NULL OR verification_expires_at > NOW(), FALSE) AS is_verified,
        CASE WHEN verification_expires_at > NOW() THEN verification_tier END AS verification_tier
      FROM users
      WHERE id<>$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$1", "users.id")}
        AND (username ILIKE $2 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\')
      ORDER BY (lower(username)=lower($3)) DESC, display_name LIMIT 20`, [req.user.id, like, term.replace(/^@/, "")]),
    pool.query(`
      SELECT g.id,g.name,g.description,g.group_type,g.category,g.subcategory,g.requires_approval,g.invite_only,
        (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
        EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS is_member
      FROM social_groups g
      WHERE g.hidden_at IS NULL AND NOT g.is_secret AND (g.name ILIKE $2 ESCAPE '\\' OR g.description ILIKE $2 ESCAPE '\\')
      ORDER BY member_count DESC, g.created_at DESC LIMIT 20`, [req.user.id, like]),
    pool.query(`
      SELECT p.id,p.name,p.page_type,p.category,p.subcategory,p.description,p.is_official,
        CASE WHEN p.verification_expires_at > NOW() THEN p.verification_tier END AS verification_tier,
        (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count
      FROM pages p
      WHERE p.hidden_at IS NULL AND (p.name ILIKE $1 ESCAPE '\\' OR p.description ILIKE $1 ESCAPE '\\' OR p.category ILIKE $1 ESCAPE '\\')
      ORDER BY follower_count DESC, p.created_at DESC LIMIT 20`, [like]),
    // Hashtags que começam pelo que foi escrito, nas publicações públicas dos últimos 6 meses.
    tagPrefix ? pool.query(`
      SELECT lower(m[1]) AS tag, COUNT(DISTINCT p.id)::int AS posts
      FROM posts p CROSS JOIN LATERAL regexp_matches(p.body, '#([[:alnum:]_]{1,50})', 'g') m
      WHERE p.hidden_at IS NULL AND p.group_id IS NULL AND NOT p.is_exclusive
        AND p.created_at > NOW() - INTERVAL '180 days' AND lower(m[1]) LIKE $1 ESCAPE '\\'
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`, [`${tagPrefix.toLowerCase().replace(/_/g, "\\_")}%`]) : { rows: [] },
    // Eventos ainda por acontecer (fora dos grupos), pelo nome, local ou descrição.
    pool.query(`
      SELECT e.id,e.name,e.location,e.starts_at,e.image_url,e.ticket_price_kz::float AS ticket_price_kz,
        (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count
      FROM events e
      WHERE e.group_id IS NULL AND e.starts_at > NOW() - INTERVAL '6 hours' AND NOT ${blockedBetween("$1", "e.creator_id")}
        AND (e.name ILIKE $2 ESCAPE '\\' OR e.location ILIKE $2 ESCAPE '\\' OR e.description ILIKE $2 ESCAPE '\\')
      ORDER BY e.starts_at LIMIT 10`, [req.user.id, like])
  ]);
  res.json({ users: users.rows, groups: groups.rows, pages: pages.rows, hashtags: hashtags.rows, events: events.rows });
});

app.get("/api/users/search", auth, async (req, res) => {
  const search = String(req.query.q || "").trim();
  if (search.length < 1) return res.json({ users: [] });
  const r = await pool.query(`
    SELECT id,username,display_name,avatar_url
    FROM users
    WHERE id<>$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$1", "users.id")}
      AND (username ILIKE $2 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\')
    ORDER BY display_name LIMIT 20`, [req.user.id, `%${search.slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`]);
  res.json({ users: r.rows });
});

app.get("/api/friends", auth, async (req, res) => {
  const [friends, requests, suggestions] = await Promise.all([
    pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,${onlineSql("u")} AS online
      FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END
      WHERE f.user_a_id=$1 OR f.user_b_id=$1
      ORDER BY online DESC, u.display_name`, [req.user.id]),
    pool.query(`
      SELECT r.id,r.created_at,u.id AS user_id,u.username,u.display_name,u.avatar_url
      FROM friend_requests r JOIN users u ON u.id=r.requester_id
      WHERE r.addressee_id=$1 AND r.status='pending'
      ORDER BY r.created_at DESC`, [req.user.id]),
    pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url
      FROM users u
      WHERE u.id<>$1 AND u.suspended_at IS NULL AND u.email_verified
        AND NOT ${blockedBetween("$1", "u.id")}
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
          WHERE (f.user_a_id=$1 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$1)
        )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests r
          WHERE r.status='pending'
            AND ((r.requester_id=$1 AND r.addressee_id=u.id) OR (r.requester_id=u.id AND r.addressee_id=$1))
        )
      ORDER BY u.created_at DESC LIMIT 12`, [req.user.id])
  ]);
  res.json({ friends: friends.rows, requests: requests.rows, suggestions: suggestions.rows });
});

app.post("/api/friends/:userId/request", auth, async (req, res) => {
  const other = parseId(req.params.userId);
  if (!other || other === req.user.id) {
    return res.status(400).json({ error: "Pedido de amizade inválido." });
  }
  if (await isBlocked(req.user.id, other)) return res.status(403).json({ error: BLOCKED_ERROR });
  const friendship = await pool.query(`
    SELECT 1 FROM friendships
    WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)`,
  [req.user.id, other]);
  if (friendship.rowCount) return res.status(409).json({ error: "Já são amigos." });
  const reverseRequest = await pool.query(`
    SELECT id FROM friend_requests
    WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,
  [other, req.user.id]);
  if (reverseRequest.rowCount) return res.status(409).json({ error: "Este utilizador já te enviou um pedido." });
  try {
    const requestId = await transaction(async client => {
      const result = await client.query(`
        INSERT INTO friend_requests(requester_id,addressee_id) VALUES($1,$2)
        RETURNING id`, [req.user.id, other]);
      await client.query(
        "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'friend_request','Recebeste um pedido de amizade.')",
        [other, req.user.id]);
      return result.rows[0].id;
    });
    res.status(201).json({ requestId });
  } catch (error) {
    if (error.code === "23503") return res.status(404).json({ error: "Utilizador não encontrado." });
    if (error.code === "23505") return res.status(409).json({ error: "Já existe um pedido de amizade pendente." });
    throw error;
  }
});

app.post("/api/friends/requests/:requestId/accept", auth, async (req, res) => {
  const id = parseId(req.params.requestId);
  if (!id) return res.status(400).json({ error: "Pedido inválido." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query(`
      SELECT id,requester_id FROM friend_requests
      WHERE id=$1 AND addressee_id=$2 AND status='pending' FOR UPDATE`,
    [id, req.user.id]);
    if (!request.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    const requesterId = request.rows[0].requester_id;
    await client.query(
      "INSERT INTO friendships(user_a_id,user_b_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [Math.min(req.user.id, requesterId), Math.max(req.user.id, requesterId)]);
    await client.query("UPDATE friend_requests SET status='accepted' WHERE id=$1", [id]);
    await client.query(
      "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'friend_accepted','O teu pedido de amizade foi aceite.')",
      [requesterId, req.user.id]);
    await client.query("COMMIT");
    res.json({ accepted: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post("/api/friends/requests/:requestId/reject", auth, async (req, res) => {
  const id = parseId(req.params.requestId);
  if (!id) return res.status(400).json({ error: "Pedido inválido." });
  const result = await pool.query(`
    UPDATE friend_requests SET status='rejected'
    WHERE id=$1 AND addressee_id=$2 AND status='pending'
    RETURNING id`, [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Pedido não encontrado." });
  res.json({ rejected: true });
});

app.get("/api/users/:username", optionalAuth, async (req, res) => {
  const r = await pool.query(`
    SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.cover_url,u.cover_position,u.location,u.website,u.profession,
      u.is_creator,u.subscription_price,u.created_at,
      COALESCE(u.partner_since IS NOT NULL OR u.verification_expires_at > NOW(), FALSE) AS is_verified,
      CASE WHEN u.verification_expires_at > NOW() THEN u.verification_tier END AS verification_tier,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id=u.id)::int AS following,
      (SELECT COUNT(*) FROM friendships f WHERE f.user_a_id=u.id OR f.user_b_id=u.id)::int AS friends,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.group_id IS NULL)::int AS posts,
      (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=u.id)::int AS likes_received,
      (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=u.id AND c.user_id<>u.id)::int AS comments_received,
      CASE WHEN u.is_creator THEN (
        SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL}
      )::int END AS subscribers,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=u.id) AS is_following,
      EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=$2 AND b.blocked_id=u.id) AS is_blocked,
      EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2) AS blocked_me,
      u.suspended_at IS NOT NULL AS suspended,
      EXISTS(
        SELECT 1 FROM friendships f
        WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$2)
      ) AS is_friend,
      EXISTS(SELECT 1 FROM friend_requests r WHERE r.status='pending' AND r.requester_id=$2 AND r.addressee_id=u.id) AS friend_request_sent,
      -- "Online" só para amigos (e só se a pessoa não escondeu a atividade).
      (${onlineSql("u")} AND EXISTS(
        SELECT 1 FROM friendships f
        WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$2))) AS online,
      s.current_period_end AS subscription_period_end,
      s.cancel_at_period_end AS subscription_canceling,
      s.provider AS subscription_provider,
      (s.subscriber_id IS NOT NULL AND ${ACTIVE_SUBSCRIPTION_SQL}) AS is_subscribed
    FROM users u
    LEFT JOIN subscriptions s ON s.creator_id=u.id AND s.subscriber_id=$2
    WHERE u.username=$1`, [req.params.username, req.user?.id || 0]);
  // Quem me bloqueou ou está suspenso aparece como inexistente.
  if (!r.rows[0] || r.rows[0].blocked_me || r.rows[0].suspended) return res.status(404).json({ error: "Utilizador não encontrado." });
  const { blocked_me: _blockedMe, suspended: _suspended, ...user } = r.rows[0];
  // Paga mês a mês (sem Stripe): não renova sozinha; can_renew diz se já pode pagar o mês seguinte.
  user.subscription_manual = user.is_subscribed && user.subscription_provider !== "stripe";
  user.subscription_can_renew = user.is_subscribed && canRenew({ provider: user.subscription_provider, current_period_end: user.subscription_period_end, cancel_at_period_end: user.subscription_canceling });
  delete user.subscription_provider;
  if (!user.is_subscribed) {
    user.subscription_period_end = null;
    user.subscription_canceling = false;
  }
  if (req.user && req.user.id !== user.id) {
    // Conta no máximo uma visita por pessoa e por dia; uma falha aqui não impede ver o perfil.
    pool.query(
      "INSERT INTO profile_views(profile_id,viewer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [user.id, req.user.id]).catch(error => console.error("Profile view not recorded:", error.code || error.name));
  }
  res.json({ user });
});

// Amigos de um perfil (até 9 para o cartão "Amigos"): primeiro os que também são amigos de quem vê.
// Quem bloqueou ou foi bloqueado por quem vê não aparece; o perfil bloqueado/suspenso dá 404 como acima.
app.get("/api/users/:username/friends", optionalAuth, async (req, res) => {
  const viewerId = req.user?.id || 0;
  const owner = await pool.query(
    `SELECT u.id FROM users u WHERE u.username=$1 AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}`,
    [req.params.username, viewerId]);
  if (!owner.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
  const ownerId = owner.rows[0].id;
  const friendsOf = param => `SELECT CASE WHEN f.user_a_id=${param} THEN f.user_b_id ELSE f.user_a_id END
    FROM friendships f WHERE f.user_a_id=${param} OR f.user_b_id=${param}`;
  const result = await pool.query(`
    SELECT u.id,u.username,u.display_name,u.avatar_url,
      (u.id IN (${friendsOf("$2")})) AS mutual,
      COUNT(*) OVER()::int AS total,
      COUNT(*) FILTER (WHERE u.id IN (${friendsOf("$2")})) OVER()::int AS mutual_total
    FROM users u
    WHERE u.id IN (${friendsOf("$1")}) AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}
    ORDER BY mutual DESC, u.display_name
    LIMIT 9`, [ownerId, viewerId]);
  const rows = result.rows;
  res.json({
    friends: rows.map(({ total: _total, mutual_total: _mutualTotal, ...friend }) => friend),
    total: rows[0]?.total || 0,
    mutual: viewerId && viewerId !== ownerId ? rows[0]?.mutual_total || 0 : 0
  });
});

// Estatísticas privadas da própria conta (últimos 30 dias + melhores publicações).
app.get("/api/auth/me/stats", auth, async (req, res) => {
  const id = req.user.id;
  const [totals, daily, topPosts, creator] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT viewer_id) FROM profile_views WHERE profile_id=$1 AND viewed_on > CURRENT_DATE - 30)::int AS profile_visitors_30d,
        (SELECT COUNT(*) FROM follows WHERE following_id=$1 AND created_at > NOW() - INTERVAL '30 days')::int AS new_followers_30d,
        (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=$1 AND l.created_at > NOW() - INTERVAL '30 days')::int AS likes_30d,
        (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=$1 AND c.user_id<>$1 AND c.created_at > NOW() - INTERVAL '30 days')::int AS comments_30d,
        (SELECT COUNT(*) FROM posts WHERE user_id=$1 AND created_at > NOW() - INTERVAL '30 days')::int AS posts_30d`, [id]),
    pool.query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT COUNT(DISTINCT viewer_id) FROM profile_views v WHERE v.profile_id=$1 AND v.viewed_on=d::date)::int AS visitors
      FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, INTERVAL '1 day') d
      ORDER BY d`, [id]),
    pool.query(`
      SELECT p.id,LEFT(p.body,120) AS excerpt,p.media_type,p.created_at,
        p.like_count::int AS likes,
        p.comment_count::int AS comments
      FROM posts p WHERE p.user_id=$1
      ORDER BY p.like_count + 2 * p.comment_count DESC, p.created_at DESC
      LIMIT 5`, [id]),
    pool.query(`
      SELECT u.is_creator,u.subscription_price,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL})::int AS active_subscribers,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL} AND s.provider IN ('stripe','local'))::int AS paying_subscribers,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL} AND s.cancel_at_period_end)::int AS canceling_subscribers
      FROM users u WHERE u.id=$1`, [id])
  ]);
  const creatorRow = creator.rows[0];
  res.json({
    ...totals.rows[0],
    daily_visitors: daily.rows,
    top_posts: topPosts.rows,
    creator: creatorRow?.is_creator ? {
      price: Number(creatorRow.subscription_price),
      active_subscribers: creatorRow.active_subscribers,
      paying_subscribers: creatorRow.paying_subscribers,
      canceling_subscribers: creatorRow.canceling_subscribers,
      // Estimativa bruta: assinantes pagos × preço atual (antes da parte do Tchilar, das taxas e dos impostos).
      estimated_monthly_revenue: Math.round(creatorRow.paying_subscribers * Number(creatorRow.subscription_price) * 100) / 100
    } : null
  });
});

app.post("/api/users/:id/follow", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Utilizador inválido." });
  if (id === req.user.id) return res.status(400).json({ error: "Não podes seguir a própria conta." });
  if (await isBlocked(req.user.id, id)) return res.status(403).json({ error: BLOCKED_ERROR });
  const target = await pool.query("SELECT 1 FROM users WHERE id=$1", [id]);
  if (!target.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
  const following = await transaction(async client => {
    const removed = await client.query(
      "DELETE FROM follows WHERE follower_id=$1 AND following_id=$2 RETURNING following_id",
      [req.user.id, id]);
    if (removed.rowCount) return false;
    const inserted = await client.query(
      "INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING following_id",
      [req.user.id, id]);
    if (inserted.rowCount) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'follow','Começou a seguir-te.')`, [id, req.user.id]);
    }
    return true;
  });
  res.json({ following });
});

// Subscrever (ou renovar) um criador. Cartão com a Stripe = subscrição que se cobra sozinha todos os meses.
// Express, Referência, PayPal e RedotPay = paga-se um mês de cada vez (ver local-subscriptions.js).
app.post("/api/subscriptions/:creatorId", auth, async (req, res) => {
  const creatorId = parseId(req.params.creatorId);
  if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
  if (await isBlocked(req.user.id, creatorId)) return res.status(403).json({ error: BLOCKED_ERROR });
  if (payments.mode === "off") {
    return res.status(503).json({ error: "Os pagamentos ainda não estão disponíveis." });
  }
  const body = isRecord(req.body) ? req.body : {};
  const method = typeof body.method === "string" ? body.method : "";
  const [creatorResult, subscriberResult, existingResult] = await Promise.all([
    pool.query("SELECT id,username,display_name,is_creator,subscription_price FROM users WHERE id=$1", [creatorId]),
    pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]),
    pool.query(`
      SELECT s.provider,s.provider_subscription_id,s.cancel_at_period_end,s.current_period_end,(${ACTIVE_SUBSCRIPTION_SQL}) AS active
      FROM subscriptions s WHERE s.subscriber_id=$1 AND s.creator_id=$2`, [req.user.id, creatorId])
  ]);
  const creator = creatorResult.rows[0];
  if (!creator || !creator.is_creator) return res.status(404).json({ error: "Criador não encontrado." });
  const price = Number(creator.subscription_price);
  if (!(price >= MIN_PRICE)) return res.status(409).json({ error: "Este criador ainda não definiu um preço de subscrição." });
  const email = subscriberResult.rows[0]?.email;
  const payMonth = async () => {
    const result = await localSubscriptions.startPayment({ subscriberId: req.user.id, email, creator, method: method || undefined, phone: body.phone, promoCode: body.promoCode });
    if (result.error) return res.status(result.methods ? 400 : 503).json(result);
    return res.status(201).json(result);
  };

  const existing = existingResult.rows[0];
  if (existing?.active) {
    // Paga mês a mês: com um método escolhido, paga o mês seguinte (nos últimos 7 dias, ou depois de cancelar).
    if (existing.provider !== "stripe" && method) {
      if (!canRenew(existing)) return res.status(409).json({ error: `Já tens este mês pago. Podes renovar nos últimos ${RENEWAL_WINDOW_DAYS} dias.` });
      return payMonth();
    }
    if (!existing.cancel_at_period_end) return res.status(409).json({ error: "Já tens uma subscrição ativa." });
    // Retomar uma subscrição que ia terminar no fim do período.
    if (existing.provider === "stripe") {
      await applyStripeSubscription(await stripe.subscriptions.update(existing.provider_subscription_id, { cancel_at_period_end: false }));
      return res.json({ subscribed: true, message: "A tua subscrição vai continuar a renovar." });
    }
    await pool.query(
      "UPDATE subscriptions SET cancel_at_period_end=FALSE,updated_at=NOW() WHERE subscriber_id=$1 AND creator_id=$2",
      [req.user.id, creatorId]);
    return res.json({ subscribed: true, message: "Vamos avisar-te antes do fim do mês para renovares." });
  }

  // Sem método escolhido (app antiga): cartão se houver Stripe; senão, o único método que existir.
  const useStripe = stripe && (method === "card" || (!method && !payments.methods.some(id => id !== "card")));
  if (!useStripe) return payMonth();

  const metadata = { subscriber_id: String(req.user.id), creator_id: String(creatorId) };
  const profileUrl = new URL(`/u/${encodeURIComponent(creator.username)}`, appUrl);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    client_reference_id: String(req.user.id),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: subscriptionCurrency,
        unit_amount: Math.round(price * 100),
        recurring: { interval: "month" },
        product_data: { name: `Subscrição de ${creator.display_name} no Tchilar` }
      }
    }],
    metadata,
    subscription_data: { metadata },
    success_url: `${profileUrl}?subscription=success`,
    cancel_url: `${profileUrl}?subscription=cancelled`
  });
  res.json({ checkoutUrl: session.url });
});

app.delete("/api/subscriptions/:creatorId", auth, async (req, res) => {
  const creatorId = parseId(req.params.creatorId);
  if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
  const result = await pool.query(`
    SELECT s.provider,s.provider_subscription_id,s.cancel_at_period_end,s.current_period_end
    FROM subscriptions s
    WHERE s.subscriber_id=$1 AND s.creator_id=$2 AND ${ACTIVE_SUBSCRIPTION_SQL}`, [req.user.id, creatorId]);
  const subscription = result.rows[0];
  if (!subscription) return res.status(404).json({ error: "Não tens uma subscrição ativa deste criador." });
  // O acesso mantém-se até ao fim do período já pago; apenas deixa de renovar.
  if (!subscription.cancel_at_period_end) {
    if (subscription.provider === "stripe") {
      if (!stripe) return res.status(503).json({ error: "Os pagamentos não estão configurados." });
      await applyStripeSubscription(await stripe.subscriptions.update(subscription.provider_subscription_id, { cancel_at_period_end: true }));
    } else {
      await pool.query(
        "UPDATE subscriptions SET cancel_at_period_end=TRUE,updated_at=NOW() WHERE subscriber_id=$1 AND creator_id=$2",
        [req.user.id, creatorId]);
    }
  }
  res.json({ canceled: true, accessUntil: subscription.current_period_end });
});

// Campos de um grupo vistos por quem não é membro (sem a lista de membros dos grupos secretos).
const GROUP_FIELDS = `g.id,g.name,g.description,g.created_at,g.is_secret,g.access_price::float AS access_price,
  g.group_type,g.category,g.subcategory,g.requires_approval,g.invite_only,g.rules,
  u.username AS owner_username,u.display_name AS owner_name,u.avatar_url AS owner_avatar,
  (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
  (SELECT COUNT(*) FROM posts po WHERE po.group_id=g.id AND po.hidden_at IS NULL)::int AS post_count`;

// Idade de quem pede: os grupos secretos são só para maiores de 18 (sem data de nascimento conta como menor).
async function viewerAge(userId) {
  if (!userId) return { adult: false, hasBirthDate: false };
  const result = await pool.query(`SELECT birth_date IS NOT NULL AS has_birth_date, ${adultSql("birth_date")} AS adult FROM users WHERE id=$1`, [userId]);
  return { adult: Boolean(result.rows[0]?.adult), hasBirthDate: Boolean(result.rows[0]?.has_birth_date) };
}

// Os grupos secretos nunca aparecem na lista: só os vê quem já é membro (e é maior de idade).
app.get("/api/groups", optionalAuth, async (req, res) => {
  const viewerId = req.user?.id || 0;
  const [result, viewer] = await Promise.all([pool.query(`
    SELECT ${GROUP_FIELDS},
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT mu.username, mu.display_name, mu.avatar_url FROM group_members m JOIN users mu ON mu.id=m.user_id
        WHERE m.group_id=g.id ORDER BY m.joined_at LIMIT 5) x) AS member_preview,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS is_member,
      EXISTS(SELECT 1 FROM group_join_requests r WHERE r.group_id=g.id AND r.user_id=$1) AS has_requested,
      (SELECT m.role FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS my_role,
      CASE WHEN EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1 AND m.role IN ('owner','admin','moderator'))
        THEN (SELECT COUNT(*) FROM group_join_requests r WHERE r.group_id=g.id)::int ELSE 0 END AS pending_requests,
      EXISTS(SELECT 1 FROM group_invites i WHERE i.group_id=g.id AND i.user_id=$1) AS has_invite
    FROM social_groups g JOIN users u ON u.id=g.owner_id
    WHERE g.hidden_at IS NULL AND (NOT g.is_secret OR (
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1)
      AND EXISTS(SELECT 1 FROM users me WHERE me.id=$1 AND ${adultSql("me.birth_date")})))
    ORDER BY g.created_at DESC LIMIT 100`, [viewerId]), viewerAge(req.user?.id)]);
  res.json({ groups: result.rows, viewer });
});

// Procura de grupos secretos: só pelo nome exato e só para maiores de 18. Para um menor (ou sem data
// de nascimento) a resposta é sempre vazia, sem dizer se o grupo existe.
const groupSearchRateLimit = makeRateLimit("groupSearch", {
  windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Demasiadas pesquisas. Espera um minuto." }
});
app.get("/api/groups/secret", auth, groupSearchRateLimit, async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const viewer = await viewerAge(req.user.id);
  if (!viewer.adult || name.length < 3 || name.length > 100) return res.json({ groups: [], viewer });
  const result = await pool.query(`
    SELECT ${GROUP_FIELDS}, '[]'::json AS member_preview,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$2) AS is_member
    FROM social_groups g JOIN users u ON u.id=g.owner_id
    WHERE g.is_secret AND g.hidden_at IS NULL AND lower(g.name)=lower($1)
    ORDER BY g.created_at DESC LIMIT 10`, [name, req.user.id]);
  res.json({ groups: result.rows, viewer });
});

app.post("/api/groups", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const name = cleanText(body.name);
  const description = cleanText(body.description);
  if (!name || name.length > 100) return res.status(400).json({ error: "O nome do grupo é obrigatório e deve ter até 100 caracteres." });
  if ((body.description !== undefined && typeof body.description !== "string") || description.length > 2000) {
    return res.status(400).json({ error: "A descrição excede 2000 caracteres." });
  }
  const privacy = parseGroupPrivacy(body);
  if (privacy.error) return res.status(400).json({ error: privacy.error });
  const kind = parseGroupKind(body.groupType, body.category, body.subcategory);
  if (kind.error) return res.status(400).json({ error: kind.error });
  const rules = cleanText(body.rules);
  if ((body.rules !== undefined && typeof body.rules !== "string") || rules.length > 3000) return res.status(400).json({ error: "As regras devem ter até 3000 caracteres." });
  const isSecret = privacy.value === "secret";
  const requiresApproval = privacy.value === "approval";
  const inviteOnly = privacy.value === "private";
  let accessPrice = null;
  if (isSecret) {
    if (!(await viewerAge(req.user.id)).adult) {
      return res.status(403).json({ error: "Só maiores de 18 anos podem criar grupos secretos. Confirma a tua data de nascimento nas Definições." });
    }
    if (name.length < 3) return res.status(400).json({ error: "O nome de um grupo secreto deve ter pelo menos 3 caracteres." });
    const price = parseAccessPrice(body.accessPrice);
    if (price.error) return res.status(400).json({ error: price.error });
    accessPrice = price.value;
  }
  const group = await transaction(async client => {
    const result = await client.query(
      `INSERT INTO social_groups(owner_id,name,description,is_secret,access_price,requires_approval,invite_only,group_type,category,subcategory,rules)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,name,description,created_at,is_secret,access_price::float AS access_price,requires_approval,invite_only,group_type,category,subcategory,rules`,
      [req.user.id, name, description, isSecret, accessPrice, requiresApproval, inviteOnly, kind.type, kind.category, kind.subcategory, rules]);
    await client.query(
      "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [result.rows[0].id, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ group: { ...group, member_count: 1, is_member: true } });
});

app.post("/api/groups/:groupId/join", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
  const group = await pool.query("SELECT owner_id,is_secret,requires_approval,invite_only FROM social_groups WHERE id=$1 AND hidden_at IS NULL", [groupId]);
  // Num grupo secreto só se entra pagando (POST /access); a resposta não revela que o grupo existe.
  if (!group.rowCount || group.rows[0].is_secret) return res.status(404).json({ error: "Grupo não encontrado." });
  // Grupo privado: só entra quem tem convite (o convite é usado ao entrar).
  if (group.rows[0].invite_only && group.rows[0].owner_id !== req.user.id) {
    const invited = await pool.query("DELETE FROM group_invites WHERE group_id=$1 AND user_id=$2 RETURNING group_id", [groupId, req.user.id]);
    if (!invited.rowCount) {
      const member = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
      if (member.rowCount) return res.json({ joined: true });
      return res.status(403).json({ error: "Este grupo é privado: só entra quem um administrador convidar." });
    }
  }
  // Num grupo privado fica um pedido à espera do dono (quem já é membro não pede outra vez).
  if (group.rows[0].requires_approval && group.rows[0].owner_id !== req.user.id) {
    const member = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
    if (member.rowCount) return res.json({ joined: true });
    const request = await pool.query(
      "INSERT INTO group_join_requests(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id",
      [groupId, req.user.id]);
    if (request.rowCount) {
      await pool.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        SELECT m.user_id,$2,'group_join','Pediu para entrar num grupo que administras.' FROM group_members m
        WHERE m.group_id=$1 AND m.role IN ('owner','admin','moderator')`, [groupId, req.user.id]);
    }
    return res.status(202).json({ requested: true });
  }
  const result = await pool.query(
    "INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id",
    [groupId, req.user.id]);
  if (result.rowCount && group.rows[0].owner_id !== req.user.id) {
    await pool.query(`
      INSERT INTO notifications(user_id,actor_id,type,text)
      VALUES($1,$2,'group_join','Juntou-se ao teu grupo.')`, [group.rows[0].owner_id, req.user.id]);
  }
  res.json({ joined: true });
});

// Entrada paga num grupo secreto. Pede o nome exato (além do número), para que só entre quem o conhece.
app.post("/api/groups/:groupId/access", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  const body = isRecord(req.body) ? req.body : {};
  if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
  const viewer = await viewerAge(req.user.id);
  const group = await pool.query("SELECT id,name,owner_id,is_secret,access_price FROM social_groups WHERE id=$1 AND hidden_at IS NULL", [groupId]);
  const found = group.rows[0];
  if (!viewer.adult || !found?.is_secret || !sameGroupName(body.name, found.name)) {
    return res.status(404).json({ error: "Grupo não encontrado." });
  }
  const member = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
  if (member.rowCount) return res.status(409).json({ error: "Já és membro deste grupo." });
  const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
  const purchase = await pool.query(
    "INSERT INTO group_access_purchases(group_id,user_id,owner_id,amount_kz) VALUES($1,$2,$3,$4) RETURNING id",
    [groupId, req.user.id, found.owner_id, found.access_price]);
  const id = purchase.rows[0].id;
  const result = await payments.start({
    purpose: "group_access", refId: id, amountKz: Number(found.access_price), userId: req.user.id, email: user.rows[0]?.email,
    method: body.method, phone: body.phone, promoCode: body.promoCode, name: `Entrada no grupo ${found.name}`,
    successPath: `/groups/${groupId}?pagamento=sucesso`, cancelPath: "/groups?pagamento=cancelado",
    onSession: sessionId => pool.query("UPDATE group_access_purchases SET stripe_session_id=$2 WHERE id=$1", [id, sessionId])
  });
  if (result.error) return res.status(503).json({ error: result.error });
  res.status(201).json(result);
});

// Pagamento confirmado: a pessoa passa a membro (se o grupo ainda existir) e o dono é avisado.
payments.register("group_access", async (purchaseId, details) => {
  await transaction(async client => {
    const purchase = await client.query(
      `UPDATE group_access_purchases SET status='paid', paid_at=NOW(), stripe_payment_intent=$2
       WHERE id=$1 AND status='pending' RETURNING group_id,user_id,owner_id`,
      [purchaseId, details.paymentIntent || null]);
    const paid = purchase.rows[0];
    if (!paid?.group_id) return;
    await client.query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [paid.group_id, paid.user_id]);
    if (paid.owner_id && paid.owner_id !== paid.user_id) {
      await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join','Pagou a entrada e juntou-se ao teu grupo secreto.')",
        [paid.owner_id, paid.user_id]);
    }
  });
});

app.get("/api/pages", optionalAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT p.id,p.name,p.page_type,p.category,p.subcategory,p.description,p.about,p.contact_email,p.contact_phone,p.website,p.address,p.opening_hours,
      p.logo_url,p.cover_url,p.cover_position,p.is_official,p.shop_enabled,p.created_at,u.username AS owner_username,
      p.whatsapp,(p.business_verified_at IS NOT NULL) AS business_verified,
      CASE WHEN p.owner_id=$1 THEN p.business_nif END AS business_nif,
      CASE WHEN p.owner_id=$1 THEN p.business_requested_at END AS business_requested_at,
      CASE WHEN p.owner_id=$1 THEN p.business_rejected_reason END AS business_rejected_reason,
      CASE WHEN p.verification_expires_at > NOW() THEN p.verification_tier END AS verification_tier,
      u.display_name AS owner_name,u.avatar_url AS owner_avatar,
      (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count,
      (SELECT COUNT(*) FROM posts po WHERE po.page_id=p.id AND po.hidden_at IS NULL)::int AS post_count,
      (COALESCE(p.owner_id=$1,FALSE) OR EXISTS(SELECT 1 FROM page_followers f WHERE f.page_id=p.id AND f.user_id=$1)) AS is_following
    FROM pages p LEFT JOIN users u ON u.id=p.owner_id
    WHERE p.hidden_at IS NULL
    ORDER BY p.created_at DESC LIMIT 100`, [req.user?.id || 0]);
  res.json({ pages: result.rows });
});

app.patch("/api/pages/:pageId/about", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const body = isRecord(req.body) ? req.body : {};
  const fields = ["about", "contact_email", "contact_phone", "website", "address", "opening_hours"];
  if (fields.some(field => body[field] !== undefined && typeof body[field] !== "string")) {
    return res.status(400).json({ error: "Preenche os campos de texto corretamente." });
  }
  // Campo que não vem no pedido fica como está (null → COALESCE); "" apaga.
  const values = Object.fromEntries(fields.map(field => [field, body[field] === undefined ? null : cleanText(body[field])]));
  const limits = { about: 3000, contact_email: 254, contact_phone: 40, website: 300, address: 240, opening_hours: 300 };
  const oversized = fields.find(field => values[field] !== null && values[field].length > limits[field]);
  if (oversized) return res.status(400).json({ error: `O campo excede o limite de ${limits[oversized]} caracteres.` });
  if (values.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact_email)) {
    return res.status(400).json({ error: "Indica um endereço de email válido." });
  }
  // Loja: só existe se quem gere a página a ligar (sem loja, o separador "Loja" não aparece).
  if (body.shop_enabled !== undefined && typeof body.shop_enabled !== "boolean") return res.status(400).json({ error: "Indica se a página tem loja." });
  // WhatsApp das encomendas: guardado só com dígitos (formato que o wa.me aceita). "" apaga.
  const whatsapp = parsePhone(body.whatsapp, body.whatsapp_country);
  if (whatsapp.error) return res.status(400).json({ error: "Indica um número de WhatsApp válido." });
  if (values.website) {
    try {
      const url = new URL(values.website);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid");
    } catch {
      return res.status(400).json({ error: "Indica um endereço web válido, começado por https://." });
    }
  }
  const result = await pool.query(`
    UPDATE pages SET about=COALESCE($1,about),contact_email=COALESCE($2,contact_email),contact_phone=COALESCE($3,contact_phone),
      website=COALESCE($4,website),address=COALESCE($5,address),opening_hours=COALESCE($6,opening_hours),
      shop_enabled=COALESCE($9,shop_enabled),
      whatsapp=CASE WHEN $10::boolean THEN $11 ELSE whatsapp END
    WHERE id=$7 AND owner_id=$8 AND hidden_at IS NULL
    RETURNING id,about,contact_email,contact_phone,website,address,opening_hours,shop_enabled,whatsapp`,
  [values.about, values.contact_email, values.contact_phone, values.website, values.address, values.opening_hours, pageId, req.user.id,
    typeof body.shop_enabled === "boolean" ? body.shop_enabled : null, !whatsapp.skip, whatsapp.value ? whatsapp.value.replace(/\D/g, "") : null]);
  if (!result.rowCount) {
    const exists = await pool.query("SELECT 1 FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
    return res.status(exists.rowCount ? 403 : 404).json({ error: exists.rowCount ? "Só a pessoa responsável pela página pode editar estas informações." : "Página não encontrada." });
  }
  res.json({ page: result.rows[0] });
});

async function pageImageOwner(req, res, next) {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const result = await pool.query(
    "SELECT id,owner_id,logo_url,cover_url FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (result.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: "Só a pessoa responsável pela página pode alterar as imagens." });
  req.page = result.rows[0];
  next();
}

function savePageImage(kind) {
  const column = kind === "logo" ? "logo_url" : "cover_url";
  return async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Escolhe uma imagem para carregar." });
    const position = kind === "cover" ? parseCoverPosition(req.body?.position) : null;
    if (kind === "cover" && position === null) {
      await removeUpload(`/uploads/${req.file.filename}`);
      return res.status(400).json({ error: "Posição da capa inválida." });
    }
    const url = `/uploads/${req.file.filename}`;
    const result = await pool.query(kind === "cover"
      ? "UPDATE pages SET cover_url=$1,cover_position=$4 WHERE id=$2 AND owner_id=$3 RETURNING id,cover_position"
      : `UPDATE pages SET ${column}=$1 WHERE id=$2 AND owner_id=$3 RETURNING id`,
    kind === "cover" ? [url, req.page.id, req.user.id, position] : [url, req.page.id, req.user.id]);
    if (!result.rowCount) {
      await removeUpload(url);
      return res.status(404).json({ error: "Página não encontrada." });
    }
    await removeUpload(req.page[column]);
    res.json({ kind, url, ...(kind === "cover" && { position: result.rows[0].cover_position }) });
  };
}

app.post("/api/pages/:pageId/logo", auth, pageImageOwner, imageUpload.single("image"), optimizeUpload("avatar"), savePageImage("logo"));
app.post("/api/pages/:pageId/cover", auth, pageImageOwner, imageUpload.single("image"), optimizeUpload("cover"), savePageImage("cover"));
app.delete("/api/pages/:pageId/logo", auth, pageImageOwner, async (req, res) => {
  const result = await pool.query("UPDATE pages SET logo_url='' WHERE id=$1 AND owner_id=$2 RETURNING id",
    [req.page.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  await removeUpload(req.page.logo_url);
  res.json({ removed: true });
});
app.patch("/api/pages/:pageId/cover-position", auth, pageImageOwner, async (req, res) => {
  const position = parseCoverPosition(req.body?.position);
  if (req.body?.position === undefined || position === null) return res.status(400).json({ error: "Posição da capa inválida." });
  if (!req.page.cover_url) return res.status(400).json({ error: "Esta página ainda não tem uma capa para posicionar." });
  const result = await pool.query(
    "UPDATE pages SET cover_position=$1 WHERE id=$2 AND owner_id=$3 RETURNING cover_position",
    [position, req.page.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  res.json({ position: result.rows[0].cover_position });
});
app.delete("/api/pages/:pageId/cover", auth, pageImageOwner, async (req, res) => {
  const result = await pool.query("UPDATE pages SET cover_url='',cover_position=50 WHERE id=$1 AND owner_id=$2 RETURNING id",
    [req.page.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  await removeUpload(req.page.cover_url);
  res.json({ removed: true });
});

app.post("/api/pages", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const name = cleanText(body.name);
  const kind = parsePageType(body.pageType, body.category, body.subcategory);
  const description = cleanText(body.description);
  if (!name || name.length > 100) return res.status(400).json({ error: "O nome da página é obrigatório e deve ter até 100 caracteres." });
  if (kind.error) return res.status(400).json({ error: kind.error });
  if ((body.description !== undefined && typeof body.description !== "string") || description.length > 2000) {
    return res.status(400).json({ error: "A descrição excede 2000 caracteres." });
  }
  if (body.shopEnabled !== undefined && typeof body.shopEnabled !== "boolean") return res.status(400).json({ error: "Indica se a página tem loja." });
  const page = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO pages(owner_id,name,page_type,category,subcategory,description,shop_enabled) VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,name,page_type,category,subcategory,description,is_official,shop_enabled,created_at`,
    [req.user.id, name, kind.type, kind.category, kind.subcategory, description, body.shopEnabled === true]);
    await client.query("INSERT INTO page_followers(page_id,user_id) VALUES($1,$2)", [result.rows[0].id, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ page: { ...page, follower_count: 1, is_following: true } });
});

app.post("/api/pages/:pageId/follow", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const page = await pool.query("SELECT owner_id FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
  if (!page.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (page.rows[0].owner_id === req.user.id) return res.json({ following: true });
  const result = await pool.query(
    "INSERT INTO page_followers(page_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING page_id",
    [pageId, req.user.id]);
  if (result.rowCount && page.rows[0].owner_id !== req.user.id) {
    await pool.query(`
      INSERT INTO notifications(user_id,actor_id,type,text)
      VALUES($1,$2,'page_follow','Começou a seguir a tua página.')`, [page.rows[0].owner_id, req.user.id]);
  }
  res.json({ following: true });
});

app.get("/api/pages/:pageId/offers", optionalAuth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const page = await pool.query("SELECT shop_enabled,whatsapp,business_verified_at IS NOT NULL AS business_verified FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
  if (!page.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (!page.rows[0].shop_enabled) return res.json({ offers: [], shop_enabled: false });
  const shop = { whatsapp: page.rows[0].whatsapp, business_verified: page.rows[0].business_verified };
  const result = await pool.query(`
    SELECT id,page_id,title,description,price_kz::float AS price_kz,discount_percent,promo_code,expires_at,checkout_url,created_at
    FROM page_offers
    WHERE page_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC,id DESC`, [pageId]);
  res.json({ offers: result.rows, shop_enabled: true, ...shop });
});

// Pedido do selo "Negócio verificado": quem gere a página indica o NIF e a equipa confirma (Administração → Negócios).
app.post("/api/pages/:pageId/business", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const nif = String(req.body?.nif || "").toUpperCase().replace(/[\s.-]/g, "");
  if (!/^[0-9A-Z]{9,14}$/.test(nif)) return res.status(400).json({ error: "Indica o NIF do negócio (9 a 14 letras e números)." });
  const result = await pool.query(`
    UPDATE pages SET business_nif=$3,business_requested_at=NOW(),business_rejected_reason=NULL
    WHERE id=$1 AND owner_id=$2 AND hidden_at IS NULL AND shop_enabled AND business_verified_at IS NULL
    RETURNING id,business_nif,business_requested_at`, [pageId, req.user.id, nif]);
  if (!result.rowCount) {
    const page = (await pool.query("SELECT owner_id,shop_enabled,business_verified_at FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId])).rows[0];
    if (!page) return res.status(404).json({ error: "Página não encontrada." });
    if (page.owner_id !== req.user.id) return res.status(403).json({ error: "Só a pessoa responsável pela página pode pedir o selo." });
    if (page.business_verified_at) return res.status(409).json({ error: "Este negócio já está verificado." });
    return res.status(409).json({ error: "Liga primeiro a loja da página (Editar informações)." });
  }
  res.status(201).json({ page: result.rows[0] });
});

app.post("/api/pages/:pageId/offers", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const body = isRecord(req.body) ? req.body : {};
  const title = cleanText(body.title);
  const description = typeof body.description === "string" ? cleanText(body.description) : "";
  const price = Number(body.priceKz);
  const discountPercent = body.discountPercent === "" || body.discountPercent == null ? 0 : Number(body.discountPercent);
  const promoCode = body.promoCode ? normalizePromotionCode(body.promoCode) : null;
  const hasExpiry = body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "";
  const expiresAt = hasExpiry ? new Date(body.expiresAt) : null;
  const checkoutUrl = typeof body.checkoutUrl === "string" && body.checkoutUrl.length <= 2000 ? normalizeWebsite(body.checkoutUrl.trim()) : null;
  if (!title || title.length > 120) return res.status(400).json({ error: "Indica o nome da oferta (até 120 caracteres)." });
  if (body.description !== undefined && typeof body.description !== "string") return res.status(400).json({ error: "A descrição é inválida." });
  if (description.length > 2000) return res.status(400).json({ error: "A descrição deve ter até 2000 caracteres." });
  if (!Number.isFinite(price) || price < 1 || price > 1000000000) return res.status(400).json({ error: "O preço deve estar entre 1 e 1 000 000 000 Kz." });
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) return res.status(400).json({ error: "O desconto deve estar entre 0% e 100%." });
  if (promoCode && !/^[A-Z0-9_-]{3,40}$/.test(promoCode)) return res.status(400).json({ error: "O código deve ter 3 a 40 letras, números, hífen ou underscore." });
  if (body.promoCode && !promoCode) return res.status(400).json({ error: "Indica um código promocional válido." });
  if (promoCode && discountPercent === 0) return res.status(400).json({ error: "Define um desconto para usar um código promocional." });
  if (hasExpiry && typeof body.expiresAt !== "string") return res.status(400).json({ error: "A validade é inválida." });
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) return res.status(400).json({ error: "A validade deve ser uma data futura." });
  if (!checkoutUrl || !checkoutUrl.startsWith("https://")) return res.status(400).json({ error: "Indica uma ligação HTTPS válida para o WhatsApp ou site de compra." });
  const checkout = new URL(checkoutUrl);
  if (checkout.username || checkout.password) return res.status(400).json({ error: "A ligação de compra não pode conter credenciais." });
  const page = await pool.query("SELECT owner_id,name,shop_enabled FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
  if (!page.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (page.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: "Só o responsável pela página pode criar ofertas." });
  if (!page.rows[0].shop_enabled) return res.status(409).json({ error: "Esta página não tem loja. Liga a loja em Editar informações." });
  const postBody = [
    `Oferta em ${page.rows[0].name}: ${title}`,
    description,
    `Preço: ${price.toLocaleString("pt-AO")} Kz`,
    discountPercent > 0 ? `Desconto: ${discountPercent}%${promoCode ? ` · Código: ${promoCode}` : ""}` : "",
    expiresAt ? `Válido até: ${expiresAt.toLocaleDateString("pt-PT", { timeZone: "Africa/Luanda" })}` : "",
    `Comprar/contactar: ${checkoutUrl}`
  ].filter(Boolean).join("\n\n");
  if (postBody.length > 5000) return res.status(400).json({ error: "A oferta é demasiado longa para publicar no feed da página." });
  try {
    const offer = await transaction(async client => {
      const post = await client.query("INSERT INTO posts(user_id,body,page_id) VALUES($1,$2,$3) RETURNING id",
        [req.user.id, postBody, pageId]);
      const result = await client.query(`
        INSERT INTO page_offers(page_id,title,description,price_kz,discount_percent,promo_code,expires_at,promo_post_id,checkout_url)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id,page_id,title,description,price_kz::float AS price_kz,discount_percent,promo_code,expires_at,checkout_url,created_at`,
      [pageId, title, description, price, discountPercent, promoCode, expiresAt, post.rows[0].id, checkoutUrl]);
      return result.rows[0];
    });
    res.status(201).json({ offer });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Esta página já tem uma oferta com esse código." });
    throw error;
  }
});

app.delete("/api/pages/:pageId/offers/:offerId", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  const offerId = parseId(req.params.offerId);
  if (!pageId || !offerId) return res.status(400).json({ error: "Oferta ou página inválida." });
  const result = await transaction(async client => {
    const removed = await client.query(`
      DELETE FROM page_offers o USING pages p
      WHERE o.id=$1 AND o.page_id=$2 AND p.id=o.page_id AND p.owner_id=$3
      RETURNING o.id,o.promo_post_id`, [offerId, pageId, req.user.id]);
    if (removed.rows[0]?.promo_post_id) {
      await client.query("UPDATE posts SET hidden_at=NOW() WHERE id=$1 AND page_id=$2 AND hidden_at IS NULL",
        [removed.rows[0].promo_post_id, pageId]);
    }
    return removed;
  });
  if (!result.rowCount) return res.status(404).json({ error: "Oferta não encontrada." });
  res.json({ deleted: true });
});

app.get("/api/events", optionalAuth, async (req, res) => {
  const pageId = req.query.pageId === undefined ? null : parseId(req.query.pageId);
  if (req.query.pageId !== undefined && !pageId) return res.status(400).json({ error: "Página inválida." });
  const result = await pool.query(`
    SELECT e.id,e.page_id,p.name AS page_name,e.name,e.description,e.location,e.image_url,e.starts_at,e.created_at,
      u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,
      e.ticket_price_kz::float AS ticket_price_kz,e.tickets_total,
      COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS tickets_sold,
      (SELECT COALESCE(json_agg(json_build_object('code',c.code,'checked_in_at',c.checked_in_at) ORDER BY c.id), '[]'::json)
        FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
        WHERE t.event_id=e.id AND t.user_id=$1 AND t.status='paid' AND t.refund_status IS NULL) AS my_tickets,
      (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
      EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$1) AS is_attending
    FROM events e JOIN users u ON u.id=e.creator_id LEFT JOIN pages p ON p.id=e.page_id
    WHERE e.starts_at >= NOW() - INTERVAL '1 day' AND e.group_id IS NULL
      AND ($2::int IS NULL OR e.page_id=$2)
    ORDER BY e.starts_at ASC LIMIT 100`, [req.user?.id || 0, pageId]);
  res.json({ events: result.rows });
});

app.post("/api/events", auth, imageUpload.single("image"), optimizeUpload("event"), async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
  const reject = async (status, error) => {
    if (imageUrl) await removeUpload(imageUrl);
    return res.status(status).json({ error });
  };
  try {
    if (typeof body.name !== "string") return reject(400, "O nome do evento é obrigatório.");
    const name = cleanText(body.name);
    const description = cleanText(body.description);
    const location = cleanText(body.location);
    const startsAt = new Date(body.startsAt);
    if (!name || name.length > 120) return reject(400, "O nome do evento é obrigatório e deve ter até 120 caracteres.");
    if (!body.startsAt || Number.isNaN(startsAt.getTime())) return reject(400, "Indica uma data e hora válidas.");
    if (startsAt <= new Date()) return reject(400, "O evento deve começar no futuro.");
    if ((body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000))
      || (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 160))) {
      return reject(400, "A descrição ou localização excede o limite permitido.");
    }
    const pageId = body.pageId === undefined || body.pageId === null || body.pageId === "" ? null : parseId(body.pageId);
    if (body.pageId !== undefined && body.pageId !== null && body.pageId !== "" && !pageId) return reject(400, "Página inválida.");
    if (pageId) {
      const page = await pool.query("SELECT 1 FROM pages WHERE id=$1 AND owner_id=$2 AND hidden_at IS NULL", [pageId, req.user.id]);
      if (!page.rowCount) return reject(403, "Só o responsável pela página pode criar eventos nela.");
    }
    // Bilhete pago com dinheiro (0 = grátis, com o botão "Vou"). Quem organiza fica com 85%.
    const ticket = parseTicketInput(body);
    if (ticket.error) return reject(400, ticket.error);
    // Eventos pagos: quem vende (nome/empresa, NIF e morada) aparece no recibo de cada bilhete.
    const seller = ticket.price ? parseSellerInput(body, cleanText) : null;
    if (seller?.error) return reject(400, seller.error);
    const event = await transaction(async client => {
      const result = await client.query(`
        INSERT INTO events(creator_id,page_id,name,description,location,image_url,starts_at,ticket_price_kz,tickets_total,seller_name,seller_nif,seller_address)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,page_id,name,description,location,image_url,starts_at,created_at,ticket_price_kz::float AS ticket_price_kz,tickets_total,
          seller_name,seller_nif,seller_address`,
      [req.user.id, pageId, name, description, location, imageUrl, startsAt.toISOString(), ticket.price, ticket.total,
        seller?.name || null, seller?.nif || null, seller?.address || null]);
      // Os dados ficam guardados na conta para preencher os próximos eventos.
      if (seller) await client.query("UPDATE users SET billing_name=$2,billing_nif=$3,billing_address=$4 WHERE id=$1", [req.user.id, seller.name, seller.nif, seller.address]);
      await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2)", [result.rows[0].id, req.user.id]);
      return result.rows[0];
    });
    res.status(201).json({ event: { ...event, creator_id: req.user.id, attendee_count: 1, is_attending: true, tickets_sold: 0, my_tickets: [] } });
  } catch (error) {
    if (imageUrl) await removeUpload(imageUrl);
    throw error;
  }
});

registerEventTickets(app, { pool, auth, parseId, isRecord, transaction, blockedBetween, appUrl, payments, secret: JWT_SECRET, apiUrl: apiPublicUrl,
  emailQueue: mailTransport ? emailQueue : null });

app.post("/api/events/:eventId/rsvp", auth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  // Eventos de um grupo: só os membros do grupo confirmam presença.
  const event = await pool.query(`SELECT creator_id,ticket_price_kz::float AS ticket_price_kz FROM events e WHERE id=$1
    AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`, [eventId, req.user.id]);
  if (!event.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
  if (event.rows[0].ticket_price_kz > 0 && event.rows[0].creator_id !== req.user.id) {
    return res.status(409).json({ error: "Este evento tem bilhete: compra-o para garantires o lugar." });
  }
  const attending = await transaction(async client => {
    const existing = await client.query(
      "DELETE FROM event_attendees WHERE event_id=$1 AND user_id=$2 RETURNING event_id",
      [eventId, req.user.id]);
    if (existing.rowCount) return false;
    const inserted = await client.query(
      "INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [eventId, req.user.id]);
    if (inserted.rowCount && event.rows[0].creator_id !== req.user.id) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'event_rsvp','Vai participar no teu evento.')`, [event.rows[0].creator_id, req.user.id]);
    }
    return true;
  });
  res.json({ attending });
});

app.get("/api/notifications", auth, async (req, res) => {
  const [notifications, unread] = await Promise.all([
    pool.query(`
      SELECT n.id,n.type,n.text,n.read,n.created_at,n.actor_id,n.post_id,n.group_id,n.call_id,n.event_id,
        u.username AS actor_username,u.display_name AS actor_name,u.avatar_url AS actor_avatar
      FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
      WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]),
    pool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read=FALSE", [req.user.id])
  ]);
  res.json({ notifications: notifications.rows, unreadCount: unread.rows[0].count });
});

app.post("/api/notifications/:id/read", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Notificação inválida." });
  const result = await pool.query(
    "UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2 RETURNING id",
    [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Notificação não encontrada." });
  res.json({ read: true });
});

app.post("/api/notifications/read-all", auth, async (req, res) => {
  await pool.query("UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE", [req.user.id]);
  res.json({ read: true });
});

app.get("/api/messages/unread-count", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id=$1 AND read_at IS NULL", [req.user.id]);
  res.json({ unread: result.rows[0].count });
});

app.get("/api/messages/:userId", auth, async (req, res) => {
  const other = parseId(req.params.userId);
  if (!other || other === req.user.id) return res.status(400).json({ error: "Destinatário inválido." });
  // ?after=<id>: só mensagens mais recentes (usado para atualizar a conversa ao vivo).
  const after = req.query.after === undefined ? null : parseId(req.query.after);
  if (req.query.after !== undefined && !after) return res.status(400).json({ error: "Parâmetro inválido." });
  const recipient = await pool.query(
    `SELECT id,username,display_name,avatar_url,${blockedBetween("$2", "users.id")} AS blocked FROM users WHERE id=$1`,
    [other, req.user.id]);
  if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
  const r = await pool.query(`
    SELECT * FROM (
      SELECT m.id,m.sender_id,m.receiver_id,m.body,m.created_at,m.read_at, s.username AS sender_username
      FROM messages m JOIN users s ON s.id=m.sender_id
      WHERE ((m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1))
        AND ($3::int IS NULL OR m.id > $3)
      ORDER BY m.created_at DESC, m.id DESC LIMIT 100
    ) recent ORDER BY created_at ASC, id ASC`, [req.user.id, other, after]);
  await pool.query(
    "UPDATE messages SET read_at=NOW() WHERE sender_id=$1 AND receiver_id=$2 AND read_at IS NULL",
    [other, req.user.id]);
  const { blocked, ...person } = recipient.rows[0];
  res.json({ messages: r.rows, person, canMessage: !blocked });
});

app.get("/api/messages", auth, async (req, res) => {
  const r = await pool.query(`
    SELECT other.id,other.username,other.display_name,other.avatar_url,
      latest.body AS latest_message,latest.created_at AS latest_message_at,
      (SELECT COUNT(*)::int FROM messages um WHERE um.sender_id=other.id AND um.receiver_id=$1 AND um.read_at IS NULL) AS unread
    FROM (
      SELECT DISTINCT ON (CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END)
        CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END AS other_id,
        body,created_at
      FROM messages
      WHERE sender_id=$1 OR receiver_id=$1
      ORDER BY CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END,created_at DESC
    ) latest
    JOIN users other ON other.id=latest.other_id
    WHERE NOT ${blockedBetween("$1", "other.id")}
    ORDER BY latest.created_at DESC`, [req.user.id]);
  res.json({ conversations: r.rows });
});

app.post("/api/messages/:userId", auth, async (req, res) => {
  const other = parseId(req.params.userId);
  const bodyData = isRecord(req.body) ? req.body : {};
  const body = cleanText(bodyData.body);
  if (!other || other === req.user.id) {
    return res.status(400).json({ error: "Destinatário inválido." });
  }
  if (!body || typeof bodyData.body !== "string") return res.status(400).json({ error: "Mensagem vazia." });
  if (bodyData.body.length > 4000) return res.status(400).json({ error: "A mensagem excede 4000 caracteres." });
  const recipient = await pool.query("SELECT 1 FROM users WHERE id=$1 AND suspended_at IS NULL", [other]);
  if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
  if (await isBlocked(req.user.id, other)) return res.status(403).json({ error: BLOCKED_ERROR });
  if (!(await reachAllowed("messages", other, req.user.id))) {
    return res.status(403).json({ error: "Esta conta escolheu quem lhe pode enviar mensagens, e de momento não podes escrever-lhe." });
  }
  const message = await transaction(async client => {
    const result = await client.query(
      "INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING *",
      [req.user.id, other, body]);
    await client.query(`
      INSERT INTO notifications(user_id,actor_id,type,text)
      VALUES($1,$2,'message','Enviou-te uma mensagem.')`, [other, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ message });
});

// ---------------------------------------------------------------------------------------------
// Bloquear, denunciar e moderar
// ---------------------------------------------------------------------------------------------

app.get("/api/blocks", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT u.id,u.username,u.display_name,u.avatar_url,b.created_at
    FROM blocks b JOIN users u ON u.id=b.blocked_id
    WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`, [req.user.id]);
  res.json({ blocked: result.rows });
});

app.post("/api/users/:id/block", auth, async (req, res) => {
  const other = parseId(req.params.id);
  if (!other || other === req.user.id) return res.status(400).json({ error: "Utilizador inválido." });
  const target = await pool.query("SELECT 1 FROM users WHERE id=$1", [other]);
  if (!target.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
  // Bloquear corta todas as ligações entre as duas contas.
  await transaction(async client => {
    await client.query("INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, other]);
    await client.query(
      "DELETE FROM friendships WHERE user_a_id=LEAST($1::int,$2::int) AND user_b_id=GREATEST($1::int,$2::int)", [req.user.id, other]);
    await client.query(
      "DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)", [req.user.id, other]);
    await client.query(`
      UPDATE friend_requests SET status='rejected'
      WHERE status='pending' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
    [req.user.id, other]);
  });
  res.json({ blocked: true });
});

app.delete("/api/users/:id/block", auth, async (req, res) => {
  const other = parseId(req.params.id);
  if (!other) return res.status(400).json({ error: "Utilizador inválido." });
  await pool.query("DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2", [req.user.id, other]);
  res.json({ blocked: false });
});

const reportRateLimit = makeRateLimit("report", {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Enviaste muitas denúncias. Tenta novamente mais tarde." }
});

app.get("/api/reports/reasons", (_req, res) => {
  res.json({ reasons: Object.entries(REPORT_REASONS).map(([id, label]) => ({ id, label })) });
});

app.post("/api/reports", reportRateLimit, auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const targetType = body.targetType;
  const targetId = parseId(body.targetId);
  const reason = body.reason;
  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (!["post", "comment", "user", "course", "group"].includes(targetType) || !targetId) return res.status(400).json({ error: "Denúncia inválida." });
  if (!Object.hasOwn(REPORT_REASONS, reason)) return res.status(400).json({ error: "Escolhe um motivo." });
  if (details.length > 1000) return res.status(400).json({ error: "Os detalhes devem ter até 1000 caracteres." });
  const ownerSql = {
    post: "SELECT user_id FROM posts WHERE id=$1",
    comment: "SELECT user_id FROM comments WHERE id=$1",
    user: "SELECT id AS user_id FROM users WHERE id=$1",
    course: "SELECT owner_id AS user_id FROM courses WHERE id=$1 AND status='published'",
    group: "SELECT owner_id AS user_id FROM social_groups WHERE id=$1 AND hidden_at IS NULL"
  }[targetType];
  const target = await pool.query(ownerSql, [targetId]);
  if (!target.rowCount) return res.status(404).json({ error: "Conteúdo não encontrado." });
  const targetUserId = target.rows[0].user_id;
  if (targetUserId === req.user.id) return res.status(400).json({ error: "Não podes denunciar o teu próprio conteúdo." });
  try {
    await pool.query(`
      INSERT INTO reports(reporter_id,target_type,target_id,target_user_id,reason,details)
      VALUES($1,$2,$3,$4,$5,$6)`, [req.user.id, targetType, targetId, targetUserId, reason, details]);
  } catch (error) {
    if (error.code === "23505") return res.json({ reported: true, message: "Já tinhas denunciado este conteúdo. Vamos analisá-lo." });
    throw error;
  }
  if (targetType === "post") {
    const stats = await pool.query(`
      SELECT COUNT(DISTINCT r.reporter_id)::int AS open_reports, ARRAY_AGG(DISTINCT r.reason) AS reasons,
        EXTRACT(EPOCH FROM NOW() - u.created_at) / 86400 AS author_age_days
      FROM reports r JOIN users u ON u.id=r.target_user_id
      WHERE r.target_type='post' AND r.target_id=$1 AND r.status='open'
      GROUP BY u.created_at`, [targetId]);
    const row = stats.rows[0];
    if (row && shouldAutoHide({ openReports: row.open_reports, reasons: row.reasons, authorAgeDays: Number(row.author_age_days) })) {
      await pool.query("UPDATE posts SET hidden_at=NOW(),hidden_reason='auto_reports' WHERE id=$1 AND hidden_at IS NULL", [targetId]);
    }
  }
  res.status(201).json({ reported: true, message: "Obrigado. A equipa de moderação vai analisar a denúncia." });
});

app.get("/api/admin/reports", auth, requireRole("moderation"), async (req, res) => {
  const status = req.query.status === undefined ? "open" : req.query.status;
  if (!["open", "resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "Estado inválido." });
  const result = await pool.query(`
    SELECT r.id,r.target_type,r.target_id,r.reason,r.details,r.status,r.action,r.created_at,r.resolved_at,
      rep.username AS reporter_username,
      tu.id AS target_user_id,tu.username AS target_username,tu.display_name AS target_display_name,
      tu.suspended_at IS NOT NULL AS target_suspended,
      CASE r.target_type
        WHEN 'post' THEN (SELECT p.body FROM posts p WHERE p.id=r.target_id)
        WHEN 'comment' THEN (SELECT c.body FROM comments c WHERE c.id=r.target_id)
        WHEN 'course' THEN (SELECT co.title || ' — ' || co.summary FROM courses co WHERE co.id=r.target_id)
        WHEN 'group' THEN (SELECT sg.name || ' — ' || sg.description FROM social_groups sg WHERE sg.id=r.target_id)
        ELSE tu.bio END AS target_excerpt,
      CASE WHEN r.target_type='post' THEN (SELECT p.hidden_at IS NOT NULL FROM posts p WHERE p.id=r.target_id)
        WHEN r.target_type='course' THEN (SELECT co.status='hidden' FROM courses co WHERE co.id=r.target_id)
        WHEN r.target_type='group' THEN (SELECT sg.hidden_at IS NOT NULL FROM social_groups sg WHERE sg.id=r.target_id) END AS target_hidden,
      (SELECT COUNT(*)::int FROM reports o WHERE o.target_type=r.target_type AND o.target_id=r.target_id AND o.status='open') AS open_reports_on_target
    FROM reports r
    LEFT JOIN users rep ON rep.id=r.reporter_id
    LEFT JOIN users tu ON tu.id=r.target_user_id
    WHERE r.status=$1
    ORDER BY r.created_at DESC LIMIT 100`, [status]);
  res.json({ reports: result.rows, reasons: REPORT_REASONS });
});

app.post("/api/admin/reports/:id/resolve", auth, requireRole("moderation"), async (req, res) => {
  const id = parseId(req.params.id);
  const action = isRecord(req.body) ? req.body.action : undefined;
  if (!id || !MODERATION_ACTIONS.includes(action)) return res.status(400).json({ error: "Ação inválida." });
  const report = await pool.query("SELECT target_type,target_id,target_user_id FROM reports WHERE id=$1", [id]);
  if (!report.rowCount) return res.status(404).json({ error: "Denúncia não encontrada." });
  const { target_type: type, target_id: targetId, target_user_id: targetUserId } = report.rows[0];
  if (["hide_post", "restore_post"].includes(action) && type !== "post") return res.status(400).json({ error: "Esta ação só se aplica a publicações." });
  if (action === "delete_comment" && type !== "comment") return res.status(400).json({ error: "Esta ação só se aplica a comentários." });
  if (["hide_course", "restore_course"].includes(action) && type !== "course") return res.status(400).json({ error: "Esta ação só se aplica a cursos." });
  if (["hide_group", "restore_group"].includes(action) && type !== "group") return res.status(400).json({ error: "Esta ação só se aplica a grupos." });
  if (["suspend_user", "unsuspend_user"].includes(action) && targetUserId === req.user.id) {
    return res.status(400).json({ error: "Não podes suspender a tua própria conta." });
  }
  await transaction(async client => {
    if (action === "hide_post") await client.query("UPDATE posts SET hidden_at=NOW(),hidden_reason='moderation' WHERE id=$1", [targetId]);
    if (action === "restore_post") await client.query("UPDATE posts SET hidden_at=NULL,hidden_reason=NULL WHERE id=$1", [targetId]);
    if (action === "delete_comment") await client.query("DELETE FROM comments WHERE id=$1", [targetId]);
    // Curso escondido: sai da Academia; quem já comprou continua a ter acesso.
    if (action === "hide_course") await client.query("UPDATE courses SET status='hidden' WHERE id=$1 AND status='published'", [targetId]);
    if (action === "restore_course") await client.query("UPDATE courses SET status='published' WHERE id=$1 AND status='hidden'", [targetId]);
    if (action === "hide_group") await client.query("UPDATE social_groups SET hidden_at=NOW() WHERE id=$1 AND hidden_at IS NULL", [targetId]);
    if (action === "restore_group") await client.query("UPDATE social_groups SET hidden_at=NULL WHERE id=$1", [targetId]);
    if (action === "suspend_user") {
      // auth_version+1 termina as sessões abertas da conta suspensa.
      await client.query("UPDATE users SET suspended_at=NOW(),suspended_reason='Denúncia #' || $2::text,auth_version=auth_version+1 WHERE id=$1 AND is_admin=FALSE", [targetUserId, id]);
    }
    if (action === "unsuspend_user") await client.query("UPDATE users SET suspended_at=NULL, suspended_reason=NULL WHERE id=$1", [targetUserId]);
    await logAdminAction(client, req.user.id, `report_${action}`, "report", id);
    // Resolve de uma vez todas as denúncias abertas sobre o mesmo alvo.
    await client.query(`
      UPDATE reports SET status=$1,action=$2,resolved_by=$3,resolved_at=NOW()
      WHERE (id=$4 OR (target_type=$5 AND target_id=$6)) AND status='open'`,
    [action === "dismiss" ? "dismissed" : "resolved", action, req.user.id, id, type, targetId]);
  });
  res.json({ resolved: true });
});

// ---------------------------------------------------------------------------------------------
// Editar e apagar conteúdo
// ---------------------------------------------------------------------------------------------

app.patch("/api/posts/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  const bodyData = isRecord(req.body) ? req.body : {};
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  if (typeof bodyData.body !== "string" || bodyData.body.length > 5000) {
    return res.status(400).json({ error: "A publicação deve ter até 5000 caracteres." });
  }
  const body = bodyData.body.trim();
  const result = await pool.query(`
    UPDATE posts SET body=$1,edited_at=NOW()
    WHERE id=$2 AND user_id=$3 AND ($1<>'' OR media_url<>'')
    RETURNING id,body,edited_at`, [body, id, req.user.id]);
  if (!result.rowCount) {
    const exists = await pool.query("SELECT media_url FROM posts WHERE id=$1 AND user_id=$2", [id, req.user.id]);
    if (exists.rowCount) return res.status(400).json({ error: "Uma publicação sem fotografia ou vídeo não pode ficar vazia." });
    return res.status(404).json({ error: "Publicação não encontrada." });
  }
  res.json({ post: result.rows[0] });
});

app.delete("/api/comments/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Comentário inválido." });
  // Pode apagar quem escreveu o comentário ou o autor da publicação.
  const result = await pool.query(`
    DELETE FROM comments c USING posts p
    WHERE c.id=$1 AND p.id=c.post_id AND (c.user_id=$2 OR p.user_id=$2)
    RETURNING c.id`, [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Comentário não encontrado." });
  res.json({ deleted: true });
});

app.post("/api/groups/:groupId/leave", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
  const group = await pool.query("SELECT owner_id FROM social_groups WHERE id=$1", [groupId]);
  if (!group.rowCount) return res.status(404).json({ error: "Grupo não encontrado." });
  if (group.rows[0].owner_id === req.user.id) {
    return res.status(409).json({ error: "És o responsável pelo grupo: apaga o grupo em vez de sair." });
  }
  await pool.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
  // Sair também retira um pedido de entrada que ainda esteja à espera.
  await pool.query("DELETE FROM group_join_requests WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
  res.json({ left: true });
});

// Pedidos de entrada num grupo privado: só o dono os vê e decide.
// Grupo que esta pessoa gere: dono, administrador ou moderador (aprovam pedidos de entrada).
async function ownedGroup(groupId, userId) {
  const result = await pool.query(`SELECT g.id,g.name FROM social_groups g JOIN group_members m ON m.group_id=g.id
    WHERE g.id=$1 AND m.user_id=$2 AND m.role IN ('owner','admin','moderator')`, [groupId, userId]);
  return result.rows[0] || null;
}

app.get("/api/groups/:groupId/requests", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId || !(await ownedGroup(groupId, req.user.id))) return res.status(404).json({ error: "Grupo não encontrado." });
  const result = await pool.query(`
    SELECT u.id,u.username,u.display_name,u.avatar_url,r.created_at
    FROM group_join_requests r JOIN users u ON u.id=r.user_id
    WHERE r.group_id=$1 AND NOT ${blockedBetween("$2", "u.id")}
    ORDER BY r.created_at`, [groupId, req.user.id]);
  res.json({ requests: result.rows });
});

app.post("/api/groups/:groupId/requests/:userId", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  const userId = parseId(req.params.userId);
  const body = isRecord(req.body) ? req.body : {};
  if (!groupId || !userId || typeof body.approve !== "boolean") return res.status(400).json({ error: "Pedido inválido." });
  const group = await ownedGroup(groupId, req.user.id);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });
  const handled = await transaction(async client => {
    const removed = await client.query(
      "DELETE FROM group_join_requests WHERE group_id=$1 AND user_id=$2 RETURNING user_id", [groupId, userId]);
    if (!removed.rowCount) return false;
    if (body.approve) {
      await client.query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [groupId, userId]);
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'group_join',$3)`, [userId, req.user.id, `Aceitou o teu pedido para entrar em «${group.name}».`]);
    }
    return true;
  });
  if (!handled) return res.status(404).json({ error: "Este pedido já não existe." });
  res.json({ approved: body.approve });
});

app.delete("/api/groups/:groupId", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
  const media = await pool.query(
    "SELECT p.media_url FROM posts p JOIN social_groups g ON g.id=p.group_id WHERE g.id=$1 AND g.owner_id=$2",
    [groupId, req.user.id]);
  const result = await pool.query("DELETE FROM social_groups WHERE id=$1 AND owner_id=$2 RETURNING id", [groupId, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Grupo não encontrado." });
  await Promise.all(media.rows.map(row => removeUpload(row.media_url)));
  res.json({ deleted: true });
});

app.delete("/api/pages/:pageId/follow", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const page = await pool.query("SELECT owner_id FROM pages WHERE id=$1 AND hidden_at IS NULL", [pageId]);
  if (!page.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (page.rows[0].owner_id === req.user.id) {
    return res.status(409).json({ error: "És o responsável pela página: apaga a página em vez de deixar de a seguir." });
  }
  await pool.query("DELETE FROM page_followers WHERE page_id=$1 AND user_id=$2", [pageId, req.user.id]);
  res.json({ following: false });
});

app.delete("/api/pages/:pageId", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const owned = await pool.query("SELECT is_official FROM pages WHERE id=$1 AND owner_id=$2", [pageId, req.user.id]);
  if (!owned.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  if (owned.rows[0].is_official) return res.status(403).json({ error: "A página oficial do Tchilar não pode ser apagada." });
  const media = await pool.query(
    `SELECT p.media_url FROM posts p JOIN pages pg ON pg.id=p.page_id WHERE pg.id=$1 AND pg.owner_id=$2
     UNION ALL SELECT logo_url AS media_url FROM pages WHERE id=$1 AND owner_id=$2 AND logo_url<>''
     UNION ALL SELECT cover_url AS media_url FROM pages WHERE id=$1 AND owner_id=$2 AND cover_url<>''
     UNION ALL SELECT e.image_url AS media_url FROM events e WHERE e.page_id=$1 AND e.image_url<>''`,
    [pageId, req.user.id]);
  const result = await pool.query("DELETE FROM pages WHERE id=$1 AND owner_id=$2 RETURNING id", [pageId, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  await Promise.all(media.rows.map(row => removeUpload(row.media_url)));
  res.json({ deleted: true });
});

// Um evento: dados, quem criou e quem vai (amigos e quem segues primeiro). Quem tem bloqueio não aparece.
app.get("/api/events/:eventId", optionalAuth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  const viewer = req.user?.id || 0;
  const event = await pool.query(`
    SELECT e.id,e.page_id,p.name AS page_name,e.name,e.description,e.location,e.image_url,e.starts_at,e.created_at,
      u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,u.avatar_url AS creator_avatar,
      e.ticket_price_kz::float AS ticket_price_kz,e.tickets_total,e.seller_name,
      CASE WHEN e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2) THEN e.seller_nif END AS seller_nif,
      CASE WHEN e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2) THEN e.seller_address END AS seller_address,
      COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS tickets_sold,
      (SELECT COALESCE(json_agg(json_build_object('code',c.code,'checked_in_at',c.checked_in_at) ORDER BY c.id), '[]'::json)
        FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
        WHERE t.event_id=e.id AND t.user_id=$2 AND t.status='paid' AND t.refund_status IS NULL) AS my_tickets,
      (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
      EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$2) AS is_attending,
      (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2)) AS is_creator
    FROM events e JOIN users u ON u.id=e.creator_id LEFT JOIN pages p ON p.id=e.page_id
    WHERE e.id=$1 AND NOT ${blockedBetween("$2", "e.creator_id")}
      AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`, [eventId, viewer]);
  if (!event.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
  const attendees = await pool.query(`
    SELECT u.id,u.username,u.display_name,u.avatar_url,
      EXISTS(SELECT 1 FROM friendships f WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_b_id=$2 AND f.user_a_id=u.id)) AS is_friend
    FROM event_attendees a JOIN users u ON u.id=a.user_id
    WHERE a.event_id=$1 AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}
    ORDER BY is_friend DESC, (EXISTS(SELECT 1 FROM follows fo WHERE fo.follower_id=$2 AND fo.following_id=u.id)) DESC, u.display_name
    LIMIT 60`, [eventId, viewer]);
  res.json({ event: event.rows[0], attendees: attendees.rows });
});

// Editar um evento (quem o criou ou quem gere a página): nome, data, local, descrição e lotação.
// O preço não muda depois de criado (quem já comprou pagou esse preço). A lotação nunca fica abaixo do já vendido.
// Se a data ou o local mudarem, quem vai e quem tem bilhete é avisado, e os lembretes voltam a ser enviados.
app.patch("/api/events/:eventId", auth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  const body = isRecord(req.body) ? req.body : {};
  const current = (await pool.query(`
    SELECT e.id,e.name,e.description,e.location,e.starts_at,e.tickets_total,e.ticket_price_kz::float AS price,
      COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS sold
    FROM events e WHERE e.id=$1 AND (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages p WHERE p.id=e.page_id AND p.owner_id=$2))
      AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`,
  [eventId, req.user.id])).rows[0];
  if (!current) return res.status(404).json({ error: "Evento não encontrado." });
  if (new Date(current.starts_at).getTime() < Date.now() - 6 * 3600000) return res.status(409).json({ error: "Este evento já aconteceu: já não se edita." });
  const next = { name: current.name, description: current.description, location: current.location, startsAt: new Date(current.starts_at), total: current.tickets_total };
  if (body.name !== undefined) {
    const name = cleanText(body.name);
    if (!name || name.length > 120) return res.status(400).json({ error: "O nome do evento é obrigatório e deve ter até 120 caracteres." });
    next.name = name;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.length > 2000) return res.status(400).json({ error: "A descrição pode ter até 2000 caracteres." });
    next.description = cleanText(body.description);
  }
  if (body.location !== undefined) {
    if (typeof body.location !== "string" || body.location.length > 160) return res.status(400).json({ error: "O local pode ter até 160 caracteres." });
    next.location = cleanText(body.location);
  }
  if (body.startsAt !== undefined) {
    const startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: "Indica uma data e hora válidas." });
    if (startsAt <= new Date()) return res.status(400).json({ error: "O evento deve começar no futuro." });
    next.startsAt = startsAt;
  }
  let seller = null;
  if (current.price > 0 && (body.sellerName !== undefined || body.sellerNif !== undefined || body.sellerAddress !== undefined)) {
    seller = parseSellerInput(body, cleanText);
    if (seller.error) return res.status(400).json({ error: seller.error });
  }
  if (body.ticketsTotal !== undefined && current.price > 0) {
    const total = body.ticketsTotal === null || body.ticketsTotal === "" ? null : Number(body.ticketsTotal);
    if (total !== null && (!Number.isInteger(total) || total < 1 || total > 100000)) return res.status(400).json({ error: "Indica quantos bilhetes há (pelo menos 1)." });
    if (total !== null && total < current.sold) return res.status(409).json({ error: `Já vendeste ${current.sold} bilhetes: a lotação não pode ser menor.` });
    next.total = total;
  }
  const moved = next.startsAt.getTime() !== new Date(current.starts_at).getTime();
  const relocated = (next.location || "") !== (current.location || "");
  const updated = await transaction(async client => {
    const row = (await client.query(`
      UPDATE events SET name=$2,description=$3,location=$4,starts_at=$5,tickets_total=$6,
        seller_name=COALESCE($7,seller_name),seller_nif=COALESCE($8,seller_nif),seller_address=CASE WHEN $7::text IS NULL THEN seller_address ELSE $9 END
      WHERE id=$1
      RETURNING id,name,description,location,starts_at,tickets_total,seller_name,seller_nif,seller_address`,
    [eventId, next.name, next.description, next.location, next.startsAt.toISOString(), next.total, seller?.name || null, seller?.nif || null, seller?.address || null])).rows[0];
    if (seller) await client.query("UPDATE users SET billing_name=$2,billing_nif=$3,billing_address=$4 WHERE id=$1", [req.user.id, seller.name, seller.nif, seller.address]);
    // Os bilhetes passam a poder ser levantados 1 dia depois da nova data, mas nunca mais cedo do que antes
    // (antecipar a data não pode encurtar a espera do dinheiro).
    if (moved) {
      await client.query("UPDATE event_tickets SET available_at=GREATEST(available_at, $2::timestamptz + INTERVAL '1 day') WHERE event_id=$1",
        [eventId, next.startsAt.toISOString()]);
      await client.query("DELETE FROM event_reminders_sent WHERE event_id=$1", [eventId]);
    }
    if (moved || relocated) {
      const when = next.startsAt.toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" });
      const change = [moved ? `nova data: ${when}` : null, relocated ? `novo local: ${next.location || "a anunciar"}` : null].filter(Boolean).join("; ");
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text,event_id)
        SELECT DISTINCT people.user_id,$2::int,'event_update',$3::text,$1::int FROM (
          SELECT user_id FROM event_attendees WHERE event_id=$1
          UNION SELECT user_id FROM event_tickets WHERE event_id=$1 AND status='paid' AND refund_status IS NULL
        ) people WHERE people.user_id<>$2::int`,
      [eventId, req.user.id, `O evento «${next.name}» mudou (${change}). Os teus bilhetes continuam válidos.`]);
    }
    return row;
  });
  res.json({ event: updated, notified: moved || relocated });
});

app.delete("/api/events/:eventId", auth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  // Se houver bilhetes vendidos, as estrelas voltam a quem comprou (gatilho da migração 071).
  const result = await transaction(async client => {
    const owned = await client.query(`SELECT e.id FROM events e
      WHERE e.id=$1 AND (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages p WHERE p.id=e.page_id AND p.owner_id=$2)) FOR UPDATE`, [eventId, req.user.id]);
    if (!owned.rowCount) return owned;
    const blocked = await deleteBlockedReason(client, eventId);
    if (blocked) return { blocked };
    return client.query("DELETE FROM events WHERE id=$1 RETURNING id,image_url", [eventId]);
  });
  if (result.blocked) return res.status(409).json({ error: result.blocked });
  if (!result.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
  await removeUpload(result.rows[0].image_url);
  res.json({ deleted: true });
});

// Exportação dos dados pessoais (RGPD, direito de acesso/portabilidade).
// Também usada pela equipa para responder a pedidos de dados (admin-routes.js).
async function buildUserExport(id) {
  const q = (sql, values = [id]) => pool.query(sql, values).then(result => result.rows);
  const [account, posts, comments, likes, messages, friends, following, groups, pages, events, subscriptions, stories,
    audience, stars, starPurchases, promotions, campaigns, payoutAccount, payouts, invitedBy] = await Promise.all([
    q(`SELECT ${OWN_ACCOUNT_FIELDS},created_at FROM users WHERE id=$1`),
    q("SELECT id,body,media_url,media_type,is_exclusive,group_id,page_id,created_at,edited_at FROM posts WHERE user_id=$1 ORDER BY created_at"),
    q("SELECT id,post_id,body,created_at FROM comments WHERE user_id=$1 ORDER BY created_at"),
    q("SELECT post_id FROM likes WHERE user_id=$1"),
    q(`SELECT m.id,s.username AS from_user,r.username AS to_user,m.body,m.created_at
       FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
       WHERE m.sender_id=$1 OR m.receiver_id=$1 ORDER BY m.created_at`),
    q(`SELECT u.username,f.created_at FROM friendships f
       JOIN users u ON u.id=CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END
       WHERE f.user_a_id=$1 OR f.user_b_id=$1`),
    q("SELECT u.username FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=$1"),
    q("SELECT g.id,g.name,m.joined_at FROM group_members m JOIN social_groups g ON g.id=m.group_id WHERE m.user_id=$1"),
    q("SELECT p.id,p.name,f.followed_at FROM page_followers f JOIN pages p ON p.id=f.page_id WHERE f.user_id=$1"),
    q("SELECT e.id,e.name,e.starts_at FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.user_id=$1"),
    q(`SELECT u.username AS creator,s.status,s.current_period_end,s.provider FROM subscriptions s
       JOIN users u ON u.id=s.creator_id WHERE s.subscriber_id=$1`),
    q("SELECT id,body,media_url,created_at,expires_at FROM stories WHERE user_id=$1"),
    q("SELECT province,to_char(birth_date,'YYYY-MM-DD') AS birth_date,show_province_to_brands,partner_since FROM users WHERE id=$1"),
    q(`SELECT l.amount,l.kind,l.post_id,u.username AS other_user,l.created_at FROM star_ledger l
       LEFT JOIN users u ON u.id=l.counterpart_id WHERE l.user_id=$1 ORDER BY l.created_at`),
    q("SELECT stars,amount_kz,status,created_at,paid_at FROM star_purchases WHERE user_id=$1 ORDER BY created_at"),
    q(`SELECT id,post_id,title,body,link_url,budget,spent,status,days,target_provinces,target_min_age,target_max_age,
       paid_at,starts_at,ends_at,review_note,refund_status,created_at FROM ads WHERE owner_id=$1 ORDER BY created_at`),
    q(`SELECT c.title,c.brief,c.budget,c.status,c.created_at,b.username AS brand,k.username AS creator FROM brand_campaigns c
       JOIN users b ON b.id=c.brand_id JOIN users k ON k.id=c.creator_id WHERE c.brand_id=$1 OR c.creator_id=$1 ORDER BY c.created_at`),
    // O IBAN completo não é exportado: só o titular, o banco e os 4 últimos dígitos.
    q("SELECT holder_name,bank_name,iban_last4,updated_at FROM payout_accounts WHERE user_id=$1"),
    q("SELECT amount,bank_name,iban_last4,status,reference,note,created_at,processed_at FROM payout_requests WHERE user_id=$1 ORDER BY created_at"),
    q("SELECT r.username FROM users u JOIN users r ON r.id=u.referred_by WHERE u.id=$1")
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: account[0] || null,
    posts, comments, likes, messages, friends, following, groups, pages, events, subscriptions, stories,
    audience: audience[0] || null,
    invitedBy: invitedBy[0]?.username || null,
    stars, starPurchases, promotions, campaigns,
    payoutAccount: payoutAccount[0] || null,
    payouts
  };
}
app.get("/api/auth/me/export", auth, async (req, res) => {
  const data = await buildUserExport(req.user.id);
  res.set("Content-Disposition", `attachment; filename="tchilar-dados-${data.account?.username || req.user.id}.json"`);
  res.json(data);
});

// Apaga a conta e tudo o que lhe pertence: cancela as subscrições pagas na Stripe e remove os ficheiros.
// Também usada pela equipa para cumprir um pedido de apagamento (admin-routes.js).
async function deleteAccount(userId, profile) {
  const paid = await pool.query(`
    SELECT provider_subscription_id FROM subscriptions
    WHERE (subscriber_id=$1 OR creator_id=$1) AND provider='stripe' AND provider_subscription_id IS NOT NULL
      AND status<>'canceled'`, [userId]);
  if (paid.rowCount && !stripe) {
    return { status: 503, error: "Não é possível cancelar as subscrições pagas agora. Tenta mais tarde." };
  }
  for (const row of paid.rows) {
    try {
      await stripe.subscriptions.cancel(row.provider_subscription_id);
    } catch (error) {
      // Já cancelada/inexistente na Stripe: segue em frente; outro erro impede apagar para não continuar a cobrar.
      if (error?.code !== "resource_missing") {
        console.error("Stripe cancel failed:", error?.code || error?.name);
        return { status: 502, error: "Não foi possível cancelar uma subscrição paga. Tenta novamente." };
      }
    }
  }
  const files = await pool.query(`
    SELECT media_url FROM posts WHERE media_url<>'' AND (
      user_id=$1
      OR group_id IN (SELECT id FROM social_groups WHERE owner_id=$1)
      OR page_id IN (SELECT id FROM pages WHERE owner_id=$1))
    UNION SELECT media_url FROM stories WHERE user_id=$1 AND media_url<>''
    UNION SELECT image_url AS media_url FROM events WHERE image_url<>'' AND (
      creator_id=$1 OR page_id IN (SELECT id FROM pages WHERE owner_id=$1))`, [userId]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await Promise.all([
    ...files.rows.map(row => removeUpload(row.media_url)),
    removeUpload(profile.avatar_url),
    removeUpload(profile.cover_url)
  ]);
  return { deleted: true };
}

// Apagar a conta: exige a palavra-passe, cancela subscrições pagas e remove os ficheiros.
app.delete("/api/auth/me", accountSecurityRateLimit, auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.password !== "string" || !body.password) {
    return res.status(400).json({ error: "Confirma com a tua palavra-passe." });
  }
  const account = await pool.query("SELECT password_hash,avatar_url,cover_url FROM users WHERE id=$1", [req.user.id]);
  if (!account.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  if (!(await bcrypt.compare(body.password, account.rows[0].password_hash))) {
    return res.status(401).json({ error: "Palavra-passe incorreta." });
  }
  const outcome = await deleteAccount(req.user.id, account.rows[0]);
  if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
  res.json({ deleted: true });
});

// Ficheiros que fazem os links do site abrir a app (quando o domínio do site é servido por esta API).
registerAppLinks(app);

// Pré-visualização dos links (WhatsApp, Facebook...). Endereços: a página no site e as fotos na API.
// O endereço da página fica sempre no site: só um perfil, publicação ou curso reconhecido (caminhos /u/, /posts/,
// /academia/) mantém o seu caminho; tudo o resto vai para a página inicial. Assim "/api/share//outro-site.com"
// nunca leva ninguém para fora do Tchilar.
const previewUrls = (pathname, preview) => {
  const siteOrigin = new URL(appUrl).origin;
  const page = preview ? new URL(pathname, siteOrigin) : new URL("/", siteOrigin);
  return { pageUrl: page.origin === siteOrigin ? page.toString() : `${siteOrigin}/`, siteUrl: appUrl, mediaUrl: apiPublicUrl };
};
// Site numa hospedagem à parte (cPanel): o .htaccess manda os robôs para aqui (ex.: /api/share/u/ana).
app.get("/api/share/*path", async (req, res) => {
  const pathname = req.path.slice("/api/share".length) || "/";
  const preview = await findPreview(pool, pathname);
  res.set("Cache-Control", "public, max-age=300").type("html").send(crawlerPage(preview, previewUrls(pathname, preview)));
});

// O servidor entrega também o site, a menos que o site esteja numa hospedagem à parte (SERVE_CLIENT=false).
if ((process.env.NODE_ENV === "production" && process.env.SERVE_CLIENT !== "false") || process.env.SERVE_CLIENT === "true") {
  const clientBuild = path.join(__dirname, "..", "dist");
  app.use(express.static(clientBuild, { index: false }));
  let indexHtml = null;
  app.use(async (req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    try {
      indexHtml ??= await fs.promises.readFile(path.join(clientBuild, "index.html"), "utf8");
      // Perfis, publicações e cursos levam a sua foto e o seu texto; as outras páginas, os do Tchilar.
      const preview = await findPreview(pool, req.path);
      res.set("Cache-Control", "no-cache").type("html").send(injectPreview(indexHtml, preview, previewUrls(req.path, preview)));
    } catch (error) {
      next(error);
    }
  });
}

// Métodos disponíveis e estado de um pagamento por Express/Referência (o ecrã de pagamento vai perguntando).
app.get("/api/payments/methods", (_req, res) => res.json({ methods: payments.methods, upcoming: payments.upcoming, mode: payments.mode }));
app.get("/api/payments/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Pagamento inválido." });
  const result = await payments.status(id, req.user.id);
  if (!result) return res.status(404).json({ error: "Pagamento não encontrado." });
  res.json(result);
});
app.post("/api/payments/:id/simulate", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id || !(await payments.simulateReference(id, req.user.id))) return res.status(404).json({ error: "Simulação indisponível." });
  res.json(await payments.status(id, req.user.id));
});

registerCreatorRoutes(app, {
  pool, auth, optionalAuth, imageUpload, optimizeUpload, removeUpload, parseId,
  isRecord, cleanText, transaction, serializePost, blockedBetween, ACTIVE_SUBSCRIPTION_SQL, payments
});
const growth = registerGrowthRoutes(app, {
  pool, auth, optionalAuth, requireAdmin, parseId, isRecord, cleanText, transaction, blockedBetween, canAccessPost, payments
});
// Chave para cifrar os IBAN dos criadores (obrigatória em produção; ver README).
const payoutKey = loadKey({ payoutKey: process.env.PAYOUT_ENCRYPTION_KEY, jwtSecret: JWT_SECRET, isProduction: !isDevelopment });
registerLiveRoutes(app, { pool, auth, presenceAuth, optionalAuth, parseId, isRecord, cleanText, transaction, blockedBetween, rateLimit: accountSecurityRateLimit });
// Aparelhos com sessão aberta (Definições → Segurança) e sair a sério.
registerSessionRoutes(app, { pool, auth, parseId });

// Grupos por dentro: regras, equipa, convites, fixadas, sondagens, chat, ficheiros, eventos e estatísticas.
const groupActionRateLimit = makeRateLimit("groupAction", {
  windowMs: 60 * 1000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Estás a fazer isto demasiado depressa. Espera um minuto." }
});
registerGroupFeatures(app, {
  pool, auth, optionalAuth, parseId, isRecord, cleanText, transaction, blockedBetween, GROUP_FIELDS, documentUpload,
  signProtectedMedia, removeUpload, parseGroupKind, rateLimit: groupActionRateLimit, imageUpload, optimizeUpload
});

// Chamadas de voz e vídeo nos grupos (até 8 pessoas, ligações diretas; TURN dos diretos se houver).
registerGroupCalls(app, { pool, auth, parseId, isRecord, transaction, turnServer, reachAllowed, blockedBetween, rateLimit: groupActionRateLimit });

// Academia: cursos à venda (criadores 85%, equipa revê).
registerCourseRoutes(app, {
  pool, auth, optionalAuth, requireRole, parseId, isRecord, cleanText, transaction, payments,
  upload, imageUpload, optimizeUpload, removeUpload, signMedia: signProtectedMedia
});

// Notificações push para a app (via Expo). O envio só arranca em startServer (os testes não enviam nada).
// Avisos no browser: precisam das chaves VAPID (npx web-push generate-vapid-keys). Sem elas, só a app recebe push.
const webPush = createWebPushSender({ publicKey: process.env.WEB_PUSH_PUBLIC_KEY, privateKey: process.env.WEB_PUSH_PRIVATE_KEY, subject: process.env.WEB_PUSH_SUBJECT });
const push = createPush({ pool, accessToken: process.env.EXPO_ACCESS_TOKEN || "", webPush });
push.registerRoutes(app, { auth, isRecord });

const music = registerMusicRoutes(app, { pool, auth, optionalAuth, requireAdmin: requireRole("moderation"), parseId, isRecord, uploadDir, removeUpload, rateLimit: options => makeRateLimit("music", options) });
registerFinanceRoutes(app, { pool, auth, requireRole, parseId, isRecord, cleanText, transaction, payments, payoutKey });
registerHomeRoutes(app, { pool, auth, blockedBetween });
registerPaymentRoutes(app, { pool, auth, requireAdmin: requireRole("finance"), parseId });
registerAdminRoutes(app, { pool, auth, requireAdmin, requireRole, parseId, cleanText, transaction });
registerAdminOperations(app, {
  pool, auth, requireAdmin, requireRole, parseId, cleanText, isRecord, transaction, payments, payoutKey,
  buildUserExport, deleteAccount, emailQueue
});

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? `O ficheiro excede o limite de ${_req.path.startsWith("/api/music") ? "15" : "100"} MB.`
        : "Não foi possível processar o ficheiro enviado."
    });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "O corpo do pedido contém JSON inválido." });
  }
  if (error.message === "Formato de ficheiro não suportado.") {
    return res.status(415).json({ error: error.message });
  }
  // Referência curta para cruzar a queixa de quem usa com o registo do servidor.
  // Regista a rota sem a query (pode ter tokens de acesso), a conta e a pilha completa.
  const reference = crypto.randomBytes(4).toString("hex");
  console.error(JSON.stringify({
    level: "error",
    at: new Date().toISOString(),
    reference,
    method: _req.method,
    route: _req.route?.path || _req.path,
    path: _req.path,
    userId: _req.user?.id || null,
    code: error.code || null,
    message: error.message,
    stack: error.stack
  }));
  res.status(500).json({ error: `Ocorreu um erro interno. Tenta novamente mais tarde (referência ${reference}).`, reference });
});

// Erros fora dos pedidos (intervalos, webhooks em segundo plano): ficam registados com a pilha.
process.on("unhandledRejection", (/** @type {any} */ reason) => {
  console.error(JSON.stringify({ level: "error", at: new Date().toISOString(), kind: "unhandledRejection",
    message: reason?.message || String(reason), stack: reason?.stack || null }));
});

async function startServer() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não está definido. Configura o ficheiro .env.");
  }
  if (!JWT_SECRET || JWT_SECRET.length < 32
    || JWT_SECRET === "change_this_secret"
    || JWT_SECRET === "replace_with_a_random_secret_at_least_32_characters") {
    throw new Error("JWT_SECRET tem de ser uma chave aleatória com pelo menos 32 caracteres.");
  }
  if (process.env.SMTP_HOST && !process.env.SMTP_FROM) {
    throw new Error("SMTP_FROM é obrigatório quando SMTP_HOST está configurado.");
  }
  if (!isDevelopment && (!mailTransport || !process.env.SMTP_FROM || !process.env.APP_URL)) {
    throw new Error("Fora de NODE_ENV=development, configura SMTP_HOST, SMTP_FROM e APP_URL para confirmação e recuperação de conta.");
  }
  if (!isDevelopment && !process.env.PAYOUT_ENCRYPTION_KEY) {
    throw new Error("Fora de NODE_ENV=development, define PAYOUT_ENCRYPTION_KEY (32 bytes) para cifrar os dados bancários dos criadores.");
  }
  if (!isDevelopment && redotpay && redotpay.environment !== "production") {
    throw new Error("Fora de NODE_ENV=development, REDOTPAY_ENV tem de ser production.");
  }
  // Uma ProxyPay em sandbox aceita pagamentos falsos: fora de desenvolvimento, isso daria estrelas
  // (levantáveis) sem dinheiro real. O mesmo vale para chaves de teste da Stripe.
  if (!isDevelopment && proxypay && proxypay.environment !== "production") {
    throw new Error("Fora de NODE_ENV=development, PROXYPAY_ENV tem de ser production (o sandbox aceita pagamentos falsos).");
  }
  if (!isDevelopment && /^sk_test_/.test(process.env.STRIPE_SECRET_KEY || "")) {
    throw new Error("Fora de NODE_ENV=development, STRIPE_SECRET_KEY não pode ser uma chave de teste (sk_test_).");
  }
  if (stripe && !stripeWebhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET é obrigatório quando STRIPE_SECRET_KEY está configurado.");
  }
  if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
    throw new Error("CLIENT_URL tem de conter a origem pública do frontend.");
  }
  try {
    new URL(appUrl);
  } catch {
    throw new Error("APP_URL deve ser um URL absoluto válido.");
  }
  await initDb();
  if (process.env.PUSH_NOTIFICATIONS !== "false") push.start();
  emailQueue.start();
  // Aviso de renovação das subscrições pagas mês a mês (3 dias antes do fim), de hora a hora.
  const renewals = () => localSubscriptions.remindRenewals().catch(error => console.error("Avisos de renovação:", error.message));
  renewals();
  setInterval(renewals, 60 * 60 * 1000).unref();
  // Lembretes dos eventos (1 dia e 1 hora antes), de 10 em 10 minutos.
  const reminders = () => sendEventReminders({ pool, transaction }).catch(error => console.error("Lembretes de eventos:", error.message));
  reminders();
  setInterval(reminders, 10 * 60 * 1000).unref();
  // Desafios do mês automáticos (CHALLENGES_AUTO=false desliga: a equipa lança à mão).
  if (process.env.CHALLENGES_AUTO !== "false") {
    const monthly = () => launchMonthlyChallenges({ pool, transaction })
      .then(created => { if (created.length) console.log(`Desafios do mês lançados: ${created.length}`); })
      .catch(error => console.error("Desafios do mês:", error.message));
    monthly();
    setInterval(monthly, 60 * 60 * 1000).unref();
  }
  if (proxypay) {
    const timer = setInterval(() => payments.pollProxyPay().catch(error => console.error("ProxyPay poll:", error.message)), 60_000);
    timer.unref();
  }
  return app.listen(PORT, () => console.log(`API: http://localhost:${PORT}`));
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("Backend startup failed:", error.message);
    pool.end().finally(() => { process.exitCode = 1; });
  });
}

module.exports = { app, initDb, launchMonthlyChallenges: () => launchMonthlyChallenges({ pool, transaction }), payments, pool,
  sendEventReminders: () => sendEventReminders({ pool, transaction }), sms, startServer };
