import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Button, Card, Empty, Loading, Notice, Page, count } from "../../components/ui";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

// Um desafio: ranking por gostos e, enquanto está aberto, participar com uma publicação pública tua.
export default function Challenge() {
  const { id } = useLocalSearchParams();
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [myPosts, setMyPosts] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => api(`/challenges/${id}`).then(setData).catch(loadError => setError(loadError.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;
  const joined = data.ranking.some(entry => entry.username === user?.username);

  const choose = async () => {
    const result = await api(`/posts?username=${encodeURIComponent(user.username)}`);
    setMyPosts(result.posts.filter(post => !post.is_exclusive && !post.group_id && !post.shared_post_id));
  };
  const join = async postId => {
    setError("");
    try {
      await api(`/challenges/${id}/entries`, { method: "POST", body: { postId } });
      setMyPosts(null);
      setMessage("Estás a participar! Partilha a publicação para ganhar gostos.");
      load();
    } catch (joinError) {
      setError(joinError.message);
    }
  };

  return <Page>
    <Stack.Screen options={{ title: data.challenge.title }} />
    <Card title={data.challenge.title} subtitle={`🏆 ${data.challenge.prize || `${data.challenge.prize_stars} estrelas`} · ${data.challenge.entries} participantes`}>
      {Boolean(data.challenge.description) && <Text style={{ color: colors.text, lineHeight: 20 }}>{data.challenge.description}</Text>}
      {data.challenge.is_open && !joined && !myPosts && <Button label="Participar" icon="trophy" onPress={choose} />}
    </Card>
    <Notice error={error} message={message} />
    {myPosts && <Card title="Escolhe a tua publicação" subtitle="Só publicações públicas tuas.">
      {myPosts.length === 0 ? <Empty text="Ainda não tens publicações públicas. Publica primeiro!" />
        : myPosts.map(post => <Pressable key={post.id} onPress={() => join(post.id)} style={{ padding: 10, borderRadius: 12, backgroundColor: colors.background }}>
          <Text numberOfLines={2} style={{ color: colors.text }}>{post.body || (post.media_type === "video" ? "[vídeo]" : "[foto]")}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{count(post.likes)} gostos</Text>
        </Pressable>)}
    </Card>}
    <Card title="Ranking">
      {data.ranking.length === 0 ? <Empty text="Ainda ninguém participa. Sê o primeiro!" icon="podium-outline" />
        : data.ranking.map((entry, index) => <Pressable key={entry.post_id} onPress={() => router.push(`/u/${entry.username}`)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ width: 28, fontSize: 18, fontWeight: "800", color: index < 3 ? "#E8890C" : colors.muted }}>{index + 1}</Text>
          <Avatar user={entry} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>{entry.display_name}</Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{entry.excerpt || "[foto/vídeo]"}</Text>
          </View>
          <Text style={{ fontWeight: "800", color: colors.accent }}>♥ {count(entry.likes)}</Text>
        </Pressable>)}
    </Card>
  </Page>;
}
