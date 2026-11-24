// Conta: registo, login, recuperação, telemóvel, dois passos, perfil, exportar e apagar.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { ACTIVE_SUBSCRIPTION_SQL } = require("./subscriptions");
const { MAX_PRICE } = require("./subscriptions");
const { MIN_PRICE } = require("./subscriptions");
const { PHONE_ERROR } = require("./phones");
const QRCode = require("qrcode");
const { SMS_CODE_PATTERN } = require("./sms");
const bcrypt = require("bcryptjs");
const { createSession } = require("./sessions");
const crypto = require("crypto");
const { decrypt } = require("./payouts");
const { deviceLabel } = require("./sessions");
const { encrypt } = require("./payouts");
const { generateSecret } = require("./totp");
const jwt = require("jsonwebtoken");
const { makeRateLimit } = require("./rate-limit");
const { otpauthUri } = require("./totp");
const { parseBirthDate } = require("./growth");
const { parsePhoneNumber } = require("./phones");
const { parseSellerInput } = require("./event-tickets");
const { parseSubscriptionPrice } = require("./subscriptions");
const { readPreferences } = require("./preferences");
const { recordSms } = require("./sms-guard");
const { smsAllowed } = require("./sms-guard");
const { updatePreferences } = require("./preferences");
const { verifyCode } = require("./totp");

function registerAccountRoutes(app, deps) {
  const {
    JWT_SECRET, OWN_ACCOUNT_FIELDS, accountSecurityRateLimit, appUrl, auth, buildUserExport, cleanText,
    deleteAccount, emailQueue, isDevelopment, isRecord, mailTransport, normalizeWebsite, parseCoverPosition,
    parsePhone, payoutKey, pool, sms, transaction
  } = deps;

  const exposeDevAuthLinks = isDevelopment && process.env.DEV_EXPOSE_AUTH_LINKS === "true";
  const authRateLimit = makeRateLimit("auth", {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas tentativas. Tenta novamente mais tarde." }
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

  // Reposicionar a capa atual sem voltar a enviar a imagem.
  // Dados para recibos: o nome (ou empresa), NIF e morada que aparecem em «Vendido por» nos recibos
  // de quem compra ao criador (bilhetes, grupos, cursos, subscrições). Tudo vazio apaga.
  app.patch("/api/auth/me/billing", auth, async (req, res) => {
    const body = req.body || {};
    const empty = ["sellerName", "sellerNif", "sellerAddress"].every(key => !String(body[key] ?? "").trim());
    const parsed = empty ? null : parseSellerInput(body, cleanText);
    if (parsed?.error) return res.status(400).json({ error: parsed.error.replace(" que vende os bilhetes", "").replace(" de quem vende os bilhetes", "") });
    const seller = { name: parsed?.name ?? null, nif: parsed?.nif ?? null, address: parsed?.address ?? null };
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
  app.get("/api/auth/me/export", auth, async (req, res) => {
    const data = await buildUserExport(req.user.id);
    res.set("Content-Disposition", `attachment; filename="tchilar-dados-${data.account?.username || req.user.id}.json"`);
    res.json(data);
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
    const outcome = await deleteAccount(req.user.id, account.rows[0]);
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ deleted: true });
  });
}

module.exports = { registerAccountRoutes };
