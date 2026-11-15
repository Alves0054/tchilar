import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { CampaignList } from "../components/Campaigns";
import { PaymentSheet } from "../components/PaymentSheet";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, Row, Stats, count, dateOnly, dateTime, kz } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

const TABS = [["resumo", "Resumo"], ["conteudo", "Conteúdo"], ["ganhos", "Ganhos"], ["promocoes", "Promoções"],
  ["subscricoes", "Subscrições"], ["parceiros", "Parceiros"], ["parcerias", "Parcerias"]];

function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api(path).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message)), [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}
const change = ({ total, previous }) => !previous ? null : `${total >= previous ? "+" : ""}${Math.round(((total - previous) / previous) * 100)}% vs. período anterior`;

// Barras simples por dia (uma série). Toca numa barra para ver o valor.
function Bars({ rows, field }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...rows.map(row => row[field] || 0));
  const shown = active === null ? null : rows[active];
  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.muted, fontSize: 12 }}>{shown ? `${dateOnly(shown.day)}: ${count(shown[field])}` : "Toca numa barra para ver o dia"}</Text>
    <View style={styles.bars}>{rows.map((row, index) => <Pressable key={row.day} style={styles.barHit} onPress={() => setActive(index)}>
      <View style={[styles.bar, { height: `${Math.max(2, (row[field] / max) * 100)}%` }, active === index && { backgroundColor: colors.accent }]} />
    </Pressable>)}</View>
  </View>;
}

function Summary() {
  const [days, setDays] = useState("28");
  const { data, error } = useLoad(`/creator/overview?days=${days}`);
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const metric = (key, label) => [label, count(data.metrics[key].total), change(data.metrics[key])];
  return <>
    <Chips value={days} onChange={setDays} options={[["7", "7 dias"], ["28", "28 dias"], ["90", "90 dias"]]} />
    <Card title="Desempenho">
      <Stats items={[metric("views", "Visualizações"), metric("engagement", "Interações"), metric("followers", "Novos seguidores"), metric("visits", "Visitas ao perfil")]} />
    </Card>
    <Card title="Visualizações por dia"><Bars rows={data.daily} field="views" /></Card>
  </>;
}

function Content() {
  const { data, error } = useLoad("/creator/content");
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  return <Card title="As tuas publicações">
    {data.posts.length === 0 ? <Empty text="Ainda não publicaste." /> : data.posts.map(post => <Row key={post.id}
      icon={post.media_type === "video" ? "film" : post.media_type === "image" ? "image" : "document-text"}
      title={post.body?.slice(0, 80) || (post.media_type === "video" ? "Vídeo" : "Foto")}
      subtitle={`${dateOnly(post.created_at)} · ${count(post.views)} visualizações · ${count(post.likes)} gostos · ${count(post.comments)} comentários`} />)}
  </Card>;
}

