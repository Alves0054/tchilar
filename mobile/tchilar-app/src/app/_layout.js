import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OfflineBanner } from "../components/OfflineBanner";
import { installGlobalErrorReporting, reportError } from "../lib/errors";
import { colors } from "../lib/theme";
import { AppLock } from "../components/AppLock";
import { IncomingCall } from "../components/IncomingCall";
import { SessionProvider } from "../lib/session";
import { nativeHeaderOptions } from "../lib/headers";
import { listenToPushTaps } from "../lib/push";
import { isDark } from "../lib/theme";

installGlobalErrorReporting();

// Se um ecrã falhar, aparece isto em vez de um ecrã branco: o erro vai para a equipa (com uma referência)
// e a pessoa pode tentar outra vez ou voltar ao Início.
export function ErrorBoundary({ error, retry }) {
  const [reference] = useState(() => reportError(error, "screen"));
  return <View style={errorStyles.screen}>
    <Ionicons name="warning-outline" size={40} color={colors.text} />
    <Text style={errorStyles.title}>Algo correu mal neste ecrã</Text>
    <Text style={errorStyles.text}>A equipa do Tchilar já foi avisada.{reference ? ` Referência: ${reference}` : ""}</Text>
    <Pressable style={errorStyles.button} onPress={retry} accessibilityRole="button"><Text style={errorStyles.buttonText}>Tentar outra vez</Text></Pressable>
  </View>;
}

export default function RootLayout() {
  useEffect(() => listenToPushTaps(), []);
  return <SafeAreaProvider>
    <SessionProvider>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={nativeHeaderOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="create" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="story/new" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="story/[index]" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="community/new" options={{ title: "Criar", presentation: "modal" }} />
        <Stack.Screen name="live/[id]" options={{ title: "Direto" }} />
        <Stack.Screen name="call/[groupId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="call/direct/[callId]" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="live/new" options={{ title: "Entrar em direto", presentation: "fullScreenModal" }} />
      </Stack>
      <IncomingCall />
      <AppLock />
      <OfflineBanner />
    </SessionProvider>
  </SafeAreaProvider>;
}

const errorStyles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 28, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  text: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  button: { marginTop: 10, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 999 },
  buttonText: { color: colors.onPrimary, fontWeight: "800", fontSize: 15 }
});
