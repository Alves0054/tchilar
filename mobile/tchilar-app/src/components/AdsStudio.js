// Painel do criador → Anúncios: o "estúdio de difusão" (igual ao site, src/modules/ads.css).
// Preto e branco com o vermelho Tchilar como sinal de "no ar"; os anéis do topo são o alcance a espalhar-se.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { api, mediaUri, upload } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";
import { PaymentSheet } from "./PaymentSheet";
import { StableSlider } from "./StableSlider";
import { Button, Field, Loading, Notice, count, kz } from "./ui";

const RED = "#E30613";
const INK = "#0B0B0C";
const BUDGETS = [2000, 5000, 10000, 25000, 50000];
const DAYS = [1, 3, 7, 14, 30];
// Cor da faixa lateral de cada estado (as mesmas do site).
const STATUS = {
  active: ["No ar", "#1E9E5A"], paused: ["Em pausa", "#D48A00"], in_review: ["Em revisão", "#1877F2"],
  pending_payment: ["Por pagar", RED], rejected: ["Recusado", "#B3261E"], ended: ["Terminado", "#8E8E93"]
};
const FILTERS = [
  ["all", "Todas", () => true],
  ["live", "No ar", ad => ad.status === "active" || ad.status === "paused"],
  ["review", "Em revisão", ad => ad.status === "in_review"],
  ["unpaid", "Por pagar", ad => ad.status === "pending_payment"],
  ["done", "Terminadas", ad => ad.status === "ended" || ad.status === "rejected"]
];
const dayLabel = value => `${value} ${Number(value) === 1 ? "dia" : "dias"}`;
const percentOf = (part, whole) => whole ? `${((part / whole) * 100).toFixed(1).replace(".", ",")}%` : "0%";
const canBoost = post => !post.is_exclusive && !post.group_id && !post.hidden_at && !post.shared_post_id;

// Ponto vermelho a piscar quando há promoções no ar (sem caixa à volta).
function LiveDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <View style={styles.liveDotWrap}>
    <Animated.View style={[styles.liveHalo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }] }]} />
    <View style={styles.liveDot} />
  </View>;
}

// Anel do orçamento gasto.
function Ring({ ratio, color, size = 54 }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio) }} accessibilityLabel="Orçamento gasto">
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.line} strokeWidth={stroke} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={`${length} ${length}`} strokeDashoffset={length * (1 - Math.min(100, ratio) / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </Svg>
    <Text style={styles.ringText}>{Math.round(ratio)}%</Text>
  </View>;
}

function Chip({ label, on, onPress, disabled }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.4 }]}
    accessibilityRole="button" accessibilityState={{ selected: on, disabled }}>
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

