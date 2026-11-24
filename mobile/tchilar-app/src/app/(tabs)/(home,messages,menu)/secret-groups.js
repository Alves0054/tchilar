import { router } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { PaymentSheet } from "../../../components/PaymentSheet";
import { Badge, Button, Card, Empty, Field, Notice, Page, kz } from "../../../components/ui";
import { api } from "../../../lib/api";
import { colors } from "../../../lib/theme";

// Grupos secretos, como no site: não aparecem em lista nenhuma. Só se encontram pelo nome exato,
// só para maiores de 18 anos, e entra-se pagando a entrada definida pelo dono.
export default function SecretGroups() {
  const [name, setName] = useState("");
  const [result, setResult] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({});

  const search = async () => {
    setBusy(true); setNotice({});
    try { setResult(await api(`/groups/secret?name=${encodeURIComponent(name.trim())}`)); } catch (error) { setNotice({ error: error.message }); } finally { setBusy(false); }
  };
  const viewer = result?.viewer;

  return <Page>
    <Card title="Entrar num grupo secreto" subtitle="Escreve o nome exato que te deram. Os grupos secretos não aparecem em nenhuma lista.">
      <Field placeholder="Nome do grupo" value={name} onChangeText={setName} autoCapitalize="none" onSubmitEditing={search} returnKeyType="search" />
      <Button label="Procurar" icon="search" onPress={search} busy={busy} disabled={name.trim().length < 3} />
      <Notice {...notice} />
    </Card>
    {viewer && !viewer.adult && <Card>
      <Text style={{ color: colors.text }}>{viewer.hasBirthDate ? "Os grupos secretos são só para maiores de 18 anos." : "Confirma a tua data de nascimento no site para entrar em grupos secretos."}</Text>
    </Card>}
    {viewer?.adult && result.groups.length === 0 && <Empty text="Nenhum grupo com esse nome. Confirma o nome exato com quem te convidou." icon="lock-closed-outline" />}
    {result?.groups.map(group => <Card key={group.id} title={group.name} subtitle={`Criado por ${group.owner_name} · ${group.member_count} membros`} right={<Badge label="Secreto" tone="warning" />}>
      {Boolean(group.description) && <Text style={{ color: colors.text }}>{group.description}</Text>}
      {group.is_member
        ? <Button label="Abrir o grupo" onPress={() => router.push(`/group/${group.id}`)} />
        : <Button label={group.access_billing === "monthly" ? `Pagar mensalidade · ${kz(group.access_price)}/mês` : `Pagar entrada · ${kz(group.access_price)}`}
          icon="lock-open" onPress={() => setPaying(group)} />}
    </Card>)}
    <PaymentSheet visible={Boolean(paying)} title={paying ? (paying.access_billing === "monthly" ? `Mensalidade de ${paying.name} (1 mês)` : `Entrada em ${paying.name}`) : ""} amount={paying?.access_price} purpose="group_access" onClose={() => setPaying(null)}
      start={choice => api(`/groups/${paying.id}/access`, { method: "POST", body: { name: paying.name, ...choice } })}
      onPaid={() => { const id = paying.id; setPaying(null); router.push(`/group/${id}`); }} />
  </Page>;
}
