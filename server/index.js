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
const { rateLimit } = require("express-rate-limit");
const helmet = require("helmet");
const Stripe = require("stripe");
const { runMigrations } = require("./migrate");
const { optimizeUpload } = require("./images");
const { activatePaidAd, registerCreatorRoutes } = require("./creator-routes");
const { registerGrowthRoutes } = require("./growth-routes");
const { registerLiveRoutes } = require("./live-routes");
const { createPayments } = require("./payments");
const { createPaybyrd, createProxyPay } = require("./angola-payments");
const { registerFinanceRoutes } = require("./finance-routes");
const { decrypt, encrypt, loadKey } = require("./payouts");
const { generateSecret, otpauthUri, verifyCode } = require("./totp");
const { parseVideoEdit } = require("./video-edit");
const QRCode = require("qrcode");
const { MODERATION_ACTIONS, REPORT_REASONS, blockedBetween, shouldAutoHide } = require("./moderation");
const {
  ACTIVE_SUBSCRIPTION_SQL,
  DEMO_PERIOD_DAYS,
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
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas tentativas. Tenta novamente mais tarde." }
});
// Ações de segurança com sessão iniciada (mudar palavra-passe, 2FA): limite próprio, para não gastar
// as tentativas de login. 20 em 15 min chega para uso normal e torna inútil adivinhar códigos de 6 dígitos.
const accountSecurityRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas tentativas. Tenta novamente daqui a 15 minutos." }
});
const recoveryRateLimit = rateLimit({
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
const payments = createPayments({ stripe, isProduction: !demoPayments, appUrl, currency: subscriptionCurrency, pool, proxypay, paybyrd, allowSimulation: demoPayments });
payments.register("ad", (adId, details) => activatePaidAd(pool, adId, details));

// Atrás do nginx (ou outro proxy), o IP real vem em X-Forwarded-For. Sem isto, os limites de tentativas
// contariam todas as pessoas como uma só (o IP do proxy). TRUST_PROXY = número de proxies à frente.
if (Number(process.env.TRUST_PROXY) > 0) app.set("trust proxy", Number(process.env.TRUST_PROXY));

// Cabeçalhos de segurança. A CSP só deixa correr scripts do próprio site: mesmo que alguém consiga
// injetar HTML, o browser recusa executar código vindo de outro lado.
const apiOrigin = (() => {
  try { return process.env.VITE_API_URL ? new URL(process.env.VITE_API_URL).origin : null; } catch { return null; }
})();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", ...(apiOrigin ? [apiOrigin] : [])],
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

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

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

// Campos da própria conta devolvidos ao cliente (nunca inclui password_hash nem auth_version).
const OWN_ACCOUNT_FIELDS = "id,username,email,display_name,bio,avatar_url,cover_url,cover_position,location,website,profession,is_creator,subscription_price,email_verified,is_admin";

// Apaga um ficheiro de /uploads de forma segura (ignora valores vazios e ficheiros já removidos).
async function removeUpload(mediaUrl) {
  if (typeof mediaUrl !== "string" || !mediaUrl.startsWith("/uploads/")) return;
  try {
    await fs.promises.unlink(path.join(uploadDir, path.basename(mediaUrl)));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not remove upload:", error.code || error.name);
  }
}

async function initDb() {
  await runMigrations(pool);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, maxLength) {
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
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Só a equipa de moderação pode aceder." });
  pool.query("SELECT totp_enabled_at FROM users WHERE id=$1", [req.user.id]).then(result => {
    if (!result.rows[0]?.totp_enabled_at) {
      return res.status(403).json({ error: "Ativa a verificação em dois passos nas Definições para usar o painel de administração.", twoFactorSetupRequired: true });
    }
    next();
  }).catch(next);
}

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, version: Number(user.auth_version || 0) },
    JWT_SECRET,
    { expiresIn: "12h" });
}

// Regras para palavras-passe NOVAS (registo, recuperação, mudança). As já existentes continuam a funcionar.
// O bcrypt só lê os primeiros 72 bytes, por isso recusamos mais do que isso em vez de cortar em silêncio.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "12341234", "87654321", "11111111", "00000000",
  "password", "password1", "palavrapasse", "qwertyuiop", "abcdefgh", "iloveyou", "angola123", "biva1234"
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
  const subject = purpose === "verify_email" ? "Confirma o teu email — Biva" : "Redefine a palavra-passe — Biva";
  const instruction = purpose === "verify_email"
    ? "Confirma o teu endereço de email"
    : "Redefine a tua palavra-passe";
  await mailTransport.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject,
    text: `${instruction} através desta ligação (válida por 1 hora): ${url.toString()}`
  });
  return null;
}

