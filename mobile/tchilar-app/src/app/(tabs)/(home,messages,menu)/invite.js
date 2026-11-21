import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Share, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { Badge, Button, Card, Empty, Loading, Notice, Page, Stats, dateOnly } from "../../../components/ui";
import { WEB_URL, api } from "../../../lib/api";
import { colors } from "../../../lib/theme";

// Convidar amigos: o link pessoal, partilhar por WhatsApp/SMS/etc. e quem já entrou pelo teu convite.
export default function Invite() {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api("/referrals").then(setData).catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;

  const link = `${WEB_URL}/register?convite=${encodeURIComponent(data.code)}`;
  const share = () => Share.share({ message: `Junta-te a mim no Tchilar! ${link}`, url: link, title: "Vem para o Tchilar" });
  const copy = async () => { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <Card title="Convida os teus amigos" subtitle={`Ganhas ${data.bonus} estrelas por cada amigo que entra e publica pela primeira vez.`}>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.background }}>
        <Text selectable style={{ color: colors.text, fontWeight: "700" }}>{link}</Text>
      </View>
      <Button label="Partilhar convite" icon="share-social" onPress={share} />
      <Button label={copied ? "Link copiado!" : "Copiar link"} icon="copy" variant="secondary" onPress={copy} />
    </Card>
    <Card title="Os teus convites">
      <Stats items={[["Convidados", data.invited], ["Recompensas", data.rewarded], ["Estrelas ganhas", data.rewarded * data.bonus]]} />
      {data.people.length === 0 ? <Empty text="Ainda ninguém entrou com o teu convite." icon="people-outline" />
        : data.people.map(person => <View key={person.username} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Avatar user={person} size={38} />
          <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{person.display_name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Entrou {dateOnly(person.created_at)}</Text></View>
          <Badge label={person.rewarded ? `+${data.bonus} ★` : "À espera da 1.ª publicação"} tone={person.rewarded ? "good" : "neutral"} />
        </View>)}
    </Card>
  </Page>;
}
