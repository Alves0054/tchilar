import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Switch, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, Row, dateOnly, dateTime, kz } from "../../components/ui";
import { WEB_URL, api, downloadAndShare, saveToken, upload } from "../../lib/api";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";
import { SETTINGS_SECTIONS } from "./index";

function useNotice() {
  const [notice, setNotice] = useState({});
  const run = async (task, message) => {
    setNotice({});
    try { await task(); if (message) setNotice({ message }); return true; } catch (error) { setNotice({ error: error.message }); return false; }
  };
  return [notice, run];
}

// ---------------------------------------------------------------------------------------------
function Profile() {
  const { user, refresh } = useSession();
  const [form, setForm] = useState({ displayName: user.display_name || "", bio: user.bio || "", location: user.location || "", profession: user.profession || "", website: user.website || "" });
  const [notice, run] = useNotice();
  const [busy, setBusy] = useState("");
  const set = key => value => setForm({ ...form, [key]: value });
  const changePhoto = async kind => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: kind === "avatar" ? [1, 1] : [3, 1] });
    if (result.canceled) return;
    setBusy(kind);
    await run(() => upload(`/auth/me/${kind}`, {}, result.assets[0], "image").then(refresh), kind === "avatar" ? "Foto atualizada." : "Capa atualizada.");
    setBusy("");
  };
  return <>
    <Card title="Fotos">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar user={user} size={72} />
        <View style={{ flex: 1, gap: 8 }}>
          <Button small label="Mudar foto de perfil" icon="camera" onPress={() => changePhoto("avatar")} busy={busy === "avatar"} />
          <Button small variant="secondary" label="Mudar capa" icon="image" onPress={() => changePhoto("cover")} busy={busy === "cover"} />
        </View>
      </View>
    </Card>
    <Card title="Sobre ti">
      <Field label="Nome público" value={form.displayName} onChangeText={set("displayName")} maxLength={100} />
      <Field label="Biografia" value={form.bio} onChangeText={set("bio")} multiline maxLength={500} />
      <Field label="Localidade" value={form.location} onChangeText={set("location")} maxLength={100} placeholder="Luanda" />
      <Field label="Profissão" value={form.profession} onChangeText={set("profession")} maxLength={100} />
      <Field label="Site" value={form.website} onChangeText={set("website")} autoCapitalize="none" keyboardType="url" placeholder="https://" />
      <Button label="Guardar" onPress={() => run(() => api("/auth/me", { method: "PATCH", body: form }).then(refresh), "Perfil guardado.")} disabled={!form.displayName.trim()} />
      <Notice {...notice} />
    </Card>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Telemóvel da conta: privado; preenche o Multicaixa Express nos pagamentos.
function PhoneCard() {
  const { user, refresh } = useSession();
  const [phone, setPhone] = useState(user.phone || "");
  const [notice, run] = useNotice();
  const save = value => run(() => api("/auth/me", { method: "PATCH", body: { phone: value } }).then(() => { setPhone(value.replace(/\D/g, "").slice(-9)); return refresh(); }),
    value ? "Telemóvel guardado." : "Telemóvel removido.");
  return <Card title="Telemóvel" subtitle="Opcional e privado: não aparece no perfil. Preenche o Multicaixa Express nos pagamentos.">
    <Field label="Número de telemóvel" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="9XX XXX XXX" maxLength={16} />
    <Button label="Guardar" onPress={() => save(phone.trim())} disabled={!phone.trim()} />
    {user.phone ? <Button variant="ghost" label="Remover número" onPress={() => save("")} /> : null}
    <Notice {...notice} />
  </Card>;
}

