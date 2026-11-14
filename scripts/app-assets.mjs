// Gera os ícones da app e as imagens das lojas a partir do logótipo (mobile/biva-expo/assets/tchilar-icon.png).
// Uso: npm run app:assets
//   App:   icon-ios.png (1024, sem transparência), android-icon-foreground/monochrome.png, notification-icon.png
//   Lojas: store/play-icon-512.png, store/play-feature-graphic.png (1024×500), store/app-store-icon-1024.png
// Capturas de ecrã: põe as capturas do telemóvel em store/raw/ (PNG, por ordem: 1-....png, 2-....png) e
// os títulos em store/captions.json; o script cria as versões para a App Store (1320×2868) e Google Play (1080×1920).
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = existsSync(path.join(root, "mobile", "tchilar-app")) ? path.join(root, "mobile", "tchilar-app") : path.join(root, "mobile", "biva-expo");
const assets = path.join(appDir, "assets");
const store = path.join(root, "store");
mkdirSync(store, { recursive: true });
const INK = "#0B0B0C";
const RED = "#E30613";

// 1) A marca (T branco + ponto vermelho) recortada do ícone: fica só o que é claro ou vermelho.
const source = sharp(path.join(assets, "tchilar-icon.png")).ensureAlpha();
const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
const mark = Buffer.alloc(info.width * info.height * 4);
const silhouette = Buffer.alloc(info.width * info.height * 4);
for (let i = 0; i < info.width * info.height; i++) {
  const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
  const white = Math.min(r, g, b);                       // quanto é branco
  const red = Math.max(0, r - Math.max(g, b));           // quanto é vermelho
  const alpha = Math.min(255, Math.max(0, (Math.max(white, red) - 70) * 2.2)) * (a / 255);
  const isRed = red > white;
  mark.set(isRed ? [227, 6, 19, alpha] : [255, 255, 255, alpha], i * 4);
  silhouette.set([255, 255, 255, alpha], i * 4);
}
const markPng = await sharp(mark, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
const silhouettePng = await sharp(silhouette, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();

// Marca centrada num quadrado, a ocupar "fraction" do lado.
async function placed(png, size, fraction, background = { r: 0, g: 0, b: 0, alpha: 0 }) {
  const inner = Math.round(size * fraction);
  const resized = await sharp(png).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: resized, gravity: "center" }]);
}

// iOS e App Store: quadrado cheio, sem transparência (o sistema arredonda os cantos).
await (await placed(markPng, 1024, 0.62, INK)).flatten({ background: INK }).png().toFile(path.join(assets, "icon-ios.png"));
await (await placed(markPng, 1024, 0.62, INK)).flatten({ background: INK }).png().toFile(path.join(store, "app-store-icon-1024.png"));
// Android adaptativo: a marca dentro da zona segura (66%), fundo de cor no app.json.
await (await placed(markPng, 1024, 0.5)).png().toFile(path.join(assets, "android-icon-foreground.png"));
await (await placed(silhouettePng, 1024, 0.5)).png().toFile(path.join(assets, "android-icon-monochrome.png"));
// Notificação Android: silhueta branca em fundo transparente (o sistema pinta-a).
await (await placed(silhouettePng, 96, 0.8)).png().toFile(path.join(assets, "notification-icon.png"));
// Google Play: ícone 512 sem transparência.
await (await placed(markPng, 512, 0.62, INK)).flatten({ background: INK }).png().toFile(path.join(store, "play-icon-512.png"));

// Ecrã de arranque em modo escuro: o mesmo logótipo com o texto e o quadrado a branco (o ponto fica vermelho).
{
  const splash = sharp(path.join(assets, "tchilar-splash.png")).ensureAlpha();
  const { data: px, info: si } = await splash.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < si.width * si.height; i++) {
    const [r, g, b] = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
    if (r - Math.max(g, b) > 60) continue;                // vermelho: fica
    const dark = 255 - Math.min(r, g, b);                  // preto → branco, branco → transparente
    px.set([255, 255, 255, Math.round(px[i * 4 + 3] * dark / 255)], i * 4);
  }
  await sharp(px, { raw: { width: si.width, height: si.height, channels: 4 } }).png().toFile(path.join(assets, "tchilar-splash-dark.png"));
}

// 2) Imagem de destaque do Google Play (1024×500): logótipo completo e frase.
const logo = await sharp(path.join(root, "public", "tchilar-logo-full.png")).resize({ width: 720 }).toBuffer();
const tagline = Buffer.from(`<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <text x="512" y="395" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="${INK}">Conecta · Partilha · Vive</text>
  <circle cx="512" cy="440" r="7" fill="${RED}"/></svg>`);
await sharp({ create: { width: 1024, height: 500, channels: 4, background: "#FFFFFF" } })
  .composite([{ input: logo, top: 110, left: 152 }, { input: tagline, top: 0, left: 0 }])
  .flatten({ background: "#FFFFFF" }).png().toFile(path.join(store, "play-feature-graphic.png"));

// 3) Capturas de ecrã com título, para as duas lojas.
const raw = path.join(store, "raw");
if (existsSync(raw)) {
  const captions = existsSync(path.join(store, "captions.json")) ? JSON.parse(readFileSync(path.join(store, "captions.json"), "utf8")) : {};
  const shots = readdirSync(raw).filter(name => /\.(png|jpe?g)$/i.test(name)).sort();
  const escape = text => String(text).replace(/[<>&"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char]);
  for (const [folder, width, height] of [["app-store-6.9", 1320, 2868], ["google-play", 1080, 1920]]) {
    mkdirSync(path.join(store, "screenshots", folder), { recursive: true });
    for (const name of shots) {
      const title = captions[name] || "";
      const top = Math.round(height * 0.17);
      const phoneHeight = height - top - Math.round(height * 0.04);
      const phone = await sharp(path.join(raw, name)).resize({ height: phoneHeight, width: Math.round(width * 0.82), fit: "inside" }).png().toBuffer();
      const meta = await sharp(phone).metadata();
      const rounded = await sharp(phone).composite([{ input: Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="100%" height="100%" rx="${Math.round(meta.width * 0.07)}" fill="#fff"/></svg>`), blend: "dest-in" }]).png().toBuffer();
      const text = Buffer.from(`<svg width="${width}" height="${top}" xmlns="http://www.w3.org/2000/svg">
        <text x="${width / 2}" y="${top * 0.62}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(width * 0.062)}" font-weight="800" fill="#FFFFFF">${escape(title)}</text></svg>`);
      await sharp({ create: { width, height, channels: 4, background: INK } })
        .composite([{ input: text, top: 0, left: 0 }, { input: rounded, top, left: Math.round((width - meta.width) / 2) }])
        .flatten({ background: INK }).png().toFile(path.join(store, "screenshots", folder, name.replace(/\.\w+$/, ".png")));
    }
  }
  console.log(`Capturas: ${shots.length} por loja em store/screenshots/.`);
} else {
  console.log("Sem capturas: põe as imagens do telemóvel em store/raw/ e volta a correr.");
}
console.log("Ícones da app em", path.relative(root, assets), "e imagens das lojas em store/.");
