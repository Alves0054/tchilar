// Calendário do Tchilar na app (igual ao do site, src/modules/date-picker.jsx): um campo que abre o mês por baixo,
// com atalhos (Hoje, Amanhã, Sábado), o mês em grelha e a hora. Feito em JavaScript (funciona no Expo Go, sem
// módulos nativos). value/onChange: "AAAA-MM-DDTHH:MM" (hora local), "" quando vazio.
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../lib/theme";

const RED = "#E30613";
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];
const MINUTES = ["00", "15", "30", "45"];
const pad = number => String(number).padStart(2, "0");
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = text => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
};
const timeOf = text => (/T(\d{2}:\d{2})/.exec(text || "") || [])[1] || "";

// "AAAA-MM-DDTHH:MM" local de agora + minutos (para o mínimo de um evento).
export const localDateTime = (offsetMinutes = 0) => {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function formatDateTime(value) {
  const day = parseDay(value);
  if (!day) return "";
  const text = day.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  const time = timeOf(value);
  const full = time ? `${text} · ${time}` : text;
  return full[0].toUpperCase() + full.slice(1);
}

export function DateTimeField({ value, onChange, min = "", defaultTime = "18:00", placeholder = "Escolhe o dia e a hora", label = "Dia e hora" }) {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value);
  const minDay = parseDay(min);
  const [view, setView] = useState(() => selected || new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const compose = (day, time) => {
    let next = `${dayKey(day)}T${time || timeOf(value) || defaultTime}`;
    if (min && next < min.slice(0, 16)) {
      const [hours, minutes] = timeOf(min).split(":").map(Number);
      const rounded = Math.ceil((hours * 60 + minutes) / 15) * 15;
      if (rounded < 24 * 60) next = `${dayKey(day)}T${pad(Math.floor(rounded / 60))}:${pad(rounded % 60)}`;
    }
    return next;
  };
  const isOff = day => Boolean(minDay && day < minDay);
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(view.getFullYear(), view.getMonth(), index - offset + 1));
  }, [view]);
  const shift = step => setView(current => new Date(current.getFullYear(), current.getMonth() + step, 1));
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const saturday = new Date(today); saturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
  const quick = [["Hoje", today], ["Amanhã", tomorrow], ["Sábado", saturday]].filter(([, day]) => !isOff(day));
  const [hours, minutes] = (timeOf(value) || defaultTime).split(":");
  const setTime = (nextHours, nextMinutes) => selected && onChange(compose(selected, `${nextHours}:${nextMinutes}`));

  return <>
    <Pressable style={styles.field} onPress={() => { setView(selected || minDay || new Date()); setOpen(true); }} accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatDateTime(value) || placeholder}`}>
      <Ionicons name="calendar-outline" size={18} color={colors.text} />
      <Text style={[styles.fieldText, !value && { color: colors.muted }]} numberOfLines={1}>{formatDateTime(value) || placeholder}</Text>
      <Ionicons name="chevron-down" size={16} color={colors.text} />
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}><Text style={styles.done}>{selected ? "Feito" : "Fechar"}</Text></Pressable>
          </View>
          {quick.length > 0 && <View style={styles.quick}>{quick.map(([name, day]) => {
            const on = selected && dayKey(selected) === dayKey(day);
            return <Pressable key={name} style={[styles.quickBtn, on && styles.quickOn]} onPress={() => { setView(day); onChange(compose(day)); }}>
              <Text style={[styles.quickText, on && { color: "#fff" }]}>{name}</Text></Pressable>;
          })}</View>}
          <View style={styles.monthHead}>
            <Pressable style={styles.nav} onPress={() => shift(-1)} accessibilityLabel="Mês anterior"><Ionicons name="chevron-back" size={18} color={colors.text} /></Pressable>
            <Text style={styles.monthTitle}>{MONTHS[view.getMonth()][0].toUpperCase() + MONTHS[view.getMonth()].slice(1)} {view.getFullYear()}</Text>
            <Pressable style={styles.nav} onPress={() => shift(1)} accessibilityLabel="Mês seguinte"><Ionicons name="chevron-forward" size={18} color={colors.text} /></Pressable>
          </View>
          <View style={styles.grid}>
            {WEEKDAYS.map((day, index) => <Text key={index} style={[styles.weekday, index >= 5 && { color: RED }]}>{day}</Text>)}
            {cells.map(day => {
              const key = dayKey(day);
              const outside = day.getMonth() !== view.getMonth();
              const chosen = selected && key === dayKey(selected);
              const off = isOff(day);
              return <Pressable key={key} disabled={off} onPress={() => onChange(compose(day))} style={styles.cell}
                accessibilityLabel={day.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" })} accessibilityState={{ selected: Boolean(chosen), disabled: off }}>
                <View style={[styles.day, key === dayKey(today) && styles.today, chosen && styles.dayOn]}>
                  <Text style={[styles.dayText, outside && { opacity: 0.45 }, off && { opacity: 0.25 }, chosen && { color: "#fff", fontWeight: "800" }]}>{day.getDate()}</Text>
                </View>
              </Pressable>;
            })}
          </View>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}><Ionicons name="time-outline" size={15} color={colors.text} /> Hora {selected ? "" : "(escolhe primeiro o dia)"}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {Array.from({ length: 24 }, (_, hour) => pad(hour)).map(hour => <Pressable key={hour} disabled={!selected} onPress={() => setTime(hour, minutes)}
                style={[styles.timeChip, hour === hours && selected && styles.timeOn, !selected && { opacity: 0.4 }]}>
                <Text style={[styles.timeText, hour === hours && selected && { color: "#fff" }]}>{hour}h</Text></Pressable>)}
            </ScrollView>
            <View style={styles.quick}>{MINUTES.map(minute => <Pressable key={minute} disabled={!selected} onPress={() => setTime(hours, minute)}
              style={[styles.quickBtn, minute === minutes && selected && styles.quickOn, !selected && { opacity: 0.4 }]}>
              <Text style={[styles.quickText, minute === minutes && selected && { color: "#fff" }]}>:{minute}</Text></Pressable>)}</View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  fieldText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.surface },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  done: { color: RED, fontSize: 15, fontWeight: "800" },
  quick: { flexDirection: "row", gap: 6 },
  quickBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  quickOn: { borderColor: "#0B0B0C", backgroundColor: "#0B0B0C" },
  quickText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  nav: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: `${100 / 7}%`, textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "800", paddingVertical: 4 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  day: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  today: { borderWidth: 1.5, borderColor: colors.text },
  dayOn: { backgroundColor: RED, borderColor: RED },
  dayText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  timeBlock: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  timeLabel: { color: colors.text, fontSize: 14, fontWeight: "800" },
  timeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  timeOn: { backgroundColor: RED, borderColor: RED },
  timeText: { color: colors.text, fontSize: 13, fontWeight: "700" }
});
