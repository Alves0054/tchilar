import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { ActionButton, CommunityCard, CommunityList } from "../components/CommunityList";
import { api } from "../lib/api";
import catalog from "../lib/community-types.json";
import { colors } from "../lib/theme";

const topicLabel = key => catalog.groupTopics.find(topic => topic.key === key)?.label || "Geral";
const FILTERS = [
  { key: "all", label: "Todos", test: () => true },
  { key: "mine", label: "Os meus", test: group => group.is_member },
  { key: "discover", label: "Descobrir", test: group => !group.is_member }
];

function JoinButton({ group, update }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (group.is_member) {
        await api(`/groups/${group.id}/leave`, { method: "POST" });
        update({ is_member: false, member_count: group.member_count - 1 });
      } else {
        const result = await api(`/groups/${group.id}/join`, { method: "POST" });
        if (result.requested) update({ has_requested: true });
        else update({ is_member: true, member_count: group.member_count + 1 });
      }
    } catch (error) {
      Alert.alert("Grupos", error.message);
    } finally {
      setBusy(false);
    }
  };
  if (group.is_secret && !group.is_member) return null;
  const label = group.is_member ? "Membro" : group.has_requested ? "Pedido enviado" : group.requires_approval ? "Pedir" : "Participar";
  return <ActionButton label={label} active={group.is_member || group.has_requested} onPress={run} disabled={busy || (group.has_requested && !group.is_member)} />;
}

export default function Groups() {
  return <>
    <Stack.Screen options={{ headerRight: () => <View style={{ flexDirection: "row", gap: 16 }}>
      <Pressable onPress={() => router.push("/secret-groups")} hitSlop={10} accessibilityLabel="Grupos secretos"><Ionicons name="lock-closed" size={24} color={colors.primary} /></Pressable>
      <Pressable onPress={() => router.push("/community/new?type=group")} hitSlop={10} accessibilityLabel="Criar"><Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable>
    </View> }} />
    <CommunityList path="/groups" field="groups" filters={FILTERS} empty="Ainda não há grupos."
    renderRow={(group, update) => <Pressable onPress={() => router.push(`/group/${group.id}`)}><CommunityCard
      icon={group.is_secret ? "lock-closed" : "people"}
      tone={group.is_secret ? "#8E44AD" : "#2EAA6B"}
      title={group.name}
      lines={[
        `${topicLabel(group.topic)} · ${group.member_count} ${group.member_count === 1 ? "membro" : "membros"}${group.is_secret ? " · Secreto" : group.requires_approval ? " · Privado" : ""}`,
        group.description
      ]}
      action={<JoinButton group={group} update={update} />}
    /></Pressable>} />
  </>;
}
