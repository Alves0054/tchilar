// Academia Tchilar: cursos à venda. Criadores e a equipa criam cursos com aulas (texto e vídeo); a equipa
// revê os cursos dos criadores antes de irem para a venda. O criador fica com 85% de cada venda (entra no
// saldo e levanta-se para o IBAN); os cursos da equipa são do Tchilar.
//
// Acesso às aulas: quem criou, a equipa, quem comprou (sem reembolso) e toda a gente nos cursos grátis.
// As aulas marcadas como "amostra" ficam abertas a quem ainda não comprou. Os vídeos das aulas pagas só se
// veem com um link assinado que dura 30 minutos (ver uploads em index.js).
const { logAdminAction } = require("./admin-routes");

const COURSE_CREATOR_SHARE = 0.85;
const COURSE_LEVELS = ["iniciante", "intermedio", "avancado"];
const COURSE_CATEGORIES = ["criacao", "video", "fotografia", "musica", "negocios", "marketing", "tecnologia", "idiomas", "bem-estar", "outro"];
const MIN_PRICE = 500;
const MAX_PRICE = 500000;
const LESSON_MEDIA_MINUTES = 30;

const courseShareKz = gross => Math.round(Number(gross || 0) * COURSE_CREATOR_SHARE * 100) / 100;

// Campos de um curso vindos do formulário. partial=true numa edição (só valida o que vier).
function parseCourse(body, cleanText, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = cleanText(body.title);
    if (!out.title || out.title.length > 120) return { error: "O título deve ter entre 1 e 120 caracteres." };
  }
  if (!partial || body.summary !== undefined) {
    out.summary = cleanText(body.summary);
    if (out.summary.length > 240) return { error: "O resumo pode ter até 240 caracteres." };
  }
  if (!partial || body.description !== undefined) {
    out.description = typeof body.description === "string" ? body.description.replace(/\r\n/g, "\n").trim() : "";
    if (out.description.length > 8000) return { error: "A descrição pode ter até 8000 caracteres." };
  }
  if (!partial || body.category !== undefined) {
    out.category = COURSE_CATEGORIES.includes(body.category) ? body.category : "outro";
  }
  if (!partial || body.level !== undefined) {
    out.level = COURSE_LEVELS.includes(body.level) ? body.level : "iniciante";
  }
  if (!partial || body.priceKz !== undefined) {
    const price = body.priceKz === "" || body.priceKz === null || body.priceKz === undefined ? 0 : Number(body.priceKz);
    if (!Number.isFinite(price) || (price !== 0 && (price < MIN_PRICE || price > MAX_PRICE)) || Math.round(price * 100) !== price * 100) {
      return { error: `O preço é 0 (grátis) ou entre ${MIN_PRICE.toLocaleString("pt-PT")} Kz e ${MAX_PRICE.toLocaleString("pt-PT")} Kz.` };
    }
    out.price_kz = price;
  }
  return { course: out };
}

function parseLesson(body, cleanText, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = cleanText(body.title);
    if (!out.title || out.title.length > 120) return { error: "O título da aula deve ter entre 1 e 120 caracteres." };
  }
  if (!partial || body.body !== undefined) {
    out.body = typeof body.body === "string" ? body.body.replace(/\r\n/g, "\n").trim() : "";
    if (out.body.length > 20000) return { error: "O texto da aula pode ter até 20 000 caracteres." };
  }
  if (!partial || body.isPreview !== undefined) out.is_preview = body.isPreview === true || body.isPreview === "true";
  if (body.position !== undefined) {
    out.position = Number(body.position);
    if (!Number.isInteger(out.position) || out.position < 0 || out.position > 1000) return { error: "Posição inválida." };
  }
  return { lesson: out };
}

