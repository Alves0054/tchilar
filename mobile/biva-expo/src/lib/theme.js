// Cores do Tchilar (as mesmas do site), regra 60-30-10:
// 60% preto e branco (texto, ícones, estados ativos), 30% cinzentos neutros (cartões, chips, botões secundários),
// 10% vermelho (accent): só botões principais, notificações e destaques.
export const colors = {
  primary: "#0B0B0C",
  primarySoft: "#F1F1F2",
  accent: "#E30613",
  secondary: "#6E6E73",
  ink: "#0B0B0C",
  text: "#0B0B0C",
  muted: "#6E6E73",
  line: "#E5E5EA",
  surface: "#FFFFFF",
  background: "#F4F4F5",
  danger: "#D10A16"
};

export function relativeTime(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  if (seconds < 604800) return `há ${Math.floor(seconds / 86400)} d`;
  return new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}
