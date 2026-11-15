// Grupos: entrada (público, com aprovação, privado por convite, secreto), 16 tipos e 32 categorias.
// A mesma lista que o servidor valida (server/community-types.json, copiada para lib/community-types.json).
import catalog from "./community-types.json";

export const GROUP_PRIVACY = catalog.groupPrivacy;
export const GROUP_TYPES = catalog.groupTypes;
export const GROUP_CATEGORIES = catalog.groupCategories;

export const groupType = key => GROUP_TYPES.find(type => type.key === key) || GROUP_TYPES[0];
export const groupCategory = key => GROUP_CATEGORIES.find(area => area.key === key) || GROUP_CATEGORIES[0];
export const groupPrivacyOf = group => group.is_secret ? "secret" : group.invite_only ? "private" : group.requires_approval ? "approval" : "public";
export const groupPrivacy = group => GROUP_PRIVACY.find(option => option.key === groupPrivacyOf(group));

// "Free Fire" se houver subcategoria, senão "Jogos e gaming".
export function groupCategoryLabel(group) {
  const area = groupCategory(group.category);
  return area.subcategories.find(item => item.key === group.subcategory)?.label || area.label;
}
// "Jogos e gaming › Free Fire".
export function groupCategoryPath(group) {
  const area = groupCategory(group.category);
  const sub = area.subcategories.find(item => item.key === group.subcategory);
  return sub ? `${area.label} › ${sub.label}` : area.label;
}

export const ROLE_LABELS = { owner: "Dono", admin: "Administrador", moderator: "Moderador", member: "Membro" };
export const isTeam = role => ["owner", "admin", "moderator"].includes(role);
