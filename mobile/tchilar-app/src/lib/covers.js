// Capas de perfil sem foto: 10 frases (server/profile-covers.json, copiado para lib/profile-covers.json).
import profileCovers from "./profile-covers.json";

export const PROFILE_COVERS = profileCovers.covers;
// Capa sem foto: uma de 10 frases, sempre a mesma para cada pessoa. O número da conta é "baralhado"
// (multiplicação de Knuth), para contas seguidas não ficarem com frases seguidas.
export const coverFor = id => PROFILE_COVERS[Math.floor(((Number(id) || 0) * 2654435761) % 4294967296 / 4294967296 * PROFILE_COVERS.length)];
