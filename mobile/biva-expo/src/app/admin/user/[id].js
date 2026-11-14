import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { Badge, Button, Card, Chips, Empty, Loading, Notice, Page, Row, Stats, count, dateTime, kz } from "../../../components/ui";
import { usePrompt } from "../../../components/usePrompt";
import { api } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { colors } from "../../../lib/theme";
import { ROLE_LABELS, canSee } from "../index";

// Ficha de uma pessoa: conta, atividade, dinheiro, denúncias e o que a equipa já fez.
export default function AdminUser() {
  const { id } = useLocalSearchParams();
  const { user: me } = useSession();
  const [prompt, ask] = usePrompt();
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState({});
  const load = useCallback(() => api(`/admin/users/${id}`).then(setData).catch(error => setNotice({ error: error.message })), [id]);
  useEffect(() => { load(); }, [load]);
  const role = me?.admin_role || "super";
  const canModerate = canSee(role, ["moderation"]);

  const run = async (task, message) => {
    setNotice({});
    try { await task(); setNotice({ message }); await load(); } catch (error) { setNotice({ error: error.message }); }
  };
  if (!data) return <Page><Notice {...notice} />{!notice.error && <Loading />}</Page>;
  const { user } = data;

  const suspend = async () => {
    const reason = await ask({ title: `Suspender @${user.username}`, message: "As sessões abertas terminam.", placeholder: "Motivo (fica no registo)" });
    if (reason) run(() => api(`/admin/users/${id}/suspend`, { method: "POST", body: { reason } }), "Conta suspensa.");
  };
  const setRole = value => run(() => api(`/admin/users/${id}/role`, { method: "POST", body: { role: value || null } }), value ? `Função: ${ROLE_LABELS[value]}.` : "Retirado da equipa.");

  return <Page>
    <Stack.Screen options={{ title: user.display_name }} />
    {prompt}
    <Card>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Avatar user={user} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }} onPress={() => router.push(`/u/${user.username}`)}>{user.display_name} <Text style={{ color: colors.primary }}>@{user.username}</Text></Text>
          <Text selectable style={{ color: colors.muted }}>{user.email}</Text>
          <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
            {user.is_admin && <Badge label={ROLE_LABELS[user.admin_role || "super"]} tone="info" />}
            {user.suspended_at && <Badge label="Suspensa" tone="danger" />}
            {!user.email_verified && <Badge label="Email por confirmar" tone="warning" />}
            {user.is_creator && <Badge label="Criador" />}
            {user.two_factor && <Badge label="2FA" tone="good" />}
          </View>
        </View>
      </View>
      {user.suspended_at && <Text style={{ color: colors.danger }}>Suspensa {dateTime(user.suspended_at)}{user.suspended_reason ? `: ${user.suspended_reason}` : ""}</Text>}
      {canModerate && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {!user.email_verified && <Button small variant="secondary" label="Confirmar email" onPress={() => run(() => api(`/admin/users/${id}/verify-email`, { method: "POST" }), "Email confirmado.")} />}
        {user.suspended_at ? <Button small label="Reativar conta" onPress={() => run(() => api(`/admin/users/${id}/unsuspend`, { method: "POST", body: {} }), "Conta reativada.")} />
          : !user.is_admin && <Button small variant="danger" label="Suspender" onPress={suspend} />}
      </View>}
      <Notice {...notice} />
    </Card>
    {role === "super" && Number(id) !== me.id && <Card title="Função na equipa" subtitle="Para entrar no painel, a pessoa precisa de ter os dois passos ativos.">
      <Chips value={user.is_admin ? user.admin_role || "super" : ""} onChange={setRole}
        options={[["", "Sem acesso"], ["moderation", "Moderação"], ["finance", "Finanças"], ["super", "Administração total"]]} />
    </Card>}
    <Card title="Atividade">
      <Stats items={[["Publicações", count(user.posts)], ["Amigos", count(user.friends)], ["Seguidores", count(user.followers)], !data.money_hidden && ["Gastou no Tchilar", kz(data.spent)],
        ["Denúncias recebidas", count(user.reports_total), user.reports_open ? `${user.reports_open} abertas` : null], ["Denúncias feitas", count(user.reports_made)]]} />
      <Row icon="calendar" title="Conta criada" subtitle={dateTime(user.created_at)} />
      <Row icon="time" title="Última atividade" subtitle={user.last_seen_at ? dateTime(user.last_seen_at) : "Nunca"} />
      <Row icon="location" title="Província" subtitle={user.province || "—"} />
      <Row icon="people" title="Convidado por" subtitle={user.referred_by ? `@${user.referred_by}` : "—"} />
    </Card>
    {!data.money_hidden && <><Card title="Pagamentos">
      {data.payments.length === 0 ? <Empty text="Sem pagamentos." /> : data.payments.map(payment => <Row key={`${payment.kind}-${payment.id}`} icon="receipt"
        title={`${kz(payment.amount)} · ${payment.description}`} subtitle={`${payment.receipt} · ${dateTime(payment.paid_at)} · ${payment.method_label}`}
        right={<Badge label={payment.status_label} tone={payment.status === "paid" ? "good" : "warning"} />} />)}
    </Card>
    <Card title="Levantamentos">
      {data.payouts.length === 0 ? <Empty text="Sem levantamentos." /> : data.payouts.map(payout => <Row key={payout.id} icon="cash"
        title={kz(payout.amount)} subtitle={`${payout.bank_name} · IBAN •••• ${payout.iban_last4} · ${dateTime(payout.created_at)}`} right={<Badge label={payout.status} />} />)}
    </Card></>}
    <Card title="Denúncias sobre esta conta">
      {data.reports.length === 0 ? <Empty text="Nenhuma denúncia." /> : data.reports.map(report => <Row key={report.id} icon="flag"
        title={report.reason} subtitle={`${report.target_type} · ${dateTime(report.created_at)}`} right={<Badge label={report.status} />} />)}
    </Card>
    <Card title="Ações da equipa">
      {data.actions.length === 0 ? <Empty text="Nenhuma ação registada." /> : data.actions.map(item => <Row key={item.id} icon="document-text"
        title={`@${item.admin?.username || "equipa"} · ${item.label}`} subtitle={`${dateTime(item.created_at)}${item.note ? ` · «${item.note}»` : ""}`} />)}
    </Card>
  </Page>;
}
