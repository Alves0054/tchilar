// Temas dos grupos, privacidade dos grupos e tipos de página. A lista vive em community-types.json,
// que o frontend também importa, para os dois lados nunca mostrarem opções diferentes.
const { groupTopics, groupPrivacy, pageTypes } = require("./community-types.json");

const DEFAULT_GROUP_TOPIC = "geral";
const DEFAULT_PAGE_TYPE = "comunidade";
const DEFAULT_PAGE_CATEGORY = "comunidade";

const groupTopicKeys = new Set(groupTopics.map(topic => topic.key));
const privacyKeys = new Set(groupPrivacy.map(option => option.key));

function parseGroupTopic(value) {
  if (value === undefined) return { value: DEFAULT_GROUP_TOPIC };
  return groupTopicKeys.has(value) ? { value } : { error: "Escolhe um tema da lista." };
}

// Aceita `privacy` ("public" | "private" | "secret") ou, para clientes antigos, `isSecret`.
function parseGroupPrivacy(body) {
  if (body.privacy !== undefined) {
    return privacyKeys.has(body.privacy) ? { value: body.privacy } : { error: "Tipo de grupo inválido." };
  }
  if (body.isSecret !== undefined && typeof body.isSecret !== "boolean") return { error: "Tipo de grupo inválido." };
  return { value: body.isSecret === true ? "secret" : "public" };
}

// A subcategoria tem de pertencer ao tipo escolhido (ex.: "restaurante" só existe em "negocio").
function parsePageType(type, category) {
  if (type === undefined && category === undefined) return { type: DEFAULT_PAGE_TYPE, category: DEFAULT_PAGE_CATEGORY };
  const found = pageTypes.find(item => item.key === type);
  if (!found) return { error: "Escolhe o tipo de página." };
  if (!found.categories.some(item => item.key === category)) return { error: "Escolhe uma categoria deste tipo de página." };
  return { type, category };
}

// Fundos dos stories de texto: cores e temas ilustrados (story-backgrounds.json, também usado pelo frontend).
const storyBackgrounds = require("./story-backgrounds.json");
const storyBackgroundKeys = new Set([...storyBackgrounds.colors, ...storyBackgrounds.themes].map(item => item.key));
function parseStoryBackground(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  return storyBackgroundKeys.has(value) ? { value } : { error: "Escolhe um fundo da lista." };
}

module.exports = { parseStoryBackground, DEFAULT_GROUP_TOPIC, groupPrivacy, groupTopics, pageTypes, parseGroupPrivacy, parseGroupTopic, parsePageType };
