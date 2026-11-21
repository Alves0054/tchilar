// Separadores dentro de um grupo na app: chat, eventos, sondagens, ficheiros, membros, estatísticas e definições.
// Falam com /api/groups/:id/... (server/group-features.js), como no site.
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EventComposer, EventPoster } from "./EventComposer";
import { API_URL, api, upload } from "../lib/api";
import { GROUP_CATEGORIES, GROUP_PRIVACY, GROUP_TYPES, ROLE_LABELS, groupCategory, groupPrivacyOf, isTeam } from "../lib/groups";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";
import { ChatSkeleton, ListSkeleton, RowsSkeleton } from "./Loaders";
import { SelectBox, useOptions } from "./OptionsSheet";
import { Button, Card, Empty, Field, Notice } from "./ui";

const when = value => new Date(value).toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ask = (title, text) => new Promise(resolve => Alert.alert(title, text, [{ text: "Cancelar", style: "cancel", onPress: () => resolve(false) }, { text: "Sim", style: "destructive", onPress: () => resolve(true) }]));

// ----- Chat: vai buscando as mensagens novas de 4 em 4 segundos (só com a app aberta) -----
export function GroupChat({ group, me, keyboardOverlap = 0 }) {
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const lastId = useRef(null);
  const load = useCallback(async () => {
    try {
      const result = await api(`/groups/${group.id}/chat${lastId.current ? `?after=${lastId.current}` : ""}`);
      setMessages(current => {
        const next = lastId.current ? [...(current || []), ...result.messages] : result.messages;
        if (next.length) lastId.current = next[next.length - 1].id;
        return next;
      });
    } catch (loadError) { setError(loadError.message); }
  }, [group.id]);
  useEffect(() => {
    lastId.current = null; load();
    const timer = setInterval(() => { if (AppState.currentState === "active") load(); }, 4000);
    return () => clearInterval(timer);
  }, [load]);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    try { await api(`/groups/${group.id}/chat`, { method: "POST", body: { body } }); load(); } catch (sendError) { setError(sendError.message); setText(body); }
  };
  const remove = async message => {
    if (!(await ask("Apagar mensagem", "Apagar esta mensagem do chat?"))) return;
    try { await api(`/groups/${group.id}/chat/${message.id}`, { method: "DELETE" }); setMessages(current => current.filter(item => item.id !== message.id)); }
    catch (removeError) { setError(removeError.message); }
  };
  return <View style={{ gap: 10, paddingBottom: keyboardOverlap }}>
    {messages === null ? <ChatSkeleton /> : messages.length === 0 ? <Empty icon="chatbubbles-outline" text="Ainda ninguém escreveu. Diz olá ao grupo." /> : messages.map((message, index) => {
      const mine = message.user_id === me?.id;
      const follow = messages[index - 1]?.user_id === message.user_id;
      return <Pressable key={message.id} onLongPress={() => (mine || isTeam(group.my_role)) && remove(message)} delayLongPress={350}
        style={[styles.msgRow, mine && styles.msgMine, follow && { marginTop: -4 }]}>
        {!mine && <View style={{ width: 30 }}>{!follow && <Avatar user={message} size={30} />}</View>}
        <View style={[styles.bubble, mine && styles.bubbleMine]}>
          {!mine && !follow && <Text style={styles.msgName}>{message.display_name}</Text>}
          <Text style={[styles.msgText, mine && { color: colors.onPrimary }]}>{message.body}</Text>
          <Text style={[styles.msgTime, mine && { color: colors.onPrimary, opacity: 0.7 }]}>{when(message.created_at)}</Text>
        </View>
      </Pressable>;
    })}
    <Notice error={error} />
    <View style={styles.composer}>
      <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Escreve ao grupo..." placeholderTextColor={colors.muted} multiline maxLength={2000} />
      <Pressable style={[styles.send, !text.trim() && { opacity: 0.4 }]} onPress={send} disabled={!text.trim()} accessibilityLabel="Enviar"><Ionicons name="send" size={18} color={colors.onPrimary} /></Pressable>
    </View>
  </View>;
}

