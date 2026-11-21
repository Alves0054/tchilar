import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PHONE_COUNTRIES, phoneCountry } from "../lib/phones";
import { colors } from "../lib/theme";

// País (bandeira + indicativo, abre a lista dos países da CPLP) + número de telemóvel.
export default function PhoneInput({ country, onCountryChange, value, onChangeText, placeholder = "Telemóvel", editable = true, inputStyle }) {
  const [choosing, setChoosing] = useState(false);
  const chosen = phoneCountry(country);
  return <View style={styles.row}>
    <Pressable style={[styles.country, inputStyle && { height: inputStyle.height }]} onPress={() => setChoosing(true)} disabled={!editable}
      accessibilityRole="button" accessibilityLabel={`País do telemóvel: ${chosen.name}, indicativo +${chosen.dial}. Toca para mudar.`}>
      <Text style={styles.countryText}>{chosen.flag} +{chosen.dial}</Text>
      <Text style={styles.chevron}>▾</Text>
    </Pressable>
    <TextInput style={[styles.input, inputStyle, styles.inputFlex]} placeholderTextColor={colors.muted}
      placeholder={`${placeholder} (ex.: ${chosen.example})`} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
      value={value} onChangeText={onChangeText} maxLength={20} editable={editable} />
    <Modal visible={choosing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChoosing(false)}>
      <SafeAreaView style={styles.sheet} edges={["top", "bottom"]}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>País do telemóvel</Text>
          <Pressable onPress={() => setChoosing(false)} accessibilityRole="button" hitSlop={10}><Text style={styles.close}>Fechar</Text></Pressable>
        </View>
        <FlatList data={PHONE_COUNTRIES} keyExtractor={item => item.code} ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => <Pressable style={styles.option} accessibilityRole="button" accessibilityState={{ selected: item.code === chosen.code }}
            onPress={() => { onCountryChange(item.code); setChoosing(false); }}>
            <Text style={styles.flag}>{item.flag}</Text>
            <Text style={styles.optionName}>{item.name}</Text>
            <Text style={styles.optionDial}>+{item.dial}</Text>
            {item.code === chosen.code && <Text style={styles.check}>✓</Text>}
          </Pressable>} />
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  country: { height: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line,
    borderRadius: 14, backgroundColor: colors.background },
  countryText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  chevron: { color: colors.muted, fontSize: 12 },
  input: { height: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.background },
  inputFlex: { flex: 1, minWidth: 0 },
  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  close: { color: colors.accent, fontSize: 16, fontWeight: "700" },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 15 },
  flag: { fontSize: 24 },
  optionName: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  optionDial: { color: colors.muted, fontSize: 15 },
  check: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 54 }
});
