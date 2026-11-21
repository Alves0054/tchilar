// Peças das Páginas, iguais às do site (src/modules/pages.jsx): foto de perfil, capa, números, cartão e destaque.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mediaUri } from "../lib/api";
import { pageCategoryLabel, pageType } from "../lib/pages";
import { colors } from "../lib/theme";
import { VerifiedBadge } from "./VerifiedBadge";

// Quatro tons escuros por categoria (como no site), para páginas sem capa nem foto.
const TONES = [["#0B0B0C", "#2C2C2E"], ["#2C2C2E", "#0B0B0C"], ["#48484A", "#6E6E73"], ["#0B0B0C", "#3A3A3C"]];
export const pageTone = page => {
  const key = String(page?.category || page?.name || "");
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
};
export const pageMonogram = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(word => word[0] || "").join("").toUpperCase() || "?";
const plural = (count, one, many) => `${Number(count || 0).toLocaleString("pt-PT")} ${count === 1 ? one : many}`;

// Selo ao lado do nome da página: o da verificação paga (Kazola azul, Bolado vermelho, Benga dourado)
// ou, sem plano, o visto dourado da página oficial do Tchilar.
export function OfficialBadge({ show, tier = null, size = 17 }) {
  if (tier) return <VerifiedBadge tier={tier} size={size} />;
  return show ? <Ionicons name="checkmark-circle" size={size} color="#D4AF37" accessibilityLabel="Página oficial do Tchilar" /> : null;
}

// Foto de perfil da página (quadrada com cantos redondos, como as marcas); sem foto, as iniciais no tom da página.
export function PageLogo({ page, size = 56, border = 3 }) {
  const radius = Math.round(size * 0.32);
  const uri = mediaUri(page?.logo_url);
  return <View style={[styles.logo, { width: size, height: size, borderRadius: radius, borderWidth: border }]}>
    {uri
      ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      : <LinearGradient colors={pageTone(page)} style={styles.fill}>
        <Text style={[styles.logoText, { fontSize: Math.round(size * 0.36) }]}>{pageMonogram(page?.name)}</Text>
      </LinearGradient>}
  </View>;
}

// Capa: a imagem na posição escolhida pelo dono. "smart": um cartaz quadrado/vertical aparece inteiro, com a própria
// imagem desfocada por trás (cortado numa faixa só se via uma tira). Sem capa: o gradiente e as iniciais vazadas.
export function PageCover({ page, height, smart = false, children }) {
  const uri = mediaUri(page?.cover_url);
  const [poster, setPoster] = useState(false);
  // O expo-image só aceita a posição como objeto ({ top: "30%" }); um texto como "50% 30%" era ignorado.
  const position = { top: `${page?.cover_position ?? 50}%`, left: "50%" };
  return <View style={[styles.cover, { height }]}>
    <LinearGradient colors={pageTone(page)} style={StyleSheet.absoluteFill} />
    {uri
      ? <>
        {poster && <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} />}
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={poster ? "contain" : "cover"} contentPosition={poster ? "center" : position}
          transition={150} onLoad={event => {
            if (!smart) return;
            const { width, height: imageHeight } = event.source || {};
            setPoster(Boolean(width && imageHeight && width / imageHeight < 1.6));
          }} />
      </>
      : <Text style={[styles.coverMark, { fontSize: Math.round(height * 1.05) }]} numberOfLines={1}>{pageMonogram(page?.name)}</Text>}
    {children}
  </View>;
}

export function PageKind({ page }) {
  const type = pageType(page.page_type);
  return <View style={styles.kind}>
    <Ionicons name={type.ion || "document-text"} size={12} color={colors.text} />
    <Text style={styles.kindText} numberOfLines={1}>{type.label} · {pageCategoryLabel(page)}</Text>
  </View>;
}

export function PageStats({ page, since = false }) {
  const parts = [plural(page.follower_count, "seguidor", "seguidores"), plural(page.post_count, "publicação", "publicações")];
  if (since && page.created_at) parts.push(`desde ${new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}`);
  return <Text style={styles.stats}>{parts.join("  ·  ")}</Text>;
}

// Botão Seguir / A seguir / Gerir (o mesmo comportamento do site).
export function FollowButton({ page, isOwner, onToggle, busy, onManage }) {
  if (isOwner) {
    return <Pressable style={[styles.follow, styles.followSoft]} onPress={onManage} accessibilityRole="button">
      <Ionicons name="settings-outline" size={14} color={colors.text} /><Text style={styles.followSoftText}>Gerir</Text>
    </Pressable>;
  }
  return <Pressable style={[styles.follow, page.is_following && styles.followSoft, busy && { opacity: 0.6 }]} onPress={onToggle} disabled={busy}
    accessibilityRole="button" accessibilityState={{ selected: Boolean(page.is_following) }}
    accessibilityLabel={page.is_following ? `A seguir ${page.name}. Toca para deixar de seguir.` : `Seguir ${page.name}`}>
    <Ionicons name={page.is_following ? "checkmark" : "add"} size={15} color={page.is_following ? colors.text : "#fff"} />
    <Text style={page.is_following ? styles.followSoftText : styles.followText}>{page.is_following ? "A seguir" : "Seguir"}</Text>
  </Pressable>;
}