// ----- Eventos do grupo -----
// Eventos do grupo (igual ao site): criar abre a mesma janela dos outros eventos (calendário, imagem, cartaz)
// e a lista mostra cada evento em cartão, com o botão "Vou".
export function GroupEvents({ group }) {
  const [events, setEvents] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api(`/groups/${group.id}/events`).then(result => setEvents(result.events)).catch(loadError => setError(loadError.message)), [group.id]);
  useEffect(() => { load(); }, [load]);
  const rsvp = item => api(`/events/${item.id}/rsvp`, { method: "POST" }).then(load).catch(rsvpError => setError(rsvpError.message));
  return <View style={{ gap: 12 }}>
    <View style={styles.eventsHead}>
      <View style={{ flex: 1 }}><Text style={styles.eventsTitle}>Eventos do grupo</Text><Text style={styles.muted}>Só os membros veem estes eventos.</Text></View>
      <Button small label="Criar" icon="add" onPress={() => setCreating(true)} />
    </View>
    <Notice error={error} />
    {events === null ? <RowsSkeleton rows={3} /> : events.length === 0
      ? <Empty icon="calendar-outline" text="Ainda não há eventos marcados. Marca um encontro, um treino ou uma live: avisamos todos os membros." />
      : events.map(item => <EventPoster key={item.id} event={item} going={item.is_attending} onGoing={() => rsvp(item)} compact
        host={`${item.attendee_count} ${item.attendee_count === 1 ? "vai" : "vão"} · por ${item.creator_name}`} onPress={() => router.push(`/event/${item.id}`)} />)}
    <Modal visible={creating} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreating(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.sheetHead}>
          <Text style={styles.eventsTitle}>Novo evento do grupo</Text>
          <Pressable onPress={() => setCreating(false)} hitSlop={10} accessibilityLabel="Fechar"><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <EventComposer endpoint={`/groups/${group.id}/events`} groupName={group.name} onCancel={() => setCreating(false)}
            onCreated={() => { setCreating(false); load(); }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </View>;
}

// ----- Sondagens -----
export function GroupPolls({ group, me }) {
  const [polls, setPolls] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api(`/groups/${group.id}/polls`).then(result => setPolls(result.polls)).catch(loadError => setError(loadError.message)), [group.id]);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    try {
      await api(`/groups/${group.id}/polls`, { method: "POST", body: { question: form.question, options: form.options.filter(o => o.trim()), multiple: form.multiple, days: 7 } });
      setForm(null); setError(""); load();
    } catch (createError) { setError(createError.message); }
  };
  const vote = async (poll, option) => {
    const mine = poll.options.filter(o => o.mine).map(o => o.id);
    const next = poll.multiple ? (mine.includes(option.id) ? mine.filter(id => id !== option.id) : [...mine, option.id]) : (mine.includes(option.id) ? [] : [option.id]);
    try { await api(`/groups/${group.id}/polls/${poll.id}/vote`, { method: "POST", body: { optionIds: next } }); load(); } catch (voteError) { setError(voteError.message); }
  };
  const remove = async poll => {
    if (!(await ask("Apagar sondagem", poll.question))) return;
    try { await api(`/groups/${group.id}/polls/${poll.id}`, { method: "DELETE" }); load(); } catch (removeError) { setError(removeError.message); }
  };
  return <View style={{ gap: 12 }}>
    {form ? <Card title="Nova sondagem" subtitle="Fica aberta durante uma semana.">
      <Field label="Pergunta" value={form.question} onChangeText={question => setForm({ ...form, question })} maxLength={200} placeholder="Que dia preferem?" />
      {form.options.map((option, index) => <Field key={index} label={`Resposta ${index + 1}`} value={option} maxLength={100}
        onChangeText={value => setForm({ ...form, options: form.options.map((item, i) => i === index ? value : item) })} />)}
      {form.options.length < 10 && <Button small variant="ghost" icon="add" label="Mais uma resposta" onPress={() => setForm({ ...form, options: [...form.options, ""] })} />}
      <View style={styles.switchRow}><Text style={{ color: colors.text, flex: 1 }}>Permitir várias respostas</Text><Switch value={form.multiple} onValueChange={multiple => setForm({ ...form, multiple })} /></View>
      <Notice error={error} />
      <View style={styles.row}><Button variant="secondary" label="Cancelar" onPress={() => setForm(null)} /><Button label="Publicar" onPress={create} disabled={!form.question.trim()} /></View>
    </Card> : <Button label="Criar sondagem" icon="add" onPress={() => setForm({ question: "", options: ["", ""], multiple: false })} />}
    {!form && <Notice error={error} />}
    {polls === null ? <ListSkeleton cards={2} /> : polls.length === 0 ? <Empty icon="bar-chart-outline" text="Ainda não há sondagens. Pergunta ao grupo o que pensa." />
      : polls.map(poll => {
        const total = poll.options.reduce((sum, o) => sum + o.votes, 0);
        return <Card key={poll.id} title={poll.question} subtitle={`${poll.author_name || "Alguém"} · ${poll.voters} ${poll.voters === 1 ? "votou" : "votaram"}${poll.closed ? " · fechada" : ""}`}
          right={(poll.author_id === me?.id || isTeam(group.my_role)) ? <Pressable onPress={() => remove(poll)} hitSlop={10}><Ionicons name="trash-outline" size={20} color={colors.muted} /></Pressable> : null}>
          {poll.options.map(option => {
            const percent = total ? Math.round((option.votes / total) * 100) : 0;
            return <Pressable key={option.id} onPress={() => vote(poll, option)} disabled={poll.closed} style={[styles.option, option.mine && styles.optionMine]}>
              <View style={[styles.optionBar, { width: `${percent}%` }]} />
              <Text style={styles.optionText}>{option.mine ? "✓ " : ""}{option.label}</Text>
              <Text style={styles.muted}>{percent}%</Text>
            </Pressable>;
          })}
        </Card>;
      })}
  </View>;
}

