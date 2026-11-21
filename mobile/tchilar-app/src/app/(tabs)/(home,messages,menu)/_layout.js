// Uma pilha de ecrãs por separador (Início, Mensagens, Menu), com os mesmos ecrãs em todas: um perfil, um grupo
// ou uma publicação abrem dentro do separador onde estás e a barra de baixo continua sempre à vista.
// (Rotas partilhadas do Expo Router: a pasta "(home,messages,menu)" existe uma vez em cada separador.)
// Ficam fora, sem barra, só os ecrãs de ecrã inteiro: entrar, publicar, stories, chamadas e diretos.
import { Stack } from "expo-router";
import { useWindowDimensions } from "react-native";
import { nativeHeaderOptions } from "../../../lib/headers";

// O primeiro ecrã de cada separador.
export const unstable_settings = {
  anchor: "index",
  messages: { anchor: "messages" },
  menu: { anchor: "menu" }
};

const TITLES = {
  "post/[id]": "Publicação", "chat/[id]": "Conversa", search: "Pesquisar", notifications: "Notificações", friends: "Amigos",
  "group/[id]": "Grupo", "secret-groups": "Grupos secretos", academy: "Academia Tchilar", "academy/[id]": "Curso",
  "academy/edit/[id]": "Editar curso", "page/[id]": "Página", groups: "Grupos", pages: "Páginas", events: "Eventos",
  "event/[id]": "Evento", "u/[username]": "Perfil", "live/index": "Diretos", creator: "Painel do criador", stars: "Estrelas",
  brands: "Marcas", "challenges/index": "Desafios", "challenges/[id]": "Desafio", invite: "Convidar amigos", help: "Ajuda",
  "settings/index": "Definições e privacidade", "settings/[section]": "Definições", "admin/index": "Administração",
  "admin/[section]": "Administração", "admin/user/[id]": "Utilizador"
};

// iPad e tablets: o conteúdo fica numa coluna centrada e legível (as barras de cima e de baixo continuam a toda a
// largura). As Páginas usam uma coluna mais larga porque têm 2 ou 3 cartões por linha e uma coluna de resumo.
const COLUMN = 820;
const WIDE_COLUMN = 1180;
const WIDE_SCREENS = new Set(["pages", "page/[id]"]);

export default function TabStack({ segment }) {
  const { width } = useWindowDimensions();
  const column = max => ({ ...nativeHeaderOptions.contentStyle, paddingHorizontal: Math.max(0, Math.round((width - max) / 2)) });
  const screenOptions = { ...nativeHeaderOptions, contentStyle: column(COLUMN) };
  return <Stack screenOptions={screenOptions}>
    {segment === "(messages)" ? <Stack.Screen name="messages" options={{ title: "Mensagens", headerLargeTitle: true }} />
      : segment === "(menu)" ? <Stack.Screen name="menu" options={{ title: "Menu", headerLargeTitle: true }} />
        : <Stack.Screen name="index" options={{ title: "Tchilar" }} />}
    {Object.entries(TITLES).map(([name, title]) => <Stack.Screen key={name} name={name}
      options={WIDE_SCREENS.has(name) ? { title, contentStyle: column(WIDE_COLUMN) } : { title }} />)}
  </Stack>;
}