function Account() {
  const { user, signOut } = useSession();
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [notice, run] = useNotice();
  const remove = () => Alert.alert("Apagar conta", "Apaga o perfil, publicações, mensagens, grupos e páginas que criaste. Não pode ser desfeito.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Apagar", style: "destructive", onPress: async () => { if (await run(() => api("/auth/me", { method: "DELETE", body: { password } }))) signOut(); } }
  ]);
  return <>
    <Card title="Conta">
      <Row icon="mail" title={user.email} subtitle={user.email_verified ? "Email confirmado" : "Email por confirmar"} right={<Badge label={user.email_verified ? "Confirmado" : "Por confirmar"} tone={user.email_verified ? "good" : "warning"} />} />
      <Row icon="person" title={`@${user.username}`} subtitle={user.is_creator ? "Conta de criador" : "Membro da comunidade"} />
      <Row icon="calendar" title="No Tchilar desde" subtitle={dateOnly(user.created_at)} />
    </Card>
    <PhoneCard />
    <Card title="Os teus dados" subtitle="Descarrega uma cópia de tudo o que tens no Tchilar.">
      <Button variant="secondary" label="Descarregar os meus dados" icon="download" onPress={() => run(() => downloadAndShare("/auth/me/export", `tchilar-dados-${user.username}.json`, "application/json"))} />
    </Card>
    <Card title="Apagar conta" subtitle="Cancela as subscrições pagas e apaga tudo. Não pode ser desfeito.">
      {!confirming ? <Button variant="danger" label="Apagar conta" icon="trash" onPress={() => setConfirming(true)} /> : <>
        <Field label="Palavra-passe" value={password} onChangeText={setPassword} secureTextEntry />
        <Button variant="danger" label="Apagar definitivamente" onPress={remove} disabled={!password} />
        <Button variant="ghost" label="Cancelar" onPress={() => { setConfirming(false); setPassword(""); }} />
      </>}
      <Notice {...notice} />
    </Card>
  </>;
}

// ---------------------------------------------------------------------------------------------
function Security() {
  const { refresh } = useSession();
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [twoFactor, setTwoFactor] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState({ open: false, password: "", code: "" });
  const [notice, run] = useNotice();
  const loadTwoFactor = useCallback(() => api("/auth/2fa").then(setTwoFactor).catch(() => {}), []);
  useEffect(() => { loadTwoFactor(); }, [loadTwoFactor]);

  const changePassword = () => run(async () => {
    const result = await api("/auth/password", { method: "POST", body: passwords });
    await saveToken(result.token);
    setPasswords({ currentPassword: "", newPassword: "" });
  }, "Palavra-passe alterada. As outras sessões foram terminadas.");
  const logoutAll = () => run(async () => { const result = await api("/auth/logout-all", { method: "POST" }); await saveToken(result.token); }, "Sessão terminada em todos os outros dispositivos.");

  return <>
    <Notice {...notice} />
    <Card title="Palavra-passe">
      <Field label="Palavra-passe atual" value={passwords.currentPassword} onChangeText={currentPassword => setPasswords({ ...passwords, currentPassword })} secureTextEntry />
      <Field label="Nova palavra-passe" value={passwords.newPassword} onChangeText={newPassword => setPasswords({ ...passwords, newPassword })} secureTextEntry hint="Pelo menos 8 caracteres." />
      <Button label="Mudar palavra-passe" onPress={changePassword} disabled={!passwords.currentPassword || passwords.newPassword.length < 8} />
    </Card>
    <Card title="Verificação em dois passos" subtitle="Pede um código da app de autenticação sempre que entras. Obrigatória para a equipa."
      right={twoFactor ? <Badge label={twoFactor.enabled ? "Ativa" : "Desligada"} tone={twoFactor.enabled ? "good" : "neutral"} /> : null}>
      {twoFactor && !twoFactor.enabled && !setup && <Button label="Ativar" icon="shield-checkmark" onPress={() => run(async () => setSetup(await api("/auth/2fa/setup", { method: "POST" })))} />}
      {setup && <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text }}>1. Na app de autenticação (Google Authenticator, Authy…), adiciona uma conta com esta chave (ou lê o código QR noutro ecrã):</Text>
        <Text selectable style={{ fontWeight: "800", letterSpacing: 1, color: colors.text, textAlign: "center" }}>{setup.secret}</Text>
        {setup.qr && <Image source={{ uri: setup.qr }} style={{ width: 180, height: 180, alignSelf: "center" }} />}
        <Field label="2. Código de 6 dígitos" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
        <Button label="Confirmar" disabled={code.length !== 6} onPress={async () => {
          if (await run(() => api("/auth/2fa/enable", { method: "POST", body: { code } }), "Verificação em dois passos ativa.")) { setSetup(null); setCode(""); loadTwoFactor(); refresh(); }
        }} />
      </View>}
      {twoFactor?.enabled && !disabling.open && <Button variant="secondary" label="Desligar" onPress={() => setDisabling({ open: true, password: "", code: "" })} />}
      {disabling.open && <View style={{ gap: 10 }}>
        <Field label="Palavra-passe" value={disabling.password} onChangeText={password => setDisabling({ ...disabling, password })} secureTextEntry />
        <Field label="Código atual" value={disabling.code} onChangeText={value => setDisabling({ ...disabling, code: value })} keyboardType="number-pad" maxLength={6} />
        <Button variant="danger" label="Desligar dois passos" onPress={async () => {
          if (await run(() => api("/auth/2fa/disable", { method: "POST", body: { password: disabling.password, code: disabling.code } }), "Verificação em dois passos desligada.")) { setDisabling({ open: false }); loadTwoFactor(); }
        }} />
      </View>}
    </Card>
    <Card title="Sessões abertas" subtitle="Perdeste o telemóvel ou entraste noutro computador? Termina as outras sessões.">
      <Button variant="secondary" label="Terminar outras sessões" icon="log-out" onPress={logoutAll} />
    </Card>
  </>;
}

