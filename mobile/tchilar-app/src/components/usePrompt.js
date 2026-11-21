// Janela para pedir um texto (motivo, referência, nota). O Alert.prompt do React Native só existe no iOS.
import { useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/theme";
import { Button, Field } from "./ui";

export function usePrompt() {
  const [state, setState] = useState(null);
  const [value, setValue] = useState("");
  const resolver = useRef(null);
  const ask = ({ title, message, placeholder = "", initial = "", confirmLabel = "Confirmar", optional = false, keyboardType }) => new Promise(resolve => {
    resolver.current = resolve;
    setValue(initial);
    setState({ title, message, placeholder, confirmLabel, optional, keyboardType });
  });
  const finish = result => { setState(null); resolver.current?.(result); };
  const element = <Modal visible={Boolean(state)} transparent animationType="fade" onRequestClose={() => finish(null)}>
    <View style={styles.backdrop}>
      <View style={styles.box}>
        <Text style={styles.title}>{state?.title}</Text>
        {state?.message ? <Text style={styles.message}>{state.message}</Text> : null}
        <Field value={value} onChangeText={setValue} placeholder={state?.placeholder} autoFocus multiline={!state?.keyboardType} keyboardType={state?.keyboardType} />
        <View style={styles.actions}>
          <View style={{ flex: 1 }}><Button variant="secondary" label="Cancelar" onPress={() => finish(null)} /></View>
          <View style={{ flex: 1 }}><Button label={state?.confirmLabel || "Confirmar"} disabled={!state?.optional && !value.trim()} onPress={() => finish(value.trim())} /></View>
        </View>
      </View>
    </View>
  </Modal>;
  return [element, ask];
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(3,35,58,0.5)" },
  box: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  message: { color: colors.muted },
  actions: { flexDirection: "row", gap: 10 }
});
