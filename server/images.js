// Otimização de imagens enviadas: tudo é convertido para WebP, redimensionado e sem metadados.
// Corre depois do multer; os vídeos passam sem alterações.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

sharp.cache(false); // sem cache de ficheiros: os uploads são apagados/renomeados logo a seguir

// Tamanho máximo (em píxeis, lado maior/caixa) e qualidade WebP por tipo de imagem.
// Qualidade 80–85 em WebP é visualmente igual ao original e costuma reduzir 60–90% do peso.
const IMAGE_PROFILES = {
  avatar: { width: 640, height: 640, quality: 85 },
  // A capa só limita a largura: a altura extra é o que o utilizador pode reposicionar.
  cover: { width: 1920, height: undefined, quality: 82 },
  post: { width: 1600, height: 1600, quality: 80 },
  event: { width: 1600, height: 1200, quality: 82 },
  story: { width: 1080, height: 1920, quality: 80 }
};

// Versão pequena das fotos das publicações, para o modo "Poupar dados" (cerca de 5 a 10 vezes mais leve).
const SMALL_VARIANT = { width: 480, quality: 55 };
const smallVariantName = filename => String(filename).replace(/\.webp$/i, ".sm.webp");

// Converte um ficheiro de imagem no disco. Devolve o novo nome de ficheiro (.webp).
async function optimizeImageFile(filePath, profileName) {
  const profile = IMAGE_PROFILES[profileName];
  if (!profile) throw new Error(`Perfil de imagem desconhecido: ${profileName}`);
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const outputName = `${baseName}.webp`;
  const outputPath = path.join(directory, outputName);
  const temporaryPath = path.join(directory, `${baseName}.tmp.webp`);
  // Lê para memória: no Windows o sharp mantém o ficheiro aberto e não o deixaria apagar
  // (acontece quando o original já é .webp e tem o mesmo nome do resultado).
  const input = await fs.promises.readFile(filePath);
  // animated: true mantém GIFs animados (passam a WebP animado).
  await sharp(input, { animated: true, limitInputPixels: 50_000_000 })
    .rotate() // aplica a orientação EXIF antes de a descartar
    .resize({ width: profile.width, height: profile.height, fit: "inside", withoutEnlargement: true })
    .webp({ quality: profile.quality, effort: 4 })
    .toFile(temporaryPath); // sem .withMetadata(): o GPS e outros dados EXIF não são guardados
  if (profileName === "post") {
    await sharp(input, { animated: false, limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: SMALL_VARIANT.width, height: SMALL_VARIANT.width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: SMALL_VARIANT.quality, effort: 4 })
      .toFile(path.join(directory, smallVariantName(outputName)));
  }
  await fs.promises.rm(filePath, { force: true });
  await fs.promises.rename(temporaryPath, outputPath);
  return outputName;
}

// Middleware: otimiza req.file quando é uma imagem. Ficheiros inválidos são recusados e apagados.
function optimizeUpload(profileName) {
  return async (req, res, next) => {
    if (!req.file || !req.file.mimetype.startsWith("image/")) return next();
    const originalSize = req.file.size;
    try {
      const filename = await optimizeImageFile(req.file.path, profileName);
      const stats = await fs.promises.stat(path.join(path.dirname(req.file.path), filename));
      req.file = { ...req.file, filename, path: path.join(path.dirname(req.file.path), filename), mimetype: "image/webp", size: stats.size, originalSize };
      next();
    } catch (error) {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
      const base = path.join(path.dirname(req.file.path), path.basename(req.file.path, path.extname(req.file.path)));
      await fs.promises.rm(`${base}.tmp.webp`, { force: true }).catch(() => {});
      console.error("Image optimization failed:", error.message);
      res.status(400).json({ error: "Não foi possível ler esta imagem. Experimenta outro ficheiro." });
    }
  };
}

module.exports = { IMAGE_PROFILES, optimizeImageFile, optimizeUpload, smallVariantName };
