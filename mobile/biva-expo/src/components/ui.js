// Peças comuns dos ecrãs: página com "puxar para atualizar", cartões, números, botões, campos e filtros.
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../lib/theme";

export const kz = value => `${Number(value || 0).toLocaleString("pt-PT", { maximumFractionDigits: 2 })} Kz`;
export const count = value => Number(value || 0).toLocaleString("pt-PT");
export const dateTime = value => value ? new Date(value).toLocaleString("pt-PT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const dateOnly = value => value ? new Date(value).toLocaleDateString("pt-PT", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function Page({ children, refreshing = false, onRefresh, padded = true }) {
  return <ScrollView contentContainerStyle={[styles.page, !padded && { padding: 0 }]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic"
    refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}>
    {children}
  </ScrollView>;
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
}

export function Card({ title, subtitle, right, children, style }) {
  return <View style={[styles.card, style]}>
    {(title || right) && <View style={styles.cardHead}>
      <View style={{ flex: 1 }}>
        {title && <Text style={styles.cardTitle}>{title}</Text>}
        {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>}
    {children}
  </View>;
}

export function Stats({ items }) {
  return <View style={styles.stats}>{items.filter(Boolean).map(([label, value, hint]) => <View key={label} style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
    {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
  </View>)}</View>;
}

export function Button({ label, onPress, variant = "primary", icon, disabled, busy, small }) {
  const variants = { primary: styles.btnPrimary, secondary: styles.btnSecondary, danger: styles.btnDanger, ghost: styles.btnGhost };
  const textColor = variant === "primary" || variant === "danger" ? "#fff" : colors.primary;
  return <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
    style={[styles.btn, small && styles.btnSmall, variants[variant], (disabled || busy) && { opacity: 0.5 }]}>
    {busy ? <ActivityIndicator color={textColor} /> : <>
      {icon && <Ionicons name={icon} size={small ? 15 : 18} color={textColor} />}
      <Text style={[styles.btnText, small && { fontSize: 13 }, { color: textColor }]}>{label}</Text>
    </>}
  </Pressable>;
}

export function Field({ label, hint, ...props }) {
  return <View style={styles.field}>
    {label && <Text style={styles.fieldLabel}>{label}</Text>}
    <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.multiline && styles.inputMulti, props.style]} />
    {hint && <Text style={styles.fieldHint}>{hint}</Text>}
  </View>;
}

export function Chips({ options, value, onChange }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {options.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.chip, value === key && styles.chipActive]}>
      <Text style={[styles.chipText, value === key && styles.chipTextActive]}>{label}</Text>
    </Pressable>)}
  </ScrollView>;
}

export function Row({ icon, title, subtitle, right, onPress, tone }) {
  const Wrapper = onPress ? Pressable : View;
  return <Wrapper style={styles.row} onPress={onPress}>
    {icon && <View style={[styles.rowIcon, tone && { backgroundColor: `${tone}1F` }]}><Ionicons name={icon} size={20} color={tone || colors.text} /></View>}
    <View style={{ flex: 1 }}>
      <Text style={styles.rowTitle}>{title}</Text>
      {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
    </View>
    {right}
    {onPress && !right && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
  </Wrapper>;
}

export function Badge({ label, tone = "neutral" }) {
  const tones = { neutral: [colors.background, colors.text], good: ["#E3F6EC", "#1E7A4B"], warning: ["#FFF1DC", "#9A5B00"], danger: ["#FDE7E7", colors.danger], info: [colors.primarySoft, colors.primary] };
  const [bg, fg] = tones[tone] || tones.neutral;
  return <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: fg }]}>{label}</Text></View>;
}

export function Notice({ error, message }) {
  if (!error && !message) return null;
  return <View style={[styles.notice, error ? styles.noticeError : styles.noticeOk]}>
    <Ionicons name={error ? "alert-circle" : "checkmark-circle"} size={18} color={error ? colors.danger : "#1E7A4B"} />
    <Text style={[styles.noticeText, { color: error ? colors.danger : "#1E7A4B" }]}>{error || message}</Text>
  </View>;
}

export function Empty({ text, icon = "file-tray-outline" }) {
  return <View style={styles.empty}><Ionicons name={icon} size={28} color={colors.muted} /><Text style={styles.emptyText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: 12, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  cardSubtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "45%", backgroundColor: colors.background, borderRadius: 12, padding: 12, gap: 2 },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "800" },
  statHint: { color: colors.muted, fontSize: 11 },
  btn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 46, paddingHorizontal: 18, borderRadius: 23 },
  btnSmall: { height: 34, paddingHorizontal: 12, borderRadius: 17 },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: colors.primarySoft },
  btnDanger: { backgroundColor: colors.danger },
  btnGhost: { backgroundColor: "transparent" },
  btnText: { fontWeight: "800", fontSize: 15 },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontWeight: "700" },
  fieldHint: { color: colors.muted, fontSize: 12 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: colors.background },
  inputMulti: { minHeight: 96, textAlignVertical: "top" },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  rowSubtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "800" },
  notice: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 12 },
  noticeError: { backgroundColor: "#FDE7E7" },
  noticeOk: { backgroundColor: "#E3F6EC" },
  noticeText: { flex: 1, fontWeight: "600" },
  empty: { alignItems: "center", gap: 8, padding: 24 },
  emptyText: { color: colors.muted, textAlign: "center" }
});
