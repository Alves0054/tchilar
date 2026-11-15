import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, Row, Stats, count, dateTime, kz } from "../../components/ui";
import { usePrompt } from "../../components/usePrompt";
import * as DocumentPicker from "expo-document-picker";
import { api, downloadAndShare, upload } from "../../lib/api";
import { audioDuration } from "../../lib/audio";
import { useSession } from "../../lib/session";
import { colors, relativeTime } from "../../lib/theme";
import { ADMIN_SECTIONS, canSee } from "./index";

// Carrega uma rota de administração. Sem dois passos ativos, a API recusa: mostra como resolver.
function useAdmin(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api(path).then(result => { setData(result); setError(null); })
    .catch(loadError => setError(loadError)).finally(() => setRefreshing(false)), [path]);
  useEffect(() => { setData(null); load(); }, [load]);
  return { data, error, load, refreshing, refresh: () => { setRefreshing(true); load(); } };
}
function AdminError({ error }) {
  if (!error) return null;
  return <Card>
    <Notice error={error.message} />
    {error.data?.twoFactorSetupRequired && <Button label="Ativar dois passos" icon="shield-checkmark" onPress={() => router.push("/settings/seguranca")} />}
  </Card>;
}
// Executa uma ação, mostra o resultado e recarrega.
function useAction(load) {
  const [notice, setNotice] = useState({});
  const run = async (task, message) => {
    setNotice({});
    try { await task(); setNotice({ message }); await load(); return true; } catch (error) { setNotice({ error: error.message }); return false; }
  };
  return [notice, run];
}
const post = (path, body) => api(path, { method: "POST", body: body || {} });
const confirm = (title, text) => new Promise(resolve => Alert.alert(title, text, [{ text: "Não", style: "cancel", onPress: () => resolve(false) }, { text: "Sim", onPress: () => resolve(true) }]));