// ----- Ficheiros -----
const sizeLabel = bytes => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const fileIcon = mime => mime.startsWith("image/") ? "image-outline" : mime.includes("pdf") ? "document-text-outline" : mime.includes("sheet") || mime.includes("excel") || mime.includes("csv") ? "grid-outline" : mime.includes("zip") ? "archive-outline" : "document-outline";
export function GroupFiles({ group, me }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api(`/groups/${group.id}/files`).then(result => setFiles(result.files)).catch(loadError => setError(loadError.message)), [group.id]);
  useEffect(() => { load(); }, [load]);
  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    if (file.size && file.size > 25 * 1024 * 1024) return setError("O ficheiro tem mais de 25 MB.");
    setBusy(true); setError("");
    try { await upload(`/groups/${group.id}/files`, {}, { uri: file.uri, mimeType: file.mimeType, fileName: file.name }, "file"); load(); }
    catch (uploadError) { setError(uploadError.message); }
    finally { setBusy(false); }
  };
  const remove = async file => {
    if (!(await ask("Apagar ficheiro", file.name))) return;
    try { await api(`/groups/${group.id}/files/${file.id}`, { method: "DELETE" }); load(); } catch (removeError) { setError(removeError.message); }
  };
  return <View style={{ gap: 12 }}>
    <Button label={busy ? "A enviar..." : "Partilhar ficheiro"} icon="cloud-upload-outline" onPress={pick} busy={busy} />
    <Text style={styles.muted}>PDF, Word, Excel, PowerPoint, texto, ZIP ou imagens, até 25 MB. Só os membros os descarregam.</Text>
    <Notice error={error} />
    {files === null ? <RowsSkeleton rows={3} /> : files.length === 0 ? <Empty icon="folder-open-outline" text="Ainda não há ficheiros no grupo." />
      : <Card>{files.map(file => <View key={file.id} style={styles.fileRow}>
        <View style={styles.fileIcon}><Ionicons name={fileIcon(file.mime)} size={20} color={colors.text} /></View>
        <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(`${API_URL}${file.url}`)}>
          <Text style={styles.title} numberOfLines={1}>{file.name}</Text>
          <Text style={styles.muted}>{sizeLabel(file.size_bytes)} · {file.display_name}</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(`${API_URL}${file.url}`)} hitSlop={8} accessibilityLabel={`Descarregar ${file.name}`}><Ionicons name="download-outline" size={22} color={colors.text} /></Pressable>
        {(file.user_id === me?.id || isTeam(group.my_role)) && <Pressable onPress={() => remove(file)} hitSlop={8}><Ionicons name="trash-outline" size={20} color={colors.muted} /></Pressable>}
      </View>)}</Card>}
  </View>;
}

