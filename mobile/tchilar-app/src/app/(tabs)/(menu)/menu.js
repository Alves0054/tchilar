import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { useSession } from "../../../lib/session";
import { colors } from "../../../lib/theme";

// Os mesmos atalhos do Menu do site, todos na app. Ícones em cores vivas e sólidas (sem vermelho, que fica
// para botões principais e notificações).
const SHORTCUTS = [
  { label: "Amigos", hint: "Pedidos, sugestões e amigos", icon: "person-add", tone: "#30B350", route: "/friends" },
  { label: "Grupos", hint: "Pessoas com os mesmos interesses", icon: "people", tone: "#0FA3B1", route: "/groups" },
  { label: "Páginas", hint: "Segue projetos e marcas", icon: "flag", tone: "#FF8A00", route: "/pages" },
  { label: "Eventos", hint: "Encontros perto de ti", icon: "calendar", tone: "#F06A2A", route: "/events" },
  { label: "Painel do criador", hint: "Insights, ganhos e promoções", icon: "stats-chart", tone: "#5E5CE6", route: "/creator" },
  { label: "Estrelas", hint: "Apoia os teus criadores", icon: "star", tone: "#E5A000", route: "/stars" },
  { label: "Marcas", hint: "Campanhas com criadores", icon: "briefcase", tone: "#2F80ED", route: "/brands" },
  { label: "Desafios", hint: "Participa e ganha prémios", icon: "trophy", tone: "#E5A000", route: "/challenges" },
  { label: "Academia Tchilar", hint: "Cresce como criador", icon: "school", tone: "#30B350", route: "/academy" },
  { label: "Convidar amigos", hint: "Ganha estrelas", icon: "gift", tone: "#F06A2A", route: "/invite" }
];

export default function Menu() {
  const { user, signOut } = useSession();
  const confirmSignOut = () => Alert.alert("Terminar sessão", "Queres sair da tua conta neste telemóvel?", [
    { text: "Cancelar", style: "cancel" },
    { text: "Sair", style: "destructive", onPress: signOut }
  ]);

  return <ScrollView contentContainerStyle={styles.screen} contentInsetAdjustmentBehavior="automatic">
    <Pressable style={styles.profile} onPress={() => router.push(`/u/${user.username}`)}>
      <Avatar user={user} size={52} />
      <View style={{ flex: 1 }}><Text style={styles.name}>{user.display_name}</Text><Text style={styles.hint}>Ver o teu perfil</Text></View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>

    <View style={styles.grid}>
      {SHORTCUTS.map(item => <Pressable key={item.label} style={styles.tile} onPress={() => router.push(item.route)}>
        <View style={[styles.tileIcon, { backgroundColor: item.tone }]}><Ionicons name={item.icon} size={22} color="#FFFFFF" /></View>
        <Text style={styles.tileLabel}>{item.label}</Text>
        <Text style={styles.tileHint} numberOfLines={2}>{item.hint}</Text>
      </Pressable>)}
    </View>

    <View style={styles.list}>
      {[
        ["settings-outline", "Definições e privacidade", () => router.push("/settings")],
        ["help-circle-outline", "Ajuda", () => router.push("/help")],
        ...(user.is_admin ? [["shield-checkmark-outline", "Administração", () => router.push("/admin")]] : []),
        ["log-out-outline", "Terminar sessão", confirmSignOut]
      ].map(([icon, label, onPress]) => <Pressable key={label} style={styles.row} onPress={onPress}>
        <View style={styles.rowIcon}><Ionicons name={icon} size={22} color={colors.text} /></View>
        <Text style={styles.rowText}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>)}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { padding: 12, gap: 12, paddingBottom: 32 },
  profile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  hint: { color: colors.muted },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48.5%", padding: 12, borderRadius: 16, backgroundColor: colors.surface, gap: 4, minHeight: 112 },
  tileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  tileLabel: { color: colors.text, fontSize: 15, fontWeight: "800" },
  tileHint: { color: colors.muted, fontSize: 12 },
  list: { borderRadius: 16, backgroundColor: colors.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" }
});