// ---------------------------------------------------------------------------------------------
const REACH = [["everyone", "Todos"], ["following", "Quem sigo"], ["nobody", "Ninguém"]];
const NOTIFY = [["interactions", "Gostos, comentários e partilhas"], ["people", "Seguidores e pedidos de amizade"], ["messages", "Mensagens"], ["lives", "Diretos"], ["community", "Grupos, páginas e eventos"]];

function usePreferences() {
  const [preferences, setPreferences] = useState(null);
  const [notice, run] = useNotice();
  useEffect(() => { api("/auth/me/preferences").then(result => setPreferences(result.preferences)).catch(() => {}); }, []);
  const save = patch => {
    const before = preferences;
    setPreferences({ ...preferences, ...patch, notify: { ...preferences.notify, ...(patch.notify || {}) } });
    run(() => api("/auth/me/preferences", { method: "PATCH", body: patch }).then(result => setPreferences(result.preferences)).catch(error => { setPreferences(before); throw error; }), "Guardado.");
  };
  return { preferences, save, notice };
}

function Privacy() {
  const { preferences, save, notice } = usePreferences();
  const [blocked, setBlocked] = useState(null);
  const loadBlocked = useCallback(() => api("/blocks").then(result => setBlocked(result.blocked)).catch(() => setBlocked([])), []);
  useEffect(() => { loadBlocked(); }, [loadBlocked]);
  if (!preferences) return <Loading />;
  return <>
    <Notice {...notice} />
    <Card title="Quem te pode enviar mensagens"><Chips value={preferences.messages} onChange={messages => save({ messages })} options={REACH} /></Card>
    <Card title="Quem pode comentar as tuas publicações"><Chips value={preferences.comments} onChange={comments => save({ comments })} options={REACH} /></Card>
    <Card title="Estado de atividade">
      <Row icon="ellipse" tone="#2EAA6B" title="Mostrar quando estou ativo" subtitle="Os teus amigos veem o ponto verde quando estás online."
        right={<Switch value={preferences.showActivity} onValueChange={showActivity => save({ showActivity })} trackColor={{ true: colors.primary }} />} />
    </Card>
    <Card title="Pessoas bloqueadas">
      {!blocked ? <Loading /> : blocked.length === 0 ? <Empty text="Não bloqueaste ninguém." icon="ban-outline" /> : blocked.map(person => <Row key={person.id} icon="ban" title={person.display_name} subtitle={`@${person.username}`}
        right={<Button small variant="secondary" label="Desbloquear" onPress={async () => { await api(`/users/${person.id}/block`, { method: "DELETE" }).catch(() => {}); loadBlocked(); }} />} />)}
    </Card>
  </>;
}

function Notifications() {
  const { preferences, save, notice } = usePreferences();
  if (!preferences) return <Loading />;
  return <>
    <Notice {...notice} />
    <Card title="Avisar-me sobre" subtitle="Avisos de dinheiro, segurança e da equipa chegam sempre.">
      {NOTIFY.map(([key, label]) => <Row key={key} icon="notifications" title={label}
        right={<Switch value={preferences.notify[key]} onValueChange={value => save({ notify: { [key]: value } })} trackColor={{ true: colors.primary }} />} />)}
    </Card>
  </>;
}

