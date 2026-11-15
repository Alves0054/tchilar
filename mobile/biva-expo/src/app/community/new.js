import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { SelectBox, useOptions } from "../../components/OptionsSheet";
import { Button, Card, Field, Notice, Page } from "../../components/ui";
import { api } from "../../lib/api";
import { PAGE_CATEGORIES, PAGE_TYPES, pageCategory } from "../../lib/pages";
import { GROUP_CATEGORIES, GROUP_PRIVACY, GROUP_TYPES, groupCategory } from "../../lib/groups";
import { colors } from "../../lib/theme";

// Criar um grupo, uma página ou um evento (/community/new?type=group|page|event), com as mesmas opções do site.
const TITLES = { group: "Criar grupo", page: "Criar página", event: "Criar evento" };

function toIsoDateTime(date, time) {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  return d && t ? new Date(`${d[3]}-${d[2]}-${d[1]}T${t[1]}:${t[2]}:00`).toISOString() : null;
}
const mask = (text, kind) => {
  const digits = text.replace(/\D/g, "");
  return kind === "date"
    ? [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/")
    : [digits.slice(0, 2), digits.slice(2, 4)].filter(Boolean).join(":");
};

export default function NewCommunity() {
  const { type = "group" } = useLocalSearchParams();
  const [form, setForm] = useState({ name: "", description: "", groupType: "", groupCategory: "", groupSub: "", rules: "", privacy: "public", accessPrice: "", pageType: "", category: "", subcategory: "", location: "", date: "", time: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  // Página: escolher o tipo sugere a categoria (uma banda → Música e áudio); a subcategoria é opcional.
  const [options, choose] = useOptions();
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
  const pickPrivacy = async () => {
    const key = await choose("Quem pode entrar", GROUP_PRIVACY.map(item => ({ key: item.key, label: item.label, icon: item.ion })), form.privacy);
    if (key) set("privacy")(key);
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
        const result = await api("/pages", { method: "POST", body: { name: form.name, description: form.description, pageType: form.pageType, category: form.category, subcategory: form.subcategory || undefined } });
        router.replace(`/page/${result.page.id}`);
      } else {
        const startsAt = toIsoDateTime(form.date, form.time);
        if (!startsAt) throw new Error("Escreve a data (DD/MM/AAAA) e a hora (HH:MM).");
        await api("/events", { method: "POST", body: { name: form.name, description: form.description, location: form.location, startsAt } });
        router.back();
      }
    } catch (createError) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  };

  return <Page>
    <Stack.Screen options={{ title: TITLES[type] || "Criar" }} />
    <Card>
      <Field label="Nome" value={form.name} onChangeText={set("name")} maxLength={100} />
      <Field label="Descrição" value={form.description} onChangeText={set("description")} multiline maxLength={2000} />
      {type === "group" && <>
        <SelectBox label="Tipo de grupo" icon={groupKind?.ion || "people-outline"} value={groupKind?.label} placeholder="Escolhe o tipo" onPress={pickGroupType} />
        {groupKind ? <>
          <SelectBox label="Categoria" value={groupArea?.label} onPress={pickGroupCategory} />
          {groupArea?.subcategories.length > 0 && <SelectBox label="Subcategoria" hint="opcional" placeholder="Sem subcategoria"
            value={groupArea.subcategories.find(item => item.key === form.groupSub)?.label} onPress={pickGroupSub} />}
        </> : null}
        <SelectBox label="Quem pode entrar" icon={privacyOption?.ion} value={privacyOption?.label} onPress={pickPrivacy} />
        <Text style={{ color: colors.muted }}>{privacyOption?.help}</Text>
        <Field label="Regras (opcional)" value={form.rules} onChangeText={set("rules")} multiline maxLength={3000} placeholder={"1. Respeito por todos.\n2. Sem spam."} />
        {form.privacy === "secret" && <Field label="Preço de entrada (Kz)" value={form.accessPrice} onChangeText={value => set("accessPrice")(value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
          hint="Só maiores de 18 anos. Os membros pagam para entrar; recebes uma parte." />}
      </>}
      {type === "page" && <>
        <SelectBox label="Tipo de página" icon={kind?.ion || "albums-outline"} value={kind?.label} placeholder="Escolhe o tipo" onPress={pickType} />
        {kind ? <>
          <SelectBox label="Categoria" value={area?.label} onPress={pickCategory} />
          {area?.subcategories.length > 0 && <SelectBox label="Subcategoria" hint="opcional" placeholder="Sem subcategoria"
            value={area.subcategories.find(item => item.key === form.subcategory)?.label} onPress={pickSubcategory} />}
        </> : null}
        {options}
      </>}
      {type === "event" && <>
        <Field label="Local" value={form.location} onChangeText={set("location")} maxLength={200} placeholder="Ilha de Luanda" />
        <Field label="Data" value={form.date} onChangeText={value => set("date")(mask(value, "date"))} keyboardType="number-pad" placeholder="DD/MM/AAAA" maxLength={10} />
        <Field label="Hora" value={form.time} onChangeText={value => set("time")(mask(value, "time"))} keyboardType="number-pad" placeholder="HH:MM" maxLength={5} />
      </>}
      <Notice error={error} />
      <Button label={TITLES[type] || "Criar"} onPress={create} busy={busy} disabled={!form.name.trim() || (type === "page" && !form.pageType) || (type === "group" && !form.groupType)} />
    </Card>
  </Page>;
}

