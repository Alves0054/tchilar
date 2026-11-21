// Campanhas entre marcas e criadores: recebidas (criador aceita/recusa) e enviadas (marca paga, cancela, conclui).
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { api } from "../lib/api";
import { colors } from "../lib/theme";
import { PaymentSheet } from "./PaymentSheet";
import { Badge, Button, Card, Chips, Empty, Loading, Notice, dateOnly, kz } from "./ui";

const STATUS = {
  proposed: ["Proposta", "info"], accepted: ["Aceite: falta pagar", "warning"], declined: ["Recusada", "neutral"],
  paid: ["Paga: a decorrer", "good"], completed: ["Concluída", "good"], cancelled: ["Cancelada", "neutral"]
};

export function CampaignList() {
  const [data, setData] = useState(null);
  const [side, setSide] = useState("received");
  const [paying, setPaying] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => api("/campaigns").then(setData).catch(loadError => setError(loadError.message)), []);
  useEffect(() => { load(); }, [load]);

  const act = (campaign, action, confirmText) => Alert.alert("Campanha", confirmText, [
    { text: "Não", style: "cancel" },
    { text: "Sim", onPress: async () => {
      setError(""); setMessage("");
      try { await api(`/campaigns/${campaign.id}/${action}`, { method: "POST" }); setMessage("Feito."); load(); } catch (actError) { setError(actError.message); }
    } }
  ]);

  if (!data) return error ? <Notice error={error} /> : <Loading />;
  const list = data[side];
  return <View style={{ gap: 12 }}>
    <Chips value={side} onChange={setSide} options={[["received", `Recebidas (${data.received.length})`], ["sent", `Enviadas (${data.sent.length})`]]} />
    <Notice error={error} message={message} />
    {list.length === 0 && <Empty text={side === "received" ? "Ainda não recebeste propostas de marcas." : "Ainda não enviaste propostas. Procura criadores em Marcas."} icon="briefcase-outline" />}
    {list.map(campaign => {
      const [label, tone] = STATUS[campaign.status] || [campaign.status, "neutral"];
      const other = side === "received" ? campaign.brand_name : campaign.creator_name;
      return <Card key={campaign.id} title={campaign.title} subtitle={`${side === "received" ? "De" : "Para"} ${other} · ${dateOnly(campaign.created_at)}`} right={<Badge label={label} tone={tone} />}>
        <Text style={{ color: colors.text, lineHeight: 20 }}>{campaign.brief}</Text>
        <Text style={{ color: colors.muted }}>Orçamento {kz(campaign.budget)} · {side === "received" ? `recebes ${kz(campaign.net)}` : `comissão do Tchilar ${kz(campaign.commission)}`}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {side === "received" && campaign.status === "proposed" && <>
            <Button small label="Aceitar" onPress={() => act(campaign, "accept", "Aceitar esta campanha? A marca vai poder pagar.")} />
            <Button small variant="secondary" label="Recusar" onPress={() => act(campaign, "decline", "Recusar esta proposta?")} />
          </>}
          {side === "sent" && campaign.status === "accepted" && <Button small label={`Pagar ${kz(campaign.budget)}`} onPress={() => setPaying(campaign)} />}
          {side === "sent" && ["proposed", "accepted"].includes(campaign.status) && <Button small variant="secondary" label="Cancelar" onPress={() => act(campaign, "cancel", "Cancelar esta proposta?")} />}
          {side === "sent" && campaign.status === "paid" && <Button small label="Confirmar entrega" onPress={() => act(campaign, "complete", "O criador entregou o trabalho? Ao confirmar, o pagamento passa para o criador.")} />}
        </View>
      </Card>;
    })}
    <PaymentSheet visible={Boolean(paying)} title={paying ? `Campanha: ${paying.title}` : ""} amount={paying?.budget} purpose="campaign" onClose={() => setPaying(null)}
      start={choice => api(`/campaigns/${paying.id}/pay`, { method: "POST", body: choice })}
      onPaid={() => { setPaying(null); setMessage("Campanha paga. O criador já pode começar."); load(); }} />
  </View>;
}
