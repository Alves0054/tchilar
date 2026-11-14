import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { Badge, Card, Empty, Loading, Notice, Page, dateOnly } from "../../components/ui";
import { api } from "../../lib/api";
import { colors } from "../../lib/theme";

// Desafios do mês: os abertos primeiro. Ganha a publicação com mais gostos.
export default function Challenges() {
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api("/challenges").then(result => setItems(result.challenges)).catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useEffect(() => { load(); }, [load]);
  if (!items) return error ? <Page><Notice error={error} /></Page> : <Loading />;

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    {items.length === 0 && <Empty text="Ainda não há desafios. Volta em breve!" icon="trophy-outline" />}
    {items.map(challenge => <Card key={challenge.id} title={challenge.title}
      subtitle={challenge.is_open ? `Até ${dateOnly(challenge.ends_at)}` : `Terminou a ${dateOnly(challenge.closed_at || challenge.ends_at)}`}
      right={<Badge label={challenge.is_open ? "Aberto" : "Terminado"} tone={challenge.is_open ? "good" : "neutral"} />}>
      {Boolean(challenge.description) && <Text style={{ color: colors.text, lineHeight: 20 }}>{challenge.description}</Text>}
      <Text style={{ color: colors.muted }}>
        🏆 {challenge.prize || `${challenge.prize_stars} estrelas`}{challenge.sponsor ? ` · Patrocínio: ${challenge.sponsor}` : ""} · {challenge.entries} participantes
      </Text>
      {challenge.winner_name && <Badge label={`Venceu: ${challenge.winner_name}`} tone="warning" />}
      {challenge.my_post_id && <Badge label="Estás a participar" tone="info" />}
      <Text onPress={() => router.push(`/challenges/${challenge.id}`)} style={{ color: colors.primary, fontWeight: "800" }}>
        {challenge.is_open && !challenge.my_post_id ? "Participar e ver ranking ›" : "Ver ranking ›"}
      </Text>
    </Card>)}
  </Page>;
}
