import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Button, Card, Chips, Empty, Loading, Notice, Page } from "../components/ui";
import { api } from "../lib/api";
import { colors, relativeTime } from "../lib/theme";

function Person({ person, children, online }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
    <Pressable onPress={() => router.push(`/u/${person.username}`)}>
      <Avatar user={person} size={50} />
      {online && <View style={{ position: "absolute", right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: "#2EAA6B", borderWidth: 2, borderColor: "#fff" }} />}
    </Pressable>
    <Pressable style={{ flex: 1 }} onPress={() => router.push(`/u/${person.username}`)}>
      <Text style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}>{person.display_name}</Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>@{person.username}{person.created_at ? ` · ${relativeTime(person.created_at)}` : ""}</Text>
    </Pressable>
    {children}
  </View>;
}

// Amigos, como no site: pedidos recebidos, sugestões e a lista de amigos (os online primeiro).
export default function Friends() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("requests");
  const [sent, setSent] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState({});
  const load = useCallback(() => api("/friends").then(result => {
    setData(result);
    if (!result.requests.length) setTab(current => current === "requests" ? "suggestions" : current);
  }).catch(error => setNotice({ error: error.message })).finally(() => setRefreshing(false)), []);
  useEffect(() => { load(); }, [load]);

  const run = async (task, message) => {
    setNotice({});
    try { await task(); setNotice({ message }); await load(); } catch (error) { setNotice({ error: error.message }); }
  };
  if (!data) return notice.error ? <Page><Notice {...notice} /></Page> : <Loading />;
  const online = data.friends.filter(friend => friend.online).length;

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <Chips value={tab} onChange={setTab} options={[["requests", `Pedidos (${data.requests.length})`], ["suggestions", "Sugestões"], ["friends", `Amigos (${data.friends.length})`]]} />
    <Notice {...notice} />
    {tab === "requests" && <Card title="Pedidos de amizade">
      {data.requests.length === 0 ? <Empty text="Não tens pedidos por responder." icon="person-add-outline" /> : data.requests.map(request => <Person key={request.id} person={request}>
        <View style={{ gap: 6 }}>
          <Button small label="Aceitar" onPress={() => run(() => api(`/friends/requests/${request.id}/accept`, { method: "POST" }), `Tu e ${request.display_name} são agora amigos.`)} />
          <Button small variant="secondary" label="Recusar" onPress={() => run(() => api(`/friends/requests/${request.id}/reject`, { method: "POST" }), "Pedido recusado.")} />
        </View>
      </Person>)}
    </Card>}
    {tab === "suggestions" && <Card title="Pessoas que talvez conheças">
      {data.suggestions.length === 0 ? <Empty text="Sem sugestões por agora." icon="people-outline" /> : data.suggestions.map(person => <Person key={person.id} person={person}>
        <Button small label={sent.includes(person.id) ? "Enviado" : "Adicionar"} disabled={sent.includes(person.id)}
          onPress={async () => {
            try { await api(`/friends/${person.id}/request`, { method: "POST" }); setSent(list => [...list, person.id]); } catch (error) { setNotice({ error: error.message }); }
          }} />
      </Person>)}
    </Card>}
    {tab === "friends" && <Card title="Os teus amigos" subtitle={online ? `${online} online agora` : null}>
      {data.friends.length === 0 ? <Empty text="Ainda não tens amigos. Vê as sugestões!" icon="people-outline" /> : data.friends.map(friend => <Person key={friend.id} person={friend} online={friend.online}>
        <Button small variant="secondary" label="Mensagem" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: friend.id, name: friend.display_name } })} />
      </Person>)}
    </Card>}
  </Page>;
}
