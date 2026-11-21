import { Ionicons } from "@expo/vector-icons";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { EventComposer } from "../../components/EventComposer";
import { SelectBox, useOptions } from "../../components/OptionsSheet";
import { PageLogo } from "../../components/PageParts";
import { useSession } from "../../lib/session";
import { Button, Card, Field, Notice, Page } from "../../components/ui";
import { api } from "../../lib/api";
import { PAGE_CATEGORIES, PAGE_TYPES, pageCategory } from "../../lib/pages";
import { GROUP_CATEGORIES, GROUP_PRIVACY, GROUP_TYPES, groupCategory } from "../../lib/groups";
import { kz } from "../../components/ui";
import { colors } from "../../lib/theme";

// Criar um grupo, uma página ou um evento (/community/new?type=group|page|event), com as mesmas opções do site.
const TITLES = { group: "Criar grupo", page: "Criar página", event: "Criar evento" };

export default function NewCommunity() {
  // Evento de uma página: /community/new?type=event&pageId=2&pageName=Loja (fica ligado à página).
  const { type = "group", pageId, pageName } = useLocalSearchParams();
  const [form, setForm] = useState({ name: "", description: "", groupType: "", groupCategory: "", groupSub: "", rules: "", privacy: "public", accessPrice: "", pageType: "", category: "", subcategory: "", location: "", date: "", time: "", shopEnabled: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  // Página: escolher o tipo sugere a categoria (uma banda → Música e áudio); a subcategoria é opcional.
  const [options, choose] = useOptions();
  const { user } = useSession();
  // Grupo: o tipo sugere a categoria (compra e venda → Compra e venda); a subcategoria é opcional.
  const groupKind = GROUP_TYPES.find(item => item.key === form.groupType);
  const groupArea = form.groupCategory ? groupCategory(form.groupCategory) : null;
  const privacyOption = GROUP_PRIVACY.find(item => item.key === form.privacy);
  const pickGroupType = async () => {
    const key = await choose("Tipo de grupo", GROUP_TYPES.map(item => ({ key: item.key, label: `${item.label} — ${item.help}`, icon: item.ion })), form.groupType);
    const item = GROUP_TYPES.find(entry => entry.key === key);
    if (item) setForm(current => ({ ...current, groupType: item.key, groupCategory: item.category, groupSub: "" }));
  };
  const pickGroupCategory = async () => {
    const key = await choose("Categoria", GROUP_CATEGORIES.map(item => ({ key: item.key, label: item.label })), form.groupCategory);
    if (key) setForm(current => ({ ...current, groupCategory: key, groupSub: current.groupCategory === key ? current.groupSub : "" }));
  };
  const pickGroupSub = async () => {
    const key = await choose(groupArea.label, [{ key: "", label: "Sem subcategoria" }, ...groupArea.subcategories.map(item => ({ key: item.key, label: item.label }))], form.groupSub);
    if (key !== null && key !== undefined) set("groupSub")(key);
  };
  const area = pageCategory(form.category);
  const kind = PAGE_TYPES.find(item => item.key === form.pageType);
  const pickType = async () => {
    const key = await choose("Tipo de página", PAGE_TYPES.map(item => ({ key: item.key, label: item.label, icon: item.ion, section: item.group })), form.pageType);
    const item = PAGE_TYPES.find(entry => entry.key === key);
    if (item) setForm(current => ({ ...current, pageType: item.key, category: item.category, subcategory: "" }));
  };
  const pickCategory = async () => {
    const key = await choose("Categoria", PAGE_CATEGORIES.map(item => ({ key: item.key, label: item.label })), form.category);
    if (key) setForm(current => ({ ...current, category: key, subcategory: current.category === key ? current.subcategory : "" }));
  };
  const pickSubcategory = async () => {
    const key = await choose(area.label, [{ key: "", label: "Sem subcategoria" }, ...area.subcategories.map(item => ({ key: item.key, label: item.label }))], form.subcategory);
    if (key !== null && key !== undefined) set("subcategory")(key);
  };

  const create = async () => {
    setBusy(true); setError("");
    try {
      if (type === "group") {
        const result = await api("/groups", { method: "POST", body: { name: form.name, description: form.description, groupType: form.groupType, category: form.groupCategory, subcategory: form.groupSub || undefined, rules: form.rules, privacy: form.privacy,
          ...(form.privacy === "secret" ? { accessPrice: Number(form.accessPrice) } : {}) } });
        router.replace(`/group/${result.group.id}`);
      } else if (type === "page") {
        const result = await api("/pages", { method: "POST", body: { name: form.name, description: form.description, pageType: form.pageType, category: form.category, subcategory: form.subcategory || undefined, shopEnabled: form.shopEnabled } });
        router.replace(`/page/${result.page.id}`);
      }
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  if (type === "event") return <Page>
    <Stack.Screen options={{ title: pageName ? "Evento da página" : "Criar evento" }} />
    <Card><EventComposer pageId={pageId} pageName={pageName} onCreated={() => router.back()} /></Card>
  </Page>;

  // Pré-visualização do grupo (igual ao site): logótipo, nome, etiquetas, quem pode entrar e o botão que as pessoas vão ver.
  const price = Number(form.accessPrice);
  const previewAction = form.privacy === "secret" ? `Entrar por ${kz(price >= 500 ? price : 500)}`
    : form.privacy === "approval" ? "Pedir para entrar" : form.privacy === "private" ? "Só por convite" : "Participar";

  return <Page>
    <Stack.Screen options={{ title: TITLES[type] || "Criar" }} />
    <Card>
      <Field label="Nome" value={form.name} onChangeText={set("name")} maxLength={100} />
      <Field label="Descrição" value={form.description} onChangeText={set("description")} multiline maxLength={2000} />
      {type === "group" && options}
      {type === "group" && <>
        <SelectBox label="Tipo de grupo" icon={groupKind?.ion || "people-outline"} value={groupKind?.label} placeholder="Escolhe o tipo" onPress={pickGroupType} />
        {groupKind ? <>
          <SelectBox label="Categoria" value={groupArea?.label} onPress={pickGroupCategory} />
          {groupArea?.subcategories.length > 0 && <SelectBox label="Subcategoria" hint="opcional" placeholder="Sem subcategoria"
            value={groupArea.subcategories.find(item => item.key === form.groupSub)?.label} onPress={pickGroupSub} />}
        </> : null}
        <Text style={styles.label}>Quem pode entrar</Text>
        <View style={styles.privacyGrid}>{GROUP_PRIVACY.map(option => {
          const on = form.privacy === option.key;
          return <Pressable key={option.key} style={[styles.privacy, on && styles.privacyOn]} onPress={() => set("privacy")(option.key)}
            accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <View style={styles.privacyHead}>
              <View style={[styles.privacyIcon, option.key === "secret" && { backgroundColor: "#0B0B0C" }]}>
                <Ionicons name={option.ion} size={16} color={option.key === "secret" ? "#fff" : colors.text} /></View>
              <Text style={styles.privacyName} numberOfLines={1}>{option.label}</Text>
              <View style={[styles.dot, on && styles.dotOn]} />
            </View>
            <Text style={styles.privacyHelp}>{option.help}</Text>
          </Pressable>;
        })}</View>
        <Field label="Regras (opcional)" value={form.rules} onChangeText={set("rules")} multiline maxLength={3000} placeholder={"1. Respeito por todos.\n2. Sem spam."} />
        {form.privacy === "secret" && <Field label="Preço de entrada (Kz)" value={form.accessPrice} onChangeText={value => set("accessPrice")(value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
          hint="Só maiores de 18 anos. Pagamento único entre 500 e 500 000 Kz; recebes 70% de cada entrada." />}
        <Text style={styles.label}>Assim vão ver o teu grupo</Text>
        <View style={styles.preview}>
          <View style={styles.previewCover} />
          <View style={styles.previewLogo}><PageLogo page={{ name: form.name || "Novo grupo" }} size={60} border={4} /></View>
          <View style={styles.previewBody}>
            <Text style={[styles.previewName, !form.name && { opacity: 0.55 }]}>{form.name || "Nome do grupo"}</Text>
            <View style={styles.tags}>
              <Text style={styles.tag}>{groupKind ? `${groupKind.label} · ${groupArea?.label || ""}` : "Tipo · categoria"}</Text>
              {form.privacy !== "public" && <Text style={[styles.tag, form.privacy === "secret" && styles.tagDark]}>{privacyOption?.label}</Text>}
            </View>
            <Text style={[styles.previewText, !form.description && { opacity: 0.55 }]} numberOfLines={3}>{form.description || "A descrição aparece aqui."}</Text>
            <View style={styles.previewFoot}>
              <Text style={styles.small} numberOfLines={1}>1 membro · por {user?.display_name || "ti"}</Text>
              <View style={styles.action}><Text style={styles.actionText}>{previewAction}</Text></View>
            </View>
          </View>
        </View>
      </>}
      {type === "page" && <>
        <SelectBox label="Tipo de página" icon={kind?.ion || "albums-outline"} value={kind?.label} placeholder="Escolhe o tipo" onPress={pickType} />
        {kind ? <>
          <SelectBox label="Categoria" value={area?.label} onPress={pickCategory} />
          {area?.subcategories.length > 0 && <SelectBox label="Subcategoria" hint="opcional" placeholder="Sem subcategoria"
            value={area.subcategories.find(item => item.key === form.subcategory)?.label} onPress={pickSubcategory} />}
        </> : null}
        {/* Loja na página: quem cria decide (pode mudar depois em Editar informações). */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.background }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Loja na página</Text>
            <Text style={{ color: colors.muted, lineHeight: 19 }}>Produtos e serviços com preço, desconto e o link para comprar. Podes mudar depois.</Text>
          </View>
          <Switch value={form.shopEnabled} onValueChange={set("shopEnabled")} trackColor={{ true: colors.accent }} accessibilityLabel="Loja na página" />
        </View>
        {options}
      </>}
      <Notice error={error} />
      <Button label={TITLES[type] || "Criar"} onPress={create} busy={busy} disabled={!form.name.trim() || (type === "page" && !form.pageType) || (type === "group" && !form.groupType)} />
    </Card>
  </Page>;
}

const styles = StyleSheet.create({
  label: { color: colors.text, fontSize: 14, fontWeight: "800" },
  small: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  privacyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  privacy: { flexGrow: 1, flexBasis: "46%", gap: 6, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  privacyOn: { borderColor: "#E30613", backgroundColor: "rgba(227,6,19,0.05)" },
  privacyHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  privacyIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  privacyName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "800" },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line },
  dotOn: { borderWidth: 5, borderColor: "#E30613" },
  privacyHelp: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  preview: { overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  previewCover: { height: 90, backgroundColor: "#141416" },
  previewLogo: { position: "absolute", top: 58, left: 14 },
  previewBody: { gap: 8, padding: 14, paddingTop: 36 },
  previewName: { color: colors.text, fontSize: 19, fontWeight: "800" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { overflow: "hidden", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, color: colors.text, backgroundColor: colors.background, fontSize: 12, fontWeight: "800" },
  tagDark: { color: "#fff", backgroundColor: "#0B0B0C" },
  previewText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  previewFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "#E30613" },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "800" }
});
