import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import { Linking, Share, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { Badge, Button, Card, Chips, Empty, Loading, Notice, Page, Stats, dateOnly } from "../../../components/ui";
import { WEB_URL, api } from "../../../lib/api";
import { colors } from "../../../lib/theme";

// Convidar amigos: o link pessoal, partilhar por WhatsApp/SMS/etc. e quem já entrou pelo teu convite.
export default function Invite() {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [province, setProvince] = useState("");
  const [ranking, setRanking] = useState(null);
  useEffect(() => {
    api(`/referrals/ranking${province ? `?province=${encodeURIComponent(province)}` : ""}`).then(setRanking).catch(() => setRanking(null));
  }, [province]);
  const load = useCallback(() => api("/referrals").then(setData).catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;

  const link = `${WEB_URL}/register?convite=${encodeURIComponent(data.code)}`;
  const share = () => Share.share({ message: `Junta-te a mim no Tchilar! ${link}`, url: link, title: "Vem para o Tchilar" });
  const whatsapp = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`Junta-te a mim no Tchilar, a rede social angolana! ${link}`)}`)
    .catch(share);
  const copy = async () => { await Clipboard.setStringAsync(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <Card title="Convida os teus amigos" subtitle={`Ganhas ${data.bonus} estrelas por cada amigo que entra e publica pela primeira vez.`}>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.background }}>
        <Text selectable style={{ color: colors.text, fontWeight: "700" }}>{link}</Text>
      </View>
      <Button label="Enviar pelo WhatsApp" icon="logo-whatsapp" onPress={whatsapp} />
      <Button label="Partilhar convite" icon="share-social" variant="secondary" onPress={share} />
      <Button label={copied ? "Link copiado!" : "Copiar link"} icon="copy" variant="secondary" onPress={copy} />
    </Card>
    <Card title="Ranking do mês" subtitle="Quem trouxe mais amigos este mês (que já confirmaram o email e publicaram). Recomeça no dia 1.">
      <Chips value={province} onChange={setProvince} options={[["", "Angola"], ...(ranking?.provinces || []).map(name => [name, name])]} />
      {ranking && !ranking.ranking.length ? <Empty text={`Ainda ninguém ${province ? `em ${province} ` : ""}trouxe amigos este mês.`} icon="trophy-outline" />
        : ranking?.ranking.map(row => <View key={row.username} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 6, borderRadius: 10,
          backgroundColor: row.is_me ? colors.background : "transparent" }}>
          <Text style={{ width: 26, textAlign: "center", fontWeight: "800", fontSize: 16, color: row.position <= 3 ? "#E30613" : colors.text }}>{row.position}</Text>
          <Avatar user={row} size={34} />
          <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: "700" }}>{row.display_name}</Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>@{row.username}</Text></View>
          <Text style={{ color: colors.text, fontWeight: "700" }}>{row.invited} {row.invited === 1 ? "amigo" : "amigos"}</Text>
        </View>)}
      {ranking && <Text style={{ color: colors.muted, fontSize: 12 }}>{ranking.me.position ? `Estás em ${ranking.me.position}.º lugar com ${ranking.me.invited} ${ranking.me.invited === 1 ? "amigo" : "amigos"}.` : "Ainda não tens amigos a contar este mês."}
        {province ? " Nas províncias só aparece quem escolheu mostrar a província." : ""}</Text>}
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
