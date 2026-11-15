// Folha de opções que sobe de baixo (como no iOS e no Android). O Alert do Android só aceita 3 botões.
// Também serve de "caixa de seleção": listas compridas fazem scroll, podem ter títulos de grupo e marcam a escolha atual.
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";

export function useOptions() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  // options: [{ key, label, icon, danger, section }]; selected: a chave escolhida agora (fica com ✓).
  const choose = (title, options, selected) => new Promise(resolve => { resolver.current = resolve; setState({ title, options, selected }); });
  const finish = key => { setState(null); resolver.current?.(key); };
  const element = <Modal visible={Boolean(state)} transparent animationType="slide" onRequestClose={() => finish(null)}>
    <Pressable style={styles.backdrop} onPress={() => finish(null)}>
      <Pressable style={styles.sheet}>
        {state?.title ? <Text style={styles.title}>{state.title}</Text> : null}
        <ScrollView style={styles.list} bounces={false}>
          {state?.options.map((option, index) => {
            const active = state.selected !== undefined && option.key === state.selected;
            const header = option.section && option.section !== state.options[index - 1]?.section;
            return <View key={option.key}>
              {header ? <Text style={styles.section}>{option.section}</Text> : null}
              <Pressable style={[styles.option, active && styles.optionActive]} onPress={() => finish(option.key)}
                accessibilityRole="button" accessibilityState={{ selected: active }}>
                {option.icon && <Ionicons name={option.icon} size={22} color={option.danger ? colors.danger : colors.text} />}
                <Text style={[styles.label, option.danger && { color: colors.danger }]}>{option.label}</Text>
                {active && <Ionicons name="checkmark" size={20} color={colors.text} />}
              </Pressable>
            </View>;
          })}
        </ScrollView>
        <Pressable style={[styles.option, styles.cancel]} onPress={() => finish(null)}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
  return [element, choose];
}

// Caixa de seleção: mostra a escolha atual e abre a folha de opções ao tocar.
export function SelectBox({ label, hint, value, placeholder = "Escolher", icon, onPress, disabled }) {
  return <View style={{ gap: 6 }}>
    {label ? <Text style={styles.boxLabel}>{label}{hint ? <Text style={styles.boxHint}> ({hint})</Text> : null}</Text> : null}
    <Pressable style={[styles.box, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`}>
      {icon ? <Ionicons name={icon} size={20} color={colors.text} /> : null}
      <Text style={[styles.boxValue, !value && { color: colors.muted }]} numberOfLines={1}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.muted} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(3,35,58,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 12, paddingBottom: 30, maxHeight: "80%" },
  list: { flexGrow: 0 },
  title: { color: colors.muted, textAlign: "center", padding: 8, fontWeight: "700" },
  section: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12 },
  optionActive: { backgroundColor: colors.background },
  label: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  cancel: { justifyContent: "center", marginTop: 6, backgroundColor: colors.background },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: "800" },
  boxLabel: { color: colors.text, fontWeight: "700" },
  boxHint: { color: colors.muted, fontWeight: "500" },
  box: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.line },
  boxValue: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" }
});

export const REPORT_REASONS = [
  ["spam", "Spam ou publicidade enganosa"], ["harassment", "Assédio ou bullying"], ["hate", "Discurso de ódio"],
  ["violence", "Violência ou ameaças"], ["sexual", "Conteúdo sexual"], ["self_harm", "Automutilação ou suicídio"],
  ["false_info", "Informação falsa"], ["impersonation", "Está a fazer-se passar por outra pessoa"], ["other", "Outro motivo"]
];
