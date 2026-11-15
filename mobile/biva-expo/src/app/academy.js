// Academia Tchilar, como no site: Início (cursos em destaque, guias, ensinar), Cursos (loja),
// Os meus cursos e "Como funciona o Tchilar".
// Os guias vêm de src/lib/academy.json e o "Como funciona" de src/lib/tchilar-guide.json (cópia de src/data no site).
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { CATEGORY_LABELS, CATEGORY_STYLE, COURSE_STATUS, CourseCard, CourseRow, LEVEL_LABELS } from "../components/Courses";
import { Badge, Button, Card, Chips, Field, Loading, Notice, Page, count, kz } from "../components/ui";
import guides from "../lib/academy.json";
import { api } from "../lib/api";
import guide from "../lib/tchilar-guide.json";
import { colors } from "../lib/theme";

const TABS = [["inicio", "Início", "home"], ["cursos", "Cursos", "school"], ["meus", "Os meus", "person"], ["como", "Como funciona", "help-circle"]];
const ICONS = { profile: "person-circle", create: "create", messages: "chatbubbles", trophy: "trophy", stats: "stats-chart", spark: "sparkles",
  friends: "people", groups: "people-circle", live: "radio", star: "star", academy: "school", card: "card", lock: "lock-closed" };
const TONES = ["#0A84FF", "#30B350", "#AF52DE", "#FF8A00", "#0FA3B1", "#5E5CE6", "#E5A000", "#D63384", "#2F80ED", "#F06A2A", "#3A3A3C"];

function Empty({ icon = "school", title, text, action, onPress }) {
  return <View style={styles.empty}>
    <View style={[styles.emptyIcon, { backgroundColor: "#30B3501F" }]}><Ionicons name={icon} size={24} color="#30B350" /></View>
    <Text style={styles.emptyTitle}>{title}</Text>
    {Boolean(text) && <Text style={styles.emptyText}>{text}</Text>}
    {action && <Button small variant="secondary" label={action} onPress={onPress} />}
  </View>;
}

export default function Academy() {
  const [tab, setTab] = useState("inicio");
  return <Page>
    <View style={styles.hero}>
      <Text style={styles.kicker}>Academia Tchilar</Text>
      <Text style={styles.heroTitle}>Aprende, ensina e cresce</Text>
      <Text style={styles.heroText}>Cursos de criadores e da equipa, guias para crescer e tudo sobre o Tchilar.</Text>
      <View style={styles.heroPoints}>
        {[["play-circle", "Vídeo e texto"], ["gift", "Amostras grátis"], ["cash", "Quem ensina: 85%"]].map(([icon, label]) =>
          <View key={label} style={styles.heroPoint}><Ionicons name={icon} size={14} color="#fff" /><Text style={styles.heroPointText}>{label}</Text></View>)}
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      {TABS.map(([key, label, icon]) => <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabOn]}>
        <Ionicons name={icon} size={15} color={tab === key ? colors.onPrimary : colors.muted} />
        <Text style={[styles.tabText, tab === key && { color: colors.onPrimary }]}>{label}</Text>
      </Pressable>)}
    </ScrollView>
    {tab === "inicio" && <Home goTo={setTab} />}
    {tab === "cursos" && <Store />}
    {tab === "meus" && <Mine />}
    {tab === "como" && <HowItWorks />}
  </Page>;
}

function Home({ goTo }) {
  const { width } = useWindowDimensions();
  const [courses, setCourses] = useState(null);
  useFocusEffect(useCallback(() => { api("/courses").then(result => setCourses(result.courses)).catch(() => setCourses([])); }, []));
  return <>
    <View style={styles.sectionHead}>
      <Text style={styles.section}>Cursos em destaque</Text>
      <Text style={styles.link} onPress={() => goTo("cursos")}>Ver todos ›</Text>
    </View>
    {courses === null ? <Loading /> : courses.length === 0
      ? <Empty title="Os primeiros cursos estão a chegar" text="Sabes ensinar alguma coisa? Cria o teu curso e fica com 85% de cada venda." action="Criar um curso" onPress={() => goTo("meus")} />
      : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {courses.slice(0, 6).map(course => <CourseCard key={course.id} course={course} width={Math.min(280, width * 0.72)} />)}
      </ScrollView>}

    <Text style={styles.section}>Guias para crescer</Text>
    {guides.map(([title, icon, tips], index) => <View key={title} style={styles.guideCard}>
      <View style={styles.guideHead}>
        <View style={[styles.guideIcon, { backgroundColor: `${TONES[index % TONES.length]}1F` }]}><Ionicons name={ICONS[icon] || "bulb"} size={18} color={TONES[index % TONES.length]} /></View>
        <View style={{ flex: 1 }}><Text style={styles.step}>Passo {index + 1}</Text><Text style={styles.guideTitle}>{title}</Text></View>
      </View>
      {tips.map(tip => <View key={tip} style={styles.tip}>
        <Ionicons name="checkmark-circle" size={16} color="#30B350" style={{ marginTop: 2 }} />
        <Text style={styles.tipText}>{tip}</Text>
      </View>)}
    </View>)}

    <View style={styles.teach}>
      <Text style={styles.teachTitle}>Ensina o que sabes</Text>
      <Text style={styles.teachText}>Cria um curso, junta as aulas e envia para revisão. Depois de aprovado fica à venda e recebes 85% de cada venda.</Text>
      <View style={styles.teachSteps}>{["Cria o curso", "Junta as aulas", "Envia para revisão", "Recebe 85%"].map((label, index) =>
        <View key={label} style={styles.teachStep}><Text style={styles.teachNum}>{index + 1}</Text><Text style={styles.teachLabel}>{label}</Text></View>)}</View>
      <Button label="Começar" onPress={() => goTo("meus")} />
    </View>
  </>;
}

