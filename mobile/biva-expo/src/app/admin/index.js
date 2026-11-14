import { router } from "expo-router";
import { Text } from "react-native";
import { Badge, Card, Empty, Page, Row } from "../../components/ui";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

export const ROLE_LABELS = { super: "Administração total", finance: "Finanças", moderation: "Moderação" };
// As mesmas áreas do painel do site, por grupo. roles vazio = qualquer pessoa da equipa; "super" vê tudo.
export const ADMIN_SECTIONS = [
  ["Geral", [
    ["painel", "grid", "Painel", "O que está por fazer e os números", []],
    ["registo", "document-text", "Registo", "Tudo o que a equipa fez", ["super"]]
  ]],
  ["Dinheiro", [
    ["pagamentos", "card", "Pagamentos", "Confirmados, recibos e reembolsos", ["finance"]],
    ["por-resolver", "help-circle", "Por resolver", "Pagamentos que ficaram a meio", ["finance"]],
    ["levantamentos", "cash", "Levantamentos", "Pagar os criadores", ["finance"]],
    ["financas", "stats-chart", "Finanças", "Entradas e dívida aos criadores", ["finance"]]
  ]],
  ["Pessoas", [
    ["utilizadores", "people", "Utilizadores", "Procurar e ver a ficha", []],
    ["dados", "lock-closed", "Pedidos de dados", "Lei n.º 22/11", ["super"]],
    ["avisos", "megaphone", "Avisos", "Mensagens para toda a gente", ["super"]]
  ]],
  ["Conteúdo", [
    ["moderacao", "shield-checkmark", "Moderação", "Esconder sem esperar denúncias", ["moderation"]],
    ["denuncias", "flag", "Denúncias", "O que as pessoas denunciaram", ["moderation"]],
    ["promocoes", "rocket", "Promoções", "Aprovar ou recusar anúncios", ["finance", "moderation"]],
    ["musicas", "musical-notes", "Músicas", "Biblioteca com licença", ["moderation"]]
  ]]
];
export const canSee = (role, roles) => !roles.length || role === "super" || roles.includes(role);

export default function Admin() {
  const { user } = useSession();
  if (!user?.is_admin) return <Page><Empty text="Só a equipa do Tchilar tem acesso a esta área." icon="lock-closed-outline" /></Page>;
  const role = user.admin_role || "super";
  return <Page>
    <Card title="Administração" right={<Badge label={ROLE_LABELS[role]} tone="info" />}>
      <Text style={{ color: colors.muted }}>Para usar o painel tens de ter a verificação em dois passos ativa (Definições → Segurança).</Text>
    </Card>
    {ADMIN_SECTIONS.map(([group, items]) => {
      const visible = items.filter(([, , , , roles]) => canSee(role, roles));
      if (!visible.length) return null;
      return <Card key={group} title={group}>
        {visible.map(([slug, icon, title, subtitle]) => <Row key={slug} icon={icon} tone={colors.primary} title={title} subtitle={subtitle} onPress={() => router.push(`/admin/${slug}`)} />)}
      </Card>;
    })}
  </Page>;
}