// ---------------------------------------------------------------------------------------------
function Payments() {
  const [payments, setPayments] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api("/payments").then(result => setPayments(result.payments)).catch(() => setPayments([])); }, []);
  if (!payments) return <Loading />;
  return <Card title="Os teus pagamentos" subtitle="Toca num pagamento para ver o recibo.">
    {payments.length === 0 ? <Empty text="Ainda não fizeste pagamentos no Tchilar." icon="card-outline" /> : payments.map(payment => <View key={`${payment.kind}-${payment.id}`}>
      <Row icon="receipt" title={payment.description} subtitle={`${dateTime(payment.paid_at)} · ${payment.method_label}`}
        right={<Text style={{ fontWeight: "800", color: colors.text }}>{kz(payment.amount)}</Text>} onPress={() => setOpen(open === payment.receipt ? null : payment.receipt)} />
      {open === payment.receipt && <View style={{ padding: 12, gap: 4, borderRadius: 12, backgroundColor: colors.background, marginVertical: 6 }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>Recibo {payment.receipt}</Text>
        <Text style={{ color: colors.muted }}>{payment.kind_label} · {payment.status_label}</Text>
        {payment.reference && <Text style={{ color: colors.muted }}>Entidade {payment.entity} · Referência {payment.reference}</Text>}
        {payment.phone && <Text style={{ color: colors.muted }}>Telemóvel {payment.phone}</Text>}
        <Button small variant="secondary" label="Abrir para imprimir ou PDF" onPress={() => Linking.openURL(`${WEB_URL}/recibos/${payment.kind}/${payment.id}`)} />
      </View>}
    </View>)}
  </Card>;
}

// ---------------------------------------------------------------------------------------------
const REQUEST_STATUS = { open: ["Em análise", "warning"], done: ["Tratado", "good"], rejected: ["Recusado", "danger"] };
function DataRequests() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ kind: "export", details: "" });
  const [notice, run] = useNotice();
  const load = useCallback(() => api("/data-requests").then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading />;
  return <>
    <Card title="Pedir à equipa" subtitle="Pela Lei de Proteção de Dados (Lei n.º 22/11) podes pedir uma cópia, a correção ou o apagamento dos teus dados. Respondemos em até 30 dias.">
      <Chips value={form.kind} onChange={kind => setForm({ ...form, kind })} options={Object.entries(data.kinds)} />
      <Field label="Detalhes" value={form.details} onChangeText={details => setForm({ ...form, details })} multiline maxLength={1000}
        placeholder={form.kind === "correct" ? "Que dado está errado e qual é o certo?" : "Algo que a equipa deva saber (opcional)"} />
      <Button label="Enviar pedido" onPress={async () => { if (await run(() => api("/data-requests", { method: "POST", body: form }), "Pedido enviado. A resposta chega nas notificações.")) { setForm({ kind: "export", details: "" }); load(); } }} />
      <Notice {...notice} />
    </Card>
    <Card title="Os teus pedidos">
      {data.requests.length === 0 ? <Empty text="Ainda não fizeste pedidos." /> : data.requests.map(request => {
        const [label, tone] = REQUEST_STATUS[request.status];
        return <Row key={request.id} icon="folder-open" title={data.kinds[request.kind]} subtitle={`${dateOnly(request.created_at)}${request.answer ? ` · ${request.answer}` : ""}`} right={<Badge label={label} tone={tone} />} />;
      })}
    </Card>
  </>;
}

const SECTIONS = { perfil: Profile, conta: Account, seguranca: Security, privacidade: Privacy, notificacoes: Notifications, pagamentos: Payments, dados: DataRequests };

export default function SettingsSection() {
  const { section } = useLocalSearchParams();
  const Section = SECTIONS[section];
  const title = SETTINGS_SECTIONS.find(([key]) => key === section)?.[2] || "Definições";
  return <Page>
    <Stack.Screen options={{ title }} />
    {Section ? <Section /> : <Empty text="Área desconhecida." />}
  </Page>;
}
