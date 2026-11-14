import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Card, Field, Page, Row } from "../components/ui";
import { WEB_URL } from "../lib/api";
import topics from "../lib/help.json";
import { colors } from "../lib/theme";

// Ajuda: as mesmas perguntas frequentes do site (src/lib/help.json), com pesquisa.
export default function Help() {
  const [open, setOpen] = useState(null);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const filtered = topics
    .map(([topic, questions]) => [topic, questions.filter(([question, answer]) => !term || `${question} ${answer}`.toLowerCase().includes(term))])
    .filter(([, questions]) => questions.length);

  return <Page>
    <Field placeholder="Pesquisar na ajuda" value={search} onChangeText={setSearch} />
    {filtered.map(([topic, questions]) => <Card key={topic} title={topic}>
      {questions.map(([question, answer]) => {
        const expanded = open === question;
        return <Pressable key={question} onPress={() => setOpen(expanded ? null : question)} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderColor: colors.line }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "700", fontSize: 15 }}>{question}</Text>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </View>
          {expanded && <Text style={{ color: colors.muted, marginTop: 6, lineHeight: 20 }}>{answer}</Text>}
        </Pressable>;
      })}
    </Card>)}
    {filtered.length === 0 && <Text style={{ color: colors.muted, textAlign: "center" }}>Nenhuma resposta com essa pesquisa.</Text>}
    <Card title="Mais informação">
      <Row icon="document-text-outline" title="Termos de utilização" onPress={() => Linking.openURL(`${WEB_URL}/terms`)} />
      <Row icon="lock-closed-outline" title="Política de privacidade" onPress={() => Linking.openURL(`${WEB_URL}/privacy`)} />
      <Row icon="megaphone-outline" title="Regras de publicidade" onPress={() => Linking.openURL(`${WEB_URL}/publicidade`)} />
      <Row icon="information-circle-outline" title="Sobre o Tchilar" onPress={() => Linking.openURL(`${WEB_URL}/about`)} />
    </Card>
  </Page>;
}
