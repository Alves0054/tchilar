import { router } from "expo-router";
import { Card, Page, Row } from "../../components/ui";
import { colors } from "../../lib/theme";

// As mesmas áreas das Definições do site.
export const SETTINGS_SECTIONS = [
  ["perfil", "person-circle", "Perfil", "Nome, foto, biografia e contactos", colors.primary],
  ["conta", "mail", "Conta", "Email, tipo de conta e apagar conta", "#2EAA6B"],
  ["seguranca", "shield-checkmark", "Segurança", "Palavra-passe, dois passos e sessões", "#E8890C"],
  ["privacidade", "lock-closed", "Privacidade", "Mensagens, comentários, atividade e bloqueios", "#8E44AD"],
  ["aparencia", "contrast", "Aparência", "Tema claro ou escuro", "#5E5CE6"],
  ["notificacoes", "notifications", "Notificações", "Escolhe sobre o que te avisamos", colors.accent],
  ["pagamentos", "card", "Pagamentos e recibos", "O que pagaste e os recibos", colors.secondary],
  ["dados", "folder-open", "Os teus dados", "Pedidos à equipa (Lei n.º 22/11)", "#8E8E93"]
];

export default function Settings() {
  return <Page>
    <Card>
      {SETTINGS_SECTIONS.map(([key, icon, title, subtitle, tone]) =>
        <Row key={key} icon={icon} tone={tone} title={title} subtitle={subtitle} onPress={() => router.push(`/settings/${key}`)} />)}
      <Row icon="help-circle" tone={colors.muted} title="Ajuda e informação" subtitle="Perguntas frequentes, termos e privacidade" onPress={() => router.push("/help")} />
    </Card>
  </Page>;
}
