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
const Stripe = require("stripe");
const { runMigrations } = require("./migrate");
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
const recoveryRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Tenta novamente mais tarde." }
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const subscriptionCurrency = (process.env.SUBSCRIPTION_CURRENCY || "eur").toLowerCase();

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
    if (session.mode === "subscription" && session.subscription) {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      await applyStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId));
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    await applyStripeSubscription(event.data.object);
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
    "SELECT user_id,is_exclusive,group_id FROM posts WHERE id=$1",
    [postId]);
  if (!result.rowCount) return { exists: false, allowed: false };
  const post = result.rows[0];
  if (post.user_id === userId) return { exists: true, allowed: true, post };
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

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, version: Number(user.auth_version || 0) },
    JWT_SECRET,
    { expiresIn: "12h" });
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
    if (process.env.NODE_ENV === "production") throw new Error("SMTP não está configurado.");
    return url.toString();
  }
  const subject = purpose === "verify_email" ? "Confirma o teu email — NOVA+" : "Redefine a palavra-passe — NOVA+";
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
  return {
    ...post,
    media_url: post.media_url && (post.is_exclusive || post.group_id)
      ? signMedia(path.basename(post.media_url))
      : post.media_url
  };
}

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
  pool.query("SELECT auth_version FROM users WHERE id=$1", [claims.id]).then(result => {
    if (!result.rowCount || Number(result.rows[0].auth_version) !== Number(claims.version || 0)) {
      return res.status(401).json({ error: "Sessão inválida ou expirada." });
    }
    req.user = claims;
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
    return pool.query("SELECT auth_version FROM users WHERE id=$1", [claims.id]).then(result => {
      if (result.rowCount && Number(result.rows[0].auth_version) === Number(claims.version || 0)) {
        req.user = claims;
      }
      next();
    }).catch(next);
  }
  next();
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "creator-social" }));

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
      if (!storyResult.rowCount) return res.status(404).json({ error: "Ficheiro não encontrado." });
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
    if (typeof body.password !== "string" || password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "A palavra-passe deve ter pelo menos 6 caracteres e no máximo 72 bytes." });
    }
    if (body.isCreator !== undefined && typeof body.isCreator !== "boolean") {
      return res.status(400).json({ error: "O valor de conta de criador é inválido." });
    }
    if (subscriptionPrice === null) {
      return res.status(400).json({ error: `O preço de subscrição deve estar entre ${MIN_PRICE} € e ${MAX_PRICE} €.` });
    }
    if (body.displayName.length > 100 || body.email.length > 160 || body.username.length > 40) {
      return res.status(400).json({ error: "Um ou mais campos excedem o limite permitido." });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name,is_creator,subscription_price,email_verified)
       VALUES($1,$2,$3,$4,$5,$6,FALSE) RETURNING id,username,email,display_name,is_creator,subscription_price,email_verified`,
      [username.toLowerCase(), email.toLowerCase(), hash, displayName, isCreator, subscriptionPrice]
    );
    const user = result.rows[0];
    const verificationToken = await createAuthToken(user.id, "verify_email");
    const verificationUrl = await sendAccountEmail(email, "verify_email", verificationToken);
    res.status(201).json({
      user,
      message: "Conta criada. Confirma o teu email para iniciar sessão.",
      ...(verificationUrl && process.env.NODE_ENV !== "production" && { verificationUrl })
    });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Username ou email já utilizado." });
    throw error;
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const email = cleanText(body.email, 160).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return res.status(400).json({ error: "Email e palavra-passe são obrigatórios." });
  const result = await pool.query(`
    SELECT id,username,email,display_name,bio,avatar_url,is_creator,subscription_price,email_verified,auth_version,password_hash
    FROM users WHERE email=$1`, [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }
  delete user.password_hash;
  if (!user.email_verified) {
    return res.status(403).json({ error: "Confirma o teu email antes de iniciar sessão." });
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
    ...(verificationUrl && process.env.NODE_ENV !== "production" && { verificationUrl })
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
    ...(resetUrl && process.env.NODE_ENV !== "production" && { resetUrl })
  });
});

app.post("/api/auth/reset-password", recoveryRateLimit, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Ligação inválida ou expirada." });
  if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ error: "A palavra-passe deve ter pelo menos 6 caracteres e no máximo 72 bytes." });
  }
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
  const r = await pool.query("SELECT id,username,email,display_name,bio,avatar_url,is_creator,subscription_price,email_verified FROM users WHERE id=$1", [req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
  res.json({ user: r.rows[0] });
});

app.patch("/api/auth/me", auth, async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const hasDisplayName = body.displayName !== undefined;
  const hasBio = body.bio !== undefined;
  const hasPrice = body.subscriptionPrice !== undefined;
  const subscriptionPrice = hasPrice ? parseSubscriptionPrice(body.subscriptionPrice) : null;
  if (!hasDisplayName && !hasBio && !hasPrice) return res.status(400).json({ error: "Indica pelo menos um campo para atualizar." });
  if (hasPrice && subscriptionPrice === null) {
    return res.status(400).json({ error: `O preço de subscrição deve estar entre ${MIN_PRICE} € e ${MAX_PRICE} €.` });
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
      subscription_price=COALESCE($3,subscription_price)
    WHERE id=$4
    RETURNING id,username,email,display_name,bio,avatar_url,is_creator,subscription_price,email_verified`,
  [hasDisplayName ? body.displayName.trim() : null, hasBio ? body.bio.trim() : null, subscriptionPrice, req.user.id]);
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
    SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_creator,
      g.name AS group_name, pg.name AS page_name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments
    FROM posts p JOIN users u ON u.id=p.user_id
    LEFT JOIN social_groups g ON g.id=p.group_id
    LEFT JOIN pages pg ON pg.id=p.page_id
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
    ORDER BY p.created_at DESC LIMIT 50
  `, [currentUser, username, groupId, pageId, mediaType]);
  res.json({ posts: r.rows.map(serializePost) });
});

app.get("/api/stories", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT s.id,s.user_id,s.body,s.media_url,s.media_type,s.created_at,s.expires_at,
      u.username,u.display_name,u.avatar_url
    FROM stories s JOIN users u ON u.id=s.user_id
    WHERE s.expires_at>NOW()
    ORDER BY s.created_at DESC
    LIMIT 100
  `);
  res.json({
    stories: result.rows.map(story => ({
      ...story,
      media_url: story.media_url
        ? signStoryMedia(story.id, path.basename(story.media_url))
        : ""
    }))
  });
});

