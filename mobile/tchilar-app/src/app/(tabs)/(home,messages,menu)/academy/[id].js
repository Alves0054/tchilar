// Um curso da Academia: descrição, aulas (abertas a quem tem acesso; as de amostra abertas a todos) e compra.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { CATEGORY_LABELS, LEVEL_LABELS } from "../../../../components/Courses";
import { REPORT_REASONS, useOptions } from "../../../../components/OptionsSheet";
import { PaymentSheet } from "../../../../components/PaymentSheet";
import { Badge, Button, Card, Loading, Notice, Page, count, kz } from "../../../../components/ui";
import { VideoPost } from "../../../../components/VideoPost";
import { api, mediaUri } from "../../../../lib/api";
import { colors } from "../../../../lib/theme";

export default function Course() {
  const { id } = useLocalSearchParams();
  const [data, setData] = useState(null);
  const [lessonId, setLessonId] = useState(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [options, choose] = useOptions();
  // Denunciar curso (conteúdo enganador, plágio, burla...): a equipa de moderação revê.
  const report = async () => {
    const reason = await choose("Porque estás a denunciar este curso?", REPORT_REASONS.map(([value, label]) => ({ key: value, label })));
    if (!reason) return;
    try { setNotice((await api("/reports", { method: "POST", body: { targetType: "course", targetId: Number(id), reason } })).message); }
    catch (reportError) { setError(reportError.message); }
  };
  const load = useCallback(() => api(`/courses/${id}`).then(result => {
    setData(result);
    setLessonId(current => current ?? result.lessons.find(lesson => !lesson.locked)?.id ?? null);
  }).catch(loadError => setError(loadError.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <Page><Notice error={error} /></Page> : <Loading />;
  const { course, lessons } = data;
  const lesson = lessons.find(item => item.id === lessonId);
  const paid = Number(course.price_kz) > 0;
  const cover = mediaUri(course.cover_url);

  return <Page>
    <Stack.Screen options={{ title: course.title }} />
    <Card>
      {cover && <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" />}
      <Text style={styles.meta}>{CATEGORY_LABELS[course.category]} · {LEVEL_LABELS[course.level]}</Text>
      <Text style={styles.title}>{course.title}</Text>
      {Boolean(course.summary) && <Text style={styles.summary}>{course.summary}</Text>}
      <Pressable style={styles.author} disabled={course.by_team} onPress={() => router.push(`/u/${course.owner_username}`)}>
        {course.by_team ? <Ionicons name="school" size={20} color="#30B350" /> : <Avatar user={{ display_name: course.owner_name, avatar_url: course.owner_avatar }} size={28} />}
        <Text style={styles.authorName}>{course.by_team ? "Equipa Tchilar" : course.owner_name}</Text>
        <Text style={styles.muted}>· {lessons.length} aulas · {count(course.students)} alunos</Text>
      </Pressable>
      {course.has_access
        ? <Badge tone="good" label={course.can_edit ? "O teu curso" : paid ? "Já tens este curso" : "Grátis: todas as aulas abertas"} />
        : <Button label={`Comprar por ${kz(course.price_kz)}`} icon="cart" onPress={() => setPaying(true)} />}
      {course.can_edit && <Button variant="secondary" label="Editar curso" icon="create" onPress={() => router.push(`/academy/edit/${course.id}`)} />}
      {!course.can_edit && <Button variant="ghost" small label="Denunciar curso" icon="flag-outline" onPress={report} />}
      <Notice message={notice} error={error} />
    </Card>

    {lesson && <Card title={lesson.title}>
      {lesson.video_url && <VideoPost uri={mediaUri(lesson.video_url)} style={styles.video} controls />}
      {Boolean(lesson.body) && <Text style={styles.body}>{lesson.body}</Text>}
    </Card>}

    <Card title="Aulas" subtitle={lessons.some(item => item.locked) ? "Compra o curso para abrires todas as aulas." : undefined}>
      {lessons.map((item, index) => <Pressable key={item.id} disabled={item.locked} onPress={() => setLessonId(item.id)}
        style={[styles.lesson, item.id === lessonId && styles.lessonActive, item.locked && { opacity: 0.5 }]}>
        <Text style={styles.number}>{index + 1}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.lessonTitle}>{item.title}</Text>
          {item.is_preview && !course.has_access && <Text style={styles.preview}>Amostra grátis</Text>}
        </View>
        <Ionicons name={item.locked ? "lock-closed" : item.has_video ? "play-circle" : "document-text"} size={20} color={item.locked ? colors.muted : colors.text} />
      </Pressable>)}
    </Card>

    {Boolean(course.description) && <Card title="Sobre o curso"><Text style={styles.body}>{course.description}</Text></Card>}

    {options}
    <PaymentSheet visible={paying} title={`Curso «${course.title}»`} amount={course.price_kz} purpose="course"
      start={choice => api(`/courses/${course.id}/buy`, { method: "POST", body: choice })}
      onClose={() => { setPaying(false); load(); }} onPaid={() => { setPaying(false); load(); }} />
  </Page>;
}

const styles = StyleSheet.create({
  cover: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12 },
  meta: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  summary: { color: colors.text, fontSize: 15, lineHeight: 21 },
  author: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  authorName: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.muted },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  lesson: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12 },
  lessonActive: { backgroundColor: colors.background },
  number: { width: 26, height: 26, borderRadius: 13, textAlign: "center", lineHeight: 26, fontWeight: "800", color: colors.text, backgroundColor: colors.primarySoft, overflow: "hidden" },
  lessonTitle: { color: colors.text, fontWeight: "700" },
  preview: { color: "#30B350", fontSize: 12, fontWeight: "700" }
});
