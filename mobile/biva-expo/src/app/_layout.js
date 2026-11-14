import { Stack } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../lib/session";
import { nativeHeaderOptions } from "../lib/headers";
import { listenToPushTaps } from "../lib/push";

export default function RootLayout() {
  useEffect(() => listenToPushTaps(), []);
  return <SafeAreaProvider>
    <SessionProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={nativeHeaderOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="create" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="story/new" options={{ headerShown: false, presentation: "fullScreenModal" }} />
        <Stack.Screen name="story/[index]" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="post/[id]" options={{ title: "Comentários" }} />
        <Stack.Screen name="chat/[id]" options={{ title: "Conversa" }} />
        <Stack.Screen name="search" options={{ title: "Pesquisar" }} />
        <Stack.Screen name="notifications" options={{ title: "Notificações" }} />
        <Stack.Screen name="friends" options={{ title: "Amigos" }} />
        <Stack.Screen name="group/[id]" options={{ title: "Grupo" }} />
        <Stack.Screen name="secret-groups" options={{ title: "Grupos secretos" }} />
        <Stack.Screen name="academy" options={{ title: "Academia Tchilar" }} />
        <Stack.Screen name="page/[id]" options={{ title: "Página" }} />
        <Stack.Screen name="community/new" options={{ title: "Criar", presentation: "modal" }} />
        <Stack.Screen name="groups" options={{ title: "Grupos" }} />
        <Stack.Screen name="pages" options={{ title: "Páginas" }} />
        <Stack.Screen name="events" options={{ title: "Eventos" }} />
        <Stack.Screen name="u/[username]" options={{ title: "Perfil" }} />
        <Stack.Screen name="live/index" options={{ title: "Diretos" }} />
        <Stack.Screen name="live/[id]" options={{ title: "Direto" }} />
        <Stack.Screen name="live/new" options={{ title: "Entrar em direto", presentation: "fullScreenModal" }} />
        <Stack.Screen name="creator" options={{ title: "Painel do criador" }} />
        <Stack.Screen name="stars" options={{ title: "Estrelas" }} />
        <Stack.Screen name="brands" options={{ title: "Marcas" }} />
        <Stack.Screen name="challenges/index" options={{ title: "Desafios" }} />
        <Stack.Screen name="challenges/[id]" options={{ title: "Desafio" }} />
        <Stack.Screen name="invite" options={{ title: "Convidar amigos" }} />
        <Stack.Screen name="help" options={{ title: "Ajuda" }} />
        <Stack.Screen name="settings/index" options={{ title: "Definições e privacidade" }} />
        <Stack.Screen name="settings/[section]" options={{ title: "Definições" }} />
        <Stack.Screen name="admin/index" options={{ title: "Administração" }} />
        <Stack.Screen name="admin/[section]" options={{ title: "Administração" }} />
        <Stack.Screen name="admin/user/[id]" options={{ title: "Utilizador" }} />
      </Stack>
    </SessionProvider>
  </SafeAreaProvider>;
}
