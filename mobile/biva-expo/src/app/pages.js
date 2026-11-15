import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Alert, Pressable } from "react-native";
import { ActionButton, CommunityCard, CommunityList } from "../components/CommunityList";
import { api } from "../lib/api";
import { PAGE_CATEGORIES, pageCategoryLabel, pageType } from "../lib/pages";
import { colors } from "../lib/theme";


const FILTERS = [
  { key: "all", label: "Todas", test: () => true },
  { key: "following", label: "A seguir", test: page => page.is_following },
  // Uma por categoria de atividade; só aparecem as que têm páginas.
  ...PAGE_CATEGORIES.map(area => ({ key: area.key, label: area.label, onlyIfUsed: true, test: page => page.category === area.key }))
];

export default function Pages() {
  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push("/community/new?type=page")} hitSlop={10} accessibilityLabel="Criar">
      <Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable> }} />
    <CommunityList path="/pages" field="pages" filters={FILTERS} empty="Ainda não há páginas."
    renderRow={(page, update) => <Pressable onPress={() => router.push(`/page/${page.id}`)}><CommunityCard
      icon={pageType(page.page_type).ion}
      tone="#E8890C"
      title={page.name}
      lines={[`${pageType(page.page_type).label} · ${pageCategoryLabel(page)} · ${page.follower_count} ${page.follower_count === 1 ? "seguidor" : "seguidores"}`, page.description]}
      action={page.is_following
        ? <ActionButton label="A seguir" active disabled />
        : <ActionButton label="Seguir" onPress={async () => {
          try {
            await api(`/pages/${page.id}/follow`, { method: "POST" });
            update({ is_following: true, follower_count: page.follower_count + 1 });
          } catch (error) {
            Alert.alert("Páginas", error.message);
          }
        }} />}
    /></Pressable>} />
  </>;
}