export function PageCard({ page, isOwner, onOpen, onToggleFollow, busy }) {
  return <Pressable style={styles.card} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Abrir a página ${page.name}`}>
    <PageCover page={page} height={92} smart />
    <View style={styles.cardBody}>
      <View style={styles.cardLogo}><PageLogo page={page} size={56} /></View>
      <View style={styles.nameRow}>
        <Text style={styles.cardName} numberOfLines={1}>{page.name}</Text>
        <OfficialBadge show={page.is_official} tier={page.verification_tier} />
      </View>
      <PageKind page={page} />
      {page.description ? <Text style={styles.cardDesc} numberOfLines={2}>{page.description}</Text> : null}
      <PageStats page={page} />
    </View>
    <View style={styles.cardFoot}>
      <Text style={styles.owner} numberOfLines={1}>{page.owner_name || "Equipa Tchilar"}</Text>
      <FollowButton page={page} isOwner={isOwner} onToggle={onToggleFollow} busy={busy} onManage={onOpen} />
    </View>
  </Pressable>;
}

export function FeaturedPage({ page, isOwner, onOpen, onToggleFollow, busy, wide }) {
  return <Pressable style={[styles.featured, wide && styles.featuredWide]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Abrir a página ${page.name}`}>
    <View style={wide ? { flex: 1.1 } : null}><PageCover page={page} height={wide ? 230 : 170} smart /></View>
    <View style={[styles.featuredBody, wide && { flex: 1 }]}>
      <View style={styles.eyebrow}><Ionicons name="sparkles" size={12} color={colors.muted} /><Text style={styles.eyebrowText}>EM DESTAQUE</Text></View>
      <View style={styles.featuredId}>
        <PageLogo page={page} size={60} border={0} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={styles.nameRow}><Text style={styles.featuredName} numberOfLines={1}>{page.name}</Text><OfficialBadge show={page.is_official} size={19} /></View>
          <PageKind page={page} />
        </View>
      </View>
      {page.description ? <Text style={styles.cardDesc} numberOfLines={3}>{page.description}</Text> : null}
      <View style={styles.featuredFoot}>
        <PageStats page={page} />
        <FollowButton page={page} isOwner={isOwner} onToggle={onToggleFollow} busy={busy} onManage={onOpen} />
      </View>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { overflow: "hidden", borderColor: colors.surface, backgroundColor: colors.surface },
  logoText: { color: "#fff", fontWeight: "800", letterSpacing: -0.5 },
  cover: { overflow: "hidden", backgroundColor: colors.background },
  // O React Native não tem letras vazadas: as iniciais ficam quase transparentes, como uma marca de água.
  coverMark: { position: "absolute", right: -6, bottom: "-30%", color: "rgba(255,255,255,0.09)", fontWeight: "800", letterSpacing: -4 },
  kind: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 999, backgroundColor: colors.background },
  kindText: { color: colors.text, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  stats: { color: colors.muted, fontSize: 13 },
  follow: { flexDirection: "row", alignItems: "center", gap: 4, height: 34, paddingHorizontal: 13, borderRadius: 10, backgroundColor: colors.accent },
  followText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  followSoft: { backgroundColor: colors.background },
  followSoftText: { color: colors.text, fontWeight: "800", fontSize: 13 },
  card: { flex: 1, overflow: "hidden", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  cardBody: { paddingHorizontal: 14, paddingBottom: 12, gap: 6 },
  cardLogo: { marginTop: -28 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardName: { color: colors.text, fontSize: 17, fontWeight: "800", flexShrink: 1 },
  cardDesc: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: "auto" },
  owner: { flex: 1, color: colors.muted, fontSize: 13, fontWeight: "700" },
  featured: { overflow: "hidden", borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.surface },
  featuredWide: { flexDirection: "row" },
  featuredBody: { padding: 16, gap: 10, justifyContent: "center" },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 5 },
  eyebrowText: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  featuredId: { flexDirection: "row", alignItems: "center", gap: 12 },
  featuredName: { color: colors.text, fontSize: 22, fontWeight: "800", flexShrink: 1 },
  featuredFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }
});
