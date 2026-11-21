// Pré-visualização dos links partilhados (WhatsApp, Facebook, Telegram, X, LinkedIn...).
// Estes serviços não correm JavaScript: leem só as etiquetas <meta property="og:..."> do HTML que recebem.
// Como o site é uma app React, o index.html tem sempre as mesmas etiquetas; aqui trocamo-las pelas da página
// pedida (perfil, publicação ou curso) antes de entregar o HTML.
//
// Só aparece o que já é público para quem não tem sessão: nada de publicações exclusivas, de grupos ou
// escondidas pela moderação, nem perfis suspensos, nem cursos que não estão à venda.

const DEFAULT_PREVIEW = Object.freeze({
  title: "Tchilar — conecta, partilha, vive",
  description: "Partilha momentos, conversa e encontra a tua comunidade no Tchilar.",
  image: "/tchilar-logo-full.png",
  type: "website"
});

// Robôs que vão buscar a pré-visualização. Usado pela hospedagem cPanel (.htaccess) para os mandar à API.
const CRAWLER_PATTERN = /facebookexternalhit|facebookcatalog|Facebot|WhatsApp|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|SkypeUriPreview|redditbot|Applebot|Googlebot|bingbot|Embedly|vkShare|Viber|SnapchatAds/i;

const PROFILE_PATH = /^\/u\/([a-z0-9._]{3,40})(?:\/(?:about|media))?\/?$/i;
const POST_PATH = /^\/posts\/(\d{1,10})\/?$/;
const COURSE_PATH = /^\/academia\/[a-z-]{1,20}\/(\d{1,10})\/?$/;

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Texto numa linha, cortado numa palavra inteira (o WhatsApp mostra ~2 linhas).
function shorten(text, max = 200) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

const plural = (count, one, many) => `${Number(count).toLocaleString("pt-PT")} ${count === 1 ? one : many}`;

// Devolve { title, description, image, type } para o caminho pedido, ou null (fica a pré-visualização geral).
async function findPreview(pool, pathname) {
  let match = PROFILE_PATH.exec(pathname);
  if (match) {
    const result = await pool.query(`
      SELECT u.username,u.display_name,u.bio,u.avatar_url,u.profession,u.is_creator,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers
      FROM users u WHERE u.username=$1 AND u.suspended_at IS NULL`, [match[1].toLowerCase()]);
    const user = result.rows[0];
    if (!user) return null;
    const facts = [user.profession, plural(user.followers, "seguidor", "seguidores")].filter(Boolean).join(" · ");
    return {
      title: `${user.display_name} (@${user.username}) no Tchilar`,
      description: shorten(user.bio ? `${user.bio} — ${facts}` : `${facts}. Segue ${user.display_name} no Tchilar.`),
      image: user.avatar_url || DEFAULT_PREVIEW.image,
      type: "profile"
    };
  }

  match = POST_PATH.exec(pathname);
  if (match) {
    const result = await pool.query(`
      SELECT p.body,p.media_url,p.media_type,u.username,u.display_name,u.avatar_url
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.id=$1 AND p.hidden_at IS NULL AND p.group_id IS NULL AND NOT COALESCE(p.is_exclusive,FALSE)
        AND u.suspended_at IS NULL`, [Number(match[1])]);
    const post = result.rows[0];
    if (!post) return null;
    const isImage = post.media_type === "image" && post.media_url;
    const fallback = post.media_type === "video" ? "Vê o vídeo no Tchilar." : "Vê a publicação no Tchilar.";
    return {
      title: `${post.display_name} (@${post.username}) no Tchilar`,
      description: shorten(post.body) || fallback,
      image: isImage ? post.media_url : post.avatar_url || DEFAULT_PREVIEW.image,
      type: "article"
    };
  }

  match = COURSE_PATH.exec(pathname);
  if (match) {
    const result = await pool.query(`
      SELECT c.title,c.summary,c.description,c.cover_url,c.price_kz::float AS price,c.by_team,u.display_name
      FROM courses c LEFT JOIN users u ON u.id=c.owner_id
      WHERE c.id=$1 AND c.status='published'`, [Number(match[1])]);
    const course = result.rows[0];
    if (!course) return null;
    const by = course.by_team ? "Equipa Tchilar" : course.display_name || "Tchilar";
    const price = course.price ? `${course.price.toLocaleString("pt-PT")} Kz` : "Grátis";
    return {
      title: `${course.title} — Academia Tchilar`,
      description: shorten(`${course.summary || course.description || "Curso na Academia Tchilar."} · ${by} · ${price}`),
      image: course.cover_url || DEFAULT_PREVIEW.image,
      type: "article"
    };
  }
  return null;
}

// Endereço completo. As fotos (/uploads/...) estão na API; o resto (/tchilar-logo...) no site.
function absolute(url, { siteUrl, mediaUrl }) {
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, url.startsWith("/uploads/") ? mediaUrl : siteUrl).toString();
}

// Etiquetas para o <head>. pageUrl é o endereço público da página (no site, não na API).
function metaTags(preview, { pageUrl, siteUrl, mediaUrl }) {
  const data = preview || DEFAULT_PREVIEW;
  const image = absolute(data.image, { siteUrl, mediaUrl });
  return [
    `<title>${escapeHtml(preview ? data.title : "Tchilar")}</title>`,
    `<meta name="description" content="${escapeHtml(data.description)}">`,
    `<meta property="og:site_name" content="Tchilar">`,
    `<meta property="og:locale" content="pt_PT">`,
    `<meta property="og:title" content="${escapeHtml(data.title)}">`,
    `<meta property="og:description" content="${escapeHtml(data.description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:type" content="${escapeHtml(data.type)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta name="twitter:card" content="${data.image === DEFAULT_PREVIEW.image ? "summary" : "summary_large_image"}">`
  ].join("\n  ");
}

// Troca, no index.html do site, o bloco entre <!-- preview --> e <!-- /preview --> pelas etiquetas da página.
function injectPreview(html, preview, urls) {
  return html.replace(/<!-- preview -->[\s\S]*?<!-- \/preview -->/, `<!-- preview -->\n  ${metaTags(preview, urls)}\n  <!-- /preview -->`);
}

// Página mínima para os robôs quando o site está noutra hospedagem (o .htaccess manda-os à API).
// Quem abrir o link num browser vai logo para a página verdadeira no site.
function crawlerPage(preview, urls) {
  const target = escapeHtml(urls.pageUrl);
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  ${metaTags(preview, urls)}
  <link rel="canonical" href="${target}">
  <meta http-equiv="refresh" content="0;url=${target}">
</head>
<body><a href="${target}">Abrir no Tchilar</a></body>
</html>`;
}

module.exports = { COURSE_PATH, CRAWLER_PATTERN, DEFAULT_PREVIEW, POST_PATH, PROFILE_PATH, crawlerPage, escapeHtml, findPreview, injectPreview, metaTags, shorten };
