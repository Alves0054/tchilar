// Chamada a partir das mensagens: ligar a alguém (/call/direct/new?to=…) ou atender (/call/direct/:id).
// Durante a chamada dá para adicionar mais pessoas, até 8.
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { CallScreen } from "../../../components/CallScreen";
import { api } from "../../../lib/api";

export default function DirectCall() {
  const { callId, to, kind = "video", name = "Chamada" } = useLocalSearchParams();
  const [id, setId] = useState(callId === "new" ? null : callId);
  const idRef = useRef(id);
  const start = async wanted => {
    if (idRef.current) return api(`/calls/${idRef.current}/join`, { method: "POST", body: {} });
    const result = await api("/calls", { method: "POST", body: { to: [Number(to)], kind: wanted } });
    idRef.current = String(result.call.id);
    setId(idRef.current);
    return result;
  };
  return <CallScreen title={name} kind={kind} direct base={id ? `/calls/${id}` : "/calls/pending"} start={start}
    webPath={to ? `/messages/${to}` : "/messages"} />;
}
