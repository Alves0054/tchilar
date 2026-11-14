import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

// Mensagens por ler (o número no separador Mensagens).
function useUnreadMessages(enabled) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const load = () => api("/messages/unread-count").then(result => setCount(result.unread ?? result.count ?? 0)).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    const listener = AppState.addEventListener("change", state => { if (state === "active") load(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [enabled]);
  return count;
}

// Barra de baixo NATIVA do sistema: no iOS 26 é de vidro (Liquid Glass) e no Android segue o Material You.
// Acompanha sozinha as atualizações do iOS e do Android, porque é o próprio sistema que a desenha.
export default function TabsLayout() {
  const { user, ready } = useSession();
  const unreadMessages = useUnreadMessages(Boolean(user));
  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View>;
  if (!user) return <Redirect href="/login" />;
  return <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
    <NativeTabs.Trigger name="(home)">
      <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
      <NativeTabs.Trigger.Label>Início</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="reels">
      <NativeTabs.Trigger.Icon sf={{ default: "play.rectangle", selected: "play.rectangle.fill" }} md="smart_display" />
      <NativeTabs.Trigger.Label>Reels</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="publish">
      <NativeTabs.Trigger.Icon sf={{ default: "plus.circle", selected: "plus.circle.fill" }} md="add_circle" />
      <NativeTabs.Trigger.Label>Publicar</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="messages">
      <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} md="chat" />
      <NativeTabs.Trigger.Label>Mensagens</NativeTabs.Trigger.Label>
      {unreadMessages > 0 && <NativeTabs.Trigger.Badge>{unreadMessages > 20 ? "20+" : String(unreadMessages)}</NativeTabs.Trigger.Badge>}
    </NativeTabs.Trigger>
    <NativeTabs.Trigger name="menu">
      <NativeTabs.Trigger.Icon sf={{ default: "line.3.horizontal", selected: "line.3.horizontal" }} md="menu" />
      <NativeTabs.Trigger.Label>Menu</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>;
}
