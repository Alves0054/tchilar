// Regras de moderação, separadas do Express para poderem ser testadas sozinhas.

const REPORT_REASONS = {
  spam: "Spam ou publicidade enganosa",
  harassment: "Assédio ou bullying",
  hate: "Discurso de ódio",
  violence: "Violência ou ameaças",
  sexual: "Conteúdo sexual",
  self_harm: "Automutilação ou suicídio",
  false_info: "Informação falsa",
  impersonation: "Está a fazer-se passar por outra pessoa",
  other: "Outro motivo"
};

const MODERATION_ACTIONS = ["dismiss", "hide_post", "restore_post", "delete_comment", "hide_course", "restore_course", "hide_group", "restore_group", "suspend_user", "unsuspend_user"];

// Condição SQL: verdadeira quando existe um bloqueio, em qualquer sentido, entre $me e a coluna indicada.
function blockedBetween(meParam, otherColumn) {
  return `EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id=${meParam} AND bl.blocked_id=${otherColumn}) OR (bl.blocker_id=${otherColumn} AND bl.blocked_id=${meParam}))`;
}

// Decide se uma publicação deve ser escondida automaticamente enquanto espera revisão.
//   openReports    — número de pessoas diferentes com denúncia aberta sobre a publicação
//   reasons        — motivos dessas denúncias (chaves de REPORT_REASONS)
//   authorAgeDays  — há quantos dias existe a conta do autor
// Esconder cedo protege a comunidade; esconder demasiado cedo deixa grupos de pessoas
// silenciar alguém só com denúncias coordenadas.
function shouldAutoHide({ openReports, reasons, authorAgeDays }) {
  // TODO(tu): define a regra de ocultação automática do Tchilar.
  // Ponto de partida conservador: nunca esconde sozinha; tudo espera por um moderador.
  void openReports; void reasons; void authorAgeDays;
  return false;
}

module.exports = { MODERATION_ACTIONS, REPORT_REASONS, blockedBetween, shouldAutoHide };
