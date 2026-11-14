// Cores do Tchilar (as mesmas do site).
export const colors = {
  primary: "#0077B6",
  primarySoft: "#E3F2FA",
  accent: "#FF6B6B",
  secondary: "#00B4D8",
  ink: "#03233A",
  text: "#03233A",
  muted: "#5B7083",
  line: "#E2EBF0",
  surface: "#FFFFFF",
  background: "#F4FAFC",
  danger: "#D64545"
};

export function relativeTime(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
  if (seconds < 604800) return `há ${Math.floor(seconds / 86400)} d`;
  return new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
}
