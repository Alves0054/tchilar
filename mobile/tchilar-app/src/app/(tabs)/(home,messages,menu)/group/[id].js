import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { GroupChat, GroupEvents, GroupFiles, GroupMembers, GroupPolls, GroupSettings, GroupStats } from "../../../../components/GroupTabs";
import { RowsSkeleton } from "../../../../components/Loaders";
import { REPORT_REASONS, useOptions } from "../../../../components/OptionsSheet";
import { PaymentSheet } from "../../../../components/PaymentSheet";
import { PostCard } from "../../../../components/PostCard";
import { Badge, Button, Card, Loading, kz } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { groupCategoryPath, groupPrivacy, groupType, isTeam } from "../../../../lib/groups";
import { useKeyboardOverlap } from "../../../../lib/keyboard";
import { useSession } from "../../../../lib/session";
import { colors } from "../../../../lib/theme";

const TABS = [["posts", "Publicações", "newspaper-outline"], ["chat", "Chat", "chatbubbles-outline"], ["events", "Eventos", "calendar-outline"],
  ["polls", "Sondagens", "bar-chart-outline"], ["files", "Ficheiros", "folder-outline"], ["members", "Membros", "people-outline"], ["about", "Sobre", "information-circle-outline"]];

// Um grupo por dentro: cabeçalho, separadores (como no site) e, para a equipa, estatísticas e definições.
export default function Group() {
  const { id } = useLocalSearchParams();
  const { user } = useSession();
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();
  const [group, setGroup] = useState(null);
  const [posts, setPosts] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState("posts");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [options, choose] = useOptions();
  const [activeCall, setActiveCall] = useState(undefined);
  const [renewing, setRenewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = (await api(`/groups/${id}`)).group;
      setGroup(found);
      if (found.is_member) {
        const [all, top] = await Promise.all([api(`/posts?groupId=${id}`), api(`/posts?groupId=${id}&pinned=1`)]);
        setPinned(top.posts);
        setPosts(all.posts.filter(post => !top.posts.some(item => item.id === post.id)));
      } else setPosts([]);
      if (isTeam(found.my_role) && found.requires_approval) setRequests((await api(`/groups/${id}/requests`)).requests);
      if (found.is_member) setActiveCall((await api(`/groups/${id}/call`)).call);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Ao voltar de uma chamada (ou a cada 15 s), atualiza o aviso "chamada a decorrer".
  useEffect(() => {
    const timer = setInterval(() => { api(`/groups/${id}/call`).then(result => setActiveCall(result.call)).catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [id]);

  const run = async task => {
    try { await task(); await load(); } catch (actError) { Alert.alert("Grupo", actError.message); }
  };
  if (!group) return error ? <Text style={styles.state}>{error}</Text> : <Loading />;
  const role = group.my_role;
  const team = isTeam(role);
  const admin = role === "owner" || role === "admin";
  const tabs = [...TABS, ...(team ? [["stats", "Estatísticas", "stats-chart-outline"]] : []), ...(admin ? [["settings", "Definições", "settings-outline"]] : [])];
  const privacy = groupPrivacy(group);

  const report = async () => {
    const reason = await choose("Porque estás a denunciar este grupo?", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
    if (reason) run(async () => { await api("/reports", { method: "POST", body: { targetType: "group", targetId: group.id, reason } }); Alert.alert("Obrigado", "A equipa de moderação vai analisar."); });
  };
  // Opções da equipa no "…" de cada publicação.
  const postOptions = post => team ? [
    post.pinned_at
      ? { key: "unpin", label: "Desafixar", icon: "pin-outline", onPress: () => run(() => api(`/groups/${group.id}/pins/${post.id}`, { method: "DELETE" })) }
      : { key: "pin", label: "Fixar no topo", icon: "pin", onPress: () => run(() => api(`/groups/${group.id}/pins/${post.id}`, { method: "POST" })) },
    ...(post.user_id !== user?.id ? [{ key: "hide", label: "Esconder (não cumpre as regras)", icon: "eye-off-outline", danger: true,
      onPress: () => Alert.alert("Esconder publicação", "O autor é avisado.", [{ text: "Cancelar", style: "cancel" }, { text: "Esconder", style: "destructive", onPress: () => run(() => api(`/groups/${group.id}/posts/${post.id}/hide`, { method: "POST" })) }]) }] : [])
  ] : [];

  const joinArea = group.is_member
    ? <>
      <Button small label="Publicar no grupo" icon="create" onPress={() => router.push({ pathname: "/create", params: { groupId: group.id, targetName: group.name } })} />
      {role !== "owner" && <Button small variant="secondary" label="Sair" onPress={() => run(() => api(`/groups/${group.id}/leave`, { method: "POST" }))} />}
    </>
    : group.has_requested ? <Badge label="Pedido enviado" tone="info" />
      : group.invite_only ? (group.has_invite ? <Button small label="Aceitar convite" icon="checkmark" onPress={() => run(() => api(`/groups/${group.id}/join`, { method: "POST" }))} /> : <Badge label="Só por convite" tone="neutral" />)
        : <Button small label={group.requires_approval ? "Pedir para entrar" : "Participar"} onPress={() => run(() => api(`/groups/${group.id}/join`, { method: "POST" }))} />;

  const header = <View style={{ padding: 12, gap: 12 }}>
    <Card title={group.name} subtitle={`${groupType(group.group_type).label} · ${groupCategoryPath(group)}\n${group.member_count} ${group.member_count === 1 ? "membro" : "membros"} · criado por ${group.owner_name}`}
      right={<Badge label={privacy?.label} tone={group.is_secret ? "warning" : "info"} />}>
      {Boolean(group.description) && <Text style={{ color: colors.text, lineHeight: 20 }}>{group.description}</Text>}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{joinArea}</View>
    </Card>
    {group.my_access_until && (() => {
      // Grupo mensal: até quando vai o acesso; nos últimos 7 dias pode pagar o mês seguinte.
      const daysLeft = Math.ceil((new Date(group.my_access_until).getTime() - Date.now()) / 86_400_000);
      const canRenew = daysLeft > 0 && daysLeft <= 7;
      const until = new Date(group.my_access_until).toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric" });
      return <View style={[styles.access, canRenew && { borderColor: colors.accent }]}>
        <Text style={styles.accessTitle}>O teu acesso vai até {until}.</Text>
        <Text style={styles.accessSub}>{canRenew ? `Faltam ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}. Renova para não saíres do grupo.` : "Podes renovar nos últimos 7 dias."}</Text>
        {canRenew && <Button small label={`Renovar por ${kz(group.access_price)}/mês`} icon="refresh" onPress={() => setRenewing(true)} />}
      </View>;
    })()}
    <PaymentSheet visible={renewing} title={`Mensalidade de ${group.name} (1 mês)`} amount={group.access_price} purpose="group_access" onClose={() => setRenewing(false)}
      start={choice => api(`/groups/${group.id}/access`, { method: "POST", body: { name: group.name, ...choice } })}
      onPaid={() => { setRenewing(false); load(); }} />
    {group.is_member && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {tabs.map(([key, label, icon]) => <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}>
        <Ionicons name={icon} size={16} color={tab === key ? colors.onPrimary : colors.text} />
        <Text style={[styles.tabText, tab === key && { color: colors.onPrimary }]}>{label}</Text>
        {key === "members" && requests.length > 0 && <View style={styles.dot}><Text style={styles.dotText}>{requests.length}</Text></View>}
      </Pressable>)}
    </ScrollView>}
    {group.is_member && activeCall !== undefined && <View style={[styles.callBar, activeCall && styles.callLive]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.callTitle}>{activeCall ? `Chamada de ${activeCall.kind === "voice" ? "voz" : "vídeo"} a decorrer` : "Falar com o grupo"}</Text>
        <Text style={styles.callSub} numberOfLines={1}>{activeCall ? activeCall.participants.map(p => p.display_name).join(", ") : "Até 8 pessoas ao mesmo tempo."}</Text>
      </View>
      {activeCall
        ? <Button small label="Entrar" icon={activeCall.kind === "voice" ? "call" : "videocam"} onPress={() => router.push({ pathname: "/call/[groupId]", params: { groupId: group.id, kind: activeCall.kind, name: group.name } })} />
        : <>
          <Pressable style={styles.callIcon} onPress={() => router.push({ pathname: "/call/[groupId]", params: { groupId: group.id, kind: "voice", name: group.name } })} accessibilityLabel="Chamada de voz"><Ionicons name="call" size={20} color={colors.text} /></Pressable>
          <Pressable style={styles.callIcon} onPress={() => router.push({ pathname: "/call/[groupId]", params: { groupId: group.id, kind: "video", name: group.name } })} accessibilityLabel="Chamada de vídeo"><Ionicons name="videocam" size={20} color={colors.text} /></Pressable>
        </>}
    </View>}
    {team && requests.length > 0 && (tab === "posts" || tab === "members") && <Card title={`Pedidos para entrar (${requests.length})`}>
      {requests.map(person => <View key={person.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Avatar user={person} size={40} />
        <Text style={{ flex: 1, color: colors.text, fontWeight: "700" }}>{person.display_name}</Text>
        <Button small label="Aceitar" onPress={() => run(() => api(`/groups/${group.id}/requests/${person.id}`, { method: "POST", body: { approve: true } }))} />
        <Button small variant="secondary" label="Recusar" onPress={() => run(() => api(`/groups/${group.id}/requests/${person.id}`, { method: "POST", body: { approve: false } }))} />
      </View>)}
    </Card>}
  </View>;

  const about = <View style={{ gap: 12 }}>
    <Card title="Sobre o grupo">
      <Text style={styles.line}>{groupType(group.group_type).label} · {groupCategoryPath(group)}</Text>
      <Text style={styles.line}>{privacy?.label}: {privacy?.help}</Text>
      <Text style={styles.line}>Criado por {group.owner_name} em {new Date(group.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}</Text>
    </Card>
    {Boolean(group.rules) && <Card title="Regras"><Text style={styles.rules}>{group.rules}</Text></Card>}
    <Button variant="ghost" small icon="flag-outline" label="Denunciar grupo" onPress={report} />
  </View>;

  // Separadores que não são a lista de publicações: um ScrollView com o conteúdo.
  if (group.is_member && tab !== "posts") {
    return <View ref={keyboardRef} style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: group.name }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
        {header}
        <View style={{ paddingHorizontal: 12, paddingBottom: 40 }}>
          {tab === "chat" && <GroupChat group={group} me={user} keyboardOverlap={keyboardOverlap} />}
          {tab === "events" && <GroupEvents group={group} />}
          {tab === "polls" && <GroupPolls group={group} me={user} />}
          {tab === "files" && <GroupFiles group={group} me={user} />}
          {tab === "members" && <GroupMembers group={group} me={user} onChanged={load} />}
          {tab === "about" && about}
          {tab === "stats" && <GroupStats group={group} />}
          {tab === "settings" && <GroupSettings group={group} onSaved={load} />}
        </View>
      </ScrollView>
      {options}
    </View>;
  }

  return <>
    <Stack.Screen options={{ title: group.name }} />
    <FlatList contentInsetAdjustmentBehavior="automatic"
      data={group.is_member ? [...pinned, ...(posts || [])] : []}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} extraOptions={postOptions(item)} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      ListHeaderComponent={<>{header}{!group.is_member && <View style={{ paddingHorizontal: 12 }}>{about}</View>}</>}
      ListEmptyComponent={posts === null ? <RowsSkeleton rows={3} /> : <Text style={styles.state}>
        {group.is_member ? "Ainda não há publicações. Sê o primeiro!"
          : group.invite_only ? "Este grupo é privado: só entra quem for convidado."
            : "As publicações, o chat e os ficheiros só são visíveis para os membros."}</Text>}
    />
    {options}
  </>;
}

const styles = StyleSheet.create({
  access: { gap: 6, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  accessTitle: { color: colors.text, fontWeight: "800", fontSize: 15 },
  accessSub: { color: colors.muted, fontSize: 13 },
  state: { padding: 32, textAlign: "center", color: colors.muted },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  dot: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  dotText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  line: { color: colors.text, lineHeight: 20 },
  rules: { color: colors.text, lineHeight: 21 },
  callBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.line },
  callLive: { borderColor: "#1FA45A", borderWidth: 2 },
  callTitle: { color: colors.text, fontWeight: "800" },
  callSub: { color: colors.muted, fontSize: 13 },
  callIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }
});