function registerCourseRoutes(app, deps) {
  const {
    pool, auth, optionalAuth, requireRole, parseId, isRecord, cleanText, transaction, payments,
    upload, imageUpload, optimizeUpload, removeUpload, signMedia
  } = deps;
  const reviewers = requireRole("moderation");
  const notify = (db, userId, actorId, type, text) => db.query(
    "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,$3,$4)", [userId, actorId, type, text]);

  const COURSE_FIELDS = `c.id,c.owner_id,c.by_team,c.title,c.summary,c.description,c.category,c.level,c.cover_url,c.price_kz::float AS price_kz,
    c.status,c.review_note,c.published_at,c.created_at,c.updated_at,
    u.username AS owner_username,u.display_name AS owner_name,u.avatar_url AS owner_avatar,
    (SELECT COUNT(*) FROM course_lessons l WHERE l.course_id=c.id)::int AS lessons_count,
    (SELECT COUNT(*) FROM course_purchases p WHERE p.course_id=c.id AND p.status='paid' AND p.refund_status IS NULL)::int AS students`;
  const OWNED_SQL = `(c.owner_id=$1 OR c.price_kz=0 OR EXISTS(SELECT 1 FROM course_purchases p
    WHERE p.course_id=c.id AND p.user_id=$1 AND p.status='paid' AND p.refund_status IS NULL))`;

  // Quem é a pessoa: criador e/ou equipa (para criar cursos e ver os que não estão publicados).
  const viewer = async userId => {
    if (!userId) return { id: 0, isAdmin: false, isCreator: false };
    const row = (await pool.query("SELECT is_admin,is_creator FROM users WHERE id=$1", [userId])).rows[0];
    return { id: userId, isAdmin: Boolean(row?.is_admin), isCreator: Boolean(row?.is_creator) };
  };
  // O curso (com campos de quem vê). Devolve null se a pessoa não o pode ver.
  const loadCourse = async (id, who) => {
    const row = (await pool.query(`SELECT ${COURSE_FIELDS}, ${OWNED_SQL} AS has_access
      FROM courses c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=$2`, [who.id, id])).rows[0];
    if (!row) return null;
    const canEdit = row.owner_id === who.id || (row.by_team && who.isAdmin);
    if (row.status !== "published" && !canEdit && !who.isAdmin) return null;
    return { ...row, can_edit: canEdit, has_access: row.has_access || canEdit || who.isAdmin };
  };
  const editable = async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: "Curso inválido." }); return null; }
    const course = await loadCourse(id, await viewer(req.user.id));
    if (!course || !course.can_edit) { res.status(404).json({ error: "Curso não encontrado." }); return null; }
    return course;
  };

  // ----- Catálogo -----
  app.get("/api/courses", optionalAuth, async (req, res) => {
    const category = COURSE_CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
    const result = await pool.query(`
      SELECT ${COURSE_FIELDS}, ${OWNED_SQL} AS has_access
      FROM courses c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.status='published' AND ($2::text IS NULL OR c.category=$2)
        AND ($3::text IS NULL OR c.title ILIKE $3 ESCAPE '\\' OR c.summary ILIKE $3 ESCAPE '\\')
      ORDER BY c.by_team DESC, students DESC, c.published_at DESC LIMIT 60`, [req.user?.id || 0, category, like]);
    res.json({ courses: result.rows, categories: COURSE_CATEGORIES, levels: COURSE_LEVELS, creatorShare: COURSE_CREATOR_SHARE });
  });

  app.get("/api/courses/mine", auth, async (req, res) => {
    const [created, purchased] = await Promise.all([
      pool.query(`SELECT ${COURSE_FIELDS} FROM courses c LEFT JOIN users u ON u.id=c.owner_id
        WHERE c.owner_id=$1 ORDER BY c.updated_at DESC`, [req.user.id]),
      pool.query(`SELECT ${COURSE_FIELDS} FROM courses c LEFT JOIN users u ON u.id=c.owner_id
        WHERE EXISTS(SELECT 1 FROM course_purchases p WHERE p.course_id=c.id AND p.user_id=$1 AND p.status='paid' AND p.refund_status IS NULL)
        ORDER BY c.title`, [req.user.id])
    ]);
    const who = await viewer(req.user.id);
    res.json({ created: created.rows, purchased: purchased.rows, canCreate: who.isCreator || who.isAdmin, isTeam: who.isAdmin });
  });

  app.get("/api/courses/:id", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Curso inválido." });
    const course = await loadCourse(id, await viewer(req.user?.id || 0));
    if (!course) return res.status(404).json({ error: "Curso não encontrado." });
    const lessons = (await pool.query("SELECT id,position,title,body,video_url,is_preview FROM course_lessons WHERE course_id=$1 ORDER BY position,id", [id])).rows;
    res.json({
      course,
      lessons: lessons.map(lesson => {
        const open = course.has_access || lesson.is_preview;
        return {
          id: lesson.id, position: lesson.position, title: lesson.title, is_preview: lesson.is_preview, locked: !open,
          has_video: Boolean(lesson.video_url),
          ...(open && { body: lesson.body, video_url: lesson.video_url ? signMedia("lesson-media", lesson.video_url, LESSON_MEDIA_MINUTES) : null })
        };
      })
    });
  });

  // ----- Criar e editar (criadores e equipa) -----
  app.post("/api/courses", auth, async (req, res) => {
    const who = await viewer(req.user.id);
    if (!who.isCreator && !who.isAdmin) return res.status(403).json({ error: "Só contas de criador podem vender cursos. Ativa o modo criador no Painel do criador." });
    const body = isRecord(req.body) ? req.body : {};
    const parsed = parseCourse(body, cleanText);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const c = parsed.course;
    const byTeam = who.isAdmin && body.byTeam === true;
    const result = await pool.query(`
      INSERT INTO courses(owner_id,by_team,title,summary,description,category,level,price_kz)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user.id, byTeam, c.title, c.summary, c.description, c.category, c.level, c.price_kz]);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.patch("/api/courses/:id", auth, async (req, res) => {
    const course = await editable(req, res);
    if (!course) return;
    const parsed = parseCourse(isRecord(req.body) ? req.body : {}, cleanText, true);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const fields = Object.keys(parsed.course);
    if (!fields.length) return res.status(400).json({ error: "Nada para mudar." });
    // Um curso de criador já publicado volta a revisão quando muda o que se vê na loja.
    const backToReview = course.status === "published" && !course.by_team;
    await pool.query(`UPDATE courses SET ${fields.map((key, index) => `${key}=$${index + 2}`).join(",")}, updated_at=NOW()
      ${backToReview ? ", status='review'" : ""} WHERE id=$1`, [course.id, ...fields.map(key => parsed.course[key])]);
    res.json({ updated: true, status: backToReview ? "review" : course.status });
  });

  app.post("/api/courses/:id/cover", auth, imageUpload.single("image"), optimizeUpload("cover"), async (req, res) => {
    const course = await editable(req, res);
    if (!course) { if (req.file) await removeUpload(`/uploads/${req.file.filename}`); return; }
    if (!req.file) return res.status(400).json({ error: "Escolhe uma imagem." });
    await pool.query("UPDATE courses SET cover_url=$2, updated_at=NOW() WHERE id=$1", [course.id, `/uploads/${req.file.filename}`]);
    await removeUpload(course.cover_url);
    res.json({ cover_url: `/uploads/${req.file.filename}` });
  });

  app.post("/api/courses/:id/lessons", auth, upload.single("video"), async (req, res) => {
    const course = await editable(req, res);
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    if (!course) { if (fileUrl) await removeUpload(fileUrl); return; }
    if (req.file && !req.file.mimetype.startsWith("video/")) { await removeUpload(fileUrl); return res.status(400).json({ error: "A aula só aceita vídeo (MP4, WebM ou MOV)." }); }
    const parsed = parseLesson(isRecord(req.body) ? req.body : {}, cleanText);
    if (parsed.error) { if (fileUrl) await removeUpload(fileUrl); return res.status(400).json({ error: parsed.error }); }
    if (!parsed.lesson.body && !fileUrl) return res.status(400).json({ error: "A aula precisa de texto ou de um vídeo." });
    const count = (await pool.query("SELECT COUNT(*)::int AS n FROM course_lessons WHERE course_id=$1", [course.id])).rows[0].n;
    if (count >= 200) { if (fileUrl) await removeUpload(fileUrl); return res.status(409).json({ error: "Um curso pode ter até 200 aulas." }); }
    const l = parsed.lesson;
    const result = await pool.query(`
      INSERT INTO course_lessons(course_id,position,title,body,video_url,is_preview)
      VALUES($1,COALESCE($2,(SELECT COALESCE(MAX(position),0)+1 FROM course_lessons WHERE course_id=$1)),$3,$4,$5,$6) RETURNING id`,
    [course.id, l.position ?? null, l.title, l.body, fileUrl, l.is_preview]);
    await pool.query("UPDATE courses SET updated_at=NOW() WHERE id=$1", [course.id]);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.patch("/api/courses/:id/lessons/:lessonId", auth, async (req, res) => {
    const course = await editable(req, res);
    if (!course) return;
    const lessonId = parseId(req.params.lessonId);
    const parsed = parseLesson(isRecord(req.body) ? req.body : {}, cleanText, true);
    if (!lessonId || parsed.error) return res.status(400).json({ error: parsed.error || "Aula inválida." });
    const fields = Object.keys(parsed.lesson);
    if (!fields.length) return res.status(400).json({ error: "Nada para mudar." });
    const result = await pool.query(`UPDATE course_lessons SET ${fields.map((key, index) => `${key}=$${index + 3}`).join(",")}
      WHERE id=$1 AND course_id=$2 RETURNING id`, [lessonId, course.id, ...fields.map(key => parsed.lesson[key])]);
    if (!result.rowCount) return res.status(404).json({ error: "Aula não encontrada." });
    res.json({ updated: true });
  });

  app.delete("/api/courses/:id/lessons/:lessonId", auth, async (req, res) => {
    const course = await editable(req, res);
    if (!course) return;
    const lessonId = parseId(req.params.lessonId);
    const result = await pool.query("DELETE FROM course_lessons WHERE id=$1 AND course_id=$2 RETURNING video_url", [lessonId, course.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Aula não encontrada." });
    await removeUpload(result.rows[0].video_url);
    res.json({ deleted: true });
  });

  // Enviar para a loja: os cursos da equipa publicam logo; os dos criadores vão para revisão.
  app.post("/api/courses/:id/submit", auth, async (req, res) => {
    const course = await editable(req, res);
    if (!course) return;
    if (!course.lessons_count) return res.status(400).json({ error: "Junta pelo menos uma aula antes de publicar." });
    if (!["draft", "rejected"].includes(course.status) && !(course.by_team && course.status === "hidden")) {
      return res.status(409).json({ error: "Este curso já foi enviado." });
    }
    const status = course.by_team ? "published" : "review";
    await pool.query(`UPDATE courses SET status=$2, review_note=NULL, updated_at=NOW()${status === "published" ? ", published_at=COALESCE(published_at,NOW())" : ""} WHERE id=$1`, [course.id, status]);
    res.json({ status });
  });

  // Apagar: só enquanto ninguém o comprou (as compras ficam registadas para os recibos).
  app.delete("/api/courses/:id", auth, async (req, res) => {
    const course = await editable(req, res);
    if (!course) return;
    const sold = await pool.query("SELECT 1 FROM course_purchases WHERE course_id=$1 AND status='paid' LIMIT 1", [course.id]);
    if (sold.rowCount) return res.status(409).json({ error: "Este curso já foi comprado. Pede à equipa para o esconder da loja." });
    const files = await pool.query("SELECT video_url FROM course_lessons WHERE course_id=$1 AND video_url IS NOT NULL", [course.id]);
    await pool.query("DELETE FROM courses WHERE id=$1", [course.id]);
    await Promise.all([course.cover_url, ...files.rows.map(row => row.video_url)].filter(Boolean).map(removeUpload));
    res.json({ deleted: true });
  });

  // ----- Comprar -----
  app.post("/api/courses/:id/buy", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Curso inválido." });
    const course = await loadCourse(id, await viewer(req.user.id));
    if (!course || course.status !== "published") return res.status(404).json({ error: "Curso não encontrado." });
    if (course.has_access) return res.status(409).json({ error: course.price_kz ? "Já tens este curso." : "Este curso é grátis: já podes ver as aulas." });
    const body = isRecord(req.body) ? req.body : {};
    const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
    const purchase = await pool.query(
      "INSERT INTO course_purchases(course_id,user_id,owner_id,by_team,amount_kz) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [id, req.user.id, course.owner_id, course.by_team, course.price_kz]);
    const purchaseId = purchase.rows[0].id;
    const result = await payments.start({
      purpose: "course", refId: purchaseId, amountKz: course.price_kz, userId: req.user.id, email: user.rows[0]?.email,
      method: body.method, phone: body.phone, name: `Curso «${course.title}»`,
      successPath: `/academia/cursos/${id}?pagamento=sucesso`, cancelPath: `/academia/cursos/${id}?pagamento=cancelado`,
      onSession: sessionId => pool.query("UPDATE course_purchases SET stripe_session_id=$2 WHERE id=$1", [purchaseId, sessionId])
    });
    if (result.error) return res.status(503).json({ error: result.error });
    res.status(201).json(result);
  });

  payments.register("course", async (purchaseId, details) => {
    await transaction(async client => {
      const paid = (await client.query(
        `UPDATE course_purchases SET status='paid', paid_at=NOW(), stripe_payment_intent=$2
         WHERE id=$1 AND status='pending' RETURNING course_id,user_id,owner_id,by_team`, [purchaseId, details.paymentIntent || null])).rows[0];
      if (!paid?.course_id) return;
      const title = (await client.query("SELECT title FROM courses WHERE id=$1", [paid.course_id])).rows[0]?.title || "o teu curso";
      await notify(client, paid.user_id, null, "payment", `Já tens acesso ao curso «${title}». Boas aulas!`);
      if (!paid.by_team && paid.owner_id && paid.owner_id !== paid.user_id) {
        await notify(client, paid.owner_id, paid.user_id, "payment", `Comprou o teu curso «${title}». Os teus 85% já estão no saldo.`);
      }
    });
  });

  // ----- Revisão (equipa de moderação) -----
  app.get("/api/admin/courses", auth, reviewers, async (req, res) => {
    const status = ["review", "published", "rejected", "hidden", "draft"].includes(req.query.status) ? req.query.status : "review";
    const result = await pool.query(`SELECT ${COURSE_FIELDS} FROM courses c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.status=$1 ORDER BY c.updated_at DESC LIMIT 100`, [status]);
    res.json({ courses: result.rows });
  });

  const REVIEW_ACTIONS = {
    approve: [["review", "hidden"], "published", "O teu curso «%s» foi aprovado e já está à venda na Academia."],
    reject: [["review"], "rejected", "O teu curso «%s» precisa de mudanças antes de ir para a venda: %n"],
    hide: [["published"], "hidden", "O teu curso «%s» foi retirado da Academia: %n"]
  };
  app.post("/api/admin/courses/:id/review", auth, reviewers, async (req, res) => {
    const id = parseId(req.params.id);
    const body = isRecord(req.body) ? req.body : {};
    const rule = REVIEW_ACTIONS[body.action];
    const note = cleanText(body.note);
    if (!id || !rule) return res.status(400).json({ error: "Pedido inválido." });
    if (body.action !== "approve" && (!note || note.length > 500)) return res.status(400).json({ error: "Explica o motivo (até 500 caracteres)." });
    const [from, to, message] = rule;
    const result = await transaction(async client => {
      const row = (await client.query(`UPDATE courses SET status=$2, review_note=$3, updated_at=NOW()
        ${to === "published" ? ", published_at=COALESCE(published_at,NOW())" : ""}
        WHERE id=$1 AND status = ANY($4) RETURNING owner_id,title,by_team`, [id, to, note || null, from])).rows[0];
      if (!row) return null;
      await logAdminAction(client, req.user.id, `course_${body.action}`, "course", id, note);
      if (row.owner_id && !row.by_team) await notify(client, row.owner_id, null, "academy", message.replace("%s", row.title).replace("%n", note));
      return row;
    });
    if (!result) return res.status(409).json({ error: "Este curso já não está nesse estado." });
    res.json({ status: to });
  });
}

module.exports = { COURSE_CATEGORIES, COURSE_CREATOR_SHARE, COURSE_LEVELS, courseShareKz, parseCourse, parseLesson, registerCourseRoutes };
