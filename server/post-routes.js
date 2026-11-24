// Publicações, stories, gostos e comentários.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { ACTIVE_SUBSCRIPTION_SQL } = require("./subscriptions");
const { POST_MUSIC_SQL } = require("./music-routes");
const { blockedBetween } = require("./moderation");
const jwt = require("jsonwebtoken");
const { optimizeUpload } = require("./images");
const { parseStoryBackground } = require("./community-types");
const { parseVideoEdit } = require("./video-edit");
const path = require("path");

function registerPostRoutes(app, deps) {
  const {
    JWT_SECRET, auth, canAccessPost, cleanText, growth, isRecord, likePattern, music, optionalAuth, parseHashtag,
    parseId, pool, reachAllowed, removeUpload, searchTerm, serializePost, transaction, upload
  } = deps;

  function signStoryMedia(storyId, filename) {
    const access = jwt.sign({ purpose: "story-media", storyId, filename }, JWT_SECRET, { expiresIn: "15m" });
    return `/uploads/${encodeURIComponent(filename)}?access=${encodeURIComponent(access)}`;
  }

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
        g.name AS group_name, COALESCE(g.is_secret, FALSE) AS group_is_secret, pg.name AS page_name, pg.logo_url AS page_logo_url,
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
        -- Grupos secretos: as publicações só se veem dentro do grupo (ou abertas uma a uma), nunca no feed nem no perfil.
        AND (g.id IS NULL OR NOT g.is_secret OR $3::int IS NOT NULL OR $10::int IS NOT NULL)
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
  const hashtagRegex = tag => `(^|[^[:alnum:]_])#${tag}([^[:alnum:]_]|$)`;

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
}

module.exports = { registerPostRoutes };
