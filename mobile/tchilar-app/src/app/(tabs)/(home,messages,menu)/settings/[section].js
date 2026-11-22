import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, DevSettings, StyleSheet, Switch, Text, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { ReceiptModal } from "../../../../components/Receipt";
import PhoneInput from "../../../../components/PhoneInput";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, Row, dateOnly, dateTime, kz } from "../../../../components/ui";
import { api, downloadAndShare, saveToken, upload } from "../../../../lib/api";
import { lockEnabled, lockMethod, setLockEnabled } from "../../../../lib/applock";
import { AUTOPLAY_OPTIONS, TEXT_SIZES, autoplay, dataSaver, saveAutoplay, saveDataSaver, saveTextSize, textSize } from "../../../../lib/display";
import { registerForPush } from "../../../../lib/push";
import { formatPhone, maskPhone, parsePhone, phoneError, splitPhone } from "../../../../lib/phones";
import { useSession } from "../../../../lib/session";
import { SMS_CHANNEL_LABELS, useSmsChannels } from "../../../../lib/smsChannels";
import { THEME_OPTIONS, colors, saveThemePreference, themePreference } from "../../../../lib/theme";
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
  const [form, setForm] = useState({ displayName: user.display_name || "", bio: user.bio || "", location: user.location || "", profession: user.profession || "", website: user.website || "",
    subscriptionPrice: Number(user.subscription_price) > 0 ? String(Number(user.subscription_price)) : "" });
  // O preço só vai quando é um criador e escreveu um valor (entre 500 Kz e 500 000 Kz, validado no servidor).
  const saveProfile = () => {
    const { subscriptionPrice, ...rest } = form;
    const body = { ...rest, ...(user.is_creator && subscriptionPrice.trim() && { subscriptionPrice: Number(subscriptionPrice.replace(",", ".")) }) };
    return run(() => api("/auth/me", { method: "PATCH", body }).then(refresh), "Perfil guardado.");
  };
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
      <Button label="Guardar" onPress={saveProfile} disabled={!form.displayName.trim()} />
      <Notice {...notice} />
    </Card>
    {user.is_creator && <Card title="Subscrição" subtitle="O valor mensal que os teus subscritores pagam pelas publicações exclusivas.">
      <Field label="Preço por mês (Kz)" hint="Entre 500 Kz e 500 000 Kz." value={form.subscriptionPrice} onChangeText={set("subscriptionPrice")} keyboardType="decimal-pad" placeholder="Ex.: 2500" />
      <Button label="Guardar preço" variant="secondary" onPress={saveProfile} disabled={!form.subscriptionPrice.trim()} />
    </Card>}
  </>;
}

// ---------------------------------------------------------------------------------------------
// Telemóvel da conta: privado. Serve para entrar em vez do email e, se for angolano, preenche o Multicaixa Express.
// Telemóvel guardado fica só para ler (como no site); alterar ou remover pede a palavra-passe da conta.
function PhoneCard() {
  const { user, refresh } = useSession();
  const initial = splitPhone(user.phone);
  const [mode, setMode] = useState(user.phone ? "view" : "edit");   // view · edit · remove
  const [country, setCountry] = useState(initial.country);
  const [phone, setPhone] = useState(initial.national);
  const [password, setPassword] = useState("");
  const [notice, run] = useNotice();
  const hasPhone = Boolean(user.phone);
  const cancel = () => {
    const current = splitPhone(user.phone);
    setCountry(current.country);
    setPhone(current.national);
    setPassword("");
    setMode(user.phone ? "view" : "edit");
  };
  const save = value => run(async () => {
    if (value && !parsePhone(value, country)) throw new Error(phoneError(country));
    const result = await api("/auth/me", { method: "PATCH", body: { phone: value, phoneCountry: country, ...(hasPhone ? { password } : {}) } });
    const saved = splitPhone(result.user?.phone);
    setCountry(saved.country);
    setPhone(saved.national);
    setPassword("");
    setMode(result.user?.phone ? "view" : "edit");
    return refresh();
  }, value ? "Telemóvel guardado. Confirma-o com o código por SMS." : "Telemóvel removido.");
  const passwordField = <Field label="Confirma com a tua palavra-passe" value={password} onChangeText={setPassword} secureTextEntry
    autoComplete="current-password" textContentType="password" placeholder="A tua palavra-passe" />;

  if (mode === "view") return <Card title="Telemóvel" subtitle="Privado: só tu e a equipa o veem.">
    <View style={phoneStyles.saved}>
      <View style={phoneStyles.savedIcon}><Ionicons name="phone-portrait-outline" size={18} color={colors.text} /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={phoneStyles.number}>{maskPhone(user.phone)}</Text>
        <View style={[phoneStyles.tag, user.phone_verified_at ? phoneStyles.tagOk : phoneStyles.tagPending]}>
          <Text style={[phoneStyles.tagText, { color: user.phone_verified_at ? colors.good : colors.warning }]}>{user.phone_verified_at ? "Confirmado" : "Por confirmar"}</Text>
        </View>
      </View>
    </View>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ flex: 1 }}><Button variant="secondary" icon="create-outline" label="Alterar" onPress={() => setMode("edit")} /></View>
      <View style={{ flex: 1 }}><Button variant="ghost" label="Remover" onPress={() => setMode("remove")} /></View>
    </View>
    <Notice {...notice} />
    {!user.phone_verified_at && <PhoneVerification />}
  </Card>;

  if (mode === "remove") return <Card title="Remover telemóvel" subtitle={`Vais remover ${formatPhone(user.phone)}. Deixas de poder entrar com ele e de recuperar a conta por SMS.`}>
    {passwordField}
    <Button variant="danger" label="Remover número" onPress={() => save("")} disabled={!password} />
    <Button variant="ghost" label="Cancelar" onPress={cancel} />
    <Notice {...notice} />
  </Card>;

  return <Card title="Telemóvel" subtitle="Privado: não aparece no perfil. Confirmado por SMS, serve para entrar e recuperar a conta; se for angolano, preenche o Multicaixa Express.">
    <PhoneInput country={country} onCountryChange={setCountry} value={phone} onChangeText={setPhone} placeholder={hasPhone ? "Novo número" : "Número"} />
    {hasPhone && passwordField}
    <Button label="Guardar" onPress={() => save(phone.trim())} disabled={!phone.trim() || (hasPhone && !password)} />
    {hasPhone && <Button variant="ghost" label="Cancelar" onPress={cancel} />}
    <Notice {...notice} />
  </Card>;
}

