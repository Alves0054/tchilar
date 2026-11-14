import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Alert, Pressable } from "react-native";
import { ActionButton, CommunityCard, CommunityList } from "../components/CommunityList";
import { api } from "../lib/api";
import catalog from "../lib/community-types.json";
import { colors } from "../lib/theme";

const typeOf = key => catalog.pageTypes.find(type => type.key === key);
const categoryLabel = page => typeOf(page.page_type)?.categories.find(item => item.key === page.category)?.label || page.category;
const FILTERS = [
  { key: "all", label: "Todas", test: () => true },
  { key: "following", label: "A seguir", test: page => page.is_following },
  ...catalog.pageTypes.map(type => ({ key: type.key, label: type.label, test: page => page.page_type === type.key }))
];

export default function Pages() {
  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push("/community/new?type=page")} hitSlop={10} accessibilityLabel="Criar">
      <Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable> }} />
    <CommunityList path="/pages" field="pages" filters={FILTERS} empty="Ainda não há páginas."
    renderRow={(page, update) => <Pressable onPress={() => router.push(`/page/${page.id}`)}><CommunityCard
      icon="flag"
      tone="#E8890C"
      title={page.name}
      lines={[`${categoryLabel(page)} · ${page.follower_count} ${page.follower_count === 1 ? "seguidor" : "seguidores"}`, page.description]}
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
