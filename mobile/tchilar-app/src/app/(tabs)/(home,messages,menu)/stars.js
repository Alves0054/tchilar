import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PaymentSheet } from "../../../components/PaymentSheet";
import { Card, Empty, Loading, Notice, Page, Row, Stats, count, dateTime, kz } from "../../../components/ui";
import { api } from "../../../lib/api";
import { colors } from "../../../lib/theme";

const KIND_LABELS = {
  purchase: ["Compraste", "cart", colors.primary],
  gift_sent: ["Ofereceste a", "gift", colors.accent],
  gift_received: ["Recebeste de", "star", "#F5B700"],
  referral_bonus: ["Bónus de convite", "people", "#2EAA6B"],
  challenge_prize: ["Prémio de desafio", "trophy", "#E8890C"],
  refund: ["Reembolso", "return-down-back", colors.muted]
};

// Estrelas: saldo, pacotes para comprar e movimentos. Oferecem-se nas publicações e nos diretos.
export default function Stars() {
  const [data, setData] = useState(null);
  const [pack, setPack] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => api("/stars").then(setData).catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <View style={styles.hero}>
      <Ionicons name="star" size={34} color="#F5B700" />
      <Text style={styles.balance}>{count(data.balance)}</Text>
      <Text style={styles.balanceLabel}>estrelas para oferecer</Text>
    </View>
    <Notice error={error} message={message} />
    <Card title="Comprar estrelas" subtitle={`Cada estrela custa ${kz(data.price_kz)}.`}>
      <View style={styles.packs}>{data.packs.map(item => <Pressable key={item.index} style={styles.pack} onPress={() => setPack(item)}>
        <Ionicons name="star" size={22} color="#F5B700" />
        <Text style={styles.packStars}>{count(item.stars)}</Text>
        {item.bonus > 0 && <Text style={styles.bonus}>+{item.bonus} bónus</Text>}
        <Text style={styles.price}>{kz(item.price)}</Text>
      </Pressable>)}</View>
    </Card>
    <Card title="Estrelas recebidas" subtitle="O que os teus fãs te ofereceram (conta para os teus ganhos).">
      <Stats items={[["Recebidas", count(data.received.stars)], ["Valem", kz(data.received.value_kz)]]} />
    </Card>
    <Card title="Movimentos">
      {data.history.length === 0 ? <Empty text="Ainda não há movimentos." icon="star-outline" />
        : data.history.map(item => {
          const [label, icon, tone] = KIND_LABELS[item.kind] || [item.kind, "ellipse", colors.muted];
          return <Row key={item.id} icon={icon} tone={tone} title={`${label}${item.display_name ? ` ${item.display_name}` : ""}`}
            subtitle={dateTime(item.created_at)}
            right={<Text style={{ fontWeight: "800", color: item.amount > 0 ? colors.good : colors.text }}>{item.amount > 0 ? "+" : ""}{item.amount} ★</Text>} />;
        })}
    </Card>
    <PaymentSheet visible={Boolean(pack)} title={pack ? `${pack.stars}${pack.bonus ? ` + ${pack.bonus}` : ""} estrelas` : ""} amount={pack?.price} purpose="stars"
      onClose={() => setPack(null)}
      start={choice => api("/stars/purchase", { method: "POST", body: { pack: pack.index, ...choice } })}
      onPaid={() => { setPack(null); setMessage("Estrelas compradas!"); load(); }} />
  </Page>;
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", padding: 20, borderRadius: 18, backgroundColor: colors.ink, gap: 2 },
  balance: { color: "#fff", fontSize: 40, fontWeight: "800" },
  balanceLabel: { color: "rgba(255,255,255,0.8)" },
  packs: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pack: { flexGrow: 1, flexBasis: "45%", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, gap: 2 },
  packStars: { color: colors.text, fontSize: 22, fontWeight: "800" },
  bonus: { color: colors.good, fontWeight: "800", fontSize: 12 },
  price: { color: colors.primary, fontWeight: "800", marginTop: 4 }
});
