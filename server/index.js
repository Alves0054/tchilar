require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
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
const { registerAdminRoutes } = require("./admin-routes");
const { registerAdminOperations } = require("./admin-operations");
const { registerLiveRoutes, turnServer } = require("./live-routes");
const { registerGroupCalls } = require("./group-calls");
const { createPayments } = require("./payments");
const { resolvePromotionCode } = require("./promotion-codes");
const { createPaybyrd, createProxyPay } = require("./angola-payments");
const { PHONE_ERROR, parsePhoneNumber } = require("./phones");
const { createSms } = require("./sms");
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
const { loadKey } = require("./payouts");
const { canReach, readPreferences } = require("./preferences");
const { registerMusicRoutes } = require("./music-routes");
const { createPush, createWebPushSender } = require("./push");
const { registerCourseRoutes } = require("./courses");
const { registerAppLinks } = require("./app-links");
const { crawlerPage, findPreview, injectPreview } = require("./link-preview");
const { registerLocalSubscriptions } = require("./local-subscriptions");
const { SESSION_IDLE_DAYS, registerSessionRoutes, touchSession, validSession } = require("./sessions");
const { DOCUMENT_TYPES, registerGroupFeatures } = require("./group-features");
const { parseGroupKind } = require("./community-types");
const QRCode = require("qrcode");
const { registerEventTickets } = require("./event-tickets");
const { registerWebhookRoutes } = require("./webhook-routes");
const { registerAccountRoutes } = require("./account-routes");
const { registerSocialRoutes } = require("./social-routes");
const { registerGroupRoutes } = require("./group-routes");
const { groupDate, maintainGroupAccess, nextPeriodEnd } = require("./groups");
const { registerPageRoutes } = require("./page-routes");
const { registerEventRoutes } = require("./event-routes");
const { registerMessageRoutes } = require("./message-routes");
const { registerReportRoutes } = require("./report-routes");
const { registerPostRoutes } = require("./post-routes");
const { blockedBetween } = require("./moderation");
const {
  ACTIVE_SUBSCRIPTION_SQL,
  mapStripeStatus,
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
// Chave para cifrar os IBAN dos criadores e os segredos dos dois passos (obrigatória em produção; ver README).
const payoutKey = loadKey({ payoutKey: process.env.PAYOUT_ENCRYPTION_KEY, jwtSecret: JWT_SECRET, isProduction: !isDevelopment });
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
// Ações de segurança com sessão iniciada (mudar palavra-passe, 2FA): limite próprio, para não gastar
// as tentativas de login. 20 em 15 min chega para uso normal e torna inútil adivinhar códigos de 6 dígitos.
const accountSecurityRateLimit = makeRateLimit("accountSecurity", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas tentativas. Tenta novamente daqui a 15 minutos." }
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

registerWebhookRoutes(app, {
  appUrl, applyStripeSubscription, parseId, payments, paypay, proxypay, redotpay, stripe, stripeWebhookSecret
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

registerAccountRoutes(app, {
  JWT_SECRET, OWN_ACCOUNT_FIELDS, accountSecurityRateLimit, appUrl, auth, buildUserExport, cleanText,
  deleteAccount, emailQueue, isDevelopment, isRecord, mailTransport, normalizeWebsite, parseCoverPosition,
  parsePhone, payoutKey, pool, sms, transaction
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
// Texto para ILIKE: escapa % e _ para procurarem o próprio carácter.
const likePattern = value => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

// ----- Pesquisa -----
// Texto de pesquisa: 1 a 100 caracteres. undefined → null (sem filtro); inválido → null também, quem chama decide.
function searchTerm(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim();
  return value.length >= 1 && value.length <= 100 ? value : null;
}
// Hashtag: letras (com acentos), números e _, até 50. Só estes caracteres entram na expressão regular.
function parseHashtag(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^#/, "");
  return /^[\p{L}\p{N}_]{1,50}$/u.test(value) ? value : null;
}

registerSocialRoutes(app, {
  BLOCKED_ERROR, appUrl, applyStripeSubscription, auth, isBlocked, isRecord, likePattern, localSubscriptions,
  optionalAuth, parseHashtag, parseId, payments, pool, searchTerm, stripe, subscriptionCurrency, transaction
});

// Campos de um grupo vistos por quem não é membro (sem a lista de membros dos grupos secretos).
const GROUP_FIELDS = `g.id,g.name,g.description,g.created_at,g.is_secret,g.access_price::float AS access_price,g.access_billing,
  g.group_type,g.category,g.subcategory,g.requires_approval,g.invite_only,g.rules,
  u.username AS owner_username,u.display_name AS owner_name,u.avatar_url AS owner_avatar,
  (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
  (SELECT COUNT(*) FROM posts po WHERE po.group_id=g.id AND po.hidden_at IS NULL)::int AS post_count`;

registerGroupRoutes(app, {
  GROUP_FIELDS, auth, cleanText, isRecord, optionalAuth, parseId, payments, pool, removeUpload, transaction
});

// Pagamento confirmado: a pessoa passa a membro (se o grupo ainda existir) e o dono é avisado.
payments.register("group_access", async (purchaseId, details) => {
  await transaction(async client => {
    const purchase = await client.query(
      `UPDATE group_access_purchases SET status='paid', paid_at=NOW(), stripe_payment_intent=$2
       WHERE id=$1 AND status='pending' RETURNING group_id,user_id,owner_id,billing`,
      [purchaseId, details.paymentIntent || null]);
    const paid = purchase.rows[0];
    if (!paid?.group_id) return;
    if (paid.billing === "monthly") {
      // Um mês de acesso: soma 30 dias ao que ainda falta (renovar cedo não faz perder dias).
      const current = (await client.query("SELECT role,access_until FROM group_members WHERE group_id=$1 AND user_id=$2 FOR UPDATE",
        [paid.group_id, paid.user_id])).rows[0];
      if (current && current.role !== "member") return;
      const end = nextPeriodEnd(current?.access_until || null);
      await client.query(`INSERT INTO group_members(group_id,user_id,access_until) VALUES($1,$2,$3)
        ON CONFLICT (group_id,user_id) DO UPDATE SET access_until=EXCLUDED.access_until, renewal_reminded_at=NULL`,
      [paid.group_id, paid.user_id, end]);
      await client.query("UPDATE group_access_purchases SET period_end=$2 WHERE id=$1", [purchaseId, end]);
      const name = (await client.query("SELECT name FROM social_groups WHERE id=$1", [paid.group_id])).rows[0]?.name || "grupo";
      await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)",
        [paid.user_id, paid.owner_id, `O teu acesso ao grupo «${name}» está ativo até ${groupDate(end)}.`]);
      if (paid.owner_id && paid.owner_id !== paid.user_id) {
        await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)", [paid.owner_id, paid.user_id,
          current ? "Renovou a mensalidade do teu grupo secreto. Os teus 80% já estão no saldo." : "Pagou a mensalidade e juntou-se ao teu grupo secreto."]);
      }
      return;
    }
    await client.query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [paid.group_id, paid.user_id]);
    if (paid.owner_id && paid.owner_id !== paid.user_id) {
      await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join','Pagou a entrada e juntou-se ao teu grupo secreto.')",
        [paid.owner_id, paid.user_id]);
    }
  });
});

