// Tipos e categorias das páginas (a mesma lista que o servidor valida: server/community-types.json).
// 30 tipos (página pessoal, loja, banda...) e 19 categorias de atividade, 12 delas com subcategorias.
import catalog from "./community-types.json";

export const PAGE_TYPES = catalog.pageTypes;
export const PAGE_CATEGORIES = catalog.pageCategories;

export const pageType = key => PAGE_TYPES.find(type => type.key === key) || PAGE_TYPES.find(type => type.key === "comunidade");
export const pageCategory = key => PAGE_CATEGORIES.find(area => area.key === key) || null;

// "DJs" se houver subcategoria, senão "Música e áudio".
export function pageCategoryLabel(page) {
  const area = pageCategory(page.category);
  if (!area) return "";
  return area.subcategories.find(item => item.key === page.subcategory)?.label || area.label;
}
// "Música e áudio › DJs".
export function pageCategoryPath(page) {
  const area = pageCategory(page.category);
  if (!area) return "";
  const sub = area.subcategories.find(item => item.key === page.subcategory);
  return sub ? `${area.label} › ${sub.label}` : area.label;
}
