// Fila de emails. Cada email é guardado em email_queue e um processo envia-os ao ritmo permitido:
// - EMAIL_DAILY_LIMIT: máximo nas últimas 24 h (Resend grátis = 100; 0 = sem limite);
// - EMAIL_HOURLY_LIMIT: máximo na última hora (0 = sem limite).
// Os emails de conta (confirmar, recuperar) passam à frente dos avisos e deixam de ser enviados quando a
// ligação expira. Um envio que falha volta a ser tentado mais tarde (1, 2, 4, 8 min...) até MAX_ATTEMPTS.
// Várias cópias da API podem processar a mesma fila: cada linha é reservada com FOR UPDATE SKIP LOCKED.

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const STUCK_MINUTES = 10;
const KEEP_DAYS = 30;              // histórico (sem o texto dos emails de conta) guardado durante 30 dias
// Os emails de conta levam ligações de uso único (confirmar, recuperar a palavra-passe). Depois de saírem,
// falharem ou expirarem, o texto é apagado: uma cópia da base de dados não pode servir para entrar numa conta.
const REDACTED = "[ligação removida]";          // um envio "a sair" há mais do que isto (a API caiu a meio) volta à fila

const readLimit = value => Math.max(0, Number.parseInt(value || "0", 10) || 0);

function retryDelayMs(attempts) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000;
}

function createEmailQueue({ pool, transport, from, dailyLimit = readLimit(process.env.EMAIL_DAILY_LIMIT),
  hourlyLimit = readLimit(process.env.EMAIL_HOURLY_LIMIT), logger = console }) {
  let running = false;
  let timer = null;

  // kind: "account" (confirmar, recuperar), "receipt" (compras, ex.: bilhetes) e "notice" (avisos da equipa).
  // html é opcional: o texto simples vai sempre junto, para os programas de email que não mostram HTML.
  async function enqueue({ to, subject, text, html = null, kind = "notice", expiresAt = null, broadcastId = null }, client = pool) {
    const result = await client.query(`
      INSERT INTO email_queue(to_email,subject,body,html,kind,priority,expires_at,broadcast_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [to, subject.slice(0, 200), text, html, kind, kind === "notice" ? 1 : 0, expiresAt, broadcastId]);
    return result.rows[0].id;
  }

  // Quantos emails ainda podem sair agora sem passar os limites.
  async function allowance() {
    if (!dailyLimit && !hourlyLimit) return BATCH_SIZE;
    const { rows: [count] } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '24 hours')::int AS day,
             COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '1 hour')::int AS hour
      FROM email_queue WHERE status='sent' AND sent_at > NOW() - INTERVAL '24 hours'`);
    let left = BATCH_SIZE;
    if (dailyLimit) left = Math.min(left, dailyLimit - count.day);
    if (hourlyLimit) left = Math.min(left, hourlyLimit - count.hour);
    return Math.max(0, left);
  }

  async function processBatch() {
    if (!transport || running) return { sent: 0, failed: 0 };
    running = true;
    let sent = 0;
    let failed = 0;
    try {
      await pool.query(`
        UPDATE email_queue SET status='expired', body=CASE WHEN kind='account' THEN $1 ELSE body END
        WHERE status='pending' AND expires_at IS NOT NULL AND expires_at <= NOW()`, [REDACTED]);
      await pool.query("DELETE FROM email_queue WHERE status IN ('sent','failed','expired') AND created_at < NOW() - make_interval(days => $1)", [KEEP_DAYS]);
      await pool.query(`
        UPDATE email_queue SET status='pending'
        WHERE status='sending' AND next_attempt_at < NOW() - make_interval(mins => $1)`, [STUCK_MINUTES]);
      const left = await allowance();
      if (!left) return { sent, failed };
      const { rows } = await pool.query(`
        UPDATE email_queue SET status='sending', attempts=attempts+1, next_attempt_at=NOW()
        WHERE id IN (
          SELECT id FROM email_queue
          WHERE status='pending' AND next_attempt_at <= NOW()
          ORDER BY priority, next_attempt_at, id
          LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id,to_email,subject,body,html,attempts,priority,kind`, [left]);
      // O RETURNING não garante ordem: os emails de conta saem primeiro dentro do lote.
      rows.sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id));
      for (const row of rows) {
        try {
          await transport.sendMail({ from, to: row.to_email, subject: row.subject, text: row.body, ...(row.html ? { html: row.html } : {}) });
          await pool.query(`
            UPDATE email_queue SET status='sent', sent_at=NOW(), last_error=NULL, body=CASE WHEN kind='account' THEN $2 ELSE body END
            WHERE id=$1`, [row.id, REDACTED]);
          sent += 1;
        } catch (error) {
          failed += 1;
          const giveUp = row.attempts >= MAX_ATTEMPTS;
          await pool.query(`
            UPDATE email_queue SET status=$2::varchar, last_error=$3, next_attempt_at=NOW() + make_interval(secs => $4),
              body=CASE WHEN $2::varchar='failed' AND kind='account' THEN $5 ELSE body END
            WHERE id=$1`,
          [row.id, giveUp ? "failed" : "pending", String(error.message || error).slice(0, 300), retryDelayMs(row.attempts) / 1000, REDACTED]);
          logger.error(`Email ${row.id} ${giveUp ? "falhou de vez" : "falhou, nova tentativa mais tarde"}: ${error.message}`);
        }
      }
    } finally {
      running = false;
    }
    return { sent, failed };
  }

  // Tenta enviar já (ex.: logo depois de um registo), sem esperar pelo próximo ciclo e sem atrasar o pedido.
  function kick() {
    processBatch().catch(error => logger.error("Fila de emails:", error.message));
  }

  function start(intervalMs = 30_000) {
    if (!transport || timer) return;
    kick();
    timer = setInterval(kick, intervalMs);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function stats() {
    const { rows: [row] } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('pending','sending'))::int AS waiting,
             COUNT(*) FILTER (WHERE status='sent' AND sent_at > NOW() - INTERVAL '24 hours')::int AS sent_day,
             COUNT(*) FILTER (WHERE status='failed' AND created_at > NOW() - INTERVAL '7 days')::int AS failed_week,
             COUNT(*) FILTER (WHERE status='expired' AND created_at > NOW() - INTERVAL '7 days')::int AS expired_week
      FROM email_queue`);
    return { ...row, dailyLimit, hourlyLimit, enabled: Boolean(transport) };
  }

  return { enqueue, processBatch, kick, start, stop, stats };
}

module.exports = { MAX_ATTEMPTS, REDACTED, createEmailQueue, retryDelayMs };
