import { Stack } from "expo-router";
import { nativeHeaderOptions } from "../../../lib/headers";

export default function MessagesStack() {
  return <Stack screenOptions={nativeHeaderOptions}>
    <Stack.Screen name="index" options={{ title: "Mensagens", headerLargeTitle: true }} />
  </Stack>;
}
