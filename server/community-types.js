// Grupos (entrada, tipo, categoria) e páginas (tipo, categoria). A lista vive em community-types.json,
// que o site e a app também importam, para os três lados nunca mostrarem opções diferentes.
const { groupPrivacy, groupTypes, groupCategories, pageTypes, pageCategories } = require("./community-types.json");

const DEFAULT_GROUP_TYPE = "comunitario";
const DEFAULT_GROUP_CATEGORY = "comunidade";
const DEFAULT_PAGE_TYPE = "comunidade";
const DEFAULT_PAGE_CATEGORY = "sociedade";

const privacyKeys = new Set(groupPrivacy.map(option => option.key));

// Grupo: tipo (16, ex.: "compra-venda"), categoria (32) e subcategoria opcional, que tem de pertencer à categoria.
// Sem categoria, usa a sugerida para o tipo. Sem nada, fica "Comunitário · Comunidade e sociedade".
function parseGroupKind(type, category, subcategory) {
  if (type === undefined && category === undefined) return { type: DEFAULT_GROUP_TYPE, category: DEFAULT_GROUP_CATEGORY, subcategory: null };
  const kind = groupTypes.find(item => item.key === (type ?? DEFAULT_GROUP_TYPE));
  if (!kind) return { error: "Escolhe o tipo de grupo." };
  const area = groupCategories.find(item => item.key === (category ?? kind.category));
  if (!area) return { error: "Escolhe a categoria do grupo." };
  if (subcategory === undefined || subcategory === null || subcategory === "") return { type: kind.key, category: area.key, subcategory: null };
  if (!area.subcategories.some(item => item.key === subcategory)) return { error: "Escolhe uma subcategoria desta categoria." };
  return { type: kind.key, category: area.key, subcategory };
}

// Quem pode entrar: "public" | "approval" | "private" (só por convite) | "secret".
// Aceita ainda `isSecret` dos clientes antigos.
function parseGroupPrivacy(body) {
  if (body.privacy !== undefined) {
    return privacyKeys.has(body.privacy) ? { value: body.privacy } : { error: "Tipo de grupo inválido." };
  }
  if (body.isSecret !== undefined && typeof body.isSecret !== "boolean") return { error: "Tipo de grupo inválido." };
  return { value: body.isSecret === true ? "secret" : "public" };
}

// Página: tipo (30, ex.: "loja", "banda"), categoria de atividade (19, ex.: "musica") e, opcional,
// uma subcategoria que tem de pertencer à categoria (ex.: "djs" só existe em "musica").
// Sem categoria, usa a sugerida para o tipo (uma "banda" fica em "Música e áudio").
function parsePageType(type, category, subcategory) {
  if (type === undefined && category === undefined) return { type: DEFAULT_PAGE_TYPE, category: DEFAULT_PAGE_CATEGORY, subcategory: null };
  const kind = pageTypes.find(item => item.key === type);
  if (!kind) return { error: "Escolhe o tipo de página." };
  const area = pageCategories.find(item => item.key === (category ?? kind.category));
  if (!area) return { error: "Escolhe a categoria da página." };
  if (subcategory === undefined || subcategory === null || subcategory === "") return { type, category: area.key, subcategory: null };
  if (!area.subcategories.some(item => item.key === subcategory)) return { error: "Escolhe uma subcategoria desta categoria." };
  return { type, category: area.key, subcategory };
}

// Fundos dos stories de texto: cores e temas ilustrados (story-backgrounds.json, também usado pelo frontend).
const storyBackgrounds = require("./story-backgrounds.json");
const storyBackgroundKeys = new Set([...storyBackgrounds.colors, ...storyBackgrounds.themes].map(item => item.key));
function parseStoryBackground(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (value === "biva") return { value: "tchilar" };
  return storyBackgroundKeys.has(value) ? { value } : { error: "Escolhe um fundo da lista." };
}

module.exports = { parseStoryBackground, groupCategories, groupPrivacy, groupTypes, pageCategories, pageTypes, parseGroupKind, parseGroupPrivacy, parsePageType };
