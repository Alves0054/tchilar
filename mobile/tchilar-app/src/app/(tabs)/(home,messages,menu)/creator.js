import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { CampaignList } from "../../../components/Campaigns";
import { AdsStudio } from "../../../components/AdsStudio";
import { VerificationPlans } from "../../../components/VerificationPlans";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, Row, count, dateOnly, dateTime, kz } from "../../../components/ui";
import { api, mediaUri } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { colors, relativeTime } from "../../../lib/theme";

// Painel do criador: as mesmas áreas, pela mesma ordem e com os mesmos nomes do site (CREATOR_SECTIONS em src/modules/creator.jsx).
const SECTIONS = [
  ["inicio", "Página inicial"], ["insights", "Insights"], ["conteudo", "Conteúdo"], ["engajamento", "Engajamento"],
  ["monetizacao", "Monetização"], ["verificacao", "Verificação"], ["ganhos", "Ganhos"], ["parcerias", "Parcerias"], ["anuncios", "Anúncios"]
];
const METRICS = [
  ["views", "Visualizações", "eye-outline", "publicações vistas por outras pessoas"],
  ["engagement", "Engajamento", "chatbubbles-outline", "gostos, comentários e partilhas"],
  ["followers", "Novos seguidores", "people-outline", "pessoas que começaram a seguir-te"],
  ["visits", "Visitas ao perfil", "person-outline", "pessoas que abriram o teu perfil"]
];
const PERIODS = [["7", "Últimos 7 dias"], ["28", "Últimos 28 dias"], ["90", "Últimos 90 dias"]];
// Onde receber os levantamentos (igual ao site): o servidor valida e guarda o destino cifrado.
const PAYOUT_CHOICES = [
  { id: "iban", label: "Banco (IBAN)", icon: "business-outline", field: "IBAN", placeholder: "AO06 0000 0000 0000 0000 0000 0", hint: "Transferência para qualquer banco angolano." },
  { id: "express", label: "Multicaixa Express", icon: "phone-portrait-outline", field: "Telemóvel do Express", placeholder: "923 456 789", keyboard: "phone-pad", hint: "Recebes no Express do número angolano indicado." },
  { id: "paypay", label: "PayPay África", icon: "wallet-outline", field: "Telemóvel da conta PayPay", placeholder: "923 456 789", keyboard: "phone-pad", hint: "Recebes na carteira PayPay África desse número." },
  { id: "paypal", label: "PayPal", icon: "logo-paypal", field: "Email da conta PayPal", placeholder: "nome@exemplo.com", keyboard: "email-address", hint: "Pago em dólares, à taxa do dia. O PayPal pode cobrar taxas." },
  { id: "redotpay", label: "RedotPay", icon: "card-outline", field: "Email ou ID (UID) RedotPay", placeholder: "nome@exemplo.com ou 12345678", keyboard: "email-address", hint: "Pago em dólares (USDT), à taxa do dia." }
];
const ANGOLAN_BANKS = ["BAI", "BFA", "BIC", "BPC", "Millennium Atlântico", "Banco Sol", "BNI", "Standard Bank", "Banco Económico", "Banco Keve", "Banco Yetu", "Outro"];
const payoutChoice = id => PAYOUT_CHOICES.find(item => item.id === id) || PAYOUT_CHOICES[0];
// Logótipos em miniatura (os mesmos da folha de pagamento, em assets/payment-logos); o banco usa o ícone.
const PAYOUT_LOGOS = {
  express: require("../../../../assets/payment-logos/express.jpg"),
  paypay: require("../../../../assets/payment-logos/paypay.jpg"),
  paypal: require("../../../../assets/payment-logos/paypal.jpg"),
  redotpay: require("../../../../assets/payment-logos/redotpay.jpg")
};
function PayoutLogo({ method, size = 20 }) {
  if (PAYOUT_LOGOS[method]) return <Image source={PAYOUT_LOGOS[method]} style={{ width: size, height: size, borderRadius: size * 0.25 }} accessibilityIgnoresInvertColors />;
  return <View style={{ width: size, height: size, borderRadius: size * 0.25, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
    <Ionicons name="business-outline" size={Math.round(size * 0.65)} color={colors.text} /></View>;
}
const canBoost = post => !post.is_exclusive && !post.group_id && !post.hidden_at && !post.shared_post_id;
const postKind = post => post.media_type === "video" ? "Vídeo" : post.media_type === "image" ? "Foto" : "Texto";

function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => path ? api(path).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message)) : Promise.resolve(), [path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

// Variação face ao período anterior (igual ao DeltaBadge do site).
function Delta({ total, previous }) {
  if (!previous) return null;
  const value = Math.round(((total - previous) / previous) * 100);
  const up = value >= 0;
  return <Text style={[styles.delta, { color: up ? colors.good : colors.danger }]}>{up ? "▲" : "▼"} {Math.abs(value)}%</Text>;
}

function SeeAll({ onPress }) {
  return <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button"><Text style={styles.link}>Ver tudo</Text></Pressable>;
}

// Barras por dia da métrica escolhida. Toca numa barra para ver o valor.
function Bars({ rows, field }) {
  const [active, setActive] = useState(null);
  const max = Math.max(1, ...rows.map(row => row[field] || 0));
  const shown = active === null ? null : rows[active];
  return <View style={{ gap: 6 }}>
    <Text style={styles.muted}>{shown ? `${dateOnly(shown.day)}: ${count(shown[field])}` : "Toca numa barra para ver o dia"}</Text>
    <View style={styles.bars}>{rows.map((row, index) => <Pressable key={row.day} style={styles.barHit} onPress={() => setActive(index)}>
      <View style={[styles.bar, { height: `${Math.max(2, (row[field] / max) * 100)}%` }, active === index && { backgroundColor: colors.accent }]} />
    </Pressable>)}</View>
  </View>;
}

function InsightsCard({ data, error, days, onDays, full = false, go }) {
  const [metric, setMetric] = useState("views");
  const selected = METRICS.find(([key]) => key === metric);
  return <Card title="Insights" subtitle="Sabe como está o desempenho do teu perfil." right={full ? null : <SeeAll onPress={() => go("insights")} />}>
    <Chips value={days} onChange={onDays} options={PERIODS} />
    {error ? <Notice error={error} /> : !data ? <Loading cards={1} /> : <>
      <View style={styles.tiles}>
        {METRICS.map(([key, label, icon]) => <Pressable key={key} style={[styles.tile, metric === key && styles.tileOn]} onPress={() => setMetric(key)}
          accessibilityRole="tab" accessibilityState={{ selected: metric === key }}>
          <Ionicons name={icon} size={18} color={colors.text} />
          <View style={styles.tileValue}><Text style={styles.tileNumber}>{count(data.metrics[key].total)}</Text><Delta {...data.metrics[key]} /></View>
          <Text style={styles.tileLabel}>{label}</Text>
        </Pressable>)}
      </View>
      <Bars rows={data.daily} field={metric} />
      {full && <Text style={styles.muted}>A percentagem compara com os {days} dias anteriores. {selected[1]}: {selected[3]}.</Text>}
    </>}
  </Card>;
}

function ContentThumb({ post }) {
  return <View style={styles.thumb}>
    {post.media_url && post.media_type === "image"
      ? <Image source={{ uri: mediaUri(post.media_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
      : post.media_url && post.media_type === "video"
        ? <View style={styles.thumbCenter}><Ionicons name="play-circle" size={30} color={colors.muted} /></View>
        : <Text style={styles.thumbText} numberOfLines={4}>{post.excerpt || postKind(post)}</Text>}
    <View style={styles.thumbViews}><Ionicons name="eye-outline" size={12} color="#fff" /><Text style={styles.thumbViewsText}>{count(post.views)}</Text></View>
  </View>;
}

function ContentStrip({ posts, create = false }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
    {create && <Pressable style={[styles.thumb, styles.thumbCenter]} onPress={() => router.push("/create")} accessibilityRole="button">
      <Ionicons name="add" size={24} color={colors.text} /><Text style={styles.thumbCreate}>Criar publicação</Text>
    </Pressable>}
    {posts.map(post => <Pressable key={post.id} onPress={() => router.push(`/post/${post.id}`)}><ContentThumb post={post} /></Pressable>)}
  </ScrollView>;
}

function PersonLine({ person, time, children }) {
  return <Pressable style={styles.person} onPress={() => router.push(`/u/${person.username}`)} accessibilityRole="button">
    <Avatar user={person} size={38} />
    <View style={{ flex: 1 }}>
      <Text style={styles.personText}><Text style={{ fontWeight: "800" }}>{person.display_name}</Text> {children}</Text>
      {time ? <Text style={styles.muted}>{relativeTime(time)}</Text> : null}
    </View>
  </Pressable>;
}

// ----- Página inicial -----
function Home({ go }) {
  const { user } = useSession();
  const [days, setDays] = useState("28");
  const { data, error } = useLoad(`/creator/overview?days=${days}`);
  const money = useLoad("/creator/monetization");
  const ads = useLoad("/ads/mine");
  const profile = data?.profile;
  const problem = !profile ? null : profile.suspended_at ? "A tua conta está suspensa. Contacta a equipa do Tchilar."
    : profile.hidden_posts > 0 ? `${profile.hidden_posts} ${profile.hidden_posts === 1 ? "publicação escondida" : "publicações escondidas"} pela moderação.` : null;
  const activeAds = ads.data?.ads.filter(ad => ad.status === "active") || [];
  return <>
    <InsightsCard data={data} error={error} days={days} onDays={setDays} go={go} />
    <Card title="Estado do perfil">
      {!profile ? <Loading cards={1} /> : <View style={styles.status}>
        <View><Avatar user={{ ...profile, avatar_url: profile.avatar_url || user.avatar_url }} size={56} />
          <View style={[styles.statusDot, { backgroundColor: problem ? colors.warning : colors.good }]}>
            <Ionicons name={problem ? "alert" : "checkmark"} size={11} color="#fff" /></View></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.strong}>{profile.display_name}</Text>
          <Text style={styles.muted}>{problem || "Não há problemas no perfil."}</Text>
          <Text style={styles.muted}>{count(profile.followers)} {profile.followers === 1 ? "seguidor" : "seguidores"}</Text>
        </View>
      </View>}
    </Card>
    <Card title="Conteúdo" subtitle="As tuas publicações mais recentes e quantas pessoas as viram." right={<SeeAll onPress={() => go("conteudo")} />}>
      {data && (data.recent.length ? <ContentStrip posts={data.recent} create />
        : <Button variant="secondary" label="Criar a primeira publicação" icon="add" onPress={() => router.push("/create")} />)}
    </Card>
    <Card title="Monetização" subtitle="Subscrições do teu conteúdo exclusivo." right={<SeeAll onPress={() => go("monetizacao")} />}>
      {!money.data ? <Loading cards={1} /> : money.data.is_creator
        ? <View style={styles.mini}>
          <View style={styles.miniItem}><Text style={styles.miniValue}>{count(money.data.active_subscribers)}</Text><Text style={styles.muted}>subscritores ativos</Text></View>
          <View style={styles.miniItem}><Text style={styles.miniValue}>{kz(money.data.estimated_monthly_revenue)}</Text><Text style={styles.muted}>receita mensal estimada</Text></View>
        </View>
        : <Text style={styles.muted}>Ativa o modo criador para receberes subscrições.</Text>}
    </Card>
    <Card title="Anúncios" subtitle="Mostra o teu perfil ou o teu negócio a mais pessoas." right={<SeeAll onPress={() => go("anuncios")} />}>
      {!ads.data ? <Loading cards={1} /> : activeAds.length
        ? <View style={styles.mini}>
          <View style={styles.miniItem}><Text style={styles.miniValue}>{count(activeAds.length)}</Text><Text style={styles.muted}>{activeAds.length === 1 ? "anúncio ativo" : "anúncios ativos"}</Text></View>
          <View style={styles.miniItem}><Text style={styles.miniValue}>{count(activeAds.reduce((sum, ad) => sum + ad.impressions, 0))}</Text><Text style={styles.muted}>pessoas alcançadas</Text></View>
        </View>
        : <><Text style={styles.muted}>Não tens anúncios ativos.</Text><Button label="Impulsionar" icon="flash" onPress={() => go("anuncios")} /></>}
    </Card>
  </>;
}

// ----- Insights -----
function Insights() {
  const [days, setDays] = useState("28");
  const { data, error } = useLoad(`/creator/overview?days=${days}`);
  return <>
    <InsightsCard data={data} error={error} days={days} onDays={setDays} full />
    {data && <Card title="Publicações recentes"><ContentStrip posts={data.recent} /></Card>}
  </>;
}

// ----- Conteúdo -----
function Content({ onBoost }) {
  const [posts, setPosts] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async before => {
    try {
      const result = await api(`/creator/content${before ? `?before=${before}` : ""}`);
      setPosts(current => before ? [...(current || []), ...result.posts] : result.posts);
      setCursor(result.nextCursor);
    } catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const where = post => post.group_name ? `Grupo · ${post.group_name}` : post.page_name ? `Página · ${post.page_name}` : "Perfil";
  return <Card title="Conteúdo" subtitle="Todas as tuas publicações e o desempenho de cada uma."
    right={<Button small label="Criar" icon="create-outline" onPress={() => router.push("/create")} />}>
    <Notice error={error} />
    {!posts ? (error ? null : <Loading />) : posts.length === 0 ? <Empty text="Ainda não publicaste nada." /> : posts.map(post => <View key={post.id} style={styles.contentRow}>
      <Pressable style={styles.contentMain} onPress={() => router.push(`/post/${post.id}`)}>
        <ContentThumb post={post} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.strong} numberOfLines={2}>{post.excerpt || postKind(post)}</Text>
          <Text style={styles.muted}>{dateOnly(post.created_at)} · {where(post)}</Text>
          <View style={styles.tags}>
            <Badge label={postKind(post)} />
            {post.is_exclusive && <Badge label="Exclusivo" tone="warning" />}
            {post.hidden_at && <Badge label="Escondida" tone="danger" />}
          </View>
        </View>
      </Pressable>
      <View style={styles.counts}>
        {[["Visualizações", post.views], ["Gostos", post.likes], ["Comentários", post.comments], ["Partilhas", post.shares]].map(([label, value]) =>
          <View key={label} style={styles.countItem}><Text style={styles.countValue}>{count(value)}</Text><Text style={styles.countLabel}>{label}</Text></View>)}
      </View>
      {canBoost(post) && <Button small variant="secondary" label="Impulsionar" icon="flash" onPress={() => onBoost(post)} />}
    </View>)}
    {cursor && <Button variant="secondary" label={busy ? "A carregar..." : "Carregar mais"} disabled={busy}
      onPress={async () => { setBusy(true); await load(cursor); setBusy(false); }} />}
  </Card>;
}

// ----- Engajamento -----
function Engagement() {
  const { data, error } = useLoad("/creator/engagement");
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const excerpt = text => text ? `«${text.length > 60 ? `${text.slice(0, 60)}…` : text}»` : "a tua publicação";
  return <>
    <Card title="Comentários recentes">
      {data.comments.length ? data.comments.map(comment => <PersonLine key={comment.id} person={comment} time={comment.created_at}>
        comentou {excerpt(comment.post_excerpt)}: “{comment.body}”</PersonLine>) : <Text style={styles.muted}>Ainda sem comentários.</Text>}
    </Card>
    <Card title="Gostos recentes">
      {data.likes.length ? data.likes.map((like, index) => <PersonLine key={`${like.post_id}-${like.username}-${index}`} person={like} time={like.created_at}>
        gostou de {excerpt(like.post_excerpt)}</PersonLine>) : <Text style={styles.muted}>Ainda sem gostos.</Text>}
    </Card>
    <Card title="Novos seguidores">
      {data.followers.length ? data.followers.map(follower => <PersonLine key={follower.username} person={follower} time={follower.created_at}>
        começou a seguir-te</PersonLine>) : <Text style={styles.muted}>Ainda ninguém te segue.</Text>}
    </Card>
  </>;
}

// ----- Monetização (Programa de Parceiros + subscrições, como no site) -----
function PartnerProgramCard() {
  const { data, error, load } = useLoad("/creator/partner");
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading cards={1} />;
  const join = async () => {
    try { await api("/creator/partner/join", { method: "POST" }); setNotice({ message: "Bem-vindo ao Programa de Parceiros!" }); load(); } catch (joinError) { setNotice({ error: joinError.message }); }
  };
  return <>
    <Card title="Programa de Parceiros" subtitle={`Monetização por vídeos: ${kz(data.rpm)} por cada 1000 visualizações completas (vídeos vistos até ao fim), somando todos os teus vídeos. Mínimo para receber: ${kz(data.min_payout)}.`}
      right={data.open === false ? <Badge label="Brevemente" tone="warning" /> : data.partner_since ? <Badge label={data.earning ? "A ganhar" : "Em pausa"} tone={data.earning ? "good" : "warning"} /> : null}>
      {data.open === false && <View style={styles.soon}>
        <View style={styles.soonIcon}><Ionicons name="time-outline" size={20} color="#3D2B00" /></View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.soonTitle}>A monetização por vídeos está a chegar</Text>
          <Text style={styles.muted}>Ainda não estamos a pagar por visualizações. Quando o programa abrir, avisamos-te e podes aderir se cumprires as regras.</Text>
          {[["play-outline", "Conta cada vídeo visto até ao fim"], ["people-outline", "Só por outras pessoas, uma vez por dia"], ["stats-chart-outline", "O teu progresso já está a contar"]].map(([icon, text]) =>
            <View key={text} style={styles.soonItem}><Ionicons name={icon} size={14} color={colors.text} /><Text style={styles.soonItemText}>{text}</Text></View>)}
        </View>
      </View>}
      {data.checks.map(check => <Row key={check.key} icon={check.met ? "checkmark-circle" : "ellipse-outline"} tone={check.met ? colors.good : colors.muted}
        title={check.label} subtitle={check.target ? `${count(check.current)} de ${count(check.target)}` : null} />)}
      {!data.partner_since && <Button label={data.open === false ? "Brevemente" : "Aderir ao programa"} onPress={join} disabled={data.open === false || !data.eligible} />}
      <Notice {...notice} />
    </Card>
    {data.months?.length > 0 && <Card title="Ganhos por mês">
      {data.months.map(month => <Row key={month.month} icon="calendar" title={kz(month.amount)} subtitle={`${count(month.views)} visualizações completas · ${month.month}`} />)}
    </Card>}
  </>;
}

function Monetization() {
  const { refresh } = useSession();
  const { data, error, load } = useLoad("/creator/monetization");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const enable = async () => {
    setBusy(true);
    try { await api("/creator/enable", { method: "POST" }); await refresh(); await load(); }
    catch (enableError) { setNotice({ error: enableError.message }); } finally { setBusy(false); }
  };
  const savePrice = async () => {
    try { await api("/auth/me", { method: "PATCH", body: { subscriptionPrice: Number(price) } }); setNotice({ message: "Preço guardado." }); setPrice(""); load(); }
    catch (saveError) { setNotice({ error: saveError.message }); }
  };
  if (!data.is_creator) return <>
    <PartnerProgramCard />
    <Card>
      <View style={styles.ctaIcon}><Ionicons name="sparkles" size={26} color={colors.text} /></View>
      <Text style={styles.ctaTitle}>Recebe apoio de quem gosta do teu trabalho</Text>
      <Text style={[styles.muted, { textAlign: "center" }]}>Com o modo criador, defines um preço mensal em kwanzas e marcas publicações como exclusivas para quem te subscreve.</Text>
      <Button label={busy ? "A ativar..." : "Ativar modo criador"} onPress={enable} busy={busy} />
      <Notice {...notice} />
    </Card>
  </>;
  const tiles = [
    ["Subscritores ativos", count(data.active_subscribers)], ["A pagar", count(data.paying_subscribers)],
    ["Não vão renovar", count(data.canceling_subscribers)], ["Receita mensal estimada", kz(data.estimated_monthly_revenue)],
    ["Publicações exclusivas", count(data.exclusive_posts)], ["Gasto em anúncios", kz(data.ads?.spent)]
  ];
  return <>
    <PartnerProgramCard />
    <Card title="Subscrições" subtitle={data.price > 0 ? `A tua subscrição custa ${kz(data.price)} por mês.` : "Ainda não definiste o preço da tua subscrição."}>
      <View style={styles.statGrid}>{tiles.map(([label, value]) => <View key={label} style={styles.statBox}>
        <Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>)}</View>
      <Field label={data.price > 0 ? "Alterar preço mensal (Kz)" : "Definir preço mensal (Kz)"} value={price} onChangeText={value => setPrice(value.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
      <Button variant="secondary" label="Guardar preço" icon="settings-outline" onPress={savePrice} disabled={!price} />
      <Text style={styles.muted}>A receita é uma estimativa bruta (subscritores a pagar × preço atual), antes de taxas e impostos.</Text>
      <Notice {...notice} />
    </Card>
    <Card title="Subscritores">
      {data.subscribers.length === 0 ? <Text style={styles.muted}>Ainda ninguém subscreveu. Marca algumas publicações como exclusivas para dares um motivo.</Text>
        : data.subscribers.map(item => <PersonLine key={item.username} person={item} time={item.created_at}>
          · {item.is_active ? (item.cancel_at_period_end ? "Não vai renovar" : "Ativa") : "Terminada"}</PersonLine>)}
    </Card>
  </>;
}

// ----- Ganhos -----
function Earnings() {
  const { data, error, load } = useLoad("/payouts");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({});
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const withdraw = () => Alert.alert("Levantar", `Pedir o levantamento de ${kz(amount)} para ${data.account.method_label || data.account.bank_name} ${data.account.destination || data.account.iban}?`, [
    { text: "Cancelar", style: "cancel" },
    { text: "Pedir", onPress: async () => {
      setBusy(true); setNotice({});
      try { await api("/payouts/requests", { method: "POST", body: { amount: Number(amount) } }); setAmount(""); setNotice({ message: "Pedido enviado. A equipa faz a transferência e avisa-te quando estiver paga." }); load(); }
      catch (sendError) { setNotice({ error: sendError.message }); } finally { setBusy(false); }
    } }
  ]);
  const saveAccountWith = async form => {
    setBusy(true); setNotice({});
    try { await api("/payouts/account", { method: "PUT", body: form }); setAccount(null); setNotice({ message: "Guardado: é para aqui que vão os teus levantamentos." }); load(); }
    catch (saveError) { setNotice({ error: saveError.message }); } finally { setBusy(false); }
  };
  const sources = [
    ["Programa de Parceiros", data.sources.partnerKz, "sparkles-outline", data.accruing.partnerKz > 0 ? `+${kz(data.accruing.partnerKz)} a acumular este mês` : "Meses já fechados"],
    ["Estrelas recebidas", data.sources.starsKz, "star-outline", "80% do valor das estrelas"],
    ["Campanhas com marcas", data.sources.campaignsKz, "briefcase-outline", "85% das campanhas concluídas"],
    ["Grupos secretos", data.sources.groupsKz || 0, "lock-closed-outline", "80% das entradas pagas"],
    ["Prémios de desafios", data.sources.prizesKz || 0, "trophy-outline", "Prémios em dinheiro dos desafios do mês"],
    ["Cursos vendidos", data.sources.coursesKz || 0, "school-outline", "85% das vendas na Academia"],
    ["Subscrições", data.sources.subscriptionsKz || 0, "sparkles-outline", "85% de cada mês pago"],
    ["Bilhetes de eventos", data.sources.ticketsKz || 0, "ticket-outline", data.accruing.ticketsKz > 0
      ? `+${kz(data.accruing.ticketsKz)} à espera dos eventos` : "85% de cada bilhete, 1 dia depois do evento"]
  ];
  const hasPending = data.requests.some(request => request.status === "requested");
  const status = { requested: ["Em processamento", "warning"], paid: ["Pago", "good"], rejected: ["Recusado", "danger"] };
  return <>
    <Card title="Ganhos" subtitle="Tudo o que ganhaste no Tchilar e o que já podes levantar.">
      <Notice {...notice} />
      <View style={styles.statGrid}>{sources.map(([label, value, icon, hint]) => <View key={label} style={styles.statBox}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Ionicons name={icon} size={14} color={colors.muted} /><Text style={styles.statLabel}>{label}</Text></View>
        <Text style={styles.statValue}>{kz(value)}</Text><Text style={styles.countLabel}>{hint}</Text>
      </View>)}</View>
      <View style={styles.totals}>
        <View style={styles.totalRow}><Text style={styles.muted}>Total ganho</Text><Text style={styles.strong}>{kz(data.earned)}</Text></View>
        <View style={styles.totalRow}><Text style={styles.muted}>Já levantado ou em processamento</Text><Text style={styles.strong}>{kz(data.withdrawn)}</Text></View>
        <View style={[styles.totalRow, styles.available]}><Text style={styles.strong}>Disponível para levantar</Text><Text style={styles.big}>{kz(data.available)}</Text></View>
      </View>
    </Card>
    <Card title="Onde queres receber" subtitle="Escolhe banco (IBAN), Multicaixa Express, PayPay África, PayPal ou RedotPay. Os dados ficam guardados cifrados."
      right={data.account && !account ? <Button small variant="secondary" label="Alterar" onPress={() => setAccount({ method: data.account.method || "iban", holderName: "", bankName: "BAI", destination: "" })} /> : null}>
      {!data.configured && <Text style={styles.muted}>Os levantamentos ainda não estão configurados no servidor.</Text>}
      {data.account && !account ? <View style={styles.payoutAccount}>
        <PayoutLogo method={data.account.method} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.strong}>{data.account.holder_name}</Text>
          <Text style={styles.muted}>{data.account.method === "iban" || !data.account.method ? `${data.account.bank_name} · IBAN` : data.account.method_label} · {data.account.destination || data.account.iban}</Text>
        </View>
      </View> : null}
      {(!data.account || account) && data.configured && (() => {
        const form = account || { method: "iban", holderName: "", bankName: "BAI", destination: "" };
        const choice = payoutChoice(form.method);
        return <View style={{ gap: 10 }}>
          <Text style={styles.strong}>Receber por</Text>
          <View style={styles.methods}>{PAYOUT_CHOICES.map(item => <Pressable key={item.id} style={[styles.method, form.method === item.id && styles.methodOn]}
            onPress={() => setAccount({ ...form, method: item.id, destination: "" })} accessibilityRole="radio" accessibilityState={{ checked: form.method === item.id }}>
            <PayoutLogo method={item.id} /><Text style={styles.methodText}>{item.label}</Text>
          </Pressable>)}</View>
          <Text style={styles.muted}>{choice.hint}</Text>
          <Field label="Nome do titular" value={form.holderName} onChangeText={holderName => setAccount({ ...form, holderName })} autoComplete="name" />
          {form.method === "iban" && <View style={{ gap: 6 }}>
            <Text style={styles.strong}>Banco</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{ANGOLAN_BANKS.map(bank =>
              <Pressable key={bank} style={[styles.method, form.bankName === bank && styles.methodOn]} onPress={() => setAccount({ ...form, bankName: bank })}>
                <Text style={styles.methodText}>{bank}</Text></Pressable>)}</ScrollView>
          </View>}
          <Field label={choice.field} value={form.destination} placeholder={choice.placeholder} keyboardType={choice.keyboard || "default"}
            autoCapitalize={form.method === "iban" ? "characters" : "none"} autoCorrect={false}
            onChangeText={value => setAccount({ ...form, destination: form.method === "iban" ? value.toUpperCase().replace(/[^A-Z0-9 ]/g, "") : value })} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {data.account && <View style={{ flex: 1 }}><Button variant="secondary" label="Cancelar" onPress={() => setAccount(null)} /></View>}
            <View style={{ flex: 1 }}><Button label={busy ? "A guardar..." : "Guardar"} onPress={() => { setAccount(form); saveAccountWith(form); }} busy={busy} disabled={!form.holderName || !form.destination} /></View>
          </View>
        </View>;
      })()}
    </Card>
    <Card title="Levantar">
      {hasPending ? <Text style={styles.muted}>Tens um levantamento em processamento. Podes pedir outro quando esse estiver concluído.</Text>
        : data.available < data.min_withdrawal ? <Text style={styles.muted}>O levantamento mínimo é de {kz(data.min_withdrawal)}. Faltam {kz(data.min_withdrawal - data.available)}.</Text>
          : !data.account ? <Text style={styles.muted}>Escolhe primeiro onde queres receber.</Text>
            : <>
              <Field label="Valor (Kz)" value={amount} onChangeText={value => setAmount(value.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
              <Button label="Pedir levantamento" onPress={withdraw} busy={busy} disabled={!amount} />
            </>}
      {data.requests.map(request => {
        const [label, tone] = status[request.status] || [request.status, "neutral"];
        return <View key={request.id} style={styles.payoutRow}>
          <PayoutLogo method={request.method} size={32} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.strong}>{kz(request.amount)}</Text>
            <Text style={styles.muted}>{`${request.method_label || request.bank_name} · ${request.destination || request.iban} · ${dateTime(request.created_at)}`}</Text>
            {request.reference ? <Text style={styles.muted}>Referência: {request.reference}</Text> : null}
            {request.note ? <Text style={styles.muted}>Motivo: {request.note}</Text> : null}
          </View>
          <Badge label={label} tone={tone} />
        </View>;
      })}
    </Card>
  </>;
}

// Painel do criador: aberto a todas as contas, como no site. O modo criador ativa-se em Monetização.
export default function Creator() {
  const [tab, setTab] = useState("inicio");
  const [boostPost, setBoostPost] = useState(null);
  const clearBoost = useCallback(() => setBoostPost(null), []);
  const boost = post => { setBoostPost(post); setTab("anuncios"); };
  let section;
  if (tab === "inicio") section = <Home go={setTab} />;
  else if (tab === "insights") section = <Insights />;
  else if (tab === "conteudo") section = <Content onBoost={boost} />;
  else if (tab === "engajamento") section = <Engagement />;
  else if (tab === "monetizacao") section = <Monetization />;
  else if (tab === "verificacao") section = <VerificationPlans endpoint="/creator/verification" />;
  else if (tab === "ganhos") section = <Earnings />;
  else if (tab === "parcerias") section = <CampaignList />;
  else section = <AdsStudio boostPost={boostPost} clearBoost={clearBoost} />;
  return <Page>
    <View style={styles.header}>
      <Text style={styles.title}>Painel do criador</Text>
      <Button small label="Criar publicação" icon="create-outline" onPress={() => router.push("/create")} />
    </View>
    <Chips value={tab} onChange={setTab} options={SECTIONS} />
    {section}
  </Page>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800", flexShrink: 1 },
  link: { color: colors.text, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  strong: { color: colors.text, fontSize: 15, fontWeight: "800" },
  big: { color: colors.text, fontSize: 24, fontWeight: "800" },
  delta: { fontSize: 12, fontWeight: "800" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "45%", gap: 4, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tileOn: { borderColor: colors.text, borderWidth: 2 },
  tileValue: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  tileNumber: { color: colors.text, fontSize: 22, fontWeight: "800" },
  tileLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 120, gap: 2 },
  barHit: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 14 },
  statusDot: { position: "absolute", right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface },
  thumb: { width: 104, height: 130, borderRadius: 12, overflow: "hidden", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.line },
  thumbCenter: { alignItems: "center", justifyContent: "center", gap: 4, flex: 1 },
  thumbText: { color: colors.text, fontSize: 12, padding: 8 },
  thumbCreate: { color: colors.text, fontSize: 12, fontWeight: "700", textAlign: "center" },
  thumbViews: { position: "absolute", left: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)" },
  thumbViewsText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  mini: { flexDirection: "row", gap: 10 },
  miniItem: { flex: 1, gap: 2, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  miniValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  contentRow: { gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  contentMain: { flexDirection: "row", gap: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  counts: { flexDirection: "row", gap: 6 },
  countItem: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 10, backgroundColor: colors.background },
  countValue: { color: colors.text, fontSize: 15, fontWeight: "800" },
  countLabel: { color: colors.muted, fontSize: 11 },
  person: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8 },
  personText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  soon: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#D4AF3766", backgroundColor: "#D4AF371A" },
  soonIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E9C766" },
  soonTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  soonItem: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.surface },
  soonItemText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  ctaIcon: { alignSelf: "center", width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  ctaTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statBox: { flexGrow: 1, flexBasis: "45%", gap: 3, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  totals: { gap: 8, paddingTop: 4 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  available: { padding: 12, borderRadius: 12, backgroundColor: colors.goodSoft },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  payoutAccount: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  payoutRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  method: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  methodOn: { borderColor: colors.text, borderWidth: 2, backgroundColor: colors.background },
  methodText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  ad: { gap: 6, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }
});
