// Preferências da conta guardadas em users.preferences (JSONB).
// Notificações: cada tipo pertence a uma categoria que a pessoa pode desligar. Avisos de dinheiro,
// promoções e segurança não têm categoria: chegam sempre.
// O filtro corre na base de dados (trigger da migração 024), por isso a lista abaixo tem de bater certo com ela.
const NOTIFY_CATEGORIES = {
  interactions: ["like", "comment", "share"],
  people: ["follow", "friend_request", "friend_accepted"],
  messages: ["message"],
  lives: ["live"],
  community: ["group_join", "page_follow", "event_rsvp"]
};

const REACH_RULES = ["everyone", "following", "nobody"];

const PREFERENCE_DEFAULTS = Object.freeze({
  notify: Object.freeze(Object.fromEntries(Object.keys(NOTIFY_CATEGORIES).map(key => [key, true]))),
  messages: "everyone",
  comments: "everyone",
  showActivity: true
});

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

// Junta o que está guardado com os valores por omissão; ignora chaves desconhecidas.
function readPreferences(stored) {
  const saved = isRecord(stored) ? stored : {};
  const notify = isRecord(saved.notify) ? saved.notify : {};
  return {
    notify: Object.fromEntries(Object.keys(NOTIFY_CATEGORIES).map(key => [key, notify[key] !== false])),
    messages: REACH_RULES.includes(saved.messages) ? saved.messages : PREFERENCE_DEFAULTS.messages,
    comments: REACH_RULES.includes(saved.comments) ? saved.comments : PREFERENCE_DEFAULTS.comments,
    showActivity: saved.showActivity !== false
  };
}

// Aplica uma alteração parcial. Devolve { preferences } ou { error } com uma mensagem para a pessoa.
function updatePreferences(stored, patch) {
  if (!isRecord(patch)) return { error: "Alteração inválida." };
  const next = readPreferences(stored);
  for (const key of Object.keys(patch)) {
    if (!["notify", "messages", "comments", "showActivity"].includes(key)) return { error: "Opção desconhecida." };
  }
  if (patch.showActivity !== undefined) {
    if (typeof patch.showActivity !== "boolean") return { error: "Escolha inválida." };
    next.showActivity = patch.showActivity;
  }
  if (patch.notify !== undefined) {
    if (!isRecord(patch.notify)) return { error: "Opção de notificações inválida." };
    for (const [key, value] of Object.entries(patch.notify)) {
      if (!(key in NOTIFY_CATEGORIES) || typeof value !== "boolean") return { error: "Opção de notificações inválida." };
      next.notify[key] = value;
    }
  }
  for (const key of ["messages", "comments"]) {
    if (patch[key] === undefined) continue;
    if (!REACH_RULES.includes(patch[key])) return { error: "Escolha inválida." };
    next[key] = patch[key];
  }
  return { preferences: next };
}

// Pode alguém chegar a esta pessoa (mensagem ou comentário)?
// follows: a pessoa segue quem tenta chegar; replied: já houve conversa iniciada por ela.
function canReach(rule, { follows = false, replied = false } = {}) {
  if (replied) return true;
  if (rule === "nobody") return false;
  if (rule === "following") return follows;
  return true;
}

// "Online" = usou a app nos últimos minutos e não escondeu a atividade. `alias` é a tabela users na consulta.
const ONLINE_MINUTES = 5;
const onlineSql = alias => `(${alias}.last_seen_at > NOW() - INTERVAL '${ONLINE_MINUTES} minutes'
  AND COALESCE(${alias}.preferences->>'showActivity', 'true') <> 'false')`;

module.exports = { NOTIFY_CATEGORIES, ONLINE_MINUTES, onlineSql, PREFERENCE_DEFAULTS, REACH_RULES, canReach, readPreferences, updatePreferences };
