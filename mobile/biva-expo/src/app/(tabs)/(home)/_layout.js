import { Stack } from "expo-router";
import { nativeHeaderOptions } from "../../../lib/headers";

export default function HomeStack() {
  return <Stack screenOptions={nativeHeaderOptions}>
    <Stack.Screen name="index" options={{ title: "Tchilar" }} />
  </Stack>;
}
