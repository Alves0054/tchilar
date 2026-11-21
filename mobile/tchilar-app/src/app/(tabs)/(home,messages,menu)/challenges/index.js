// Desafios do mês (como no site): como funciona em 3 passos, prémios do mês, filtro por nível e cartões
// com a cor do nível e o prémio do 1.º lugar em destaque.
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LEVELS, cash, prizeHeadline, timeLeft } from "../../../../components/Prizes";
import { Chips, Empty, Loading, Notice, Page, count, kz } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { colors } from "../../../../lib/theme";

const STEPS = [["create", "#0A84FF", "Publica", "Uma publicação pública sobre o tema."], ["trophy", "#E5A000", "Entra", "Abre o desafio e escolhe-a."], ["heart", "#D63384", "Junta gostos", "Os 3 mais gostados ganham."]];

export default function Challenges() {
  const [items, setItems] = useState(null);
  const [level, setLevel] = useState("0");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api("/challenges").then(result => { setItems(result.challenges); setError(""); })
    .catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!items) return error ? <Page><Notice error={error} /></Page> : <Loading />;

  const open = items.filter(item => item.is_open);
  const finished = items.filter(item => !item.is_open);
  const shown = open.filter(item => level === "0" || String(item.level) === level);
  const totalCash = open.reduce((sum, item) => sum + (item.prizes || []).reduce((acc, prize) => acc + cash(prize), 0), 0);
  const mine = open.filter(item => item.my_post_id).length;
  const levels = [["0", "Todos"], ...Object.entries(LEVELS).filter(([key]) => open.some(item => String(item.level) === key)).map(([key, [name]]) => [key, name])];

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <View style={styles.hero}>
      <Text style={styles.kicker}>Desafios de {new Date().toLocaleDateString("pt-PT", { month: "long" })}</Text>
      <Text style={styles.heroTitle}>Participa e ganha prémios</Text>
      <View style={styles.heroStats}>
        {[["Abertos", count(open.length)], ["Em prémios", totalCash ? kz(totalCash) : "Estrelas"], ["Estás em", `${mine}`]].map(([label, value]) =>
          <View key={label} style={styles.heroStat}><Text style={styles.heroLabel}>{label}</Text><Text style={styles.heroValue}>{value}</Text></View>)}
      </View>
    </View>

    <View style={styles.steps}>
      {STEPS.map(([icon, tone, title, text], index) => <View key={title} style={styles.step}>
        <View style={[styles.stepIcon, { backgroundColor: `${tone}1F` }]}><Ionicons name={icon} size={18} color={tone} /></View>
        <Text style={styles.stepTitle}>{index + 1}. {title}</Text>
        <Text style={styles.stepText}>{text}</Text>
      </View>)}
    </View>

    <Text style={styles.section}>Desafios abertos</Text>
    {levels.length > 2 && <Chips options={levels} value={level} onChange={setLevel} />}
    {shown.length === 0 && <Empty text={open.length ? "Nenhum desafio neste nível." : "Não há desafios abertos. Os novos chegam no início do mês e recebes um aviso."} icon="trophy-outline" />}
    {shown.map(item => <ChallengeTile key={item.id} challenge={item} />)}

    {finished.length > 0 && <>
      <Text style={styles.section}>Terminados recentemente</Text>
      {finished.map(item => <ChallengeTile key={item.id} challenge={item} />)}
    </>}
  </Page>;
}

function ChallengeTile({ challenge }) {
  const [name, tone] = LEVELS[challenge.level] || ["Especial", "#6E6E73"];
  const prizes = challenge.prizes || [];
  const others = prizes.slice(1).filter(prize => prize.stars || cash(prize));
  return <Pressable style={[styles.tile, !challenge.is_open && { opacity: 0.7 }]} onPress={() => router.push(`/challenges/${challenge.id}`)}>
    <View style={[styles.band, { backgroundColor: tone }]}>
      <Text style={styles.bandText}><Ionicons name="trophy" size={12} color="#fff" /> {name}</Text>
      <Text style={styles.bandText}>{timeLeft(challenge)}</Text>
    </View>
    <View style={styles.tileBody}>
      <Text style={styles.tileTitle}>{challenge.title}</Text>
      {Boolean(challenge.description) && <Text style={styles.tileText} numberOfLines={2}>{challenge.description}</Text>}
      <View style={styles.prizeBox}>
        <Text style={styles.prizeLabel}>1.º lugar</Text>
        <Text style={styles.prizeMain}>{prizeHeadline(prizes[0])}</Text>
        {others.length > 0 && <Text style={styles.prizeLabel}>{others.map(prize => `${prize.place}.º ${prizeHeadline(prize)}`).join(" · ")}</Text>}
      </View>
      <View style={styles.tileFoot}>
        <Text style={styles.muted}><Ionicons name="people" size={13} color={colors.muted} /> {count(challenge.entries)} participantes</Text>
        {challenge.my_post_id ? <Text style={styles.joined}>✓ Estás a participar</Text>
          : challenge.is_open ? <Text style={styles.cta}>Participar ›</Text>
            : <Text style={styles.muted}>{challenge.winner_name ? `Venceu ${challenge.winner_name}` : "Ver resultados"}</Text>}
      </View>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: 18, padding: 18, gap: 4 },
  kicker: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800" },
  heroStats: { flexDirection: "row", gap: 8, marginTop: 10 },
  heroStat: { flex: 1, backgroundColor: "rgba(255,255,255,0.09)", borderRadius: 12, padding: 10 },
  heroLabel: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700" },
  heroValue: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 2 },
  steps: { flexDirection: "row", gap: 8 },
  step: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 10, gap: 4 },
  stepIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepTitle: { color: colors.text, fontWeight: "800", fontSize: 13 },
  stepText: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  section: { color: colors.text, fontSize: 19, fontWeight: "800", marginTop: 4 },
  tile: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" },
  band: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 7 },
  bandText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  tileBody: { padding: 14, gap: 8 },
  tileTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  tileText: { color: colors.muted, lineHeight: 19 },
  prizeBox: { backgroundColor: colors.background, borderRadius: 12, padding: 10, gap: 2 },
  prizeLabel: { color: colors.muted, fontSize: 12 },
  prizeMain: { color: colors.text, fontSize: 16, fontWeight: "800" },
  tileFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  muted: { color: colors.muted, fontSize: 13 },
  joined: { color: "#30B350", fontWeight: "800", fontSize: 13 },
  cta: { color: colors.text, fontWeight: "800" }
});
