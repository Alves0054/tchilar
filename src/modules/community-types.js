// Temas de grupo e tipos de página: a mesma lista que o servidor valida (server/community-types.json).
import catalog from "../../server/community-types.json";
import storyBackgrounds from "../../server/story-backgrounds.json";
import profileCovers from "../../server/profile-covers.json";

export const PROFILE_COVERS = profileCovers.covers;
// Capa sem foto: uma de 10 frases, sempre a mesma para cada pessoa. O número da conta é "baralhado"
// (multiplicação de Knuth), para contas seguidas não ficarem com frases seguidas.
export const coverFor = id => PROFILE_COVERS[Math.floor(((Number(id) || 0) * 2654435761) % 4294967296 / 4294967296 * PROFILE_COVERS.length)];


// Fundos dos stories de texto: cores (CSS) e temas ilustrados do Tchilar (imagens em /story-backgrounds).
export const STORY_COLORS = storyBackgrounds.colors;
export const STORY_THEMES = storyBackgrounds.themes;
export const DEFAULT_STORY_BACKGROUND = "tchilar";
// Estilo inline para um fundo; null quando o story não tem fundo escolhido (fica o fundo automático).
export function storyBackgroundStyle(key) {
  const normalizedKey = key === "biva" ? "tchilar" : key;
  const color = STORY_COLORS.find(item => item.key === normalizedKey);
  if (color) return { background: color.css };
  const theme = STORY_THEMES.find(item => item.key === normalizedKey);
  if (theme) return { backgroundImage: `url(${theme.image})`, backgroundSize: "cover", backgroundPosition: "center" };
  return null;
}

export const GROUP_PRIVACY = catalog.groupPrivacy;       // público, com aprovação, privado (convite), secreto
export const GROUP_TYPES = catalog.groupTypes;           // 16 tipos (para que serve o grupo)
export const GROUP_CATEGORIES = catalog.groupCategories; // 32 categorias, 18 com subcategorias
export const PAGE_TYPES = catalog.pageTypes;          // 30 tipos (página pessoal, loja, banda...)
export const PAGE_CATEGORIES = catalog.pageCategories; // 19 áreas de atividade, 12 com subcategorias

export const groupType = key => GROUP_TYPES.find(type => type.key === key) || GROUP_TYPES[0];
export const groupCategory = key => GROUP_CATEGORIES.find(area => area.key === key) || GROUP_CATEGORIES[0];
export const groupPrivacyOf = group => group.is_secret ? "secret" : group.invite_only ? "private" : group.requires_approval ? "approval" : "public";
export const groupPrivacy = group => GROUP_PRIVACY.find(option => option.key === groupPrivacyOf(group));
// "Free Fire" se houver subcategoria, senão "Jogos e gaming".
export function groupCategoryLabel(group) {
  const area = groupCategory(group.category);
  return area.subcategories.find(item => item.key === group.subcategory)?.label || area.label;
}
export function groupCategoryPath(group) {
  const area = groupCategory(group.category);
  const sub = area.subcategories.find(item => item.key === group.subcategory);
  return sub ? `${area.label} › ${sub.label}` : area.label;
}

export const pageType = key => PAGE_TYPES.find(type => type.key === key) || PAGE_TYPES.find(type => type.key === "comunidade");
export const pageCategory = key => PAGE_CATEGORIES.find(area => area.key === key) || null;
// Atividade de uma página: a subcategoria se houver ("DJs"), senão a categoria ("Música e áudio").
export function pageCategoryLabel(page) {
  const area = pageCategory(page.category);
  if (!area) return pageType(page.page_type).label;
  return area.subcategories.find(item => item.key === page.subcategory)?.label || area.label;
}
// Caminho completo: "Música e áudio › DJs".
export function pageCategoryPath(page) {
  const area = pageCategory(page.category);
  if (!area) return "";
  const sub = area.subcategories.find(item => item.key === page.subcategory);
  return sub ? `${area.label} › ${sub.label}` : area.label;
}