function signMedia(filename) {
  const access = jwt.sign({ purpose: "media", filename }, JWT_SECRET, { expiresIn: "15m" });
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
      shared_username, shared_display_name, shared_avatar_url, shared_visible, ...rest
    } = post;
    // Só publicações públicas podem ser partilhadas, por isso o ficheiro não precisa de assinatura.
    post = {
      ...rest,
      shared: shared_visible ? {
        id: shared_id, body: shared_body, media_url: shared_media_url, media_type: shared_media_type,
        created_at: shared_created_at, username: shared_username, display_name: shared_display_name, avatar_url: shared_avatar_url
      } : { unavailable: true }
    };
  } else if ("shared_id" in post) {
    const { shared_id, shared_body, shared_media_url, shared_media_type, shared_created_at,
      shared_username, shared_display_name, shared_avatar_url, shared_visible, ...rest } = post;
    post = rest;
  }
  return {
    ...post,
    media_url: post.media_url && (post.is_exclusive || post.group_id)
      ? signMedia(path.basename(post.media_url))
      : post.media_url
  };
}

const SESSION_SQL = "SELECT auth_version,suspended_at,is_admin FROM users WHERE id=$1";

function auth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Autenticação necessária." });
  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
  pool.query(SESSION_SQL, [claims.id]).then(result => {
    if (!result.rowCount || Number(result.rows[0].auth_version) !== Number(claims.version || 0)) {
      return res.status(401).json({ error: "Sessão inválida ou expirada." });
    }
    if (result.rows[0].suspended_at) {
      return res.status(403).json({ error: "A tua conta está suspensa. Contacta a equipa do Biva." });
    }
    req.user = { ...claims, isAdmin: result.rows[0].is_admin === true };
    next();
  }).catch(next);
}

function optionalAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) {
    let claims;
    try {
      claims = jwt.verify(authorization.slice(7), JWT_SECRET);
    } catch {
      return next();
    }
    return pool.query(SESSION_SQL, [claims.id]).then(result => {
      if (result.rowCount && Number(result.rows[0].auth_version) === Number(claims.version || 0) && !result.rows[0].suspended_at) {
        req.user = { ...claims, isAdmin: result.rows[0].is_admin === true };
      }
      next();
    }).catch(next);
  }
  next();
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "biva" }));

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
        const profileImage = await pool.query(
          `SELECT 1 FROM users WHERE avatar_url=$1 OR cover_url=$1
           UNION ALL SELECT 1 FROM ads WHERE image_url=$1 LIMIT 1`,
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
        access = jwt.verify(String(req.query.access || ""), JWT_SECRET);
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
          const access = jwt.verify(String(req.query.access), JWT_SECRET);
          permitted = access.purpose === "media" && access.filename === filename;
        } catch {
          permitted = false;
        }
      }
      if (!permitted) return res.status(403).json({ error: "Não tens acesso a este ficheiro." });
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.sendFile(path.join(uploadDir, filename), { dotfiles: "deny" }, error => {
      if (error) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", authRateLimit, async (req, res) => {
  try {
    const body = isRecord(req.body) ? req.body : {};
    const username = cleanText(body.username, 40).toLowerCase();
    const email = cleanText(body.email, 160).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = cleanText(body.displayName, 100);
    const isCreator = body.isCreator === true;
    const subscriptionPrice = body.subscriptionPrice === undefined || body.subscriptionPrice === 0
      ? 0
      : parseSubscriptionPrice(body.subscriptionPrice);
    if (!/^[a-z0-9._]{3,40}$/.test(username)) {
      return res.status(400).json({ error: "O username deve ter 3 a 40 caracteres: letras, números, ponto ou underscore." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Indica um email válido." });
    if (!displayName) return res.status(400).json({ error: "O nome público é obrigatório." });
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
    const hash = await bcrypt.hash(password, 12);
    // Convite: o nome de utilizador de quem convidou (opcional; ignorado se não existir).
    const invite = typeof body.invite === "string" ? body.invite.trim().toLowerCase().slice(0, 40) : "";
    const referrer = invite ? await pool.query("SELECT id FROM users WHERE username=$1", [invite]) : { rows: [] };
    const result = await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name,is_creator,subscription_price,email_verified,referred_by)
       VALUES($1,$2,$3,$4,$5,$6,FALSE,$7) RETURNING id,username,email,display_name,is_creator,subscription_price,email_verified`,
      [username.toLowerCase(), email.toLowerCase(), hash, displayName, isCreator, subscriptionPrice, referrer.rows[0]?.id || null]
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

const usernameCheckRateLimit = rateLimit({
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

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const email = cleanText(body.email, 160).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email e palavra-passe são obrigatórios." });
  const result = await pool.query(`
    SELECT ${OWN_ACCOUNT_FIELDS},auth_version,password_hash,suspended_at,totp_secret,totp_enabled_at,totp_last_step
    FROM users WHERE email=$1`, [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  delete user.password_hash;
  if (user.suspended_at) {
    return res.status(403).json({ error: "A tua conta está suspensa. Contacta a equipa do Biva." });
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
  res.json({ user, token: sign(user) });
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

app.get("/api/auth/me", auth, async (req, res) => {
  const r = await pool.query(`SELECT ${OWN_ACCOUNT_FIELDS} FROM users WHERE id=$1`, [req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: r.rows[0] });
});

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
  res.json({ token: sign(updated.rows[0]), message: "Palavra-passe alterada. As outras sessões foram terminadas." });
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
  res.json({ token: sign(updated.rows[0]), message: "Sessão terminada em todos os outros dispositivos." });
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

app.patch("/api/auth/me", auth, async (req, res) => {
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
  const hasExtra = [location.value, profession.value, website].some(value => value !== undefined);
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
  const result = await pool.query(`
    UPDATE users SET display_name=COALESCE($1,display_name),bio=COALESCE($2,bio),
      subscription_price=COALESCE($3,subscription_price),
      location=COALESCE($5,location),profession=COALESCE($6,profession),website=COALESCE($7,website)
    WHERE id=$4
    RETURNING ${OWN_ACCOUNT_FIELDS}`,
  [hasDisplayName ? body.displayName.trim() : null, hasBio ? body.bio.trim() : null, subscriptionPrice, req.user.id,
    location.value ?? null, profession.value ?? null, website ?? null]);
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
app.patch("/api/auth/me/cover-position", auth, async (req, res) => {
  const position = parseCoverPosition(req.body?.position);
  if (req.body?.position === undefined || position === null) return res.status(400).json({ error: "Posição da capa inválida." });
  const result = await pool.query(
    `UPDATE users SET cover_position=$1 WHERE id=$2 RETURNING ${OWN_ACCOUNT_FIELDS}`, [position, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: result.rows[0] });
});

app.get("/api/posts", optionalAuth, async (req, res) => {
  const currentUser = req.user?.id || 0;
  const rawUsername = req.query.username;
  const username = typeof rawUsername === "string" ? rawUsername.trim() : null;
  const rawGroupId = req.query.groupId;
  const rawPageId = req.query.pageId;
  const rawMediaType = req.query.mediaType;
  const groupId = rawGroupId === undefined ? null : parseId(rawGroupId);
  const pageId = rawPageId === undefined ? null : parseId(rawPageId);
  const mediaType = rawMediaType === undefined ? null : rawMediaType;
  // feed=following: só eu, amigos, quem sigo, páginas que sigo e grupos onde estou.
  const scope = req.query.feed === undefined ? "all" : req.query.feed;
  const before = req.query.before === undefined ? null : parseId(req.query.before);
  const limit = 20;
  if (!["all", "following"].includes(scope) || (req.query.before !== undefined && !before)) {
    return res.status(400).json({ error: "Filtro de publicações inválido." });
  }
  if (scope === "following" && !req.user) {
    return res.status(401).json({ error: "Entra na tua conta para ver o feed de quem segues." });
  }
  if ((rawUsername !== undefined && (typeof rawUsername !== "string" || !username || username.length > 40))
    || (rawGroupId !== undefined && (typeof rawGroupId !== "string" || !groupId))
    || (rawPageId !== undefined && (typeof rawPageId !== "string" || !pageId))
    || (rawMediaType !== undefined && (typeof rawMediaType !== "string" || !["image", "video"].includes(mediaType)))) {
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
    SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_creator, u.partner_since IS NOT NULL AS is_verified,
      (SELECT COALESCE(SUM(st.amount),0) FROM star_ledger st WHERE st.post_id=p.id AND st.kind='gift_received')::int AS stars,
      g.name AS group_name, pg.name AS page_name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments,
      (SELECT COUNT(*) FROM posts sh WHERE sh.shared_post_id=p.id) AS shares,
      sp.id AS shared_id, sp.body AS shared_body, sp.media_url AS shared_media_url, sp.media_type AS shared_media_type,
      sp.created_at AS shared_created_at, su.username AS shared_username, su.display_name AS shared_display_name,
      su.avatar_url AS shared_avatar_url,
      (sp.id IS NOT NULL AND sp.hidden_at IS NULL AND NOT ${blockedBetween("$1", "sp.user_id")}) AS shared_visible
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN social_groups g ON g.id=p.group_id
    LEFT JOIN pages pg ON pg.id=p.page_id
    LEFT JOIN posts sp ON sp.id=p.shared_post_id
    LEFT JOIN users su ON su.id=sp.user_id
    WHERE ($2::text IS NULL OR u.username=$2)
      AND ($3::int IS NULL OR p.group_id=$3)
      AND ($4::int IS NULL OR p.page_id=$4)
      AND ($5::text IS NULL OR p.media_type=$5)
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
    ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit}
  `, [currentUser, username, groupId, pageId, mediaType, scope, before]);
  res.json({
    posts: r.rows.map(serializePost),
    nextCursor: r.rows.length === limit ? r.rows[r.rows.length - 1].id : null
  });
});

app.get("/api/stories", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT s.id,s.user_id,s.body,s.media_url,s.media_type,s.created_at,s.expires_at,
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
  const body = cleanText(bodyData.body, 500);
  if (body.length > 500) return res.status(400).json({ error: "O story não pode exceder 500 caracteres." });
  if (!body && !req.file) return res.status(400).json({ error: "Escreve uma mensagem ou escolhe uma fotografia." });

  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : "";
  const mediaType = req.file?.mimetype?.startsWith("video") ? "video" : req.file ? "image" : "";
  const result = await pool.query(`
    INSERT INTO stories(user_id,body,media_url,media_type)
    VALUES($1,$2,$3,$4)
    RETURNING id,user_id,body,media_url,media_type,created_at,expires_at
  `, [req.user.id, body, mediaUrl, mediaType]);
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
  const body = cleanText(bodyData.body, 5000);
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
  const access = await canAccessPost(id, req.user.id);
  if (!access.exists) return res.status(404).json({ error: "Publicação não encontrada." });
  if (!access.allowed) return res.status(403).json({ error: "Não tens acesso a esta publicação." });
  const liked = await transaction(async client => {
    const removed = await client.query(
      "DELETE FROM likes WHERE user_id=$1 AND post_id=$2 RETURNING post_id",
      [req.user.id, id]);
    if (removed.rowCount) return false;
    const inserted = await client.query(
      "INSERT INTO likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id",
      [req.user.id, id]);
    if (inserted.rowCount && access.post.user_id !== req.user.id) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'like','Gostou da tua publicação.')`, [access.post.user_id, req.user.id]);
    }
    return true;
  });
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM likes WHERE post_id=$1", [id]);
  res.json({ liked, likes: count.rows[0].count });
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
  const comment = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO comments(user_id,post_id,body) VALUES($1,$2,$3)
      RETURNING id,body,created_at`, [req.user.id, id, body]);
    if (access.post.user_id !== req.user.id) {
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'comment','Comentou na tua publicação.')`, [access.post.user_id, req.user.id]);
    }
    return result.rows[0];
  });
  res.status(201).json({ comment });
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
      SELECT u.id,u.username,u.display_name,u.avatar_url
      FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END
      WHERE f.user_a_id=$1 OR f.user_b_id=$1
      ORDER BY u.display_name`, [req.user.id]),
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
      u.is_creator,u.subscription_price,u.created_at,u.partner_since IS NOT NULL AS is_verified,
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
      s.current_period_end AS subscription_period_end,
      s.cancel_at_period_end AS subscription_canceling,
      (s.subscriber_id IS NOT NULL AND ${ACTIVE_SUBSCRIPTION_SQL}) AS is_subscribed
    FROM users u
    LEFT JOIN subscriptions s ON s.creator_id=u.id AND s.subscriber_id=$2
    WHERE u.username=$1`, [req.params.username, req.user?.id || 0]);
  // Quem me bloqueou ou está suspenso aparece como inexistente.
  if (!r.rows[0] || r.rows[0].blocked_me || r.rows[0].suspended) return res.status(404).json({ error: "Utilizador não encontrado." });
  const { blocked_me: _blockedMe, suspended: _suspended, ...user } = r.rows[0];
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
        (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id)::int AS likes,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id)::int AS comments
      FROM posts p WHERE p.user_id=$1
      ORDER BY (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) + 2 * (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) DESC, p.created_at DESC
      LIMIT 5`, [id]),
    pool.query(`
      SELECT u.is_creator,u.subscription_price,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL})::int AS active_subscribers,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL} AND s.provider='stripe')::int AS paying_subscribers,
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
      // Estimativa bruta: assinantes pagos × preço atual (antes de taxas da Stripe e impostos).
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

app.post("/api/subscriptions/:creatorId", auth, async (req, res) => {
  const creatorId = parseId(req.params.creatorId);
  if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
  if (await isBlocked(req.user.id, creatorId)) return res.status(403).json({ error: BLOCKED_ERROR });
  if (!stripe && !demoPayments) {
    return res.status(503).json({ error: "Os pagamentos ainda não estão disponíveis." });
  }
  const [creatorResult, subscriberResult, existingResult] = await Promise.all([
    pool.query("SELECT id,username,display_name,is_creator,subscription_price FROM users WHERE id=$1", [creatorId]),
    pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]),
    pool.query(`
      SELECT s.provider,s.provider_subscription_id,s.cancel_at_period_end,(${ACTIVE_SUBSCRIPTION_SQL}) AS active
      FROM subscriptions s WHERE s.subscriber_id=$1 AND s.creator_id=$2`, [req.user.id, creatorId])
  ]);
  const creator = creatorResult.rows[0];
  if (!creator || !creator.is_creator) return res.status(404).json({ error: "Criador não encontrado." });
  const price = Number(creator.subscription_price);
  if (!(price >= MIN_PRICE)) return res.status(409).json({ error: "Este criador ainda não definiu um preço de subscrição." });

  const existing = existingResult.rows[0];
  if (existing?.active) {
    if (!existing.cancel_at_period_end) return res.status(409).json({ error: "Já tens uma subscrição ativa." });
    // Retomar uma subscrição que ia terminar no fim do período.
    if (existing.provider === "stripe") {
      await applyStripeSubscription(await stripe.subscriptions.update(existing.provider_subscription_id, { cancel_at_period_end: false }));
    } else {
      await pool.query(
        "UPDATE subscriptions SET cancel_at_period_end=FALSE,updated_at=NOW() WHERE subscriber_id=$1 AND creator_id=$2",
        [req.user.id, creatorId]);
    }
    return res.json({ subscribed: true, message: "A tua subscrição vai continuar a renovar." });
  }

  if (!stripe) {
    await pool.query(`
      INSERT INTO subscriptions(subscriber_id,creator_id,status,current_period_end,cancel_at_period_end,provider,provider_subscription_id,updated_at)
      VALUES($1,$2,'active',NOW() + make_interval(days => $3::int),FALSE,'demo',NULL,NOW())
      ON CONFLICT(subscriber_id,creator_id) DO UPDATE SET
        status='active',current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=FALSE,
        provider='demo',provider_subscription_id=NULL,updated_at=NOW()`,
    [req.user.id, creatorId, DEMO_PERIOD_DAYS]);
    return res.json({ subscribed: true, demo: true, message: `Subscrição de demonstração ativa durante ${DEMO_PERIOD_DAYS} dias (sem pagamento).` });
  }

  const metadata = { subscriber_id: String(req.user.id), creator_id: String(creatorId) };
  const profileUrl = new URL(`/u/${encodeURIComponent(creator.username)}`, appUrl);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: subscriberResult.rows[0]?.email,
    client_reference_id: String(req.user.id),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: subscriptionCurrency,
        unit_amount: Math.round(price * 100),
        recurring: { interval: "month" },
        product_data: { name: `Subscrição de ${creator.display_name} no Biva` }
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

app.get("/api/groups", optionalAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT g.id,g.name,g.description,g.created_at,u.username AS owner_username,
      u.display_name AS owner_name,u.avatar_url AS owner_avatar,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
      (SELECT COUNT(*) FROM posts po WHERE po.group_id=g.id AND po.hidden_at IS NULL)::int AS post_count,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
        SELECT mu.username, mu.display_name, mu.avatar_url FROM group_members m JOIN users mu ON mu.id=m.user_id
        WHERE m.group_id=g.id ORDER BY m.joined_at LIMIT 5) x) AS member_preview,
      EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS is_member
    FROM social_groups g JOIN users u ON u.id=g.owner_id
    ORDER BY g.created_at DESC LIMIT 100`, [req.user?.id || 0]);
  res.json({ groups: result.rows });
});