const phoneStyles = StyleSheet.create({
  saved: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  savedIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  number: { color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: 0.5 },
  tag: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  tagOk: { backgroundColor: colors.goodSoft },
  tagPending: { backgroundColor: colors.warningSoft },
  tagText: { fontSize: 12, fontWeight: "800" }
});

// Confirmar o número com o código por SMS (Twilio). Só um número confirmado serve para entrar e recuperar a conta.
function PhoneVerification() {
  const { user, refresh } = useSession();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [notice, run] = useNotice();
  const channels = useSmsChannels();
  useEffect(() => { setSent(false); setCode(""); }, [user.phone]);
  if (user.phone_verified_at) {
    return <Row icon="shield-checkmark" title="Número confirmado" subtitle="Podes usá-lo para entrar e para recuperar a conta." tone={colors.good} />;
  }
  const sendCode = channel => run(async () => {
    const result = await api("/auth/phone/send-code", { method: "POST", body: { channel } });
    setSent(result.channel || channel);
    if (result.devCode) setCode(result.devCode);
  }, `Enviámos um código para ${formatPhone(user.phone)}.`);
  const confirm = () => run(async () => {
    await api("/auth/phone/verify", { method: "POST", body: { code: code.trim() } });
    await refresh();
  }, "Número confirmado. Já podes usá-lo para entrar.");
  return <View style={{ gap: 10 }}>
    {/* Opcional: o email continua a servir para tudo. Cada código custa dinheiro ao Tchilar. */}
    <Text style={{ color: colors.muted, lineHeight: 20 }}><Text style={{ fontWeight: "800", color: colors.text }}>Confirmar o número é opcional. </Text>
      Só precisas se quiseres entrar com o telemóvel ou recuperar a conta sem o email.</Text>
    {sent && <Field label="Código recebido" value={code} onChangeText={value => setCode(value.replace(/\D/g, ""))} keyboardType="number-pad"
      autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10} />}
    {sent
      ? <>
        <Button label="Confirmar número" onPress={confirm} disabled={code.length < 4} />
        <Button variant="ghost" label="Enviar outro código" onPress={() => sendCode(sent)} />
      </>
      : channels.map((channel, index) => <Button key={channel} variant={index === 0 ? "primary" : "secondary"}
        icon={channel === "whatsapp" ? "logo-whatsapp" : "chatbox-ellipses"} label={`Confirmar por ${SMS_CHANNEL_LABELS[channel]}`} onPress={() => sendCode(channel)} />)}
    <Notice {...notice} />
  </View>;
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
    <AppLockSetting run={run} />
    <DeviceSessions run={run} onEndOthers={logoutAll} />
  </>;
}

