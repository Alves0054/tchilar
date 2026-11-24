// Denúncias e a sua revisão pela equipa.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { MODERATION_ACTIONS } = require("./moderation");
const { REPORT_REASONS } = require("./moderation");
const { logAdminAction } = require("./admin-routes");
const { makeRateLimit } = require("./rate-limit");
const { shouldAutoHide } = require("./moderation");

function registerReportRoutes(app, deps) {
  const {
    auth, isRecord, parseId, pool, requireRole, transaction
  } = deps;

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
}

module.exports = { registerReportRoutes };
