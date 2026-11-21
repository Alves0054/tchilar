// Um desafio (como no site): faixa com o nível e o tempo, pódio de prémios, regras, participar,
// a tua posição e a classificação por gostos.
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { LEVELS, cash, timeLeft } from "../../../../components/Prizes";
import { Button, Card, Empty, Loading, Notice, Page, count, kz } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { useSession } from "../../../../lib/session";
import { colors } from "../../../../lib/theme";

const PODIUM = { 1: ["#E5A000", 120, "🥇"], 2: ["#8E8E93", 96, "🥈"], 3: ["#A0673A", 80, "🥉"] };

function Podium({ prizes, awards }) {
  const places = [2, 1, 3].map(place => ({ place, prize: (prizes || []).find(item => item.place === place), award: (awards || []).find(item => item.place === place) }))
    .filter(item => item.prize && (item.prize.stars || cash(item.prize)));
  if (!places.length) return null;
  return <View style={styles.podium}>
    {places.map(({ place, prize, award }) => <View key={place} style={styles.podiumStep}>
      {award ? <Pressable style={{ alignItems: "center", gap: 2 }} onPress={() => router.push(`/u/${award.username}`)}>
        <Avatar user={award} size={36} /><Text style={styles.winner} numberOfLines={1}>{award.display_name}</Text>
      </Pressable> : <Text style={{ fontSize: 20 }}>{PODIUM[place][2]}</Text>}
      <View style={[styles.block, { backgroundColor: PODIUM[place][0], minHeight: PODIUM[place][1] }]}>
        <Text style={styles.blockPlace}>{place}.º</Text>
        {cash(prize) > 0 && <Text style={styles.blockCash}>{kz(cash(prize))}</Text>}
        {prize.stars > 0 && <Text style={styles.blockStars}>★ {count(prize.stars)}</Text>}
      </View>
    </View>)}
  </View>;
}

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
  const { challenge, ranking, awards } = data;
  const [levelName, tone] = LEVELS[challenge.level] || ["Desafio especial", "#6E6E73"];
  const myIndex = ranking.findIndex(entry => entry.username === user?.username);
  const hasCash = (challenge.prizes || []).some(prize => cash(prize) > 0);

  const choose = async () => {
    const result = await api(`/posts?username=${encodeURIComponent(user.username)}`);
    const since = challenge.new_posts_only ? new Date(challenge.starts_at) : null;
    setMyPosts(result.posts.filter(post => !post.is_exclusive && !post.group_id && !post.shared_post_id && (!since || new Date(post.created_at) >= since)));
  };
  const join = async postId => {
    setError("");
    try {
      await api(`/challenges/${id}/entries`, { method: "POST", body: { postId } });
      setMyPosts(null);
      setMessage("Estás a participar! Partilha a publicação para juntar gostos.");
      load();
    } catch (joinError) { setError(joinError.message); }
  };

  return <Page>
    <Stack.Screen options={{ title: "Desafio" }} />
    <View style={[styles.banner, { borderLeftColor: tone }]}>
      <View style={styles.bannerTop}>
        <View style={[styles.levelChip, { backgroundColor: tone }]}><Text style={styles.levelText}>🏆 {levelName}</Text></View>
        <Text style={[styles.time, !challenge.is_open && { color: colors.muted }]}>{timeLeft(challenge)}</Text>
      </View>
      <Text style={styles.title}>{challenge.title}</Text>
      <Text style={styles.muted}><Ionicons name="people" size={13} color={colors.muted} /> {count(challenge.entries)} participantes · {challenge.is_open ? "termina" : "terminou"} a {new Date(challenge.closed_at || challenge.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}</Text>
    </View>

    <Notice error={error} message={message} />

    <Card title={awards?.length ? "Vencedores" : "Prémios"}>
      <Podium prizes={challenge.prizes} awards={awards} />
      {hasCash && <Text style={styles.note}>O dinheiro entra no saldo de quem ganha e levanta-se para o IBAN no Painel do criador.</Text>}
    </Card>

    {challenge.is_open && <Card title={myIndex >= 0 ? "A tua participação" : "Participar"}>
      {myIndex >= 0 ? <>
        <Text style={styles.body}>Estás em <Text style={{ fontWeight: "800" }}>{myIndex + 1}.º lugar</Text> com {count(ranking[myIndex].likes)} gostos.
          {myIndex > 0 ? ` Faltam ${count(ranking[myIndex - 1].likes - ranking[myIndex].likes + 1)} gostos para subires.` : " Estás à frente!"}</Text>
        <Text style={styles.muted}>Partilha a tua publicação com amigos e grupos para juntar mais gostos.</Text>
      </> : !myPosts ? <>
        <Text style={styles.muted}>Publica algo sobre o tema e depois escolhe essa publicação aqui.</Text>
        <Button label="Participar" icon="trophy" onPress={choose} />
        <Button variant="secondary" label="Publicar primeiro" icon="add-circle" onPress={() => router.push("/create")} />
      </> : myPosts.length === 0 ? <>
        <Empty text={challenge.new_posts_only ? "Ainda não tens publicações públicas feitas desde que o desafio começou." : "Ainda não tens publicações públicas."} />
        <Button label="Publicar agora" icon="add-circle" onPress={() => router.push("/create")} />
      </> : <>
        <Text style={styles.muted}>Escolhe a publicação com que entras:</Text>
        {myPosts.map(post => <Pressable key={post.id} onPress={() => join(post.id)} style={styles.pick}>
          <Text numberOfLines={2} style={{ color: colors.text }}>{post.body || (post.media_type === "video" ? "[vídeo]" : "[foto]")}</Text>
          <Text style={styles.small}>{count(post.likes)} gostos · toca para entrar</Text>
        </Pressable>)}
        <Button variant="ghost" label="Cancelar" onPress={() => setMyPosts(null)} />
      </>}
    </Card>}

    <Card title="O desafio">
      <Text style={styles.body}>{challenge.description || "Participa com a tua melhor publicação."}</Text>
      {[challenge.new_posts_only && ["calendar-outline", "Só contam publicações feitas depois de o desafio começar."],
        ["heart-outline", "Ganha quem tiver mais gostos no fim (empate: entrou primeiro)."],
        ["checkmark-circle-outline", "Uma participação por pessoa, com uma publicação pública tua."]].filter(Boolean).map(([icon, text]) =>
        <View key={text} style={styles.fact}><Ionicons name={icon} size={16} color={colors.muted} /><Text style={styles.factText}>{text}</Text></View>)}
    </Card>

    <Card title="Classificação">
      {ranking.length === 0 ? <Empty text="Ainda ninguém participa. Sê o primeiro!" icon="podium-outline" />
        : ranking.map((entry, index) => <Pressable key={entry.post_id} onPress={() => router.push(`/u/${entry.username}`)}
          style={[styles.rankRow, index === myIndex && styles.rankMe]}>
          <Text style={[styles.rank, index < 3 && { color: PODIUM[index + 1][0] }]}>{index + 1}</Text>
          <Avatar user={entry} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rankName}>{entry.display_name}{index === myIndex ? " (tu)" : ""}</Text>
            {Boolean(entry.excerpt) && <Text style={styles.small} numberOfLines={1}>{entry.excerpt}</Text>}
          </View>
          <Text style={styles.likes}>♥ {count(entry.likes)}</Text>
        </Pressable>)}
    </Card>
  </Page>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 6, borderLeftWidth: 6 },
  bannerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  levelChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  levelText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  time: { color: "#30B350", fontWeight: "800", fontSize: 13 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  note: { color: colors.muted, fontSize: 12, textAlign: "center" },
  body: { color: colors.text, lineHeight: 21, fontSize: 15 },
  small: { color: colors.muted, fontSize: 12 },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  podiumStep: { flex: 1, alignItems: "center", gap: 6 },
  winner: { color: colors.text, fontSize: 11, fontWeight: "700", maxWidth: 90 },
  block: { width: "100%", borderTopLeftRadius: 12, borderTopRightRadius: 12, borderRadius: 4, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 8 },
  blockPlace: { color: "#fff", fontSize: 18, fontWeight: "800" },
  blockCash: { color: "#fff", fontSize: 12, fontWeight: "800" },
  blockStars: { color: "#fff", fontSize: 12 },
  pick: { padding: 10, borderRadius: 12, backgroundColor: colors.background, gap: 2 },
  fact: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  factText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 6, borderRadius: 12 },
  rankMe: { backgroundColor: colors.background },
  rank: { width: 26, fontSize: 18, fontWeight: "800", color: colors.muted, textAlign: "center" },
  rankName: { color: colors.text, fontWeight: "700" },
  likes: { color: colors.text, fontWeight: "800" }
});
