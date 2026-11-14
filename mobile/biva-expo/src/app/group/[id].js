import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { PostCard } from "../../components/PostCard";
import { Badge, Button, Card, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import catalog from "../../lib/community-types.json";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

// Um grupo por dentro: descrição, entrar/sair, pedidos (para o dono) e as publicações do grupo.
export default function Group() {
  const { id } = useLocalSearchParams();
  const { user } = useSession();
  const [group, setGroup] = useState(null);
  const [posts, setPosts] = useState(null);
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await api("/groups");
      const found = list.groups.find(item => String(item.id) === String(id));
      if (!found) throw new Error("Grupo não encontrado.");
      setGroup(found);
      const allowed = found.is_member || !found.requires_approval;
      setPosts(allowed ? (await api(`/posts?groupId=${id}`)).posts : []);
      if (found.owner_username === user?.username) setRequests((await api(`/groups/${id}/requests`)).requests);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [id, user?.username]);
  useEffect(() => { load(); }, [load]);

  const run = async task => {
    try { await task(); await load(); } catch (actError) { Alert.alert("Grupo", actError.message); }
  };
  if (!group) return error ? <Text style={styles.state}>{error}</Text> : <Loading />;
  const owner = group.owner_username === user?.username;
  const topic = catalog.groupTopics.find(item => item.key === group.topic)?.label || "Geral";

  return <>
    <Stack.Screen options={{ title: group.name }} />
    <FlatList contentInsetAdjustmentBehavior="automatic"
      data={posts || []}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={<View style={{ padding: 12, gap: 12 }}>
        <Card title={group.name} subtitle={`${topic} · ${group.member_count} ${group.member_count === 1 ? "membro" : "membros"} · criado por ${group.owner_name}`}
          right={<Badge label={group.is_secret ? "Secreto" : group.requires_approval ? "Privado" : "Público"} tone={group.is_secret ? "warning" : "info"} />}>
          {Boolean(group.description) && <Text style={{ color: colors.text, lineHeight: 20 }}>{group.description}</Text>}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {group.is_member
              ? <>
                <Button small label="Publicar no grupo" icon="create" onPress={() => router.push({ pathname: "/create", params: { groupId: group.id, targetName: group.name } })} />
                {!owner && <Button small variant="secondary" label="Sair" onPress={() => run(() => api(`/groups/${group.id}/leave`, { method: "POST" }))} />}
              </>
              : group.has_requested ? <Badge label="Pedido enviado" tone="info" />
                : <Button small label={group.requires_approval ? "Pedir para entrar" : "Participar"} onPress={() => run(() => api(`/groups/${group.id}/join`, { method: "POST" }))} />}
          </View>
        </Card>
        {owner && requests.length > 0 && <Card title={`Pedidos para entrar (${requests.length})`}>
          {requests.map(person => <View key={person.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar user={person} size={40} />
            <Text style={{ flex: 1, color: colors.text, fontWeight: "700" }}>{person.display_name}</Text>
            <Button small label="Aceitar" onPress={() => run(() => api(`/groups/${group.id}/requests/${person.id}`, { method: "POST", body: { approve: true } }))} />
            <Button small variant="secondary" label="Recusar" onPress={() => run(() => api(`/groups/${group.id}/requests/${person.id}`, { method: "POST", body: { approve: false } }))} />
          </View>)}
        </Card>}
        <Text style={styles.section}>Publicações</Text>
      </View>}
      ListEmptyComponent={posts === null ? <Loading /> : <Text style={styles.state}>
        {group.is_member || !group.requires_approval ? "Ainda não há publicações. Sê o primeiro!" : "Entra no grupo para ver as publicações."}</Text>}
    />
  </>;
}

const styles = StyleSheet.create({
  section: { color: colors.text, fontSize: 17, fontWeight: "800" },
  state: { padding: 32, textAlign: "center", color: colors.muted }
});