// Caixa de seleção (como no site): um campo que abre a lista. multiple = caixas para marcar (vazio = todas).
function SelectBox({ label, icon, options, value, onChange, multiple = false, allLabel, search = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalize = text => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const shown = options.filter(([, name]) => normalize(name).includes(normalize(query)));
  const picked = multiple ? value : [value];
  const names = options.filter(([key]) => picked.includes(key)).map(([, name]) => name);
  const summary = multiple
    ? (!value.length ? allLabel : value.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} e mais ${value.length - 2}`)
    : names[0] || "";
  const choose = key => {
    if (!multiple) { onChange(key); setOpen(false); return; }
    onChange(value.includes(key) ? value.filter(item => item !== key) : [...value, key]);
  };
  return <>
    <Pressable style={styles.selectField} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${summary}`}>
      {icon ? <Ionicons name={icon} size={17} color={colors.text} /> : null}
      <Text style={[styles.selectText, multiple && !value.length && { color: colors.muted }]} numberOfLines={1}>{summary}</Text>
      {multiple && value.length > 0 && <View style={styles.selectCount}><Text style={styles.selectCountText}>{value.length}</Text></View>}
      <Ionicons name="chevron-down" size={16} color={colors.text} />
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>{label}</Text>
          <Pressable onPress={() => setOpen(false)} hitSlop={10}><Text style={styles.sheetDone}>{multiple ? `Feito${value.length ? ` (${value.length})` : ""}` : "Fechar"}</Text></Pressable>
        </View>
        {search && <TextInput style={[styles.input, { marginHorizontal: 16 }]} value={query} onChangeText={setQuery} placeholder="Procurar" placeholderTextColor={colors.muted} />}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          {multiple && <Pressable style={[styles.option, styles.optionAll]} onPress={() => onChange([])} accessibilityRole="checkbox" accessibilityState={{ checked: !value.length }}>
            <Ionicons name={!value.length ? "checkbox" : "square-outline"} size={22} color={!value.length ? RED : colors.muted} />
            <Text style={styles.optionText}>{allLabel}</Text>
          </Pressable>}
          {shown.map(([key, name]) => {
            const on = picked.includes(key);
            return <Pressable key={key} style={styles.option} onPress={() => choose(key)} accessibilityRole={multiple ? "checkbox" : "radio"} accessibilityState={{ checked: on }}>
              <Ionicons name={multiple ? (on ? "checkbox" : "square-outline") : (on ? "radio-button-on" : "radio-button-off")} size={22} color={on ? RED : colors.muted} />
              <Text style={styles.optionText}>{name}</Text>
            </Pressable>;
          })}
          {!shown.length && <Text style={[styles.muted, { padding: 12 }]}>Nada com «{query}».</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

function Step({ number, title }) {
  return <View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><Text style={styles.stepTitle}>{title}</Text></View>;
}

export function AdsStudio({ boostPost, clearBoost }) {
  const { user } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState(null);
  const [provinces, setProvinces] = useState([]);
  const [form, setForm] = useState(null);
  const [calc, setCalc] = useState(10000);
  const [filter, setFilter] = useState("all");
  const [paying, setPaying] = useState(null);
  const [notice, setNotice] = useState({});
  const load = useCallback(() => api("/ads/mine").then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message)), []);
  useEffect(() => { load(); }, [load]);
  const openForm = useCallback(async (extra = {}) => {
    setForm({ kind: "boost", postId: null, title: "", body: "", image: null, destination: "profile", linkUrl: "",
      budget: "5000", days: "7", provinces: [], minAge: "", maxAge: "", ...extra });
    if (!posts) api("/creator/content").then(result => setPosts(result.posts.filter(canBoost))).catch(() => setPosts([]));
    if (!provinces.length) api("/provinces").then(result => setProvinces(result.provinces)).catch(() => {});
  }, [posts, provinces.length]);
  // Vindo de "Impulsionar" no Conteúdo: abre logo o formulário com essa publicação.
  useEffect(() => {
    if (!boostPost) return;
    openForm({ postId: boostPost.id });
    clearBoost();
  }, [boostPost, clearBoost, openForm]);

  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const cost = data.cost_per_impression;
  const surcharge = data.targeting_surcharge ?? 0.2;
  const ads = data.ads;
  const liveCount = ads.filter(ad => ad.status === "active").length;
  const paid = ads.filter(ad => ad.paid_at && ad.status !== "rejected");
  const sum = key => paid.reduce((total, ad) => total + Number(ad[key] || 0), 0);
  const reach = sum("reach");
  const spent = sum("spent");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const counts = Object.fromEntries(FILTERS.map(([key, , test]) => [key, ads.filter(test).length]));
  const visible = ads.filter((FILTERS.find(([key]) => key === filter) || FILTERS[0])[2]);

  const setStatus = async (ad, status) => {
    try { await api(`/ads/${ad.id}`, { method: "PATCH", body: { status } }); load(); } catch (patchError) { setNotice({ error: patchError.message }); }
  };
  const remove = ad => Alert.alert("Apagar promoção", `Apagar «${ad.title}»? As métricas também são apagadas.`, [{ text: "Não" }, { text: "Apagar", style: "destructive", onPress: async () => {
    try { await api(`/ads/${ad.id}`, { method: "DELETE" }); load(); } catch (deleteError) { setNotice({ error: deleteError.message }); }
  } }]);

  // ----- Formulário -----
  const budget = Number(form?.budget) || 0;
  const targeted = Boolean(form && (form.provinces.length || form.minAge || form.maxAge));
  const formReach = Math.floor(budget / (cost * (targeted ? 1 + surcharge : 1)));
  const selectedPost = posts?.find(post => post.id === form?.postId);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  // Anúncio: imagem da galeria (quadrada fica melhor na coluna «Patrocinado»).
  const pickAdImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Tchilar", "Permite o acesso às fotos nas definições do telemóvel.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled) set("image", result.assets[0]);
  };
  const startPayment = () => {
    if (form.kind === "boost" && !form.postId) return setNotice({ error: "Escolhe a publicação que queres impulsionar." });
    if (form.kind === "ad" && !form.title.trim()) return setNotice({ error: "Escreve o título do anúncio." });
    if (form.kind === "ad" && form.destination === "link" && !/^https?:\/\/\S+\.\S+/.test(form.linkUrl.trim())) {
      return setNotice({ error: "Escreve o endereço do site, a começar por https://" });
    }
    if (budget < 1000) return setNotice({ error: `O orçamento mínimo é ${kz(1000)}.` });
    setNotice({});
    let createdId = null;
    setPaying({
      title: form.kind === "ad" ? "Pagar anúncio" : "Pagar publicação impulsionada", amount: budget,
      start: async choice => {
        if (createdId) return api(`/ads/${createdId}/checkout`, { method: "POST", body: choice });
        const audience = { targetProvinces: form.provinces.join(","), targetMinAge: form.minAge, targetMaxAge: form.maxAge };
        let result;
        if (form.kind === "ad") {
          // Anúncio com título, texto e imagem própria (com imagem vai em multipart, campo "image").
          const fields = { title: form.title.trim(), body: form.body.trim(), destination: form.destination, linkUrl: form.linkUrl.trim(),
            budget, days: Number(form.days), ...audience, ...choice };
          result = form.image ? await upload("/ads", fields, form.image, "image") : await api("/ads", { method: "POST", body: fields });
        } else {
          result = await api("/ads", { method: "POST", body: {
            postId: form.postId, title: selectedPost?.excerpt?.slice(0, 80) || "", budget, days: Number(form.days), ...audience, ...choice
          } });
        }
        createdId = result.id;
        return result;
      }
    });
  };

  return <View style={{ gap: 14 }}>
    {/* ----- Cabeçalho simples (sem caixa) e a calculadora numa linha ----- */}
    <View style={styles.head}>
      <View style={styles.kickerRow}>{liveCount > 0 && <LiveDot />}
        <Text style={styles.kicker}>{liveCount ? `${liveCount} ${liveCount === 1 ? "promoção no ar" : "promoções no ar"}` : "Anúncios"}</Text></View>
      <Text style={styles.headTitle}>Leva o teu trabalho a quem ainda não te conhece</Text>
      <Text style={styles.headText}>Pagas uma vez, em kwanzas, e o Tchilar mostra a tua publicação a pessoas novas no feed, nos Stories e nos Reels.</Text>
      <Text style={styles.calcLine}>Com <Text style={styles.calcStrong}>{kz(calc)}</Text> chegas a cerca de <Text style={styles.calcReach}>{count(Math.floor(calc / cost))}</Text> pessoas novas</Text>
      <StableSlider minimumValue={1000} maximumValue={100000} step={1000} value={calc} onValueChange={setCalc}
        minimumTrackTintColor={RED} maximumTrackTintColor={colors.line} thumbTintColor={RED} accessibilityLabel="Orçamento" />
      {!form && <Button label={`Impulsionar com ${kz(calc)}`} icon="flash" onPress={() => openForm({ budget: String(calc) })} />}
    </View>

    <Notice {...notice} />

    {/* ----- Formulário em 3 passos + talão ----- */}
    {form && <View style={styles.card}>
      <Step number="1" title="O que queres promover" />
      <View style={styles.kinds}>
        {[["boost", "flash", "Impulsionar publicação", "Uma publicação tua no feed, nos Stories e nos Reels."],
          ["ad", "megaphone-outline", "Anúncio", "Título, texto e imagem em «Patrocinado», com ligação."]].map(([key, icon, name, hint]) =>
          <Pressable key={key} style={[styles.kind, form.kind === key && styles.kindOn]} onPress={() => set("kind", key)}
            accessibilityRole="radio" accessibilityState={{ checked: form.kind === key }}>
            <Ionicons name={icon} size={18} color={form.kind === key ? RED : colors.text} />
            <Text style={styles.kindName}>{name}</Text>
            <Text style={styles.small}>{hint}</Text>
          </Pressable>)}
      </View>
      {form.kind === "ad" ? <View style={{ gap: 10 }}>
        <Field label={`Título · ${form.title.length}/80`} value={form.title} onChangeText={value => set("title", value)} maxLength={80} placeholder="Novas peças na loja da Rita" />
        <Field label={`Texto · ${form.body.length}/200`} value={form.body} onChangeText={value => set("body", value)} maxLength={200} multiline
          placeholder="Até 40% em peças selecionadas, só esta semana." />
        <Text style={styles.strongLabel}>Imagem (opcional)</Text>
        {form.image ? <View style={styles.adImageRow}>
          <Image source={{ uri: form.image.uri }} style={styles.adThumb} contentFit="cover" />
          <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>{form.image.fileName || "Imagem escolhida"}</Text>
          <Button small variant="secondary" label="Trocar" onPress={pickAdImage} />
          <Pressable style={styles.trash} onPress={() => set("image", null)} accessibilityLabel="Remover imagem"><Ionicons name="trash-outline" size={17} color={colors.text} /></Pressable>
        </View> : <Pressable style={styles.adDrop} onPress={pickAdImage} accessibilityRole="button">
          <Ionicons name="image-outline" size={20} color={colors.text} /><Text style={styles.kindName}>Escolher imagem</Text><Text style={styles.small}>quadrada fica melhor</Text>
        </Pressable>}
        <Text style={styles.strongLabel}>Quando alguém clica, vai para…</Text>
        <View style={styles.kinds}>
          {[["profile", "person-outline", "O teu perfil", `@${user?.username || ""}`], ["link", "globe-outline", "Um site", "Loja, WhatsApp ou página"]].map(([key, icon, name, hint]) =>
            <Pressable key={key} style={[styles.kind, form.destination === key && styles.kindOn]} onPress={() => set("destination", key)}
              accessibilityRole="radio" accessibilityState={{ checked: form.destination === key }}>
              <Ionicons name={icon} size={17} color={form.destination === key ? RED : colors.text} />
              <Text style={styles.kindName}>{name}</Text><Text style={styles.small} numberOfLines={1}>{hint}</Text>
            </Pressable>)}
        </View>
        {form.destination === "link" && <TextInput style={styles.input} value={form.linkUrl} onChangeText={value => set("linkUrl", value)} placeholder="https://aminhaloja.ao"
          placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" />}
        {/* Como aparece na coluna «Patrocinado» */}
        <View style={styles.sponsor}>
          <Text style={styles.sponsorLabel}>Patrocinado</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={styles.sponsorArt}>{form.image ? <Image source={{ uri: form.image.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              : <Ionicons name="megaphone-outline" size={20} color="#fff" />}</View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.kindName, !form.title && { opacity: 0.5 }]} numberOfLines={2}>{form.title || "Título do anúncio"}</Text>
              <Text style={[styles.small, !form.body && { opacity: 0.6 }]} numberOfLines={2}>{form.body || "O texto do teu anúncio aparece aqui."}</Text>
              <Text style={styles.small}>{user?.display_name}</Text>
            </View>
          </View>
        </View>
      </View> : posts === null ? <Loading cards={1} /> : posts.length === 0
        ? <Text style={styles.muted}>Ainda não tens publicações públicas. Publica primeiro e volta para a impulsionar.</Text>
        : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {posts.slice(0, 15).map(post => <Pressable key={post.id} onPress={() => set("postId", post.id)} style={[styles.pick, form.postId === post.id && styles.pickOn]}
            accessibilityRole="radio" accessibilityState={{ checked: form.postId === post.id }}>
            {post.media_url && post.media_type === "image"
              ? <Image source={{ uri: mediaUri(post.media_url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
              : <View style={styles.pickText}>{post.media_type === "video" ? <Ionicons name="play-circle" size={30} color="#fff" /> : <Text style={styles.pickExcerpt} numberOfLines={5}>{post.excerpt}</Text>}</View>}
            {form.postId === post.id && <View style={styles.pickCheck}><Ionicons name="checkmark" size={16} color="#fff" /></View>}
          </Pressable>)}
        </ScrollView>}

      <Step number="2" title="Quanto e durante quanto tempo" />
      {/* Orçamento e duração lado a lado */}
      <View style={styles.pair}>
        <View style={[styles.pairBox, { flex: 1.4 }]}>
          <Text style={styles.pairLabel}>Orçamento total</Text>
          <View style={styles.budgetGrid}>{BUDGETS.map(value => <Pressable key={value} onPress={() => set("budget", String(value))}
            style={[styles.budgetChip, budget === value && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: budget === value }}>
            <Text style={[styles.chipText, budget === value && styles.chipTextOn]}>{kz(value)}</Text></Pressable>)}</View>
          <TextInput style={styles.input} value={form.budget} onChangeText={value => set("budget", value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
            placeholder="Outro valor (Kz)" placeholderTextColor={colors.muted} accessibilityLabel="Outro valor em kwanzas" />
        </View>
        <View style={[styles.pairBox, { flex: 1 }]}>
          <Text style={styles.pairLabel}>Duração</Text>
          <SelectBox label="Duração" options={DAYS.map(value => [String(value), dayLabel(value)])} value={form.days} onChange={value => set("days", value)} />
          <Text style={styles.small}>Termina a {new Date(Date.now() + Number(form.days) * 86400000).toLocaleDateString("pt-PT", { day: "numeric", month: "long" })}, se for aprovada hoje.</Text>
        </View>
      </View>

      <Step number="3" title="Para quem" />
      <Text style={styles.muted}>Opcional · +{Math.round(surcharge * 100)}% por pessoa alcançada. Sem filtros, o Tchilar mostra a toda a gente.</Text>
      <SelectBox label="Províncias" icon="location-outline" options={provinces.map(province => [province, province])} value={form.provinces}
        onChange={list => set("provinces", list)} multiple allLabel="Todas as províncias" search />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <TextInput style={[styles.input, { flex: 1 }]} value={form.minAge} onChangeText={value => set("minAge", value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
          placeholder="Idade mínima" placeholderTextColor={colors.muted} />
        <TextInput style={[styles.input, { flex: 1 }]} value={form.maxAge} onChangeText={value => set("maxAge", value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
          placeholder="Idade máxima" placeholderTextColor={colors.muted} />
      </View>

      {/* Talão */}
      <View style={styles.ticket}>
        <Text style={styles.ticketHead}>TALÃO DA PROMOÇÃO</Text>
        <View style={{ padding: 14, gap: 8 }}>
          <Text style={styles.ticketReach}>{count(formReach)}</Text>
          <Text style={styles.muted}>pessoas alcançadas, no máximo</Text>
          {[["Por dia", `cerca de ${kz(Math.round(budget / Number(form.days || 1)))}`], ["Duração", dayLabel(form.days)], ["Público", targeted ? `Escolhido (+${Math.round(surcharge * 100)}%)` : "Toda a gente"]].map(([label, value]) =>
            <View key={label} style={styles.ticketRow}><Text style={styles.muted}>{label}</Text><Text style={styles.ticketValue}>{value}</Text></View>)}
          <View style={styles.perforation}><View style={[styles.notch, { left: -24 }]} /><View style={[styles.notch, { right: -24 }]} /></View>
          <View style={styles.ticketRow}><Text style={styles.ticketTotalLabel}>Total</Text><Text style={styles.ticketTotal}>{kz(budget)}</Text></View>
          <Button label={`Pagar ${kz(budget)} e publicar`} onPress={startPayment} disabled={budget < 1000 || (form.kind === "boost" ? !form.postId : !form.title.trim())} />
          <Button label="Cancelar" variant="ghost" onPress={() => setForm(null)} />
          <Text style={styles.small}>Depois do pagamento, a equipa revê a promoção (normalmente em menos de 24 horas). Se for recusada, devolvemos o valor.</Text>
        </View>
      </View>
    </View>}

    {/* ----- Funil ----- */}
    {ads.length > 0 && <View style={styles.funnel}>
      <View style={styles.funnelStep}><Text style={styles.funnelLabel}>INVESTIDO</Text><Text style={styles.funnelValue}>{kz(sum("budget"))}</Text><Text style={styles.muted}>{kz(spent)} já usados</Text></View>
      <View style={styles.funnelLink}><Ionicons name="arrow-down" size={14} color={colors.muted} /><Text style={styles.funnelLinkText}>{reach ? `${kz(Math.round(spent / reach))} por pessoa` : "—"}</Text></View>
      <View style={styles.funnelStep}><Text style={styles.funnelLabel}>PESSOAS ALCANÇADAS</Text><Text style={styles.funnelValue}>{count(reach)}</Text><Text style={styles.muted}>{count(impressions)} visualizações</Text></View>
      <View style={styles.funnelLink}><Ionicons name="arrow-down" size={14} color={colors.muted} /><Text style={styles.funnelLinkText}>{percentOf(clicks, impressions)} clicaram</Text></View>
      <View style={[styles.funnelStep, styles.funnelClicks]}><Text style={styles.funnelLabel}>CLIQUES</Text><Text style={[styles.funnelValue, { color: RED }]}>{count(clicks)}</Text><Text style={styles.muted}>visitas ao teu perfil ou site</Text></View>
    </View>}

    {/* ----- Cartazes ----- */}
    {ads.length === 0 && !form ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Ainda não criaste nenhuma promoção</Text>
      <Text style={styles.muted}>Escolhe uma publicação de que gostas, define quanto queres gastar e o Tchilar mostra-a a mais pessoas.</Text>
    </View> : ads.length > 0 && <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.filter(([key]) => key === "all" || counts[key] > 0).map(([key, label]) =>
          <Chip key={key} label={`${label} · ${counts[key]}`} on={filter === key} onPress={() => setFilter(key)} />)}
      </ScrollView>
      {visible.map(ad => {
        const [label, tone] = STATUS[ad.status] || STATUS.ended;
        const ratio = ad.budget ? (ad.spent / ad.budget) * 100 : 0;
        const image = ad.post_id ? (ad.post_media_type === "image" ? ad.post_media_url : null) : ad.image_url;
        const daysLeft = Math.max(0, Math.ceil((new Date(ad.ends_at) - Date.now()) / 86400000));
        const when = ad.status === "pending_payment" ? `${dayLabel(ad.days)} depois do pagamento`
          : ad.status === "in_review" ? `${dayLabel(ad.days)} depois da aprovação`
            : ad.status === "active" || ad.status === "paused" ? (daysLeft <= 1 ? "termina hoje" : `faltam ${dayLabel(daysLeft)}`)
              : `terminou a ${new Date(ad.ends_at).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`;
        return <View key={ad.id} style={styles.poster}>
          <View style={[styles.rail, { backgroundColor: tone }]} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={styles.art}>
              {image ? <Image source={{ uri: mediaUri(image) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Ionicons name={ad.post_media_type === "video" ? "play" : ad.post_id ? "flash" : "megaphone"} size={24} color="#fff" />}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={[styles.statusPill, { backgroundColor: `${tone}1F` }]}>
                <View style={[styles.statusDot, { backgroundColor: tone }]} /><Text style={[styles.statusText, { color: tone }]}>{label}</Text>
              </View>
              <Text style={styles.posterTitle} numberOfLines={2}>{ad.title}</Text>
              <Text style={styles.muted} numberOfLines={2}>{ad.post_id ? "Publicação impulsionada" : "Anúncio"}{ad.target_provinces?.length ? ` · ${ad.target_provinces.join(", ")}` : ""} · {when}</Text>
            </View>
          </View>
          <View style={styles.metrics}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ring ratio={ratio} color={tone} />
              <Text style={styles.small}>{kz(ad.spent)}{"\n"}de {kz(ad.budget)}</Text>
            </View>
            {[["Pessoas", count(ad.reach ?? ad.impressions)], ["Cliques", count(ad.clicks)], ["Taxa", percentOf(ad.clicks, ad.impressions)]].map(([name, value]) =>
              <View key={name} style={{ alignItems: "flex-end" }}><Text style={styles.metricLabel}>{name}</Text><Text style={styles.metricValue}>{value}</Text></View>)}
          </View>
          {ad.status === "rejected" && ad.review_note ? <Text style={{ color: colors.danger, fontSize: 13 }}>Motivo: {ad.review_note}{ad.refund_status === "refunded" ? " · valor devolvido" : ""}</Text> : null}
          <View style={styles.actions}>
            {ad.status === "pending_payment" && <Button small label={`Pagar ${kz(ad.budget)}`} onPress={() => setPaying({ title: `Pagar «${ad.title}»`, amount: ad.budget, start: choice => api(`/ads/${ad.id}/checkout`, { method: "POST", body: choice }) })} />}
            {ad.status === "active" && <Button small variant="secondary" icon="pause" label="Pausar" onPress={() => setStatus(ad, "paused")} />}
            {ad.status === "paused" && <Button small icon="play" label="Retomar" onPress={() => setStatus(ad, "active")} />}
            {(ad.status === "ended" || ad.status === "rejected") && ad.post_id && <Button small variant="secondary" icon="copy-outline" label="Repetir"
              onPress={() => openForm({ postId: ad.post_id, budget: String(Math.round(ad.budget)), days: String(ad.days), provinces: ad.target_provinces || [],
                minAge: ad.target_min_age ? String(ad.target_min_age) : "", maxAge: ad.target_max_age ? String(ad.target_max_age) : "" })} />}
            <Pressable style={styles.trash} onPress={() => remove(ad)} accessibilityRole="button" accessibilityLabel={`Apagar ${ad.title}`}>
              <Ionicons name="trash-outline" size={17} color={colors.text} /></Pressable>
          </View>
        </View>;
      })}
    </>}

    <PaymentSheet visible={Boolean(paying)} title={paying?.title || ""} amount={Number(paying?.amount || 0)} purpose="ad"
      onClose={() => { setPaying(null); load(); }} start={choice => paying.start(choice)}
      onPaid={() => { setPaying(null); setForm(null); setNotice({ message: "Pago! A equipa revê a promoção e entra no ar assim que for aprovada." }); load(); }} />
  </View>;
}

const styles = StyleSheet.create({
  head: { gap: 8, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { color: RED, fontSize: 13, fontWeight: "800" },
  liveDotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  liveHalo: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  headTitle: { color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: "800", letterSpacing: -0.5 },
  headText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  calcLine: { marginTop: 6, color: colors.muted, fontSize: 14, lineHeight: 22 },
  calcStrong: { color: colors.text, fontWeight: "800" },
  calcReach: { color: colors.text, fontSize: 20, fontWeight: "800" },
  card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  step: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  stepNumber: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.text },
  stepNumberText: { color: colors.surface, fontWeight: "800" },
  stepTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  pick: { width: 96, height: 120, overflow: "hidden", borderRadius: 12, borderWidth: 2, borderColor: "transparent", backgroundColor: "#141416" },
  pickOn: { borderColor: RED },
  pickText: { flex: 1, alignItems: "center", justifyContent: "center", padding: 8 },
  pickExcerpt: { color: "#fff", fontSize: 11 },
  pickCheck: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: RED },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.text, backgroundColor: colors.text },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: colors.surface },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, backgroundColor: colors.surface, fontSize: 15 },
  ticket: { overflow: "hidden", marginTop: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  ticketHead: { paddingVertical: 10, paddingHorizontal: 14, color: "#fff", backgroundColor: INK, fontSize: 11, fontWeight: "800", letterSpacing: 1.3 },
  ticketReach: { color: RED, fontSize: 36, lineHeight: 40, fontWeight: "800" },
  ticketRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  ticketValue: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  perforation: { height: 0, marginVertical: 6, borderTopWidth: 2, borderStyle: "dashed", borderColor: colors.line },
  notch: { position: "absolute", top: -10, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.background },
  ticketTotalLabel: { color: colors.text, fontSize: 16, fontWeight: "800" },
  ticketTotal: { color: colors.text, fontSize: 20, fontWeight: "800" },
  funnel: { overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  funnelStep: { gap: 2, padding: 14 },
  funnelClicks: { backgroundColor: "rgba(227,6,19,0.06)" },
  funnelLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  funnelValue: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  funnelLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 14, backgroundColor: colors.background },
  funnelLinkText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  poster: { overflow: "hidden", gap: 12, padding: 14, paddingLeft: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  art: { width: 76, height: 96, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#141416" },
  statusPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: "800" },
  posterTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  metrics: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  metricValue: { color: colors.text, fontSize: 18, fontWeight: "800" },
  ringText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  pair: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  pairBox: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pairLabel: { color: colors.text, fontSize: 14, fontWeight: "800" },
  budgetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  budgetChip: { flexGrow: 1, flexBasis: "45%", alignItems: "center", paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  selectField: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.text, backgroundColor: colors.surface },
  selectText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  selectCount: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: RED },
  selectCountText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "75%", gap: 10, paddingTop: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.surface },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  sheetDone: { color: RED, fontSize: 15, fontWeight: "800" },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  optionAll: { borderBottomWidth: 1 },
  optionText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  kinds: { flexDirection: "row", gap: 8 },
  kind: { flex: 1, gap: 4, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  kindOn: { borderColor: RED, backgroundColor: "rgba(227,6,19,0.05)" },
  kindName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  strongLabel: { color: colors.text, fontSize: 14, fontWeight: "800" },
  adImageRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  adThumb: { width: 52, height: 52, borderRadius: 10 },
  adDrop: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  sponsor: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.background },
  sponsorLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  sponsorArt: { width: 64, height: 64, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#141416" },
  trash: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.background }
});
