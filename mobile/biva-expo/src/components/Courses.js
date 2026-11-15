// Cursos da Academia: nomes das categorias, níveis e estados, a capa (foto ou cor da categoria),
// o cartão de um curso (como no site) e a linha compacta para listas.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mediaUri } from "../lib/api";
import { colors } from "../lib/theme";
import { Avatar } from "./Avatar";
import { count, kz } from "./ui";

export const CATEGORY_LABELS = { criacao: "Criação de conteúdo", video: "Vídeo", fotografia: "Fotografia", musica: "Música", negocios: "Negócios",
  marketing: "Marketing", tecnologia: "Tecnologia", idiomas: "Idiomas", "bem-estar": "Bem-estar", outro: "Outro" };
export const LEVEL_LABELS = { iniciante: "Iniciante", intermedio: "Intermédio", avancado: "Avançado" };
export const COURSE_STATUS = { draft: ["Rascunho", "neutral"], review: ["Em revisão", "warning"], published: ["À venda", "good"], rejected: ["Precisa de mudanças", "warning"], hidden: ["Retirado", "neutral"] };
export const CATEGORY_STYLE = { criacao: ["sparkles", "#AF52DE"], video: ["film", "#D63384"], fotografia: ["camera", "#0FA3B1"], musica: ["musical-notes", "#5E5CE6"],
  negocios: ["stats-chart", "#30B350"], marketing: ["megaphone", "#FF8A00"], tecnologia: ["laptop", "#0A84FF"], idiomas: ["globe", "#2F80ED"],
  "bem-estar": ["heart", "#30B350"], outro: ["school", "#6E6E73"] };
export const priceLabel = course => Number(course.price_kz) > 0 ? kz(course.price_kz) : "Grátis";

export function CourseCover({ course, style, iconSize = 30 }) {
  const cover = mediaUri(course.cover_url);
  const [icon, tone] = CATEGORY_STYLE[course.category] || CATEGORY_STYLE.outro;
  return <View style={[styles.cover, { backgroundColor: tone }, style]}>
    {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
      : <><View style={styles.coverShade} /><Ionicons name={icon} size={iconSize} color="#fff" /></>}
  </View>;
}

// Cartão grande: capa com o preço por cima, categoria, título, resumo, autor e números.
export function CourseCard({ course, width }) {
  const owned = course.has_access && Number(course.price_kz) > 0;
  const free = !Number(course.price_kz);
  return <Pressable style={[styles.card, width && { width }]} onPress={() => router.push(`/academy/${course.id}`)}>
    <View>
      <CourseCover course={course} style={styles.cardCover} iconSize={36} />
      <View style={[styles.priceTag, free && !owned && styles.priceFree]}>
        <Text style={[styles.priceText, free && !owned && { color: "#fff" }]}>{owned ? "Já tens" : priceLabel(course)}</Text>
      </View>
    </View>
    <View style={styles.cardBody}>
      <Text style={styles.meta}>{CATEGORY_LABELS[course.category] || "Curso"} · {LEVEL_LABELS[course.level]}</Text>
      <Text style={styles.title} numberOfLines={2}>{course.title}</Text>
      {Boolean(course.summary) && <Text style={styles.summary} numberOfLines={2}>{course.summary}</Text>}
      <View style={styles.author}>
        {course.by_team ? <View style={styles.teamMark}><Ionicons name="school" size={11} color="#fff" /></View>
          : <Avatar user={{ display_name: course.owner_name, avatar_url: course.owner_avatar }} size={20} />}
        <Text style={styles.authorName} numberOfLines={1}>{course.by_team ? "Equipa Tchilar" : course.owner_name}</Text>
      </View>
      <Text style={styles.sub}>{course.lessons_count} {course.lessons_count === 1 ? "aula" : "aulas"} · {count(course.students)} alunos</Text>
    </View>
  </Pressable>;
}

// Linha compacta (cursos que vendo, administração).
export function CourseRow({ course, onPress }) {
  return <Pressable style={styles.row} onPress={onPress || (() => router.push(`/academy/${course.id}`))}>
    <CourseCover course={course} style={styles.rowCover} iconSize={24} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.meta}>{CATEGORY_LABELS[course.category] || "Curso"} · {LEVEL_LABELS[course.level]}</Text>
      <Text style={styles.rowTitle} numberOfLines={2}>{course.title}</Text>
      <Text style={styles.sub} numberOfLines={1}>{priceLabel(course)} · {course.lessons_count} aulas · {count(course.students)} alunos</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
  </Pressable>;
}

const styles = StyleSheet.create({
  cover: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  coverShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden" },
  cardCover: { width: "100%", aspectRatio: 16 / 9 },
  priceTag: { position: "absolute", right: 10, bottom: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#fff" },
  priceFree: { backgroundColor: "#30B350" },
  priceText: { color: colors.ink, fontWeight: "800", fontSize: 13 },
  cardBody: { padding: 12, gap: 4 },
  meta: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  title: { color: colors.text, fontWeight: "800", fontSize: 16 },
  summary: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  author: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  teamMark: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#30B350", alignItems: "center", justifyContent: "center" },
  authorName: { color: colors.text, fontWeight: "700", fontSize: 13, flex: 1 },
  sub: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  rowCover: { width: 88, height: 60, borderRadius: 12 },
  rowTitle: { color: colors.text, fontWeight: "800", fontSize: 15 }
});