// ---------------------------------------------------------------------------------------------
function Overview() {
  const { data, error, refreshing, refresh } = useAdmin("/admin/overview");
  const [summary, setSummary] = useState(null);
  useEffect(() => { api("/admin/operations/summary").then(setSummary).catch(() => {}); }, [data]);
  if (!data) return error ? <AdminError error={error} /> : <Loading />;
  const { people, money, todo } = data;
  const tasks = [
    todo.promotions_in_review > 0 && ["promocoes", "rocket", `${todo.promotions_in_review} promoções em revisão`],
    todo.payouts_requested > 0 && ["levantamentos", "cash", `${todo.payouts_requested} levantamentos por pagar · ${kz(todo.payouts_amount)}`],
    todo.refunds_due > 0 && ["pagamentos", "return-down-back", `${todo.refunds_due} reembolsos por fazer · ${kz(todo.refunds_amount)}`],
    todo.open_reports > 0 && ["denuncias", "flag", `${todo.open_reports} denúncias abertas`],
    todo.data_requests_open > 0 && ["dados", "lock-closed", `${todo.data_requests_open} pedidos sobre dados pessoais`],
    summary?.attempts_unresolved > 0 && ["por-resolver", "help-circle", `${summary.attempts_unresolved} pagamentos expiraram ou falharam`]
  ].filter(Boolean);
  return <>
    <Card title="Por fazer">
      {tasks.length === 0 ? <Text style={{ color: colors.muted }}>✓ Está tudo em dia.</Text>
        : tasks.map(([slug, icon, text]) => <Row key={slug} icon={icon} tone={colors.accent} title={text} onPress={() => router.push(`/admin/${slug}`)} />)}
    </Card>
    <Card title="Dinheiro"><Stats items={[["Hoje", kz(money.today)], ["Últimos 30 dias", kz(money.last_30d)], ["Pagamentos (30 dias)", count(money.count_30d)]]} /></Card>
    <Card title="Pessoas">
      <Stats items={[["Contas", count(people.total), `+${count(people.new_7d)} esta semana`], ["Online agora", count(people.online)], ["Ativas hoje", count(people.active_1d)],
        ["Criadores", count(people.creators)], ["Email por confirmar", count(people.unverified)], ["Suspensas", count(people.suspended)]]} />
    </Card>
    <Card title="Últimas ações da equipa">
      {data.recent.length === 0 ? <Empty text="Ainda não há ações registadas." /> : data.recent.map(item => <ActionRow key={item.id} item={item} />)}
    </Card>
    <Button variant="ghost" label={refreshing ? "A atualizar..." : "Atualizar"} onPress={refresh} />
  </>;
}
function ActionRow({ item }) {
  return <Row icon="document-text" title={`${item.admin ? `@${item.admin.username}` : "Equipa"} · ${item.label}${item.target_user ? ` @${item.target_user.username}` : item.target_id ? ` #${item.target_id}` : ""}`}
    subtitle={`${relativeTime(item.created_at)}${item.note ? ` · «${item.note}»` : ""}`} />;
}

// ---------------------------------------------------------------------------------------------
const PAYMENT_STATUS = [["", "Todos"], ["paid", "Pagos"], ["refund_due", "Reembolso por fazer"], ["refunded", "Reembolsados"]];
function Payments({ ask }) {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(query ? { q: query } : {}) }).toString();
  const { data, error, load } = useAdmin(`/admin/payments${params ? `?${params}` : ""}`);
  const [notice, run] = useAction(load);
  const refund = async payment => {
    const note = await ask({ title: `Reembolsar ${kz(payment.amount)}`, message: `${payment.receipt} · @${payment.customer?.username}. Retira o que o pagamento deu.`, placeholder: "Motivo (fica no registo)" });
    if (note) run(() => post(`/admin/payments/${payment.kind}/${payment.id}/refund`, { note }), "Reembolso iniciado.");
  };
  const refunded = async payment => {
    const note = await ask({ title: "Dinheiro devolvido", message: payment.receipt, placeholder: "Referência da transferência" });
    if (note) run(() => post(`/admin/payments/${payment.kind}/${payment.id}/refunded`, { note }), "Reembolso confirmado.");
  };
  return <>
    <Field placeholder="Nome, @utilizador, email ou nº do recibo" value={search} onChangeText={setSearch} onSubmitEditing={() => setQuery(search.trim())} returnKeyType="search" />
    <Chips value={status} onChange={setStatus} options={PAYMENT_STATUS} />
    <Button small variant="secondary" icon="download" label="Exportar CSV (contabilidade)" onPress={() => run(() => downloadAndShare(`/admin/payments.csv${params ? `?${params}` : ""}`, `tchilar-pagamentos-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv"), "CSV pronto.")} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : <>
      <Card><Stats items={[["Pagamentos", count(data.totals.count)], ["Recebido", kz(data.totals.received)], ["Reembolsado", kz(data.totals.refunded)], ["Por devolver", kz(data.totals.refund_due)]]} /></Card>
      {data.payments.length === 0 ? <Empty text="Nenhum pagamento com estes filtros." /> : data.payments.map(payment => <Card key={`${payment.kind}-${payment.id}`}
        title={kz(payment.amount)} subtitle={`${payment.receipt} · ${dateTime(payment.paid_at)}`}
        right={<Badge label={payment.status_label} tone={payment.status === "paid" ? "good" : payment.status === "refund_due" ? "warning" : "neutral"} />}>
        <Text style={{ color: colors.text }}>{payment.kind_label}: {payment.description}</Text>
        <Text style={{ color: colors.muted }}>{payment.customer ? `${payment.customer.display_name} (@${payment.customer.username}) · ${payment.customer.email}` : "Conta apagada"}</Text>
        <Text style={{ color: colors.muted }}>{payment.method_label}{payment.reference ? ` · Ref. ${payment.reference}` : ""}{payment.phone ? ` · ${payment.phone}` : ""}</Text>
        {payment.status === "paid" && <Button small variant="secondary" label="Reembolsar" onPress={() => refund(payment)} />}
        {payment.status === "refund_due" && <Button small label="Marcar devolvido" onPress={() => refunded(payment)} />}
      </Card>)}
    </>}
  </>;
}

function Attempts({ ask }) {
  const [status, setStatus] = useState("expired");
  const { data, error, load } = useAdmin(`/admin/payment-attempts?status=${status}`);
  const [notice, run] = useAction(load);
  const confirmPaid = async attempt => {
    const note = await ask({ title: `Confirmar ${kz(attempt.amount)} à mão`, message: `@${attempt.username} · ${attempt.purpose_label}`, placeholder: "Nº do comprovativo do banco" });
    if (note) run(() => post(`/admin/payment-attempts/${attempt.id}/confirm`, { note }), "Pagamento confirmado e produto entregue.");
  };
  return <>
    <Chips value={status} onChange={setStatus} options={[["pending", "À espera"], ["expired", "Expirados"], ["failed", "Falhados"]]} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.attempts.length === 0 ? <Empty text="Nada por resolver." /> : data.attempts.map(attempt => <Card key={attempt.id}
      title={`${attempt.purpose_label} · ${kz(attempt.amount)}`} subtitle={`${attempt.method === "express" ? "Multicaixa Express" : "Referência"} · pedido #${attempt.id} · ${dateTime(attempt.created_at)}`}>
      <Text style={{ color: colors.text }}>{attempt.display_name ? `${attempt.display_name} (@${attempt.username})` : "Conta apagada"}</Text>
      {attempt.provider_ref && <Text style={{ color: colors.muted }}>Entidade {attempt.entity || "—"} · Ref. {attempt.provider_ref}</Text>}
      {attempt.product_paid ? <Badge label="Já pago por outra via" tone="good" /> : <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small variant="secondary" label="Verificar" onPress={() => run(async () => { const result = await post(`/admin/payment-attempts/${attempt.id}/check`); if (result.status !== "paid") throw new Error(`O fornecedor diz: ${result.status}`); }, "Confirmado pelo fornecedor.")} />
        <Button small label="Confirmar à mão" onPress={() => confirmPaid(attempt)} />
      </View>}
    </Card>)}
  </>;
}

