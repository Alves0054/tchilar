import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../components/Avatar";
import { Badge, Button, Card, Empty, Loading, Notice, Page, count } from "../../../../components/ui";
import { WEB_URL, api } from "../../../../lib/api";
import { colors, relativeTime } from "../../../../lib/theme";
import { VerifiedBadge } from "../../../../components/VerifiedBadge";

// Diretos agora: quem está ao vivo, por número de pessoas a ver. Atualiza a cada 15 s.
export default function Lives() {
  const [lives, setLives] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api("/lives").then(result => { setLives(result.lives); setError(""); }).catch(loadError => setError(loadError.message)).finally(() => setRefreshing(false)), []);
  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]));

  return <Page refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
    <Card title="Entrar em direto" subtitle="Transmite com a câmara do telemóvel. Quem te segue recebe um aviso.">
      <Button label="Entrar em direto" icon="radio" onPress={() => router.push("/live/new")} />
      <Button variant="ghost" label="Usar o estúdio do site ou o OBS" onPress={() => Linking.openURL(`${WEB_URL}/live`)} />
    </Card>
    <Notice error={error} />
    {!lives ? <Loading /> : lives.length === 0 ? <Empty text="Ninguém está em direto agora." icon="radio-outline" />
      : lives.map(live => <Pressable key={live.id} onPress={() => router.push(`/live/${live.id}`)}>
        <Card>
          <View style={styles.cover}>
            <Avatar user={live} size={72} />
            <View style={styles.liveTag}><Text style={styles.liveText}>AO VIVO</Text></View>
            <Text style={styles.viewers}>👁 {count(live.viewers)}</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{live.title}</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={styles.host}>{live.display_name}</Text><VerifiedBadge show={live.is_verified} tier={live.verification_tier} size={14} /></View>
            <Text style={styles.muted}>· começou {relativeTime(live.started_at)}</Text>
            {live.stars > 0 && <Badge label={`★ ${count(live.stars)}`} tone="warning" />}
          </View>
        </Card>
      </Pressable>)}
  </Page>;
}

const styles = StyleSheet.create({
  cover: { height: 150, borderRadius: 14, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  liveTag: { position: "absolute", top: 10, left: 10, backgroundColor: colors.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  viewers: { position: "absolute", top: 10, right: 10, color: "#fff", fontWeight: "800" },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  host: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13 }
});