registerPageRoutes(app, {
  auth, cleanText, imageUpload, isRecord, normalizeWebsite, optionalAuth, parseCoverPosition, parseId,
  parsePhone, pool, removeUpload, transaction
});

registerEventRoutes(app, {
  auth, cleanText, imageUpload, isRecord, optionalAuth, parseId, pool, removeUpload, transaction
});

registerEventTickets(app, { pool, auth, parseId, isRecord, transaction, blockedBetween, appUrl, payments, secret: JWT_SECRET, apiUrl: apiPublicUrl,
  emailQueue: mailTransport ? emailQueue : null });

registerMessageRoutes(app, {
  BLOCKED_ERROR, auth, cleanText, isBlocked, isRecord, parseId, pool, reachAllowed, transaction
});

registerReportRoutes(app, {
  auth, isRecord, parseId, pool, requireRole, transaction
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

registerPostRoutes(app, {
  JWT_SECRET, auth, canAccessPost, cleanText, growth, isRecord, likePattern, music, optionalAuth, parseHashtag,
  parseId, pool, reachAllowed, removeUpload, searchTerm, serializePost, transaction, upload
});
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
  // Grupos secretos mensais: aviso 3 dias antes do fim e saída de quem não renovou, de 10 em 10 minutos.
  const groupAccess = () => maintainGroupAccess({ pool }).catch(error => console.error("Acesso aos grupos mensais:", error.message));
  groupAccess();
  setInterval(groupAccess, 10 * 60 * 1000).unref();
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
