import { Stack } from "expo-router";
import { nativeHeaderOptions } from "../../../lib/headers";

export default function MenuStack() {
  return <Stack screenOptions={nativeHeaderOptions}>
    <Stack.Screen name="index" options={{ title: "Menu", headerLargeTitle: true }} />
  </Stack>;
}