app.post("/api/stories", auth, upload.single("media"), async (req, res) => {
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

app.post("/api/posts", auth, upload.single("media"), async (req, res) => {
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
  const r = await pool.query(
    `INSERT INTO posts(user_id,body,media_url,media_type,is_exclusive,group_id,page_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.id, body, mediaUrl, mediaType, isExclusive, groupId, pageId]
  );
  res.status(201).json({ post: serializePost(r.rows[0]) });
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Publicação inválida." });
  const result = await pool.query(
    "DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id,media_url",
    [id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Publicação não encontrada." });

  const mediaUrl = result.rows[0].media_url;
  if (typeof mediaUrl === "string" && mediaUrl.startsWith("/uploads/")) {
    try {
      await fs.promises.unlink(path.join(uploadDir, path.basename(mediaUrl)));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Could not remove deleted post media:", error.code || error.name);
      }
    }
  }
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
    WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 100`, [id]);
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
    WHERE id<>$1 AND (username ILIKE $2 OR display_name ILIKE $2)
    ORDER BY display_name LIMIT 20`, [req.user.id, `%${search}%`]);
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
      WHERE u.id<>$1
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
    SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.is_creator,u.subscription_price,
      (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id) AS followers,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id) AS posts,
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
  if (!r.rows[0]) return res.status(404).json({ error: "Utilizador não encontrado." });
  const user = r.rows[0];
  if (!user.is_subscribed) {
    user.subscription_period_end = null;
    user.subscription_canceling = false;
  }
  res.json({ user });
});

app.post("/api/users/:id/follow", auth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Utilizador inválido." });
  if (id === req.user.id) return res.status(400).json({ error: "Não podes seguir a própria conta." });
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
  if (!stripe && process.env.NODE_ENV === "production") {
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
        product_data: { name: `Subscrição de ${creator.display_name} na NOVA+` }
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
      u.display_name AS owner_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
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
      u.display_name AS owner_name,
      (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count,
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
        u.username AS actor_username,u.display_name AS actor_name
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

app.get("/api/messages/:userId", auth, async (req, res) => {
  const other = parseId(req.params.userId);
  if (!other || other === req.user.id) return res.status(400).json({ error: "Destinatário inválido." });
  const recipient = await pool.query("SELECT 1 FROM users WHERE id=$1", [other]);
  if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
  const r = await pool.query(`
    SELECT m.*, s.username AS sender_username
    FROM messages m JOIN users s ON s.id=m.sender_id
    WHERE (sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)
    ORDER BY m.created_at ASC LIMIT 100`, [req.user.id, other]);
  res.json({ messages: r.rows });
});

app.get("/api/messages", auth, async (req, res) => {
  const r = await pool.query(`
    SELECT other.id,other.username,other.display_name,other.avatar_url,
      latest.body AS latest_message,latest.created_at AS latest_message_at
    FROM (
      SELECT DISTINCT ON (CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END)
        CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END AS other_id,
        body,created_at
      FROM messages
      WHERE sender_id=$1 OR receiver_id=$1
      ORDER BY CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END,created_at DESC
    ) latest
    JOIN users other ON other.id=latest.other_id
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
  const recipient = await pool.query("SELECT 1 FROM users WHERE id=$1", [other]);
  if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
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
  if (process.env.NODE_ENV === "production" && (!mailTransport || !process.env.SMTP_FROM || !process.env.APP_URL)) {
    throw new Error("Em produção, configura SMTP_HOST, SMTP_FROM e APP_URL para confirmação e recuperação de conta.");
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
  return app.listen(PORT, () => console.log(`API: http://localhost:${PORT}`));
}

if (require.main === module) {
  startServer().catch(error => {
    console.error("Backend startup failed:", error.message);
    pool.end().finally(() => { process.exitCode = 1; });
  });
}

module.exports = { app, initDb, pool, startServer };