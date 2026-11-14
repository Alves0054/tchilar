import { Stack } from "expo-router";
import { nativeHeaderOptions } from "../../../lib/headers";

export default function NotificationsStack() {
  return <Stack screenOptions={nativeHeaderOptions}>
    <Stack.Screen name="index" options={{ title: "Notificações", headerLargeTitle: true }} />
  </Stack>;
}