function Payouts({ ask }) {
  const [status, setStatus] = useState("requested");
  const { data, error, load } = useAdmin(`/admin/payouts?status=${status}`);
  const [selected, setSelected] = useState([]);
  const [notice, run] = useAction(load);
  useEffect(() => setSelected([]), [status]);
  const settle = async (payout, action) => {
    const value = await ask(action === "paid"
      ? { title: `Pagar ${kz(payout.amount)}`, message: `${payout.holder_name} · ${payout.iban}`, placeholder: "Referência da transferência" }
      : { title: "Recusar levantamento", placeholder: "Motivo (o criador vai ver)" });
    if (value) run(() => post(`/admin/payouts/${payout.id}/${action}`, action === "paid" ? { reference: value } : { note: value }), action === "paid" ? "Marcado como pago." : "Recusado.");
  };
  const batch = async () => {
    const reference = await ask({ title: `Marcar ${selected.length} como pagos`, placeholder: "Referência do lote no banco" });
    if (reference) run(() => post("/admin/payouts/batch", { ids: selected, reference }), `${selected.length} marcados como pagos.`);
  };
  return <>
    <Chips value={status} onChange={setStatus} options={[["requested", "Por pagar"], ["paid", "Pagos"], ["rejected", "Recusados"]]} />
    <Notice {...notice} />
    {status === "requested" && <Button small variant="secondary" icon="download" label="Ficheiro para o banco (CSV)" onPress={() => run(() => downloadAndShare("/admin/payouts.csv", `tchilar-levantamentos-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv"), "Ficheiro pronto.")} />}
    {status === "requested" && selected.length > 0 && <Button label={`Marcar ${selected.length} como pagos`} onPress={batch} />}
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.payouts.length === 0 ? <Empty text="Nada para mostrar." /> : data.payouts.map(payout => <Card key={payout.id}
      title={kz(payout.amount)} subtitle={`${payout.display_name || "Conta apagada"} · pedido ${relativeTime(payout.created_at)}`}
      right={status === "requested" ? <Switch value={selected.includes(payout.id)} onValueChange={on => setSelected(list => on ? [...list, payout.id] : list.filter(id => id !== payout.id))} /> : null}>
      <Text selectable style={{ color: colors.text }}>Titular: {payout.holder_name} · {payout.bank_name}</Text>
      <Text selectable style={{ color: colors.text, fontWeight: "800", letterSpacing: 0.5 }}>IBAN: {payout.iban}</Text>
      {payout.reference ? <Text style={{ color: colors.muted }}>Ref. {payout.reference}</Text> : null}
      {payout.note ? <Text style={{ color: colors.muted }}>{payout.note}</Text> : null}
      {payout.status === "requested" && <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small label="Marcar como pago" onPress={() => settle(payout, "paid")} />
        <Button small variant="secondary" label="Recusar" onPress={() => settle(payout, "reject")} />
      </View>}
    </Card>)}
  </>;
}

function Finance() {
  const { data, error } = useAdmin("/admin/finance");
  if (!data) return error ? <AdminError error={error} /> : <Loading />;
  return <>
    <Card title="Entradas (pagas por clientes)"><Stats items={[["Promoções", kz(data.income.promotions)], ["Estrelas", kz(data.income.stars)], ["Campanhas", kz(data.income.campaigns)], ["Grupos secretos", kz(data.income.groups)]]} /></Card>
    <Card title="Parte do Tchilar"><Stats items={[["Promoções", kz(data.tchilar_share.promotions)], ["Estrelas", kz(data.tchilar_share.stars)], ["Comissão campanhas", kz(data.tchilar_share.campaigns_commission)], ["Grupos", kz(data.tchilar_share.groups)]]} /></Card>
    <Card title="Criadores"><Stats items={[["Ganhos acumulados", kz(data.creators.earned)], [`Por pagar (${data.creators.requested_count})`, kz(data.creators.requested)], ["Já pagos", kz(data.creators.paid)], ["Ainda em dívida", kz(data.creators.still_owed)]]} /></Card>
    <Text style={{ color: colors.muted, fontSize: 12 }}>Valores de gestão. Não substituem a faturação certificada pela AGT.</Text>
  </>;
}

// ---------------------------------------------------------------------------------------------
const USER_FILTERS = [["all", "Todas"], ["online", "Online"], ["creators", "Criadores"], ["unverified", "Email por confirmar"], ["suspended", "Suspensas"], ["admins", "Equipa"]];
function Users() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { data, error } = useAdmin(`/admin/users?filter=${filter}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  return <>
    <Field placeholder="Nome, @utilizador ou email" value={search} onChangeText={setSearch} onSubmitEditing={() => setQuery(search.trim())} returnKeyType="search" autoCapitalize="none" />
    <Chips value={filter} onChange={setFilter} options={USER_FILTERS} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : <Card title={`${count(data.total)} contas`}>
      {data.users.length === 0 ? <Empty text="Nenhuma conta encontrada." /> : data.users.map(person => <Pressable key={person.id} onPress={() => router.push(`/admin/user/${person.id}`)}
        style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8 }}>
        <Avatar user={person} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>{person.display_name} <Text style={{ color: colors.muted, fontWeight: "400" }}>@{person.username}</Text></Text>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{person.email}</Text>
          <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
            {person.is_admin && <Badge label="Equipa" tone="info" />}
            {person.suspended_at && <Badge label="Suspensa" tone="danger" />}
            {!person.email_verified && <Badge label="Email por confirmar" tone="warning" />}
            {person.is_creator && <Badge label="Criador" />}
            {person.open_reports > 0 && <Badge label={`${person.open_reports} denúncias`} tone="warning" />}
          </View>
        </View>
      </Pressable>)}
    </Card>}
  </>;
}

// ---------------------------------------------------------------------------------------------
function Moderation({ ask }) {
  const [type, setType] = useState("post");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, load } = useAdmin(`/admin/content?type=${type}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  const [notice, run] = useAction(load);
  const act = async (item, action) => {
    let reason = "";
    if (action !== "restore") {
      reason = await ask({ title: action === "delete" ? "Apagar" : "Esconder", placeholder: "Motivo (o dono vai ver)" });
      if (!reason) return;
    }
    run(() => post(`/admin/content/${type}/${item.id}/${action}`, { reason }), { hide: "Escondido.", restore: "Voltou a estar visível.", delete: "Apagado." }[action]);
  };
  return <>
    <Chips value={type} onChange={setType} options={[["post", "Publicações"], ["comment", "Comentários"], ["group", "Grupos"], ["page", "Páginas"]]} />
    <Field placeholder="Texto ou @autor" value={search} onChangeText={setSearch} onSubmitEditing={() => setQuery(search.trim())} returnKeyType="search" />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.items.length === 0 ? <Empty text="Nada encontrado." /> : data.items.map(item => <Card key={item.id}
      title={item.title || `@${item.username}`} subtitle={`${item.title ? `@${item.username} · ` : ""}${relativeTime(item.created_at)}${item.open_reports ? ` · ${item.open_reports} denúncias` : ""}`}
      right={item.hidden_at ? <Badge label="Escondido" tone="warning" /> : null}>
      <Text style={{ color: colors.text }} numberOfLines={6}>{item.text || (item.media_url ? "[foto/vídeo]" : "—")}</Text>
      {type === "comment" ? <Button small variant="danger" label="Apagar" onPress={() => act(item, "delete")} />
        : item.hidden_at ? <Button small variant="secondary" label="Voltar a mostrar" onPress={() => act(item, "restore")} />
          : <Button small variant="danger" label="Esconder" onPress={() => act(item, "hide")} />}
    </Card>)}
  </>;
}

const REPORT_ACTIONS = [["dismiss", "Arquivar"], ["hide_post", "Esconder publicação", "post"], ["delete_comment", "Apagar comentário", "comment"], ["hide_course", "Esconder curso", "course"], ["suspend_user", "Suspender conta"]];
function Reports() {
  const [status, setStatus] = useState("open");
  const { data, error, load } = useAdmin(`/admin/reports?status=${status}`);
  const [notice, run] = useAction(load);
  const resolve = async (report, action, label) => {
    if (await confirm("Denúncia", `${label}?`)) run(() => post(`/admin/reports/${report.id}/resolve`, { action }), "Denúncia resolvida.");
  };
  return <>
    <Chips value={status} onChange={setStatus} options={[["open", "Abertas"], ["resolved", "Resolvidas"], ["dismissed", "Arquivadas"]]} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.reports.length === 0 ? <Empty text="Nenhuma denúncia." icon="flag-outline" /> : data.reports.map(report => <Card key={report.id}
      title={data.reasons[report.reason] || report.reason} subtitle={`${{ post: "Publicação", comment: "Comentário", course: "Curso" }[report.target_type] || "Perfil"} de @${report.target_username || "?"} · ${relativeTime(report.created_at)}`}
      right={report.open_reports_on_target > 1 ? <Badge label={`${report.open_reports_on_target} denúncias`} tone="warning" /> : null}>
      {report.target_excerpt ? <Text style={{ color: colors.text }} numberOfLines={6}>{report.target_excerpt}</Text> : null}
      {report.details ? <Text style={{ color: colors.muted }}>Detalhes: {report.details}</Text> : null}
      {status === "open" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {REPORT_ACTIONS.filter(([, , only]) => !only || only === report.target_type).map(([action, label]) =>
          <Button key={action} small variant={action === "dismiss" ? "secondary" : "danger"} label={label} onPress={() => resolve(report, action, label)} />)}
      </View>}
    </Card>)}
  </>;
}

function Promotions({ ask }) {
  const [status, setStatus] = useState("in_review");
  const { data, error, load } = useAdmin(`/admin/ads?status=${status}`);
  const [notice, run] = useAction(load);
  const reject = async ad => {
    const note = await ask({ title: "Recusar promoção", placeholder: "Motivo (o anunciante vai ver)" });
    if (note) run(() => post(`/admin/ads/${ad.id}/reject`, { note }), "Promoção recusada.");
  };
  return <>
    <Chips value={status} onChange={setStatus} options={[["in_review", "Em revisão"], ["active", "No ar"], ["rejected", "Recusadas"], ["all", "Todas"]]} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.ads.length === 0 ? <Empty text="Nada para rever." /> : data.ads.map(ad => <Card key={ad.id}
      title={ad.title} subtitle={`@${ad.username} · ${kz(ad.budget)} · ${ad.days} dias`}>
      {ad.post_body ? <Text style={{ color: colors.text }} numberOfLines={6}>{ad.post_body}</Text> : null}
      {ad.review_note ? <Text style={{ color: colors.danger }}>Motivo: {ad.review_note}</Text> : null}
      {ad.status === "in_review" && <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small label="Aprovar" onPress={() => run(() => post(`/admin/ads/${ad.id}/approve`), "Aprovada e no ar.")} />
        <Button small variant="danger" label="Recusar" onPress={() => reject(ad)} />
      </View>}
    </Card>)}
  </>;
}

function Music() {
  const { data, error, load } = useAdmin("/admin/music");
  const [notice, run] = useAction(load);
  const [form, setForm] = useState({ file: null, title: "", artist: "", genre: "outro", rights: false });
  const pickAudio = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setForm(current => ({ ...current, file: { uri: asset.uri, mimeType: asset.mimeType || "audio/mpeg", fileName: asset.name }, title: current.title || asset.name.replace(/\.[^.]+$/, "") }));
  };
  const send = () => run(async () => {
    const duration = await audioDuration(form.file.uri);
    await upload("/music", { title: form.title, artist: form.artist, genre: form.genre, duration: Math.round(duration * 100) / 100, rightsConfirmed: "true" }, form.file, "audio");
    setForm({ file: null, title: "", artist: "", genre: "outro", rights: false });
  }, "Música carregada. Põe-na na biblioteca quando tiveres a licença.");
  if (!data) return error ? <AdminError error={error} /> : <Loading />;
  return <>
    <Card title="Carregar música" subtitle="MP3 ou M4A. Só músicas com direitos para usar no Tchilar.">
      <Button small variant="secondary" icon="musical-notes" label={form.file ? form.file.fileName : "Escolher ficheiro de áudio"} onPress={pickAudio} />
      <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={120} />
      <Field label="Artista" value={form.artist} onChangeText={artist => setForm({ ...form, artist })} maxLength={120} />
      <Chips value={form.genre} onChange={genre => setForm({ ...form, genre })} options={(data.genres || []).map(genre => [genre, genre])} />
      <Row icon="document-text" title="Confirmo que temos os direitos desta música" right={<Switch value={form.rights} onValueChange={rights => setForm({ ...form, rights })} />} />
      <Button label="Carregar" onPress={send} disabled={!form.file || !form.title.trim() || !form.rights} />
    </Card>
    <Notice {...notice} />
    {data.tracks.length === 0 ? <Empty text="Ainda não há músicas." /> : data.tracks.map(track => <Card key={track.id} title={track.title} subtitle={`${track.artist || "—"} · ${track.genre || "sem género"} · ${track.uses} usos`}>
      <Row icon="library" title="Na biblioteca" subtitle={track.license || "Sem licença registada"}
        right={<Switch value={track.is_library} onValueChange={library => run(() => api(`/admin/music/${track.id}`, { method: "PATCH", body: { library } }), "Guardado.")} />} />
      <Row icon="eye-off" title="Escondida" right={<Switch value={Boolean(track.hidden_at)} onValueChange={hidden => run(() => api(`/admin/music/${track.id}`, { method: "PATCH", body: { hidden } }), "Guardado.")} />} />
    </Card>)}
  </>;
}

// ---------------------------------------------------------------------------------------------
function DataRequests({ ask }) {
  const [status, setStatus] = useState("open");
  const { data, error, load } = useAdmin(`/admin/data-requests?status=${status}`);
  const [notice, run] = useAction(load);
  const close = async (request, outcome) => {
    const answer = await ask({ title: outcome === "done" ? "Marcar como tratado" : "Recusar pedido", placeholder: outcome === "done" ? "Resposta para a pessoa" : "Motivo (a pessoa vai ver)" });
    if (answer) run(() => post(`/admin/data-requests/${request.id}/close`, { status: outcome, answer }), "Pedido fechado.");
  };
  const removeAccount = async request => {
    const typed = await ask({ title: "Apagar conta", message: `Apaga @${request.username} e todos os dados. Não pode ser desfeito. Escreve ${request.username} para confirmar.`, placeholder: request.username });
    if (typed) run(() => post(`/admin/data-requests/${request.id}/delete-account`, { confirm: typed }), `Conta @${request.username} apagada.`);
  };
  return <>
    <Chips value={status} onChange={setStatus} options={[["open", "Abertos"], ["done", "Tratados"], ["rejected", "Recusados"]]} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.requests.length === 0 ? <Empty text="Nenhum pedido." /> : data.requests.map(request => <Card key={request.id}
      title={data.kinds[request.kind]} subtitle={`@${request.username} · ${request.email} · ${dateTime(request.created_at)}`}
      right={request.overdue && status === "open" ? <Badge label="Prazo a acabar" tone="danger" /> : null}>
      {request.details ? <Text style={{ color: colors.text }}>{request.details}</Text> : null}
      {request.answer ? <Text style={{ color: colors.muted }}>Resposta: {request.answer}</Text> : null}
      {status === "open" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {request.kind === "export" && request.user_id && <Button small variant="secondary" icon="download" label="Descarregar dados" onPress={() => run(() => downloadAndShare(`/admin/data-requests/${request.id}/export`, `tchilar-dados-${request.username}.json`, "application/json"), "Ficheiro pronto. Envia-o à pessoa por um canal seguro.")} />}
        {request.kind === "delete" && request.user_id && <Button small variant="danger" label="Apagar conta" onPress={() => removeAccount(request)} />}
        <Button small label="Marcar tratado" onPress={() => close(request, "done")} />
        <Button small variant="secondary" label="Recusar" onPress={() => close(request, "rejected")} />
      </View>}
    </Card>)}
  </>;
}

function Broadcasts() {
  const { data, error, load } = useAdmin("/admin/broadcasts");
  const [form, setForm] = useState({ title: "", body: "", audience: "all", channel: "notification" });
  const [reach, setReach] = useState(null);
  const [notice, run] = useAction(load);
  useEffect(() => { setReach(null); api(`/admin/broadcasts/audience?audience=${encodeURIComponent(form.audience)}`).then(setReach).catch(() => {}); }, [form.audience]);
  if (!data) return error ? <AdminError error={error} /> : <Loading />;
  const send = async () => {
    const people = form.channel === "email" ? reach?.emails : reach?.people;
    if (await confirm("Enviar aviso", `Enviar «${form.title}» a ${people ?? "?"} pessoas? Não dá para desfazer.`)) {
      if (await run(() => post("/admin/broadcasts", form), "Aviso enviado.")) setForm({ ...form, title: "", body: "" });
    }
  };
  return <>
    <Card title="Novo aviso" subtitle="Chega a toda a gente, mesmo a quem desligou outras notificações.">
      <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={120} />
      <Field label="Mensagem" value={form.body} onChangeText={body => setForm({ ...form, body })} multiline maxLength={1000} />
      <Text style={{ color: colors.text, fontWeight: "700" }}>Para quem</Text>
      <Chips value={form.audience} onChange={audience => setForm({ ...form, audience })}
        options={[["all", "Todas"], ["creators", "Criadores"], ["inactive", "Sem entrar há 30 dias"], ...data.provinces.map(name => [`province:${name}`, name])]} />
      <Text style={{ color: colors.text, fontWeight: "700" }}>Como</Text>
      <Chips value={form.channel} onChange={channel => setForm({ ...form, channel })}
        options={[["notification", "Notificação"], ...(data.emailEnabled ? [["email", "Email"], ["both", "Notificação e email"]] : [])]} />
      <Text style={{ color: colors.muted }}>{reach ? `${reach.people} pessoas · ${reach.emails} com email confirmado` : "A contar..."}</Text>
      <Button label="Enviar aviso" onPress={send} disabled={!form.title.trim() || !form.body.trim()} />
      <Notice {...notice} />
    </Card>
    <Card title="Avisos enviados">
      {data.broadcasts.length === 0 ? <Empty text="Ainda não enviaste avisos." /> : data.broadcasts.map(item => <Row key={item.id} icon="megaphone" title={item.title}
        subtitle={`${item.audience} · ${item.recipients} pessoas · @${item.admin_username || "equipa"} · ${dateTime(item.created_at)}`} />)}
    </Card>
  </>;
}

function Log() {
  const { data, error } = useAdmin("/admin/actions");
  if (!data) return error ? <AdminError error={error} /> : <Loading />;
  return <Card title="Registo de ações" subtitle="Quem, o quê e quando. Não se pode apagar.">
    {data.actions.length === 0 ? <Empty text="Nada registado." /> : data.actions.map(item => <ActionRow key={item.id} item={item} />)}
  </Card>;
}


// ---------------------------------------------------------------------------------------------
// Desafios: catálogo (40 modelos), editar prémios, lançar o mês e encerrar/premiar.
const LEVEL_NAMES = { 1: "Bronze", 2: "Prata", 3: "Ouro", 4: "Diamante", 5: "Lenda" };
const prizeText = prizes => (prizes || []).filter(prize => prize.stars || Number(prize.cashKz))
  .map(prize => `${prize.place}.º ${[prize.stars ? `${prize.stars}⭐` : "", Number(prize.cashKz) ? kz(prize.cashKz) : ""].filter(Boolean).join(" + ")}`).join(" · ");

function TemplateEditor({ template, canGiveCash, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    title: template?.title || "", description: template?.description || "", category: template?.category || "geral", level: String(template?.level || 1),
    active: template?.active ?? true,
    prizes: (template?.prizes?.length ? template.prizes : [{ stars: 50, cashKz: 0 }, { stars: 30, cashKz: 0 }, { stars: 20, cashKz: 0 }])
      .map(prize => ({ stars: String(prize.stars || 0), cashKz: String(Number(prize.cashKz) || 0) }))
  }));
  const setPrize = (index, key, value) => setForm({ ...form, prizes: form.prizes.map((prize, i) => i === index ? { ...prize, [key]: value } : prize) });
  return <View style={{ gap: 10, paddingVertical: 8 }}>
    <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={100} />
    <Field label="Regras" value={form.description} onChangeText={description => setForm({ ...form, description })} multiline maxLength={1000} />
    <Field label="Categoria" value={form.category} onChangeText={category => setForm({ ...form, category })} maxLength={40} />
    <Chips options={Object.entries(LEVEL_NAMES)} value={form.level} onChange={level => setForm({ ...form, level })} />
    <Text style={{ color: colors.text, fontWeight: "800" }}>Prémios por lugar{canGiveCash ? "" : " (dinheiro: só finanças)"}</Text>
    {form.prizes.map((prize, index) => <View key={index} style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
      <Text style={{ width: 28, fontWeight: "800", color: colors.text, paddingBottom: 14 }}>{index + 1}.º</Text>
      <View style={{ flex: 1 }}><Field label="Estrelas" value={prize.stars} onChangeText={value => setPrize(index, "stars", value)} keyboardType="number-pad" /></View>
      <View style={{ flex: 1 }}><Field label="Kz" value={prize.cashKz} onChangeText={value => setPrize(index, "cashKz", value)} keyboardType="decimal-pad" editable={canGiveCash} /></View>
    </View>)}
    <View style={{ flexDirection: "row", gap: 8 }}>
      {form.prizes.length < 10 && <Button small variant="secondary" label="+ Lugar" onPress={() => setForm({ ...form, prizes: [...form.prizes, { stars: "0", cashKz: "0" }] })} />}
      {form.prizes.length > 1 && <Button small variant="secondary" label="− Lugar" onPress={() => setForm({ ...form, prizes: form.prizes.slice(0, -1) })} />}
    </View>
    {template && <Row icon={form.active ? "eye" : "eye-off"} title="Ligado" subtitle="Aparece para lançar" right={<Switch value={form.active} onValueChange={active => setForm({ ...form, active })} />} />}
    <Button label="Guardar" onPress={() => onSave({ ...form, level: Number(form.level), prizes: form.prizes.map(prize => ({ stars: Number(prize.stars) || 0, cashKz: Number(String(prize.cashKz).replace(",", ".")) || 0 })) })} disabled={!form.title.trim()} />
    <Button variant="ghost" label="Cancelar" onPress={onCancel} />
  </View>;
}

function Challenges() {
  const catalog = useAdmin("/admin/challenge-templates");
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState([]);
  const [days, setDays] = useState("");
  const [editing, setEditing] = useState(null);
  const [level, setLevel] = useState("1");
  const reload = useCallback(async () => { await catalog.load(); setOpen((await api("/challenges")).challenges.filter(item => item.closed_at === null)); }, [catalog.load]);
  const [notice, run] = useAction(reload);
  useEffect(() => { api("/challenges").then(result => setOpen(result.challenges.filter(item => item.closed_at === null))).catch(() => setOpen([])); }, []);
  if (!catalog.data) return catalog.error ? <AdminError error={catalog.error} /> : <Loading />;
  const { templates, canGiveCash } = catalog.data;
  const chosen = templates.filter(t => selected.includes(t.id));
  const chosenCash = chosen.some(t => t.prizes.some(prize => Number(prize.cashKz) > 0));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const launch = () => Alert.alert("Lançar desafios", `Lançar ${chosen.length} ${days ? `por ${days} dias` : "até ao fim do mês"} e avisar todas as pessoas?`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Lançar", onPress: () => run(async () => { await api("/admin/challenges/launch", { method: "POST", body: { templateIds: selected, ...(days && { days: Number(days) }) } }); setSelected([]); }, "Lançados. Toda a gente recebeu um aviso.") }
  ]);
  const close = challenge => Alert.alert("Encerrar e premiar", `${challenge.title}\n${prizeText(challenge.prizes) || "Sem prémio"}`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Encerrar", onPress: () => run(() => api(`/challenges/${challenge.id}/close`, { method: "POST" }), "Encerrado. Os vencedores receberam os prémios.") }
  ]);
  const save = (id, body) => run(async () => {
    await api(id === "new" ? "/admin/challenge-templates" : `/admin/challenge-templates/${id}`, { method: id === "new" ? "POST" : "PATCH", body });
    setEditing(null);
  }, "Modelo guardado.");

  return <>
    <Notice {...notice} />
    <Card title="Lançar os desafios do mês" subtitle="Escolhe no catálogo (até 20). Toda a gente recebe um aviso. Só contam publicações feitas durante o desafio.">
      <Chips options={[["", "Até ao fim do mês"], ["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"]]} value={days} onChange={setDays} />
      <Text style={{ color: colors.muted }}>{chosen.length} escolhidos{chosenCash ? " · com dinheiro" : ""}</Text>
      {chosenCash && !canGiveCash && <Text style={{ color: colors.danger }}>Há prémios em dinheiro: só a equipa de finanças lança estes.</Text>}
      <Button label="Lançar e avisar todos" icon="trophy" onPress={launch} disabled={!chosen.length || (chosenCash && !canGiveCash)} />
    </Card>
    <Card title="A decorrer">
      {!open ? <Loading /> : open.length === 0 ? <Empty text="Nenhum desafio aberto." icon="trophy-outline" />
        : open.map(item => <Row key={item.id} icon="trophy" tone="#E5A000" title={item.title}
          subtitle={`${item.level ? LEVEL_NAMES[item.level] : "Especial"} · ${prizeText(item.prizes) || "sem prémio"} · ${item.entries} participações`}
          right={<Button small label="Encerrar" onPress={() => close(item)} />} />)}
    </Card>
    <Card title={`Catálogo (${templates.length})`} subtitle="Estrelas no Bronze, Prata e Ouro; estrelas e dinheiro no Diamante e na Lenda. Tudo editável."
      right={editing !== "new" ? <Button small variant="secondary" label="Novo" onPress={() => setEditing("new")} /> : null}>
      {editing === "new" && <TemplateEditor canGiveCash={canGiveCash} onSave={body => save("new", body)} onCancel={() => setEditing(null)} />}
      <Chips options={Object.entries(LEVEL_NAMES)} value={level} onChange={setLevel} />
      {templates.filter(t => String(t.level) === level).map(t => <View key={t.id}>
        <Row icon={selected.includes(t.id) ? "checkbox" : "square-outline"} tone={t.active ? "#0A84FF" : undefined} title={t.title}
          subtitle={`${t.category} · ${prizeText(t.prizes)}${t.active ? "" : " · desligado"}${t.times_launched ? ` · lançado ${t.times_launched}×` : ""}`}
          onPress={t.active ? () => toggle(t.id) : undefined}
          right={editing !== t.id ? <Button small variant="secondary" label="Editar" onPress={() => setEditing(t.id)} /> : null} />
        {editing === t.id && <TemplateEditor template={t} canGiveCash={canGiveCash} onSave={body => save(t.id, body)} onCancel={() => setEditing(null)} />}
      </View>)}
    </Card>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Cursos: rever os cursos dos criadores antes de irem para a venda.
function Courses({ ask }) {
  const [status, setStatus] = useState("review");
  const { data, error, load } = useAdmin(`/admin/courses?status=${status}`);
  const [notice, run] = useAction(load);
  const act = async (course, action) => {
    let note = "";
    if (action !== "approve") {
      note = await ask({ title: action === "reject" ? "Pedir mudanças" : "Retirar da Academia", message: course.title, placeholder: "O criador recebe esta nota" });
      if (!note) return;
    }
    run(() => api(`/admin/courses/${course.id}/review`, { method: "POST", body: { action, note } }),
      { approve: "Aprovado e à venda.", reject: "Devolvido ao criador.", hide: "Retirado da Academia." }[action]);
  };
  return <>
    <Chips options={[["review", "Por rever"], ["published", "À venda"], ["rejected", "Recusados"], ["hidden", "Retirados"]]} value={status} onChange={setStatus} />
    <Notice {...notice} />
    {!data ? error ? <AdminError error={error} /> : <Loading /> : data.courses.length === 0 ? <Empty text="Nada aqui." icon="school-outline" />
      : data.courses.map(course => <Card key={course.id} title={course.title}
        subtitle={`${course.by_team ? "Equipa Tchilar" : `@${course.owner_username}`} · ${Number(course.price_kz) ? kz(course.price_kz) : "Grátis"} · ${course.lessons_count} aulas · ${course.students} alunos`}>
        {course.summary ? <Text style={{ color: colors.text }}>{course.summary}</Text> : null}
        {course.review_note ? <Text style={{ color: colors.muted }}>Nota: {course.review_note}</Text> : null}
        <Button small variant="secondary" label="Ver aulas" onPress={() => router.push(`/academy/${course.id}`)} />
        {["review", "hidden"].includes(status) && <Button small label={status === "hidden" ? "Repor" : "Aprovar"} onPress={() => act(course, "approve")} />}
        {status === "review" && <Button small variant="secondary" label="Pedir mudanças" onPress={() => act(course, "reject")} />}
        {status === "published" && <Button small variant="danger" label="Retirar" onPress={() => act(course, "hide")} />}
      </Card>)}
  </>;
}

const SECTIONS = { painel: Overview, pagamentos: Payments, "por-resolver": Attempts, levantamentos: Payouts, financas: Finance, utilizadores: Users,
  moderacao: Moderation, denuncias: Reports, promocoes: Promotions, musicas: Music, dados: DataRequests, avisos: Broadcasts, registo: Log,
  desafios: Challenges, cursos: Courses };

export default function AdminSection() {
  const { section } = useLocalSearchParams();
  const { user } = useSession();
  const [prompt, ask] = usePrompt();
  const entry = ADMIN_SECTIONS.flatMap(([, items]) => items).find(([slug]) => slug === section);
  const Section = SECTIONS[section];
  const allowed = user?.is_admin && entry && canSee(user.admin_role || "super", entry[4]);
  return <Page>
    <Stack.Screen options={{ title: entry?.[2] || "Administração" }} />
    {!allowed ? <Empty text="A tua função na equipa não dá acesso a esta área." icon="lock-closed-outline" /> : <Section ask={ask} />}
    {prompt}
  </Page>;
}
