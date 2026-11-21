import { Ionicons } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import { Alert, Pressable } from "react-native";
import { colors } from "../../../lib/theme";
import { ActionButton, CommunityCard, CommunityList } from "../../../components/CommunityList";
import { api } from "../../../lib/api";

const when = value => new Date(value).toLocaleString("pt-PT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const FILTERS = [
  { key: "all", label: "Próximos", test: () => true },
  { key: "going", label: "Vou", test: event => event.is_attending }
];

export default function Events() {
  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push("/community/new?type=event")} hitSlop={10} accessibilityLabel="Criar">
      <Ionicons name="add-circle" size={28} color={colors.primary} /></Pressable> }} />
    <CommunityList path="/events" field="events" filters={FILTERS} empty="Não há eventos marcados."
    renderRow={(event, update) => <CommunityCard
      onPress={() => router.push(`/event/${event.id}`)}
      icon="calendar"
      tone="#F06A2A"
      title={event.name}
      lines={[when(event.starts_at), [event.location, `${event.attendee_count} ${event.attendee_count === 1 ? "vai" : "vão"}`].filter(Boolean).join(" · "), event.description]}
      action={event.ticket_price_kz > 0
        ? <ActionButton label={event.my_ticket ? "Bilhete ✓" : `${Number(event.ticket_price_kz).toLocaleString("pt-PT")} Kz`} active={Boolean(event.my_ticket)} onPress={() => router.push(`/event/${event.id}`)} />
        : <ActionButton label={event.is_attending ? "Vou" : "Participar"} active={event.is_attending} onPress={async () => {
        try {
          const result = await api(`/events/${event.id}/rsvp`, { method: "POST" });
          update({ is_attending: result.attending, attendee_count: event.attendee_count + (result.attending ? 1 : -1) });
        } catch (error) {
          Alert.alert("Eventos", error.message);
        }
      }} />}
    />} />
  </>;
}