app.post("/api/groups", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const name = cleanText(body.name);
  const description = cleanText(body.description);
  if (!name || name.length > 100) return res.status(400).json({ error: "O nome do grupo é obrigatório e deve ter até 100 caracteres." });
  if ((body.description !== undefined && typeof body.description !== "string") || description.length > 2000) {
    return res.status(400).json({ error: "A descrição excede 2000 caracteres." });
  }
  const group = await transaction(async client => {
    const result = await client.query(
      "INSERT INTO social_groups(owner_id,name,description) VALUES($1,$2,$3) RETURNING id,name,description,created_at",
      [req.user.id, name, description]);
    await client.query(
      "INSERT INTO group_members(group_id,user_id) VALUES($1,$2)",
      [result.rows[0].id, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ group: { ...group, member_count: 1, is_member: true } });
});

app.post("/api/groups/:groupId/join", auth, async (req, res) => {
  const groupId = parseId(req.params.groupId);
  if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
  const group = await pool.query("SELECT owner_id FROM social_groups WHERE id=$1", [groupId]);
  if (!group.rowCount) return res.status(404).json({ error: "Grupo não encontrado." });
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

app.get("/api/pages", optionalAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT p.id,p.name,p.category,p.description,p.created_at,u.username AS owner_username,
      u.display_name AS owner_name,u.avatar_url AS owner_avatar,
      (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count,
      (SELECT COUNT(*) FROM posts po WHERE po.page_id=p.id AND po.hidden_at IS NULL)::int AS post_count,
      (p.owner_id=$1 OR EXISTS(SELECT 1 FROM page_followers f WHERE f.page_id=p.id AND f.user_id=$1)) AS is_following
    FROM pages p JOIN users u ON u.id=p.owner_id
    ORDER BY p.created_at DESC LIMIT 100`, [req.user?.id || 0]);
  res.json({ pages: result.rows });
});

app.post("/api/pages", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const name = cleanText(body.name);
  const category = body.category === undefined ? "Comunidade" : cleanText(body.category);
  const description = cleanText(body.description);
  if (!name || name.length > 100) return res.status(400).json({ error: "O nome da página é obrigatório e deve ter até 100 caracteres." });
  if ((body.category !== undefined && typeof body.category !== "string") || category.length > 60) {
    return res.status(400).json({ error: "A categoria deve ter até 60 caracteres." });
  }
  if ((body.description !== undefined && typeof body.description !== "string") || description.length > 2000) {
    return res.status(400).json({ error: "A descrição excede 2000 caracteres." });
  }
  const page = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO pages(owner_id,name,category,description) VALUES($1,$2,$3,$4)
      RETURNING id,name,category,description,created_at`,
    [req.user.id, name, category || "Comunidade", description]);
    await client.query("INSERT INTO page_followers(page_id,user_id) VALUES($1,$2)", [result.rows[0].id, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ page: { ...page, follower_count: 1, is_following: true } });
});

app.post("/api/pages/:pageId/follow", auth, async (req, res) => {
  const pageId = parseId(req.params.pageId);
  if (!pageId) return res.status(400).json({ error: "Página inválida." });
  const page = await pool.query("SELECT owner_id FROM pages WHERE id=$1", [pageId]);
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

app.get("/api/events", optionalAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT e.id,e.name,e.description,e.location,e.starts_at,e.created_at,
      u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,
      (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
      EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$1) AS is_attending
    FROM events e JOIN users u ON u.id=e.creator_id
    WHERE e.starts_at >= NOW() - INTERVAL '1 day'
    ORDER BY e.starts_at ASC LIMIT 100`, [req.user?.id || 0]);
  res.json({ events: result.rows });
});

app.post("/api/events", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.name !== "string") return res.status(400).json({ error: "O nome do evento é obrigatório." });
  const name = cleanText(body.name);
  const description = cleanText(body.description);
  const location = cleanText(body.location);
  const startsAt = new Date(body.startsAt);
  if (!name || name.length > 120) return res.status(400).json({ error: "O nome do evento é obrigatório e deve ter até 120 caracteres." });
  if (!body.startsAt || Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: "Indica uma data e hora válidas." });
  if (startsAt <= new Date()) return res.status(400).json({ error: "O evento deve começar no futuro." });
  if ((body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000))
    || (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 160))) {
    return res.status(400).json({ error: "A descrição ou localização excede o limite permitido." });
  }
  const event = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO events(creator_id,name,description,location,starts_at)
      VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,location,starts_at,created_at`,
    [req.user.id, name, description, location, startsAt.toISOString()]);
    await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2)", [result.rows[0].id, req.user.id]);
    return result.rows[0];
  });
  res.status(201).json({ event: { ...event, creator_id: req.user.id, attendee_count: 1, is_attending: true } });
});