function HowItWorks() {
  const [open, setOpen] = useState(guide[0].key);
  return guide.map((section, index) => <View key={section.key} style={styles.guideCard}>
    <Pressable style={styles.guideHead} onPress={() => setOpen(open === section.key ? null : section.key)} accessibilityRole="button">
      <View style={[styles.guideIcon, { backgroundColor: `${TONES[index % TONES.length]}1F` }]}>
        <Ionicons name={ICONS[section.icon] || "information-circle"} size={18} color={TONES[index % TONES.length]} />
      </View>
      <Text style={[styles.guideTitle, { flex: 1 }]}>{section.title}</Text>
      <Ionicons name={open === section.key ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
    </Pressable>
    {open === section.key && section.items.map(([term, text]) => <View key={term} style={styles.item}>
      <Text style={styles.term}>{term}</Text>
      <Text style={styles.definition}>{text}</Text>
    </View>)}
  </View>);
}

function Store() {
  const [data, setData] = useState(null);
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  useFocusEffect(useCallback(() => {
    api(`/courses${category ? `?category=${category}` : ""}`).then(result => { setData(result); setError(""); }).catch(loadError => setError(loadError.message));
  }, [category]));
  return <>
    {data && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {[["", "Todos", "apps"], ...data.categories.map(key => [key, CATEGORY_LABELS[key], CATEGORY_STYLE[key]?.[0] || "school"])].map(([key, label, icon]) =>
        <Pressable key={key || "all"} onPress={() => setCategory(key)} style={[styles.category, category === key && styles.categoryOn]}>
          <Ionicons name={icon} size={14} color={category === key ? colors.onPrimary : colors.text} />
          <Text style={[styles.categoryText, category === key && { color: colors.onPrimary }]}>{label}</Text>
        </Pressable>)}
    </ScrollView>}
    <Notice error={error} />
    {!data ? !error && <Loading /> : data.courses.length === 0
      ? <Empty title={category ? "Nenhum curso nesta categoria" : "Ainda não há cursos à venda"} text="Experimenta outra categoria, ou cria o primeiro curso em «Os meus»." />
      : <>
        <Text style={styles.muted}>{data.courses.length} {data.courses.length === 1 ? "curso" : "cursos"}</Text>
        {data.courses.map(course => <CourseCard key={course.id} course={course} />)}
      </>}
  </>;
}

function Mine() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const load = () => api("/courses/mine").then(setData).catch(loadError => setError(loadError.message));
  useFocusEffect(useCallback(() => { load(); }, []));
  const create = async () => {
    setError("");
    try {
      const result = await api("/courses", { method: "POST", body: { ...form, priceKz: form.priceKz.trim() ? Number(form.priceKz.replace(",", ".")) : 0 } });
      setForm(null);
      router.push(`/academy/edit/${result.id}`);
    } catch (createError) { setError(createError.message); }
  };
  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const students = data.created.reduce((sum, course) => sum + course.students, 0);
  const earned = data.created.reduce((sum, course) => sum + (course.by_team ? 0 : course.students * Number(course.price_kz) * 0.85), 0);
  return <>
    <Text style={styles.section}>Os cursos que tenho</Text>
    {data.purchased.length ? data.purchased.map(course => <CourseCard key={course.id} course={{ ...course, has_access: true }} />)
      : <Empty title="Ainda não tens cursos" text="Os cursos que comprares (ou os grátis que abrires) ficam aqui para sempre." />}

    <View style={styles.sectionHead}>
      <Text style={styles.section}>Os cursos que vendo</Text>
      {data.canCreate && !form && <Text style={styles.link} onPress={() => setForm({ title: "", summary: "", category: "criacao", level: "iniciante", priceKz: "", byTeam: false })}>+ Novo curso</Text>}
    </View>
    {data.created.length > 0 && <View style={styles.kpis}>
      {[["Cursos", count(data.created.length)], ["Alunos", count(students)], ["Os teus 85%", kz(earned)]].map(([label, value]) =>
        <View key={label} style={styles.kpi}><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue}>{value}</Text></View>)}
    </View>}
    {!data.canCreate && <Empty icon="stats-chart" title="Ativa o modo criador para vender" text="É grátis, no Painel do criador." action="Abrir o Painel do criador" onPress={() => router.push("/creator")} />}
    {form && <Card title="Novo curso">
      <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={120} placeholder="Ex.: Reels que vendem" />
      <Field label="Resumo" value={form.summary} onChangeText={summary => setForm({ ...form, summary })} maxLength={240} placeholder="O que se aprende, numa frase" />
      <Text style={styles.label}>Categoria</Text>
      <Chips options={Object.entries(CATEGORY_LABELS)} value={form.category} onChange={category => setForm({ ...form, category })} />
      <Text style={styles.label}>Nível</Text>
      <Chips options={Object.entries(LEVEL_LABELS)} value={form.level} onChange={level => setForm({ ...form, level })} />
      <Field label="Preço (Kz)" hint="Vazio = grátis · 500 a 500 000 Kz" value={form.priceKz} onChangeText={priceKz => setForm({ ...form, priceKz })} keyboardType="decimal-pad" />
      {data.isTeam && <Chips options={[["no", "Curso meu"], ["yes", "Curso da equipa"]]} value={form.byTeam ? "yes" : "no"} onChange={value => setForm({ ...form, byTeam: value === "yes" })} />}
      <Notice error={error} />
      <Button label="Criar e juntar aulas" onPress={create} disabled={!form.title.trim()} />
      <Button variant="ghost" label="Cancelar" onPress={() => setForm(null)} />
    </Card>}
    {data.created.length > 0 && <Card>
      {data.created.map(course => <View key={course.id} style={styles.myCourse}>
        <CourseRow course={course} onPress={() => router.push(`/academy/edit/${course.id}`)} />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Badge label={COURSE_STATUS[course.status][0]} tone={COURSE_STATUS[course.status][1]} />
          {course.review_note ? <Text style={[styles.muted, { flex: 1 }]} numberOfLines={2}>Nota: {course.review_note}</Text> : null}
        </View>
      </View>)}
    </Card>}
  </>;
}

