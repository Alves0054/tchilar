// Editar um curso meu: dados, capa, aulas (texto e/ou vídeo, amostra grátis) e enviar para revisão.
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { CATEGORY_LABELS, COURSE_STATUS, LEVEL_LABELS } from "../../../../../components/Courses";
import { Badge, Button, Card, Chips, Field, Loading, Notice, Page, Row } from "../../../../../components/ui";
import { api, upload } from "../../../../../lib/api";
import { colors } from "../../../../../lib/theme";

export default function EditCourse() {
  const { id } = useLocalSearchParams();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [lesson, setLesson] = useState({ title: "", body: "", isPreview: false, video: null });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({});
  const load = useCallback(() => api(`/courses/${id}`).then(result => {
    setData(result);
    setForm(current => current || { title: result.course.title, summary: result.course.summary, description: result.course.description,
      category: result.course.category, level: result.course.level, priceKz: Number(result.course.price_kz) ? String(result.course.price_kz) : "" });
  }).catch(error => setNotice({ error: error.message })), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data || !form) return notice.error ? <Page><Notice {...notice} /></Page> : <Loading />;
  const { course, lessons } = data;
  if (!course.can_edit) return <Page><Notice error="Só quem criou o curso o pode editar." /></Page>;

  const run = async (key, task, message) => {
    setBusy(key); setNotice({});
    try { const result = await task(); await load(); setNotice({ message: typeof result === "string" ? result : message }); }
    catch (error) { setNotice({ error: error.message }); } finally { setBusy(""); }
  };
  const save = () => run("save", async () => {
    const result = await api(`/courses/${course.id}`, { method: "PATCH", body: { ...form, priceKz: form.priceKz.trim() ? Number(form.priceKz.replace(",", ".")) : 0 } });
    return result.status === "review" && course.status === "published" ? "Guardado. Voltou a revisão: fica à venda quando a equipa aprovar." : "Guardado.";
  });
  const pickCover = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9, allowsEditing: true, aspect: [16, 9] });
    if (!result.canceled) run("cover", () => upload(`/courses/${course.id}/cover`, {}, result.assets[0], "image"), "Capa atualizada.");
  };
  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1 });
    if (!result.canceled) setLesson({ ...lesson, video: result.assets[0] });
  };
  const addLesson = () => run("lesson", async () => {
    await upload(`/courses/${course.id}/lessons`, { title: lesson.title, body: lesson.body, isPreview: lesson.isPreview ? "true" : "false" }, lesson.video, "video");
    setLesson({ title: "", body: "", isPreview: false, video: null });
  }, "Aula adicionada.");
  const removeLesson = item => Alert.alert("Apagar aula?", item.title, [
    { text: "Cancelar", style: "cancel" },
    { text: "Apagar", style: "destructive", onPress: () => run(`del${item.id}`, () => api(`/courses/${course.id}/lessons/${item.id}`, { method: "DELETE" }), "Aula apagada.") }
  ]);
  const submit = () => run("submit", async () => {
    const result = await api(`/courses/${course.id}/submit`, { method: "POST" });
    return result.status === "published" ? "Publicado na Academia." : "Enviado para revisão. Avisamos-te quando estiver à venda.";
  });
  const remove = () => Alert.alert("Apagar curso?", "Apaga o curso e todas as aulas. Não pode ser desfeito.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Apagar", style: "destructive", onPress: () => run("delete", async () => { await api(`/courses/${course.id}`, { method: "DELETE" }); router.back(); }) }
  ]);

  return <Page>
    <Stack.Screen options={{ title: "Editar curso" }} />
    <Notice {...notice} />
    <Card title={course.title} right={<Badge label={COURSE_STATUS[course.status][0]} tone={COURSE_STATUS[course.status][1]} />}>
      {course.review_note ? <Text style={{ color: colors.danger }}>Nota da equipa: {course.review_note}</Text> : null}
      {["draft", "rejected"].includes(course.status) && <Button label={course.by_team ? "Publicar" : "Enviar para revisão"} icon="send" busy={busy === "submit"} onPress={submit} />}
      <Button variant="secondary" label="Ver como aluno" icon="eye" onPress={() => router.push(`/academy/${course.id}`)} />
      <Button variant="secondary" label={course.cover_url ? "Mudar capa" : "Adicionar capa"} icon="image" busy={busy === "cover"} onPress={pickCover} />
    </Card>

    <Card title="Dados do curso">
      <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={120} />
      <Field label="Resumo" value={form.summary} onChangeText={summary => setForm({ ...form, summary })} maxLength={240} />
      <Field label="Descrição" value={form.description} onChangeText={description => setForm({ ...form, description })} multiline maxLength={8000} placeholder="Para quem é, o que se aprende, o que é preciso." />
      <Text style={{ color: colors.text, fontWeight: "700" }}>Categoria</Text>
      <Chips options={Object.entries(CATEGORY_LABELS)} value={form.category} onChange={category => setForm({ ...form, category })} />
      <Text style={{ color: colors.text, fontWeight: "700" }}>Nível</Text>
      <Chips options={Object.entries(LEVEL_LABELS)} value={form.level} onChange={level => setForm({ ...form, level })} />
      <Field label="Preço (Kz)" hint={`Vazio = grátis · 500 a 500 000 Kz${course.by_team ? "" : " · ficas com 85%"}`} value={form.priceKz} onChangeText={priceKz => setForm({ ...form, priceKz })} keyboardType="decimal-pad" />
      <Button label="Guardar" busy={busy === "save"} onPress={save} disabled={!form.title.trim()} />
      {!course.students && <Button variant="ghost" label="Apagar curso" onPress={remove} />}
    </Card>

    <Card title={`Aulas (${lessons.length})`}>
      {lessons.map((item, index) => <Row key={item.id} icon={item.has_video ? "play-circle" : "document-text"} tone={item.is_preview ? "#30B350" : undefined}
        title={`${index + 1}. ${item.title}`} subtitle={item.is_preview ? "Amostra grátis · toca para apagar" : "Toca para apagar"} onPress={() => removeLesson(item)} />)}
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 6 }}>Nova aula</Text>
      <Field label="Título" value={lesson.title} onChangeText={title => setLesson({ ...lesson, title })} maxLength={120} />
      <Field label="Texto da aula" value={lesson.body} onChangeText={body => setLesson({ ...lesson, body })} multiline maxLength={20000} />
      <Button variant="secondary" icon="videocam" label={lesson.video ? "Vídeo escolhido · trocar" : "Escolher vídeo (opcional)"} onPress={pickVideo} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, flex: 1 }}>Amostra grátis (qualquer pessoa vê antes de comprar)</Text>
        <Switch value={lesson.isPreview} onValueChange={isPreview => setLesson({ ...lesson, isPreview })} trackColor={{ true: colors.accent }} />
      </View>
      <Button label="Adicionar aula" icon="add" busy={busy === "lesson"} onPress={addLesson} disabled={!lesson.title.trim() || (!lesson.body.trim() && !lesson.video)} />
    </Card>
  </Page>;
}
