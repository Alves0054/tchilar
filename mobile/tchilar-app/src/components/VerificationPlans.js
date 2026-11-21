import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/theme";
import { PaymentSheet } from "./PaymentSheet";
import { BADGE_COLORS, VerifiedBadge } from "./VerifiedBadge";
import { Button, Loading, Notice, count, kz } from "./ui";

// Ecrã de verificação, igual ao do site (src/modules/verification.jsx): para a conta (endpoint "/creator/verification")
// ou para uma página ("/pages/:id/verification"). O servidor diz os planos, o selo ativo e os seguidores que contam.
const FEATURED_PLAN = "benga";
const TAGLINES = {
  kazola: "O selo azul, para começares a ser reconhecido.",
  bolado: "O selo vermelho e mais destaque junto das marcas.",
  benga: "O distintivo dourado e o topo do Marketplace."
};

export function VerificationPlans({ endpoint, page = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => api(endpoint).then(result => { setData(result); setError(""); })
    .catch(loadError => setError(loadError.message)), [endpoint]);
  useEffect(() => { load(); }, [load]);

  if (!data) return error ? <Notice error={error} /> : <Loading cards={2} />;
  const activePlan = data.plans.find(plan => plan.id === data.active?.tier);
  const sorted = [...data.plans].sort((a, b) => a.minimum_followers - b.minimum_followers);
  const top = sorted[sorted.length - 1].minimum_followers;
  const nextPlan = sorted.find(plan => !plan.eligible);
  // No telemóvel o plano em destaque aparece primeiro (como no site em ecrãs estreitos).
  const plans = [...data.plans].sort((a, b) => (b.id === FEATURED_PLAN) - (a.id === FEATURED_PLAN));

  return <View style={{ gap: 12 }}>
    <View style={styles.head}>
      <Text style={styles.kicker}>{page ? `Verificação da página ${page.name}` : "Verificação"}</Text>
      <Text style={styles.headTitle}>{page ? "Mostra que a página é a verdadeira" : "Mostra que és tu, com o selo"}</Text>
      <Text style={styles.headText}>{page
        ? "O selo aparece ao lado do nome da página, nas publicações e nos diretos dela."
        : "O selo aparece no teu perfil, nas publicações e nos diretos, e dá-te mais destaque junto das marcas."}</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>{data.eligible ? "Já podes ativar a verificação" : "O caminho até ao selo"}</Text>
      <Text style={styles.muted}>{nextPlan
        ? `${count(data.followers)} seguidores. Faltam ${count(nextPlan.minimum_followers - data.followers)} para o plano ${nextPlan.name}.`
        : `${count(data.followers)} seguidores: cumpres o requisito de todos os planos.`}</Text>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.min(100, (data.followers / top) * 100)}%` }]} />
      </View>
      <View style={styles.markers}>
        {sorted.map(plan => <View key={plan.id} style={styles.marker}>
          <VerifiedBadge tier={plan.id} size={14} />
          <Text style={styles.markerText}>{plan.name} · {count(plan.minimum_followers)}</Text>
        </View>)}
      </View>
      {activePlan && <View style={styles.active}><VerifiedBadge tier={activePlan.id} />
        <Text style={styles.activeText}>{activePlan.name} ativo até {new Date(data.active.expires_at).toLocaleDateString("pt-PT")}</Text></View>}
      <Text style={styles.muted}>{page ? "Contam os seguidores da página." : "Só contam seguidores (as amizades não contam)."} Cada pagamento ativa o selo durante um mês; a renovação é manual.</Text>
      <Notice error={error} message={notice} />
    </View>

    {plans.map(plan => {
      const active = data.active?.tier === plan.id;
      const blocked = Boolean(data.active) && !active;
      const featured = plan.id === FEATURED_PLAN;
      return <View key={plan.id} style={[styles.card, featured && styles.featured, active && { borderColor: BADGE_COLORS[plan.id] }]}>
        {featured && <View style={styles.ribbon}><Ionicons name="star" size={12} color="#3D2B00" /><Text style={styles.ribbonText}>Recomendado</Text></View>}
        <View style={styles.planHead}>
          <View style={[styles.planBadge, { backgroundColor: `${BADGE_COLORS[plan.id]}22` }]}><VerifiedBadge tier={plan.id} size={24} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.planName}>{plan.name}</Text>
            <Text style={styles.muted}>{TAGLINES[plan.id]}</Text>
          </View>
        </View>
        <Text style={styles.price}>{kz(plan.priceKz)}<Text style={styles.muted}> / mês</Text></Text>
        <View style={[styles.requirement, plan.eligible && styles.requirementMet]}>
          <Ionicons name={plan.eligible ? "checkmark" : "people-outline"} size={14} color={plan.eligible ? colors.good : colors.muted} />
          <Text style={[styles.requirementText, plan.eligible && { color: colors.good }]}>
            {plan.eligible ? `Requisito cumprido · ${count(plan.minimum_followers)} seguidores` : `A partir de ${count(plan.minimum_followers)} seguidores`}</Text>
        </View>
        {plan.benefits.map(benefit => <View key={benefit} style={styles.benefit}>
          <Ionicons name="checkmark" size={15} color={BADGE_COLORS[plan.id]} /><Text style={styles.benefitText}>{benefit}</Text>
        </View>)}
        <Button variant={featured && !active ? "primary" : "secondary"} disabled={!plan.eligible || blocked} onPress={() => setPaying(plan)}
          label={!plan.eligible ? `Faltam ${count(plan.minimum_followers - data.followers)} seguidores` : blocked ? "Disponível quando o plano atual acabar" : active ? `Renovar ${plan.name}` : `Ativar ${plan.name}`} />
      </View>;
    })}

    <PaymentSheet visible={Boolean(paying)} title={paying ? `Verificação ${paying.name}${page ? ` da página ${page.name}` : ""} · 1 mês` : ""}
      amount={paying?.priceKz} purpose="verification" onClose={() => { setPaying(null); load(); }}
      start={choice => api(`${endpoint}/checkout`, { method: "POST", body: { tier: paying.id, ...choice } })}
      onPaid={() => { setPaying(null); setNotice("Pagamento confirmado: o selo já está ativo."); load(); }} />
  </View>;
}

const styles = StyleSheet.create({
  head: { gap: 6, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  kicker: { color: "#E30613", fontSize: 13, fontWeight: "800" },
  headTitle: { color: colors.text, fontSize: 24, lineHeight: 28, fontWeight: "800", letterSpacing: -0.4 },
  headText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  featured: { borderWidth: 2, borderColor: "#D4AF37", marginTop: 8 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  track: { height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: colors.background },
  trackFill: { height: "100%", borderRadius: 999, backgroundColor: "#1877F2" },
  markers: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  marker: { flexDirection: "row", alignItems: "center", gap: 4 },
  markerText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  active: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.background },
  activeText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  ribbon: { position: "absolute", top: -12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: "#E9C766" },
  ribbonText: { color: "#3D2B00", fontSize: 12, fontWeight: "800" },
  planHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  planBadge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  planName: { color: colors.text, fontSize: 19, fontWeight: "800" },
  price: { color: colors.text, fontSize: 28, fontWeight: "800" },
  requirement: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 10, backgroundColor: colors.background },
  requirementMet: { backgroundColor: colors.goodSoft },
  requirementText: { color: colors.muted, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  benefit: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  benefitText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 }
});
