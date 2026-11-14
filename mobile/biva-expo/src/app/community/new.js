import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Chips, Field, Notice, Page } from "../../components/ui";
import { api } from "../../lib/api";
import catalog from "../../lib/community-types.json";
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
  const [form, setForm] = useState({ name: "", description: "", topic: "geral", privacy: "public", accessPrice: "", pageType: catalog.pageTypes[0].key, category: catalog.pageTypes[0].categories[0].key, location: "", date: "", time: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const pageType = catalog.pageTypes.find(item => item.key === form.pageType);

  const create = async () => {
    setBusy(true); setError("");
    try {
      if (type === "group") {
        const result = await api("/groups", { method: "POST", body: { name: form.name, description: form.description, topic: form.topic, privacy: form.privacy,
          ...(form.privacy === "secret" ? { accessPrice: Number(form.accessPrice) } : {}) } });
        router.replace(`/group/${result.group.id}`);
      } else if (type === "page") {
        const result = await api("/pages", { method: "POST", body: { name: form.name, description: form.description, pageType: form.pageType, category: form.category } });
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
        <Text style={{ color: colors.text, fontWeight: "700" }}>Tema</Text>
        <Chips value={form.topic} onChange={set("topic")} options={catalog.groupTopics.map(topic => [topic.key, topic.label])} />
        <Text style={{ color: colors.text, fontWeight: "700" }}>Quem pode entrar</Text>
        <Chips value={form.privacy} onChange={set("privacy")} options={catalog.groupPrivacy.map(option => [option.key, option.label])} />
        <Text style={{ color: colors.muted }}>{catalog.groupPrivacy.find(option => option.key === form.privacy)?.help}</Text>
        {form.privacy === "secret" && <Field label="Preço de entrada (Kz)" value={form.accessPrice} onChangeText={value => set("accessPrice")(value.replace(/[^\d]/g, ""))} keyboardType="number-pad"
          hint="Só maiores de 18 anos. Os membros pagam para entrar; recebes uma parte." />}
      </>}
      {type === "page" && <>
        <Text style={{ color: colors.text, fontWeight: "700" }}>Tipo de página</Text>
        <Chips value={form.pageType} onChange={key => setForm(current => ({ ...current, pageType: key, category: catalog.pageTypes.find(item => item.key === key).categories[0].key }))}
          options={catalog.pageTypes.map(item => [item.key, item.label])} />
        <Text style={{ color: colors.text, fontWeight: "700" }}>Categoria</Text>
        <Chips value={form.category} onChange={set("category")} options={pageType.categories.map(item => [item.key, item.label])} />
      </>}
      {type === "event" && <>
        <Field label="Local" value={form.location} onChangeText={set("location")} maxLength={200} placeholder="Ilha de Luanda" />
        <Field label="Data" value={form.date} onChangeText={value => set("date")(mask(value, "date"))} keyboardType="number-pad" placeholder="DD/MM/AAAA" maxLength={10} />
        <Field label="Hora" value={form.time} onChangeText={value => set("time")(mask(value, "time"))} keyboardType="number-pad" placeholder="HH:MM" maxLength={5} />
      </>}
      <Notice error={error} />
      <Button label={TITLES[type] || "Criar"} onPress={create} busy={busy} disabled={!form.name.trim()} />
    </Card>
  </Page>;
}
