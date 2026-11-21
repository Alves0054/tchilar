// Prémios de um desafio por lugar (estrelas e dinheiro) e o nome do nível.
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { colors } from "../lib/theme";
import { count, kz } from "./ui";

export const LEVELS = { 1: ["Bronze", "#A0673A"], 2: ["Prata", "#8E8E93"], 3: ["Ouro", "#E5A000"], 4: ["Diamante", "#0A84FF"], 5: ["Lenda", "#AF52DE"] };
const RANK = ["#E5A000", "#8E8E93", "#A0673A"];

export function LevelBadge({ level }) {
  if (!LEVELS[level]) return null;
  return <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: LEVELS[level][1] }}>
    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{LEVELS[level][0]}</Text>
  </View>;
}

export function PrizeList({ prizes, people }) {
  const list = (prizes || []).filter(prize => prize.stars || Number(prize.cashKz) || prize.cash_kz);
  if (!list.length) return null;
  return <View style={{ gap: 6 }}>
    {list.map(prize => <View key={prize.place} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: RANK[prize.place - 1] || colors.primarySoft }}>
        <Text style={{ color: prize.place <= 3 ? "#fff" : colors.text, fontWeight: "800", fontSize: 12 }}>{prize.place}</Text>
      </View>
      {people && <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>{prize.display_name}</Text>}
      {prize.stars > 0 && <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><Ionicons name="star" size={14} color="#E5A000" /><Text style={{ color: colors.text, fontWeight: "700" }}>{count(prize.stars)}</Text></View>}
      {Number(prize.cashKz ?? prize.cash_kz) > 0 && <Text style={{ color: "#30B350", fontWeight: "800" }}>+ {kz(prize.cashKz ?? prize.cash_kz)}</Text>}
    </View>)}
  </View>;
}

// Tempo que falta e o prémio de um lugar numa frase ("25 000 Kz + 1 000 estrelas").
const DAY = 24 * 60 * 60 * 1000;
const daysLeft = endsAt => Math.max(0, Math.ceil((new Date(endsAt) - Date.now()) / DAY));
export const timeLeft = challenge => !challenge.is_open ? "Terminado" : daysLeft(challenge.ends_at) <= 1 ? "Termina hoje" : `Faltam ${daysLeft(challenge.ends_at)} dias`;
export const cash = prize => Number(prize?.cashKz ?? prize?.cash_kz) || 0;
export const prizeHeadline = prize => !prize ? "Sem prémio"
  : [cash(prize) ? kz(cash(prize)) : "", prize.stars ? `${count(prize.stars)} estrelas` : ""].filter(Boolean).join(" + ") || "Sem prémio";