// ----- Membros, equipa e convites -----
const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 };
export function GroupMembers({ group, me, onChanged }) {
  const [members, setMembers] = useState(null);
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState({});
  const [options, choose] = useOptions();
  const load = useCallback(() => api(`/groups/${group.id}/members`).then(result => setMembers(result.members)).catch(loadError => setNotice({ error: loadError.message })), [group.id]);
  useEffect(() => { load(); }, [load]);
  const myRole = group.my_role;
  const canInvite = !group.is_secret && (!group.invite_only || isTeam(myRole));
  const invite = async () => {
    try { await api(`/groups/${group.id}/invites`, { method: "POST", body: { username } }); setNotice({ message: `Convite enviado a @${username.replace(/^@/, "")}.` }); setUsername(""); }
    catch (inviteError) { setNotice({ error: inviteError.message }); }
  };
  const manage = async person => {
    const roles = [["moderator", "Tornar moderador", "shield-half-outline"], ...(myRole === "owner" ? [["admin", "Tornar administrador", "shield-checkmark-outline"]] : []), ["member", "Só membro", "person-outline"]]
      .filter(([role]) => role !== person.role && (myRole === "owner" || myRole === "admin"));
    const key = await choose(person.display_name, [...roles.map(([role, label, icon]) => ({ key: role, label, icon })), { key: "remove", label: "Remover do grupo", icon: "person-remove-outline", danger: true }]);
    if (!key) return;
    try {
      if (key === "remove") { if (await ask("Remover do grupo", person.display_name)) await api(`/groups/${group.id}/members/${person.id}`, { method: "DELETE" }); }
      else await api(`/groups/${group.id}/members/${person.id}/role`, { method: "POST", body: { role: key } });
      load(); onChanged?.();
    } catch (manageError) { setNotice({ error: manageError.message }); }
  };
  return <View style={{ gap: 12 }}>
    {canInvite && <Card title="Convidar alguém" subtitle={group.invite_only ? "Grupo privado: só entra quem for convidado." : undefined}>
      <Field label="Nome de utilizador" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="@nome" />
      <Button label="Convidar" icon="person-add-outline" onPress={invite} disabled={!username.trim()} />
    </Card>}
    <Notice {...notice} />
    {members === null ? <RowsSkeleton rows={5} /> : <Card title={`${members.length} ${members.length === 1 ? "membro" : "membros"}`}>
      {members.map(person => {
        const manageable = person.id !== me?.id && isTeam(myRole) && RANK[myRole] > RANK[person.role];
        return <Pressable key={person.id} style={styles.memberRow} onPress={() => manageable ? manage(person) : router.push(`/u/${person.username}`)}>
          <Avatar user={person} size={40} />
          <View style={{ flex: 1 }}><Text style={styles.title}>{person.display_name}</Text><Text style={styles.muted}>@{person.username}</Text></View>
          <Text style={[styles.role, ["owner", "admin"].includes(person.role) && styles.roleStrong]}>{ROLE_LABELS[person.role]}</Text>
          {manageable && <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />}
        </Pressable>;
      })}
    </Card>}
    <Text style={styles.muted}>Administradores mudam as regras e as definições. Moderadores aprovam pedidos, fixam e escondem publicações e removem membros.</Text>
    {options}
  </View>;
}

// ----- Estatísticas (equipa) -----
export function GroupStats({ group }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api(`/groups/${group.id}/stats`).then(setData).catch(loadError => setError(loadError.message)); }, [group.id]);
  if (error) return <Notice error={error} />;
  if (!data) return <ListSkeleton cards={2} />;
  const { stats, top, weekly } = data;
  const max = Math.max(1, ...weekly.map(week => week.posts));
  const tiles = [["Membros", stats.members, `+${stats.new_members_7d} esta semana`], ["Ativos (30 dias)", stats.active_30d, stats.members ? `${Math.round((stats.active_30d / stats.members) * 100)}% dos membros` : ""],
    ["Publicações (30 d)", stats.posts_30d, `${stats.comments_30d} comentários`], ["Mensagens (30 d)", stats.messages_30d, "no chat"]];
  return <View style={{ gap: 12 }}>
    <View style={styles.tiles}>{tiles.map(([label, value, hint]) => <View key={label} style={styles.tile}>
      <Text style={styles.muted}>{label}</Text><Text style={styles.tileValue}>{value}</Text><Text style={styles.tileHint}>{hint}</Text>
    </View>)}</View>
    <Card title="Publicações por semana">
      <View style={styles.bars}>{weekly.map(week => <View key={week.week} style={styles.barCol}>
        <View style={[styles.bar, { height: `${Math.max(3, (week.posts / max) * 100)}%` }]} />
        <Text style={styles.barLabel}>{new Date(week.week).getDate()}/{new Date(week.week).getMonth() + 1}</Text>
      </View>)}</View>
    </Card>
    <Card title="Quem mais participa (30 dias)">
      {top.length ? top.map(person => <View key={person.username} style={styles.memberRow}>
        <Avatar user={person} size={32} /><Text style={[styles.title, { flex: 1 }]}>{person.display_name}</Text><Text style={styles.muted}>{person.actions}</Text>
      </View>) : <Text style={styles.muted}>Ainda sem participação este mês.</Text>}
    </Card>
  </View>;
}

