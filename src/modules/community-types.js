// Temas de grupo e tipos de página: a mesma lista que o servidor valida (server/community-types.json).
import catalog from "../../server/community-types.json";
import storyBackgrounds from "../../server/story-backgrounds.json";

// Fundos dos stories de texto: cores (CSS) e temas ilustrados do Tchilar (imagens em /story-backgrounds).
export const STORY_COLORS = storyBackgrounds.colors;
export const STORY_THEMES = storyBackgrounds.themes;
export const DEFAULT_STORY_BACKGROUND = "biva";
// Estilo inline para um fundo; null quando o story não tem fundo escolhido (fica o fundo automático).
export function storyBackgroundStyle(key) {
  const color = STORY_COLORS.find(item => item.key === key);
  if (color) return { background: color.css };
  const theme = STORY_THEMES.find(item => item.key === key);
  if (theme) return { backgroundImage: `url(${theme.image})`, backgroundSize: "cover", backgroundPosition: "center" };
  return null;
}

export const GROUP_TOPICS = catalog.groupTopics;
export const GROUP_PRIVACY = catalog.groupPrivacy;
export const PAGE_TYPES = catalog.pageTypes;

export const groupTopic = key => GROUP_TOPICS.find(topic => topic.key === key) || GROUP_TOPICS[0];
export const groupPrivacyOf = group => group.is_secret ? "secret" : group.requires_approval ? "private" : "public";

export const pageType = key => PAGE_TYPES.find(type => type.key === key) || PAGE_TYPES[PAGE_TYPES.length - 1];
// Nome da categoria de uma página (ex.: "Restaurante e café"); páginas antigas sem chave mostram o texto guardado.
export function pageCategoryLabel(page) {
  const type = pageType(page.page_type);
  return type.categories.find(item => item.key === page.category)?.label || page.category || type.label;
}
