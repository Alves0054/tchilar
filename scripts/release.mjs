// Prepara o Tchilar para subir em DOIS sítios:
//   release/servidor    → VPS (Node + PostgreSQL + fotos). A API, em https://api.<domínio>.
//   release/hospedagem  → hospedagem comum (cPanel/Apache). Só ficheiros estáticos do site.
//
// Uso:  npm run release
//       TCHILAR_WEB_URL=https://tchilar.ao TCHILAR_API_URL=https://api.tchilar.ao npm run release
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createRequire } = await import("node:module");
const { CRAWLER_PATTERN } = createRequire(import.meta.url)("../server/link-preview.js");
const webUrl = (process.env.TCHILAR_WEB_URL || "https://tchilar.ao").replace(/\/$/, "");
const apiUrl = (process.env.TCHILAR_API_URL || "https://api.tchilar.ao").replace(/\/$/, "");
for (const [name, value] of [["TCHILAR_WEB_URL", webUrl], ["TCHILAR_API_URL", apiUrl]]) {
  if (!/^https:\/\/[^/]+$/.test(value)) throw new Error(`${name} tem de ser https://domínio, sem caminho (recebi ${value}).`);
}
const out = path.join(root, "release");
const server = path.join(out, "servidor");
const hosting = path.join(out, "hospedagem");
rmSync(out, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

// 1) Site: compilado a apontar para a API no outro domínio.
process.env.NODE_ENV = "production";
process.env.VITE_API_URL = apiUrl;
process.env.VITE_PUBLIC_URL = webUrl;
const { build } = await import("vite");
await build({ root, logLevel: "warn", build: { outDir: hosting, emptyOutDir: true } });

// Apache (cPanel): todas as rotas abrem o index.html (o React trata do resto), cache longo para os
// ficheiros com impressão digital no nome, e os cabeçalhos de segurança que o servidor Node já dava.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `media-src 'self' blob: ${apiUrl} https:`,
  "font-src 'self' data:",
  `connect-src 'self' ${apiUrl} https: wss:`,
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join("; ");
writeFileSync(path.join(hosting, ".htaccess"), `# Gerado por npm run release. Site do Tchilar numa hospedagem Apache (cPanel).
Options -Indexes
RewriteEngine On

# Sempre HTTPS
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

# O iPhone lê este ficheiro sem extensão: tem de ir como JSON.
<Files "apple-app-site-association">
  ForceType application/json
</Files>

# Pré-visualização dos links: o WhatsApp, o Facebook e companhia não correm JavaScript, por isso os perfis,
# publicações e cursos pedidos por eles vão à API, que responde com a foto e o texto certos.
RewriteCond %{HTTP_USER_AGENT} (${CRAWLER_PATTERN.source}) [NC]
RewriteRule ^((u|posts|academia)/.*)$ ${apiUrl}/api/share/$1 [R=302,L]

# Rotas do React (/u/ana, /admin/painel...): ficheiro inexistente abre o index.html
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]

<IfModule mod_headers.c>
  Header always set Content-Security-Policy "${csp}"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "camera=(self), microphone=(self), geolocation=(), payment=()"
  Header always set X-Frame-Options "DENY"
  # index.html nunca em cache (para as pessoas receberem logo a versão nova); o resto em /assets tem hash no nome.
  <FilesMatch "^index\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/javascript "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
</IfModule>
`);

// Links que abrem a app: só com os dados do primeiro build (Team ID da Apple, impressão SHA-256 do Android).
const { androidAssetLinks, appleAssociation } = createRequire(import.meta.url)("../server/app-links.js");
const appleFile = appleAssociation(process.env.APPLE_TEAM_ID);
const androidFile = androidAssetLinks(process.env.ANDROID_CERT_SHA256);
if (appleFile || androidFile) mkdirSync(path.join(hosting, ".well-known"), { recursive: true });
if (appleFile) writeFileSync(path.join(hosting, ".well-known", "apple-app-site-association"), JSON.stringify(appleFile));
if (androidFile) writeFileSync(path.join(hosting, ".well-known", "assetlinks.json"), JSON.stringify(androidFile));
if (!appleFile || !androidFile) console.warn("Aviso: sem APPLE_TEAM_ID e/ou ANDROID_CERT_SHA256, os links do site ainda não abrem a app.");

// 2) Servidor: só o que a API precisa para correr (sem testes, sem frontend).
cpSync(path.join(root, "server"), path.join(server, "server"), {
  recursive: true,
  filter: source => !/\.test\.js$/.test(source)
});
for (const file of ["package.json", "package-lock.json", "docker-compose.yml", ".env.example"]) {
  cpSync(path.join(root, file), path.join(server, file));
}
cpSync(path.join(root, "deploy", "Dockerfile.api"), path.join(server, "Dockerfile"));
mkdirSync(path.join(server, "deploy"));
for (const file of ["backup.sh", "healthcheck.sh", "mediamtx.yml", "README.md"]) {
  cpSync(path.join(root, "deploy", file), path.join(server, "deploy", file));
}
// nginx só para a API: o mesmo ficheiro, mas a responder em api.<domínio>.
const apiHost = new URL(apiUrl).host;
const webHost = new URL(webUrl).host;
const nginx = readFileSync(path.join(root, "deploy", "nginx-tchilar.conf"), "utf8")
  .replace("server_name tchilar.ao www.tchilar.ao;", `server_name ${apiHost};`)
  .replace("certbot --nginx -d tchilar.ao -d www.tchilar.ao", `certbot --nginx -d ${apiHost}`)
  .replaceAll("live.tchilar.ao", `live.${webHost}`);
writeFileSync(path.join(server, "deploy", "nginx-api.conf"), nginx);
mkdirSync(path.join(server, "uploads"));
writeFileSync(path.join(server, "uploads", ".gitkeep"), "");

// Valores do .env que mudam com o site separado (o resto vem do .env.example).
writeFileSync(path.join(server, ".env.separado"), `# Junta estas linhas ao .env do servidor (copiado de .env.example).
NODE_ENV=production
# O site está na hospedagem: a API não o entrega.
SERVE_CLIENT=false
# Quem pode chamar a API (o site); a app de telemóvel já é aceite por omissão (MOBILE_APP_ORIGINS).
PUBLIC_CLIENT_URL=${webUrl}
# Links nos emails (confirmar conta, recuperar palavra-passe) abrem o site.
PUBLIC_APP_URL=${webUrl}
TRUST_PROXY=1
`);

if (!existsSync(path.join(hosting, "index.html"))) throw new Error("O site não foi gerado.");
console.log(`
Pronto. Duas pastas em release/:
  servidor/    → VPS: ${apiUrl}   (ver release/servidor/deploy/README.md e .env.separado)
  hospedagem/  → cPanel: ${webUrl} (sobe o conteúdo para public_html, incluindo o .htaccess)
`);
