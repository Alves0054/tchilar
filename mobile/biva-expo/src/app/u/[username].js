import { useLocalSearchParams } from "expo-router";
import { ProfileView } from "../../components/ProfileView";
import { useSession } from "../../lib/session";

// Perfil de qualquer pessoa. Quando o @ é o da sessão, mostra o teu perfil (Editar perfil, Story)
// em vez de "Adicionar amigo / Seguir / Mensagem".
export default function UserProfile() {
  const { username } = useLocalSearchParams();
  const { user } = useSession();
  const name = String(username || "");
  const own = Boolean(user?.username) && user.username.toLowerCase() === name.toLowerCase();
  return <ProfileView key={name} username={name} own={own} />;
}