// ----- Definições e regras (dono e administradores) -----
export function GroupSettings({ group, onSaved }) {
  const [form, setForm] = useState({ name: group.name, description: group.description || "", rules: group.rules || "", groupType: group.group_type, category: group.category, subcategory: group.subcategory || "", privacy: groupPrivacyOf(group) });
  const [notice, setNotice] = useState({});
  const [busy, setBusy] = useState(false);
  const [options, choose] = useOptions();
  const area = groupCategory(form.category);
  const kind = GROUP_TYPES.find(item => item.key === form.groupType);
  const privacy = GROUP_PRIVACY.find(item => item.key === form.privacy);
  const save = async () => {
    setBusy(true); setNotice({});
    try {
      await api(`/groups/${group.id}`, { method: "PATCH", body: { name: form.name, description: form.description, rules: form.rules, groupType: form.groupType, category: form.category, subcategory: form.subcategory || null, ...(!group.is_secret && { privacy: form.privacy }) } });
      setNotice({ message: "Guardado." }); onSaved?.();
    } catch (saveError) { setNotice({ error: saveError.message }); }
    finally { setBusy(false); }
  };
  return <Card title="Definições do grupo">
    <Field label="Nome" value={form.name} onChangeText={name => setForm({ ...form, name })} maxLength={100} />
    <Field label="Descrição" value={form.description} onChangeText={description => setForm({ ...form, description })} multiline maxLength={2000} />
    <Field label="Regras do grupo" value={form.rules} onChangeText={rules => setForm({ ...form, rules })} multiline maxLength={3000} placeholder={"1. Respeito por todos.\n2. Sem spam."} />
    <SelectBox label="Tipo" icon={kind?.ion} value={kind?.label} onPress={async () => {
      const key = await choose("Tipo de grupo", GROUP_TYPES.map(item => ({ key: item.key, label: item.label, icon: item.ion })), form.groupType);
      if (key) setForm({ ...form, groupType: key });
    }} />
    <SelectBox label="Categoria" value={area.label} onPress={async () => {
      const key = await choose("Categoria", GROUP_CATEGORIES.map(item => ({ key: item.key, label: item.label })), form.category);
      if (key) setForm({ ...form, category: key, subcategory: key === form.category ? form.subcategory : "" });
    }} />
    {area.subcategories.length > 0 && <SelectBox label="Subcategoria" hint="opcional" placeholder="Sem subcategoria" value={area.subcategories.find(item => item.key === form.subcategory)?.label} onPress={async () => {
      const key = await choose(area.label, [{ key: "", label: "Sem subcategoria" }, ...area.subcategories.map(item => ({ key: item.key, label: item.label }))], form.subcategory);
      if (key !== null && key !== undefined) setForm({ ...form, subcategory: key });
    }} />}
    {!group.is_secret && <SelectBox label="Quem pode entrar" icon={privacy?.ion} value={privacy?.label} onPress={async () => {
      const key = await choose("Quem pode entrar", GROUP_PRIVACY.filter(item => item.key !== "secret").map(item => ({ key: item.key, label: item.label, icon: item.ion })), form.privacy);
      if (key) setForm({ ...form, privacy: key });
    }} />}
    <Notice {...notice} />
    <Button label="Guardar" onPress={save} busy={busy} disabled={!form.name.trim()} />
    {options}
  </Card>;
}

const styles = StyleSheet.create({
  eventsHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  eventsTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  row: { flexDirection: "row", gap: 8 },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "85%" },
  msgMine: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  bubble: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.primary },
  msgName: { color: colors.text, fontWeight: "800", fontSize: 12, marginBottom: 2 },
  msgText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  msgTime: { color: colors.muted, fontSize: 11, marginTop: 2 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, backgroundColor: colors.surface, borderRadius: 22, padding: 6 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 9, color: colors.text, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  event: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 12 },
  eventDate: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  eventDay: { color: colors.text, fontSize: 19, fontWeight: "800" },
  eventMonth: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.background },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  optionMine: { borderColor: colors.text },
  optionBar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.background },
  optionText: { color: colors.text, fontWeight: "700", flex: 1 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  role: { color: colors.muted, fontWeight: "800", fontSize: 12, backgroundColor: colors.background, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  roleStrong: { backgroundColor: colors.primary, color: colors.onPrimary },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 2 },
  tileValue: { color: colors.text, fontSize: 26, fontWeight: "800" },
  tileHint: { color: colors.muted, fontSize: 12 },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 130, gap: 6 },
  barCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 4 },
  bar: { width: "100%", borderRadius: 6, backgroundColor: colors.text },
  barLabel: { color: colors.muted, fontSize: 10 }
});