// Bloqueio com Face ID / impressão digital (só neste telemóvel).
function AppLockSetting({ run }) {
  const [on, setOn] = useState(false);
  const [method, setMethod] = useState(undefined);
  useEffect(() => { lockEnabled().then(setOn); lockMethod().then(setMethod); }, []);
  const toggle = value => run(async () => { await setLockEnabled(value); setOn(value); }, value ? "Bloqueio ligado." : "Bloqueio desligado.");
  return <Card title="Bloquear a app" subtitle={method === null
    ? "Configura Face ID, impressão digital ou um código no telemóvel para usar o bloqueio."
    : `Pede ${method || "Face ID ou impressão digital"} ao abrir a app e ao voltar depois de 1 minuto fora. Quem pegar no telemóvel desbloqueado não entra no teu Tchilar.`}
    right={<Switch value={on} onValueChange={toggle} disabled={method === null} />} />;
}

// Onde tens sessão iniciada: cada aparelho pode ser terminado à parte.
function DeviceSessions({ run, onEndOthers }) {
  const [sessions, setSessions] = useState(null);
  const load = useCallback(() => api("/auth/sessions").then(result => setSessions(result.sessions)).catch(() => setSessions([])), []);
  useEffect(() => { load(); }, [load]);
  const seen = value => {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 10) return "Ativo agora";
    if (minutes < 60) return `Ativo há ${minutes} min`;
    if (minutes < 1440) return `Ativo há ${Math.round(minutes / 60)} h`;
    return `Ativo a ${dateOnly(value)}`;
  };
  const end = session => Alert.alert("Terminar sessão", `Terminar a sessão em "${session.device || "aparelho desconhecido"}"?`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Terminar", style: "destructive", onPress: () => run(async () => {
      await api(`/auth/sessions/${session.id}`, { method: "DELETE" });
      setSessions(list => list.filter(item => item.id !== session.id));
    }, "Sessão terminada nesse aparelho.") }
  ]);
  const others = (sessions || []).filter(session => !session.current).length;
  return <Card title="Onde tens sessão iniciada" subtitle="Não reconheces um aparelho? Termina essa sessão e muda a palavra-passe.">
    {sessions === null ? <Loading /> : sessions.map(session => <Row key={session.id}
      icon={session.client === "app" ? "phone-portrait-outline" : "desktop-outline"}
      title={session.device || (session.client === "app" ? "App Tchilar" : "Browser")}
      subtitle={`${session.client === "app" ? "App" : "Site"} · ${session.current ? "Este telemóvel" : seen(session.last_seen_at)}`}
      right={session.current ? <Badge label="Aqui" tone="good" /> : <Button small variant="secondary" label="Terminar" onPress={() => end(session)} />} />)}
    {others > 1 && <Button variant="secondary" label="Terminar todas as outras" icon="log-out" onPress={async () => { await onEndOthers(); load(); }} />}
  </Card>;
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
  const [push, setPush] = useState(null); // { ok, reason } deste telemóvel
  useEffect(() => { registerForPush({ ask: false }).then(setPush).catch(error => setPush({ ok: false, reason: error.message })); }, []);
  if (!preferences) return <Loading />;
  return <>
    <Notice {...notice} />
    <Card title="Neste telemóvel" subtitle="Os avisos chegam mesmo com a app fechada.">
      <Row icon={push?.ok ? "notifications" : "notifications-off"} tone={push?.ok ? "#30B350" : "#FF8A00"}
        title={push === null ? "A verificar..." : push.ok ? "Notificações ligadas" : "Notificações desligadas"}
        subtitle={push && !push.ok ? push.reason : undefined} />
      {push && !push.ok && <Button variant="secondary" icon="notifications" label="Ligar notificações"
        onPress={() => registerForPush({ ask: true }).then(setPush).catch(error => setPush({ ok: false, reason: error.message }))} />}
    </Card>
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
  return <Card title="Os teus pagamentos" subtitle="Toca num pagamento para ver o recibo e guardá-lo em PDF.">
    {payments.length === 0 ? <Empty text="Ainda não fizeste pagamentos no Tchilar." icon="card-outline" /> : payments.map(payment =>
      <Row key={`${payment.kind}-${payment.id}`} icon="receipt" title={payment.description}
        subtitle={`${payment.receipt} · ${dateTime(payment.paid_at)} · ${payment.method_label}${payment.status === "paid" ? "" : ` · ${payment.status_label}`}`}
        right={<Text style={{ fontWeight: "800", color: colors.text }}>{kz(payment.amount)}</Text>} onPress={() => setOpen(payment)} />)}
    <ReceiptModal payment={open} onClose={() => setOpen(null)} />
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