app.post("/api/events/:eventId/rsvp", auth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  const event = await pool.query("SELECT creator_id FROM events WHERE id=$1", [eventId]);
  if (!event.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
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
      SELECT n.id,n.type,n.text,n.read,n.created_at,
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

const reportRateLimit = rateLimit({
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
  if (!["post", "comment", "user"].includes(targetType) || !targetId) return res.status(400).json({ error: "Denúncia inválida." });
  if (!Object.hasOwn(REPORT_REASONS, reason)) return res.status(400).json({ error: "Escolhe um motivo." });
  if (details.length > 1000) return res.status(400).json({ error: "Os detalhes devem ter até 1000 caracteres." });
  const ownerSql = {
    post: "SELECT user_id FROM posts WHERE id=$1",
    comment: "SELECT user_id FROM comments WHERE id=$1",
    user: "SELECT id AS user_id FROM users WHERE id=$1"
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

app.get("/api/admin/reports", auth, requireAdmin, async (req, res) => {
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
        ELSE tu.bio END AS target_excerpt,
      CASE WHEN r.target_type='post' THEN (SELECT p.hidden_at IS NOT NULL FROM posts p WHERE p.id=r.target_id) END AS target_hidden,
      (SELECT COUNT(*)::int FROM reports o WHERE o.target_type=r.target_type AND o.target_id=r.target_id AND o.status='open') AS open_reports_on_target
    FROM reports r
    LEFT JOIN users rep ON rep.id=r.reporter_id
    LEFT JOIN users tu ON tu.id=r.target_user_id
    WHERE r.status=$1
    ORDER BY r.created_at DESC LIMIT 100`, [status]);
  res.json({ reports: result.rows, reasons: REPORT_REASONS });
});

app.post("/api/admin/reports/:id/resolve", auth, requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const action = isRecord(req.body) ? req.body.action : undefined;
  if (!id || !MODERATION_ACTIONS.includes(action)) return res.status(400).json({ error: "Ação inválida." });
  const report = await pool.query("SELECT target_type,target_id,target_user_id FROM reports WHERE id=$1", [id]);
  if (!report.rowCount) return res.status(404).json({ error: "Denúncia não encontrada." });
  const { target_type: type, target_id: targetId, target_user_id: targetUserId } = report.rows[0];
  if (["hide_post", "restore_post"].includes(action) && type !== "post") return res.status(400).json({ error: "Esta ação só se aplica a publicações." });
  if (action === "delete_comment" && type !== "comment") return res.status(400).json({ error: "Esta ação só se aplica a comentários." });
  if (["suspend_user", "unsuspend_user"].includes(action) && targetUserId === req.user.id) {
    return res.status(400).json({ error: "Não podes suspender a tua própria conta." });
  }
  await transaction(async client => {
    if (action === "hide_post") await client.query("UPDATE posts SET hidden_at=NOW(),hidden_reason='moderation' WHERE id=$1", [targetId]);
    if (action === "restore_post") await client.query("UPDATE posts SET hidden_at=NULL,hidden_reason=NULL WHERE id=$1", [targetId]);
    if (action === "delete_comment") await client.query("DELETE FROM comments WHERE id=$1", [targetId]);
    if (action === "suspend_user") {
      // auth_version+1 termina as sessões abertas da conta suspensa.
      await client.query("UPDATE users SET suspended_at=NOW(),auth_version=auth_version+1 WHERE id=$1 AND is_admin=FALSE", [targetUserId]);
    }
    if (action === "unsuspend_user") await client.query("UPDATE users SET suspended_at=NULL WHERE id=$1", [targetUserId]);
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
  res.json({ left: true });
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
  const page = await pool.query("SELECT owner_id FROM pages WHERE id=$1", [pageId]);
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
  const media = await pool.query(
    "SELECT p.media_url FROM posts p JOIN pages pg ON pg.id=p.page_id WHERE pg.id=$1 AND pg.owner_id=$2",
    [pageId, req.user.id]);
  const result = await pool.query("DELETE FROM pages WHERE id=$1 AND owner_id=$2 RETURNING id", [pageId, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Página não encontrada." });
  await Promise.all(media.rows.map(row => removeUpload(row.media_url)));
  res.json({ deleted: true });
});

app.delete("/api/events/:eventId", auth, async (req, res) => {
  const eventId = parseId(req.params.eventId);
  if (!eventId) return res.status(400).json({ error: "Evento inválido." });
  const result = await pool.query("DELETE FROM events WHERE id=$1 AND creator_id=$2 RETURNING id", [eventId, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
  res.json({ deleted: true });
});

// Exportação dos dados pessoais (RGPD, direito de acesso/portabilidade).
app.get("/api/auth/me/export", auth, async (req, res) => {
  const id = req.user.id;
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
  res.set("Content-Disposition", `attachment; filename="biva-dados-${account[0]?.username || id}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    account: account[0] || null,
    posts, comments, likes, messages, friends, following, groups, pages, events, subscriptions, stories,
    audience: audience[0] || null,
    invitedBy: invitedBy[0]?.username || null,
    stars, starPurchases, promotions, campaigns,
    payoutAccount: payoutAccount[0] || null,
    payouts
  });
});

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
  const paid = await pool.query(`
    SELECT provider_subscription_id FROM subscriptions
    WHERE (subscriber_id=$1 OR creator_id=$1) AND provider='stripe' AND provider_subscription_id IS NOT NULL
      AND status<>'canceled'`, [req.user.id]);
  if (paid.rowCount && !stripe) {
    return res.status(503).json({ error: "Não é possível cancelar as subscrições pagas agora. Tenta mais tarde." });
  }
  for (const row of paid.rows) {
    try {
      await stripe.subscriptions.cancel(row.provider_subscription_id);
    } catch (error) {
      // Já cancelada/inexistente na Stripe: segue em frente; outro erro impede apagar para não continuar a cobrar.
      if (error?.code !== "resource_missing") {
        console.error("Stripe cancel failed:", error?.code || error?.name);
        return res.status(502).json({ error: "Não foi possível cancelar uma subscrição paga. Tenta novamente." });
      }
    }
  }
  const files = await pool.query(`
    SELECT media_url FROM posts WHERE media_url<>'' AND (
      user_id=$1
      OR group_id IN (SELECT id FROM social_groups WHERE owner_id=$1)
      OR page_id IN (SELECT id FROM pages WHERE owner_id=$1))
    UNION SELECT media_url FROM stories WHERE user_id=$1 AND media_url<>''`, [req.user.id]);
  await pool.query("DELETE FROM users WHERE id=$1", [req.user.id]);
  await Promise.all([
    ...files.rows.map(row => removeUpload(row.media_url)),
    removeUpload(account.rows[0].avatar_url),
    removeUpload(account.rows[0].cover_url)
  ]);
  res.json({ deleted: true });
});

if (process.env.NODE_ENV === "production" || process.env.SERVE_CLIENT === "true") {
  const clientBuild = path.join(__dirname, "..", "dist");
  app.use(express.static(clientBuild, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(clientBuild, "index.html"), error => {
      if (error) next(error);
    });
  });
}

// Métodos disponíveis e estado de um pagamento por Express/Referência (o ecrã de pagamento vai perguntando).
app.get("/api/payments/methods", (_req, res) => res.json({ methods: payments.methods, mode: payments.mode }));
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
registerLiveRoutes(app, { pool, auth, optionalAuth, parseId, isRecord, cleanText, transaction, blockedBetween });
registerFinanceRoutes(app, { pool, auth, requireAdmin, parseId, isRecord, cleanText, transaction, payments, payoutKey });

app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "O ficheiro excede o limite de 100 MB."
        : "Não foi possível processar o ficheiro enviado."
    });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "O corpo do pedido contém JSON inválido." });
  }
  if (error.message === "Formato de ficheiro não suportado.") {
    return res.status(415).json({ error: error.message });
  }
  console.error("API request failed:", error.code || error.name || "Error");
  res.status(500).json({ error: "Ocorreu um erro interno. Tenta novamente mais tarde." });
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

module.exports = { app, initDb, pool, startServer };