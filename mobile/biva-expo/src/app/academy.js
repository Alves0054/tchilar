import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Card, Page } from "../components/ui";
import guides from "../lib/academy.json";
import { colors } from "../lib/theme";

// Academia Tchilar: os mesmos guias do site (src/lib/academy.json, copiado de src/modules/growth.jsx).
const ICONS = { profile: "person-circle", create: "create", messages: "chatbubbles", trophy: "trophy", stats: "stats-chart", spark: "sparkles" };

export default function Academy() {
  return <Page>
    <View style={{ alignItems: "center", gap: 6, padding: 20, borderRadius: 18, backgroundColor: colors.ink }}>
      <Ionicons name="school" size={34} color="#30B350" />
      <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>Cresce como criador</Text>
      <Text style={{ color: "rgba(255,255,255,0.8)", textAlign: "center" }}>Guias curtos para chegares aos 10 mil seguidores e entrares no Programa de Parceiros.</Text>
    </View>
    {guides.map(([title, icon, tips], index) => <Card key={title} title={`${index + 1}. ${title}`}
      right={<Ionicons name={ICONS[icon] || "bulb"} size={24} color={colors.primary} />}>
      {tips.map(tip => <View key={tip} style={{ flexDirection: "row", gap: 8 }}>
        <Ionicons name="checkmark-circle" size={18} color="#2EAA6B" style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, color: colors.text, lineHeight: 20 }}>{tip}</Text>
      </View>)}
    </Card>)}
    <Button label="Abrir o Painel do Criador" icon="stats-chart" onPress={() => router.push("/creator")} />
  </Page>;
}
