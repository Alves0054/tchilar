// Páginas: criar, editar, imagens, seguir, negócio verificado e ofertas.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { normalizePromotionCode } = require("./promotion-codes");
const { optimizeUpload } = require("./images");
const { parsePageType } = require("./community-types");

function registerPageRoutes(app, deps) {
  const {
    auth, cleanText, imageUpload, isRecord, normalizeWebsite, optionalAuth, parseCoverPosition, parseId,
    parsePhone, pool, removeUpload, transaction
  } = deps;

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
}

module.exports = { registerPageRoutes };
