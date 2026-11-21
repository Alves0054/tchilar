// Links do site que abrem a app (Universal Links no iOS, App Links no Android).
// Os telemóveis só abrem a app se o domínio publicar estes dois ficheiros em /.well-known/:
//   apple-app-site-association  → precisa do Team ID da Apple (APPLE_TEAM_ID)
//   assetlinks.json             → precisa da impressão SHA-256 do certificado da app Android (ANDROID_CERT_SHA256)
// Os dois valores aparecem depois do primeiro build no EAS (ver NOTA-TCHILAR.md). Sem eles, os links abrem o site.
const BUNDLE_ID = "ao.tchilar.app";

// Caminhos que a app sabe abrir. Os links dos emails (confirmar conta, nova palavra-passe) e dos recibos
// continuam no site.
const APP_PATHS = ["/u/*", "/posts/*", "/groups/*", "/pages/*", "/live", "/live/*", "/reels", "/search", "/messages", "/messages/*",
  "/notifications", "/events", "/estrelas", "/marcas", "/desafios", "/desafios/*", "/convidar", "/academia", "/academia/*", "/friends"];

const TEAM_ID = /^[A-Z0-9]{10}$/;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function appleAssociation(teamId) {
  if (!TEAM_ID.test(teamId || "")) return null;
  return { applinks: { details: [{ appIDs: [`${teamId}.${BUNDLE_ID}`], components: APP_PATHS.map(pattern => ({ "/": pattern })) }] } };
}

// Aceita várias impressões separadas por vírgulas (a do EAS e a da Google Play, por exemplo).
function androidAssetLinks(fingerprints) {
  const list = String(fingerprints || "").split(",").map(value => value.trim().toUpperCase()).filter(value => SHA256.test(value));
  if (!list.length) return null;
  return [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: BUNDLE_ID, sha256_cert_fingerprints: list } }];
}

// Quando o próprio servidor entrega o site (tudo no VPS), publica os dois ficheiros.
function registerAppLinks(app, env = process.env) {
  const apple = appleAssociation(env.APPLE_TEAM_ID);
  const android = androidAssetLinks(env.ANDROID_CERT_SHA256);
  app.get("/.well-known/apple-app-site-association", (_req, res) => apple ? res.type("application/json").send(JSON.stringify(apple)) : res.status(404).end());
  app.get("/.well-known/assetlinks.json", (_req, res) => android ? res.json(android) : res.status(404).end());
}

module.exports = { APP_PATHS, BUNDLE_ID, androidAssetLinks, appleAssociation, registerAppLinks };