// ---------------------------------------------------------------------------------------------
// Aparência: tema Automático (segue o telemóvel), Claro ou Escuro. As cores aplicam-se ao abrir a app,
// por isso mudar de tema recarrega a app (em produção, pede para a fechar e voltar a abrir).
const THEME_ICONS = { auto: "phone-portrait", light: "sunny", dark: "moon" };
function Appearance() {
  const [choice, setChoice] = useState(themePreference);
  const [notice, setNotice] = useState({});
  const [size, setSize] = useState(textSize);
  const [play, setPlay] = useState(autoplay);
  const [saver, setSaver] = useState(dataSaver);
  // Tal como o tema, o tamanho do texto e os vídeos aplicam-se ao abrir a app.
  const applyLater = changed => {
    if (!changed) { setNotice({}); return; }
    if (__DEV__) Alert.alert("Aparência", "A app vai recarregar para aplicar.", [{ text: "OK", onPress: () => DevSettings.reload() }]);
    else setNotice({ message: "Guardado. Fecha a app e volta a abri-la para veres a mudança." });
  };
  const choose = async value => {
    setChoice(value);
    const changed = await saveThemePreference(value);
    if (!changed) { setNotice({}); return; }
    if (__DEV__) {
      Alert.alert("Tema", "A app vai recarregar para aplicar o tema.", [{ text: "OK", onPress: () => DevSettings.reload() }]);
    } else {
      setNotice({ message: "Guardado. Fecha a app e volta a abri-la para veres o tema novo." });
    }
  };
  return <>
    <Card title="Tema" subtitle="Fica guardado neste telemóvel. «Automático» segue o modo claro ou escuro do sistema.">
      {THEME_OPTIONS.map(([value, label]) => <Row key={value} icon={THEME_ICONS[value]} tone={choice === value ? "#5E5CE6" : undefined} title={label}
        subtitle={value === "auto" ? "Igual ao telemóvel" : value === "dark" ? "Fundo escuro, melhor à noite" : "Fundo claro"}
        onPress={() => choose(value)}
        right={<Ionicons name={choice === value ? "radio-button-on" : "radio-button-off"} size={22} color={choice === value ? colors.text : colors.muted} />} />)}
    </Card>
    <Card title="Tamanho do texto" subtitle="Publicações e comentários. Soma-se ao tamanho de letra do telemóvel.">
      {TEXT_SIZES.map(([value, label, scale]) => <Row key={value} title={label} onPress={async () => { setSize(value); applyLater(await saveTextSize(value)); }}
        icon="text" tone={size === value ? "#5E5CE6" : undefined}
        subtitle={<Text style={{ fontSize: Math.round(15 * scale), color: colors.muted }}>Olá Tchilar</Text>}
        right={<Ionicons name={size === value ? "radio-button-on" : "radio-button-off"} size={22} color={size === value ? colors.text : colors.muted} />} />)}
    </Card>
    <Card title="Poupar dados" subtitle="Para quem usa dados móveis. Fica guardado neste telemóvel.">
      <Row icon="cellular" tone={saver ? "#34C759" : undefined} title="Poupar dados"
        subtitle="Fotos mais leves no feed (a original abre ao tocar) e vídeos só quando tocas. Gasta muito menos saldo."
        onPress={async () => { const next = !saver; setSaver(next); applyLater(await saveDataSaver(next)); }}
        right={<Switch value={saver} onValueChange={async next => { setSaver(next); applyLater(await saveDataSaver(next)); }} />} />
    </Card>
    {!saver && <Card title="Vídeos no Início" subtitle="Os Reels tocam sempre; isto é para os vídeos do feed.">
      {AUTOPLAY_OPTIONS.map(([value, label, hint]) => <Row key={value} title={label} subtitle={hint} icon={value === "always" ? "play-circle" : "cellular"}
        tone={play === value ? "#5E5CE6" : undefined} onPress={async () => { setPlay(value); applyLater(await saveAutoplay(value)); }}
        right={<Ionicons name={play === value ? "radio-button-on" : "radio-button-off"} size={22} color={play === value ? colors.text : colors.muted} />} />)}
    </Card>}
    <Notice {...notice} />
  </>;
}

const SECTIONS = { aparencia: Appearance, perfil: Profile, conta: Account, seguranca: Security, privacidade: Privacy, notificacoes: Notifications, pagamentos: Payments, dados: DataRequests };

export default function SettingsSection() {
  const { section } = useLocalSearchParams();
  const Section = SECTIONS[section];
  const title = SETTINGS_SECTIONS.find(([key]) => key === section)?.[2] || "Definições";
  return <Page>
    <Stack.Screen options={{ title }} />
    {Section ? <Section /> : <Empty text="Área desconhecida." />}
  </Page>;
}
