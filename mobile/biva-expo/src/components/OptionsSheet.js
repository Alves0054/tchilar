// Folha de opções que sobe de baixo (como no iOS e no Android). O Alert do Android só aceita 3 botões.
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../lib/theme";

export function useOptions() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  // options: [{ key, label, icon, danger }]
  const choose = (title, options) => new Promise(resolve => { resolver.current = resolve; setState({ title, options }); });
  const finish = key => { setState(null); resolver.current?.(key); };
  const element = <Modal visible={Boolean(state)} transparent animationType="slide" onRequestClose={() => finish(null)}>
    <Pressable style={styles.backdrop} onPress={() => finish(null)}>
      <Pressable style={styles.sheet}>
        {state?.title ? <Text style={styles.title}>{state.title}</Text> : null}
        {state?.options.map(option => <Pressable key={option.key} style={styles.option} onPress={() => finish(option.key)}>
          {option.icon && <Ionicons name={option.icon} size={22} color={option.danger ? colors.danger : colors.text} />}
          <Text style={[styles.label, option.danger && { color: colors.danger }]}>{option.label}</Text>
        </Pressable>)}
        <Pressable style={[styles.option, styles.cancel]} onPress={() => finish(null)}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
  return [element, choose];
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(3,35,58,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30 },
  title: { color: colors.muted, textAlign: "center", padding: 8, fontWeight: "700" },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12 },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cancel: { justifyContent: "center", marginTop: 6, backgroundColor: colors.background },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: "800" }
});

export const REPORT_REASONS = [
  ["spam", "Spam ou publicidade enganosa"], ["harassment", "Assédio ou bullying"], ["hate", "Discurso de ódio"],
  ["violence", "Violência ou ameaças"], ["sexual", "Conteúdo sexual"], ["self_harm", "Automutilação ou suicídio"],
  ["false_info", "Informação falsa"], ["impersonation", "Está a fazer-se passar por outra pessoa"], ["other", "Outro motivo"]
];
