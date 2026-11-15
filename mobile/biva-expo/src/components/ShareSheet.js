// Partilhar uma publicação no Tchilar (como no site): com um comentário opcional, no teu perfil,
// numa página tua e em até 5 grupos onde és membro.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useKeyboardOverlap } from "../lib/keyboard";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";
import { Button, Notice } from "./ui";

const MAX_GROUPS = 5;

function Option({ icon, tone, title, subtitle, on, onPress, disabled }) {
  return <Pressable style={[styles.option, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
    <View style={[styles.optionIcon, { backgroundColor: `${tone}1F` }]}><Ionicons name={icon} size={18} color={tone} /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.optionTitle} numberOfLines={1}>{title}</Text>
      {Boolean(subtitle) && <Text style={styles.optionSub} numberOfLines={1}>{subtitle}</Text>}
    </View>
    <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.text : colors.muted} />
  </Pressable>;
}

export function ShareSheet({ post, visible, onClose, onShared }) {
  const { user } = useSession();
  const [text, setText] = useState("");
  const [toProfile, setToProfile] = useState(true);
  const [pageId, setPageId] = useState(null);
  const [groupIds, setGroupIds] = useState([]);
  const [pages, setPages] = useState(null);
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keyboardRef, keyboardOverlap] = useKeyboardOverlap();

  useEffect(() => {
    if (!visible) return;
    setText(""); setToProfile(true); setPageId(null); setGroupIds([]); setError("");
    Promise.allSettled([api("/pages"), api("/groups")]).then(([pageResult, groupResult]) => {
      setPages((pageResult.value?.pages || []).filter(page => page.owner_username === user?.username));
      setGroups((groupResult.value?.groups || []).filter(group => group.is_member));
    });
  }, [visible, user?.username]);

  const toggleGroup = id => setGroupIds(current => current.includes(id) ? current.filter(item => item !== id)
    : current.length < MAX_GROUPS ? [...current, id] : current);
  const destinations = (toProfile ? 1 : 0) + (pageId ? 1 : 0) + groupIds.length;

  const submit = async () => {
    setBusy(true); setError("");
    try {
      await api(`/posts/${post.id}/share`, { method: "POST", body: { body: text.trim(), profile: toProfile, pageId, groupIds } });
      onShared?.(destinations);
      onClose();
    } catch (shareError) { setError(shareError.message); } finally { setBusy(false); }
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View ref={keyboardRef} style={[styles.screen, { paddingBottom: keyboardOverlap }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Partilhar no Tchilar</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar"><Ionicons name="close" size={26} color={colors.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Diz alguma coisa sobre isto (opcional)"
            placeholderTextColor={colors.muted} multiline maxLength={5000} />
          <View style={styles.preview}>
            <Text style={styles.previewName}>{post.display_name}</Text>
            <Text style={styles.previewText} numberOfLines={3}>{post.body || (post.media_type === "video" ? "Vídeo" : post.media_type === "image" ? "Foto" : "")}</Text>
          </View>

          <Text style={styles.section}>Onde partilhar</Text>
          <Option icon="person-circle" tone="#0A84FF" title="O meu perfil" subtitle="Aparece no teu perfil e no Início de quem te segue" on={toProfile} onPress={() => setToProfile(!toProfile)} />

          {pages === null ? <ActivityIndicator color={colors.text} /> : pages.length > 0 && <>
            <Text style={styles.section}>As tuas páginas</Text>
            {pages.map(page => <Option key={page.id} icon="flag" tone="#FF8A00" title={page.name} on={pageId === page.id} onPress={() => setPageId(pageId === page.id ? null : page.id)} />)}
          </>}

          {groups === null ? null : <>
            <Text style={styles.section}>Grupos {groupIds.length > 0 ? `(${groupIds.length}/${MAX_GROUPS})` : `· até ${MAX_GROUPS}`}</Text>
            {groups.length === 0 ? <Text style={styles.muted}>Ainda não és membro de nenhum grupo.</Text>
              : groups.map(group => <Option key={group.id} icon="people" tone="#30B350" title={group.name}
                subtitle={`${group.member_count || 0} membros`} on={groupIds.includes(group.id)} onPress={() => toggleGroup(group.id)}
                disabled={!groupIds.includes(group.id) && groupIds.length >= MAX_GROUPS} />)}
          </>}
          <Notice error={error} />
        </ScrollView>
        <View style={styles.foot}>
          <Button label={busy ? "A partilhar..." : destinations > 1 ? `Partilhar em ${destinations} sítios` : "Partilhar"} icon="repeat" busy={busy}
            disabled={!destinations} onPress={submit} />
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  body: { paddingHorizontal: 14, paddingBottom: 20, gap: 8 },
  input: { minHeight: 80, borderRadius: 14, padding: 12, backgroundColor: colors.background, color: colors.text, fontSize: 16, textAlignVertical: "top" },
  preview: { borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2 },
  previewName: { color: colors.text, fontWeight: "800" },
  previewText: { color: colors.muted },
  section: { color: colors.text, fontWeight: "800", fontSize: 15, marginTop: 10 },
  muted: { color: colors.muted },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  optionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optionTitle: { color: colors.text, fontWeight: "700" },
  optionSub: { color: colors.muted, fontSize: 12 },
  foot: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }
});
