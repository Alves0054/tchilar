import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { api } from "../lib/api";
import { colors } from "../lib/theme";

// Pesquisar pessoas, com a barra de pesquisa nativa do sistema (vidro no iOS 26, Material no Android).
export default function Search() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) return setResults([]);
    const timer = setTimeout(() => {
      api(`/users/search?q=${encodeURIComponent(query)}`).then(result => setResults(result.users)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  return <>
    <Stack.Screen options={{
      title: "Pesquisar",
      headerSearchBarOptions: {
        placeholder: "Pesquisar no Tchilar",
        autoFocus: true,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        onChangeText: event => setTerm(event.nativeEvent.text)
      }
    }} />
    <FlatList contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      data={results}
      keyExtractor={item => String(item.id)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <Pressable style={styles.row} onPress={() => router.push(`/u/${item.username}`)}>
        <Avatar user={item} size={44} />
        <View><Text style={styles.name}>{item.display_name}</Text><Text style={styles.username}>@{item.username}</Text></View>
      </Pressable>}
      ListEmptyComponent={<Text style={styles.empty}>{term.trim().length < 2 ? "Escreve pelo menos 2 letras." : "Ninguém encontrado."}</Text>}
    />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  name: { color: colors.text, fontWeight: "700", fontSize: 16 },
  username: { color: colors.muted },
  empty: { color: colors.muted, textAlign: "center", padding: 24 }
});
