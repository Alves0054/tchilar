import { Ionicons } from "@expo/vector-icons";

// Selo de verificação (igual ao site): Kazola azul, Bolado vermelho, Benga dourado. Serve para contas e páginas.
export const BADGE_COLORS = { kazola: "#1877F2", bolado: "#E30613", benga: "#C58A00" };
const LABELS = { kazola: "Verificado · Kazola", bolado: "Selo vermelho · Bolado", benga: "Selo dourado · Benga" };

export function VerifiedBadge({ show = true, tier, size = 16 }) {
  if (!show) return null;
  return <Ionicons name="checkmark-circle" size={size} color={BADGE_COLORS[tier] || BADGE_COLORS.kazola}
    accessibilityLabel={LABELS[tier] || "Verificado"} />;
}