function Earnings() {
  const { data, error, load } = useLoad("/payouts");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const withdraw = async () => {
    setBusy(true); setNotice({});
    try { await api("/payouts/requests", { method: "POST", body: { amount: Number(amount) } }); setAmount(""); setNotice({ message: "Pedido enviado. A equipa faz a transferência." }); load(); }
    catch (sendError) { setNotice({ error: sendError.message }); } finally { setBusy(false); }
  };
  const saveAccount = async () => {
    setBusy(true); setNotice({});
    try { await api("/payouts/account", { method: "PUT", body: account }); setAccount(null); setNotice({ message: "Conta bancária guardada." }); load(); }
    catch (saveError) { setNotice({ error: saveError.message }); } finally { setBusy(false); }
  };
  const status = { requested: ["Em processamento", "warning"], paid: ["Pago", "good"], rejected: ["Recusado", "danger"] };
  return <>
    <Card title="Saldo disponível" subtitle={`Ganhaste ${kz(data.earned)} no total; já levantaste ${kz(data.withdrawn)}.`}>
      <Text style={styles.big}>{kz(data.available)}</Text>
      <Stats items={[["Programa de Parceiros", kz(data.sources.partnerKz)], ["Estrelas", kz(data.sources.starsKz)], ["Campanhas", kz(data.sources.campaignsKz)], ["Grupos secretos", kz(data.sources.groupsKz)], ["Prémios de desafios", kz(data.sources.prizesKz)], ["Cursos vendidos", kz(data.sources.coursesKz)]]} />
      {data.accruing.partnerKz > 0 && <Text style={styles.muted}>Este mês já acumulaste {kz(data.accruing.partnerKz)} (entra no saldo quando o mês fechar).</Text>}
    </Card>
    <Notice {...notice} />
    <Card title="Levantar" subtitle={`Mínimo ${kz(data.min_withdrawal)}. A transferência vai para a tua conta bancária.`}>
      {data.account ? <Row icon="business" title={`${data.account.holder_name} · ${data.account.bank_name}`} subtitle={`IBAN ${data.account.iban}`}
        right={<Button small variant="secondary" label="Mudar" onPress={() => setAccount({ holderName: "", bankName: "", iban: "" })} />} /> : null}
      {(!data.account || account) && <View style={{ gap: 10 }}>
        <Field label="Titular da conta" value={account?.holderName ?? ""} onChangeText={holderName => setAccount({ ...(account || {}), holderName })} />
        <Field label="Banco" value={account?.bankName ?? ""} onChangeText={bankName => setAccount({ ...(account || {}), bankName })} placeholder="BAI, BFA, BIC…" />
        <Field label="IBAN" value={account?.iban ?? ""} onChangeText={iban => setAccount({ ...(account || {}), iban })} autoCapitalize="characters" placeholder="AO06 …" />
        <Button label="Guardar conta" onPress={saveAccount} busy={busy} disabled={!account?.holderName || !account?.bankName || !account?.iban} />
      </View>}
      {data.account && !account && <>
        <Field label="Valor (Kz)" value={amount} onChangeText={value => setAmount(value.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
        <Button label="Pedir levantamento" onPress={withdraw} busy={busy} disabled={!amount} />
      </>}
    </Card>
    <Card title="Pedidos">
      {data.requests.length === 0 ? <Empty text="Ainda não pediste levantamentos." /> : data.requests.map(request => {
        const [label, tone] = status[request.status] || [request.status, "neutral"];
        return <Row key={request.id} icon="cash" title={kz(request.amount)} subtitle={`${dateTime(request.created_at)}${request.reference ? ` · ref. ${request.reference}` : ""}${request.note ? ` · ${request.note}` : ""}`}
          right={<Badge label={label} tone={tone} />} />;
      })}
    </Card>
  </>;
}

function Promotions() {
  const { data, error, load } = useLoad("/ads/mine");
  const { user } = useSession();
  const [posts, setPosts] = useState(null);
  const [form, setForm] = useState(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const start = async () => {
    const result = await api(`/posts?username=${encodeURIComponent(user.username)}`);
    setPosts(result.posts.filter(post => !post.is_exclusive && !post.group_id && !post.shared_post_id));
  };
  const setStatus = async (ad, status) => {
    try { await api(`/ads/${ad.id}`, { method: "PATCH", body: { status } }); load(); } catch (patchError) { setNotice({ error: patchError.message }); }
  };
  const remove = ad => Alert.alert("Apagar promoção", `Apagar «${ad.title}»?`, [{ text: "Não" }, { text: "Apagar", style: "destructive", onPress: async () => {
    try { await api(`/ads/${ad.id}`, { method: "DELETE" }); load(); } catch (deleteError) { setNotice({ error: deleteError.message }); }
  } }]);
  const STATUS = { pending_payment: ["Por pagar", "warning"], in_review: ["Em revisão", "info"], active: ["No ar", "good"], paused: ["Em pausa", "neutral"], ended: ["Terminada", "neutral"], rejected: ["Recusada", "danger"] };
  return <>
    <Notice {...notice} />
    <Card title="Impulsionar uma publicação" subtitle="Mostra a tua publicação a mais pessoas. A equipa revê antes de ir para o ar.">
      {!posts && !form && <Button label="Escolher publicação" icon="rocket" onPress={start} />}
      {posts && !form && (posts.length === 0 ? <Empty text="Publica primeiro uma publicação pública." />
        : posts.slice(0, 15).map(post => <Row key={post.id} icon="document-text" title={post.body?.slice(0, 70) || "[foto/vídeo]"} subtitle={`${count(post.likes)} gostos`}
          onPress={() => setForm({ postId: post.id, title: post.body?.slice(0, 80) || "", budget: "5000", days: "7" })} />))}
      {form && <View style={{ gap: 10 }}>
        <Field label="Orçamento (Kz)" value={form.budget} onChangeText={budget => setForm({ ...form, budget: budget.replace(/[^\d]/g, "") })} keyboardType="number-pad" hint="Mínimo 1 000 Kz." />
        <Field label="Dias" value={form.days} onChangeText={days => setForm({ ...form, days: days.replace(/[^\d]/g, "") })} keyboardType="number-pad" hint="Entre 1 e 30." />
        <Text style={styles.muted}>Cerca de {count(Math.floor(Number(form.budget || 0) / data.cost_per_impression))} visualizações.</Text>
        <Button label={`Pagar ${kz(form.budget)}`} onPress={() => setPaying(true)} disabled={Number(form.budget) < 1000 || !form.days} />
        <Button label="Cancelar" variant="ghost" onPress={() => { setForm(null); setPosts(null); }} />
      </View>}
    </Card>
    <Card title="As tuas promoções">
      {data.ads.length === 0 ? <Empty text="Ainda não promoveste nada." icon="megaphone-outline" /> : data.ads.map(ad => {
        const [label, tone] = STATUS[ad.status] || [ad.status, "neutral"];
        return <View key={ad.id} style={styles.ad}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ flex: 1, color: colors.text, fontWeight: "800" }} numberOfLines={1}>{ad.title}</Text><Badge label={label} tone={tone} />
          </View>
          <Text style={styles.muted}>{kz(ad.spent)} de {kz(ad.budget)} · {count(ad.impressions)} visualizações · {count(ad.reach)} pessoas · {count(ad.clicks)} cliques</Text>
          {ad.review_note ? <Text style={{ color: colors.danger }}>Motivo: {ad.review_note}</Text> : null}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {ad.status === "active" && <Button small variant="secondary" label="Pausar" onPress={() => setStatus(ad, "paused")} />}
            {ad.status === "paused" && <Button small label="Retomar" onPress={() => setStatus(ad, "active")} />}
            {["pending_payment", "ended", "rejected"].includes(ad.status) && <Button small variant="ghost" label="Apagar" onPress={() => remove(ad)} />}
          </View>
        </View>;
      })}
    </Card>
    <PaymentSheet visible={paying} title="Impulsionar publicação" amount={Number(form?.budget || 0)} onClose={() => setPaying(false)}
      start={choice => api("/ads", { method: "POST", body: { postId: form.postId, title: form.title, budget: Number(form.budget), days: Number(form.days), ...choice } })}
      onPaid={() => { setPaying(false); setForm(null); setPosts(null); setNotice({ message: "Paga! A equipa vai rever a promoção." }); load(); }} />
  </>;
}

function Subscriptions() {
  const { data, error, load } = useLoad("/creator/monetization");
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const savePrice = async () => {
    try { await api("/auth/me", { method: "PATCH", body: { subscriptionPrice: Number(price) } }); setNotice({ message: "Preço guardado." }); setPrice(""); load(); }
    catch (saveError) { setNotice({ error: saveError.message }); }
  };
  return <>
    <Card title="Subscrições" subtitle="Quem subscreve vê as tuas publicações exclusivas.">
      <Stats items={[["Preço por mês", kz(data.price)], ["Subscritores ativos", count(data.active_subscribers)], ["A pagar", count(data.paying_subscribers)], ["Receita estimada / mês", kz(data.estimated_monthly_revenue)]]} />
      <Field label="Novo preço mensal (Kz)" value={price} onChangeText={value => setPrice(value.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
      <Button label="Guardar preço" onPress={savePrice} disabled={!price} />
      <Notice {...notice} />
    </Card>
    <Card title="Subscritores">
      {data.subscribers.length === 0 ? <Empty text="Ainda não tens subscritores." /> : data.subscribers.map(item => <Row key={item.username} icon="person" title={item.display_name}
        subtitle={item.is_active ? `Ativo até ${dateOnly(item.current_period_end)}${item.cancel_at_period_end ? " (cancela no fim)" : ""}` : "Terminada"}
        right={<Badge label={item.provider === "stripe" ? "Pago" : "Demo"} tone={item.is_active ? "good" : "neutral"} />} />)}
    </Card>
  </>;
}

function Partner() {
  const { data, error, load } = useLoad("/creator/partner");
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const join = async () => {
    try { await api("/creator/partner/join", { method: "POST" }); setNotice({ message: "Bem-vindo ao Programa de Parceiros!" }); load(); } catch (joinError) { setNotice({ error: joinError.message }); }
  };
  return <>
    <Card title="Programa de Parceiros" subtitle={`Ganhas ${kz(data.rpm)} por cada 1000 visualizações qualificadas. Mínimo para receber: ${kz(data.min_payout)}.`}
      right={data.partner_since ? <Badge label={data.earning ? "A ganhar" : "Em pausa"} tone={data.earning ? "good" : "warning"} /> : null}>
      {data.checks.map(check => <Row key={check.key} icon={check.met ? "checkmark-circle" : "ellipse-outline"} tone={check.met ? colors.good : colors.muted}
        title={check.label} subtitle={check.target ? `${count(check.current)} de ${count(check.target)}` : null} />)}
      {!data.partner_since && <Button label="Aderir ao programa" onPress={join} disabled={!data.eligible} />}
      <Notice {...notice} />
    </Card>
    {data.months?.length > 0 && <Card title="Ganhos por mês">
      {data.months.map(month => <Row key={month.month} icon="calendar" title={kz(month.amount)} subtitle={`${count(month.views)} visualizações · ${month.month}`} />)}
    </Card>}
  </>;
}

// Painel do Criador. Quem ainda não é criador pode ativar aqui.
export default function Creator() {
  const { user, refresh } = useSession();
  const [tab, setTab] = useState("resumo");
  const [error, setError] = useState("");
  if (!user.is_creator) {
    const enable = async () => {
      try { await api("/creator/enable", { method: "POST" }); await refresh(); } catch (enableError) { setError(enableError.message); }
    };
    return <Page><Card title="Torna-te criador" subtitle="Ganha com subscrições, estrelas, campanhas de marcas e o Programa de Parceiros.">
      <Ionicons name="sparkles" size={40} color={colors.primary} style={{ alignSelf: "center" }} />
      <Button label="Ativar conta de criador" onPress={enable} />
      <Notice error={error} />
    </Card></Page>;
  }
  const Section = { resumo: Summary, conteudo: Content, ganhos: Earnings, promocoes: Promotions, subscricoes: Subscriptions, parceiros: Partner, parcerias: CampaignList }[tab];
  return <Page>
    <Chips value={tab} onChange={setTab} options={TABS} />
    <Section />
  </Page>;
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 13 },
  big: { color: colors.text, fontSize: 32, fontWeight: "800" },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 120, gap: 2 },
  barHit: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  ad: { gap: 6, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }
});
