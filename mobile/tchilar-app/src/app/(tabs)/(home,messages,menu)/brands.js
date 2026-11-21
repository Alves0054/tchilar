import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "../../../components/Avatar";
import { CampaignList } from "../../../components/Campaigns";
import { Badge, Button, Card, Chips, Empty, Field, Loading, Notice, Page, count } from "../../../components/ui";
import { api } from "../../../lib/api";
import { colors } from "../../../lib/theme";
import { VerifiedBadge } from "../../../components/VerifiedBadge";

const FOLLOWERS = [["0", "Todos"], ["1000", "1 mil+"], ["10000", "10 mil+"], ["100000", "100 mil+"]];

function Propose({ creator, onDone }) {
  const [form, setForm] = useState({ title: "", brief: "", budget: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api("/campaigns", { method: "POST", body: { creatorId: creator.id, title: form.title, brief: form.brief, budget: Number(form.budget) } });
      onDone();
    } catch (sendError) { setError(sendError.message); } finally { setBusy(false); }
  };
  return <View style={{ gap: 10, paddingTop: 6 }}>
    <Field label="Título" value={form.title} onChangeText={title => setForm({ ...form, title })} maxLength={100} placeholder="Lançamento do novo sumo" />
    <Field label="O que pedes" value={form.brief} onChangeText={brief => setForm({ ...form, brief })} multiline maxLength={2000} placeholder="1 Reel e 3 stories a mostrar o produto…" />
    <Field label="Orçamento (Kz)" value={form.budget} onChangeText={budget => setForm({ ...form, budget: budget.replace(/[^\d]/g, "") })} keyboardType="number-pad" hint="Só pagas depois de o criador aceitar." />
    <Notice error={error} />
    <Button label="Enviar proposta" onPress={send} busy={busy} disabled={!form.title || !form.brief || !form.budget} />
  </View>;
}

// Marcas: encontrar criadores para campanhas pagas e acompanhar as propostas.
export default function Brands() {
  const [tab, setTab] = useState("find");
  const [filters, setFilters] = useState({ area: "", province: "", minFollowers: "0" });
  const [data, setData] = useState(null);
  const [proposing, setProposing] = useState(null);
  const [message, setMessage] = useState("");
  const load = useCallback(() => {
    const query = new URLSearchParams({ minFollowers: filters.minFollowers, ...(filters.area ? { area: filters.area } : {}), ...(filters.province ? { province: filters.province } : {}) });
    return api(`/creators?${query}`).then(setData).catch(() => setData({ creators: [], provinces: [] }));
  }, [filters]);
  useEffect(() => { if (tab === "find") load(); }, [tab, load]);

  return <Page>
    <Chips value={tab} onChange={setTab} options={[["find", "Encontrar criadores"], ["campaigns", "As minhas campanhas"]]} />
    {tab === "campaigns" ? <CampaignList /> : <>
      <Card title="Procura criadores" subtitle="Propõe uma campanha paga. O Tchilar fica com uma comissão quando a campanha é concluída.">
        <Field placeholder="Área (ex.: moda, culinária, humor)" value={filters.area} onChangeText={area => setFilters({ ...filters, area })} />
        <Chips value={filters.minFollowers} onChange={minFollowers => setFilters({ ...filters, minFollowers })} options={FOLLOWERS} />
        {data?.provinces?.length > 0 && <Chips value={filters.province} onChange={province => setFilters({ ...filters, province })}
          options={[["", "Todas as províncias"], ...data.provinces.map(name => [name, name])]} />}
      </Card>
      <Notice message={message} />
      {!data ? <Loading /> : data.creators.length === 0 ? <Empty text="Nenhum criador com estes filtros." icon="search-outline" />
        : data.creators.map(creator => <Card key={creator.id}>
          <Pressable style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={() => router.push(`/u/${creator.username}`)}>
            <Avatar user={creator} size={48} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={{ color: colors.text, fontWeight: "800", fontSize: 16, flexShrink: 1 }}>{creator.display_name}</Text><VerifiedBadge show={creator.is_verified} tier={creator.verification_tier} /></View>
              <Text style={{ color: colors.muted }}>{[creator.profession, creator.province].filter(Boolean).join(" · ") || `@${creator.username}`}</Text>
            </View>
            <Badge label={`${count(creator.followers)} seguidores`} tone="info" />
          </Pressable>
          {Boolean(creator.bio) && <Text numberOfLines={3} style={{ color: colors.text }}>{creator.bio}</Text>}
          {proposing === creator.id
            ? <Propose creator={creator} onDone={() => { setProposing(null); setMessage(`Proposta enviada a ${creator.display_name}.`); }} />
            : <Button small label="Propor campanha" icon="briefcase" onPress={() => setProposing(creator.id)} />}
        </Card>)}
    </>}
  </Page>;
}
