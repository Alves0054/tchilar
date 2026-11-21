// Chamada de voz ou vídeo num grupo (até 8 pessoas). O ecrã é o mesmo das mensagens (components/CallScreen.js).
import { useLocalSearchParams } from "expo-router";
import { CallScreen } from "../../components/CallScreen";
import { api } from "../../lib/api";

export default function GroupCall() {
  const { groupId, kind = "video", name = "Grupo" } = useLocalSearchParams();
  return <CallScreen title={name} kind={kind} base={`/groups/${groupId}/call`} webPath={`/groups/${groupId}`}
    start={wanted => api(`/groups/${groupId}/call`, { method: "POST", body: { kind: wanted } })} />;
}