const styles = StyleSheet.create({
  hero: { gap: 6, padding: 20, borderRadius: 18, backgroundColor: colors.ink },
  kicker: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800" },
  heroText: { color: "rgba(255,255,255,0.78)", lineHeight: 20 },
  heroPoints: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  heroPoint: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" },
  heroPointText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  tabs: { gap: 6, padding: 4, borderRadius: 14, backgroundColor: colors.surface },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  tabOn: { backgroundColor: colors.primary },
  tabText: { color: colors.muted, fontWeight: "800" },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  section: { color: colors.text, fontSize: 19, fontWeight: "800", marginTop: 4 },
  link: { color: colors.text, fontWeight: "800" },
  muted: { color: colors.muted },
  guideCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 10 },
  guideHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  guideIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  step: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  guideTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  tip: { flexDirection: "row", gap: 8 },
  tipText: { flex: 1, color: colors.text, lineHeight: 20 },
  item: { backgroundColor: colors.background, borderRadius: 12, padding: 12, gap: 3 },
  term: { color: colors.text, fontWeight: "800" },
  definition: { color: colors.muted, lineHeight: 20 },
  teach: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 10 },
  teachTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  teachText: { color: colors.muted, lineHeight: 20 },
  teachSteps: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  teachStep: { flexDirection: "row", alignItems: "center", gap: 6, width: "47%" },
  teachNum: { width: 24, height: 24, borderRadius: 12, textAlign: "center", lineHeight: 24, overflow: "hidden", backgroundColor: colors.primary, color: colors.onPrimary, fontWeight: "800", fontSize: 12 },
  teachLabel: { color: colors.text, fontWeight: "700", flex: 1 },
  category: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  categoryOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 12 },
  kpiLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  kpiValue: { color: colors.text, fontSize: 17, fontWeight: "800", marginTop: 2 },
  myCourse: { gap: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  label: { color: colors.text, fontWeight: "700" },
  empty: { alignItems: "center", gap: 8, padding: 20, borderRadius: 16, backgroundColor: colors.surface },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.muted, textAlign: "center", lineHeight: 20 }
});
