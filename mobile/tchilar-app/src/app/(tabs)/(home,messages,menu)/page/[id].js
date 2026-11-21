// Uma página por dentro, como no site (src/modules/pages.jsx): capa e foto de perfil, números, seguir/partilhar,
// separadores Publicações · Sobre · Eventos · Loja e, para quem a gere, "Completa a tua página", editar informações,
// mudar a capa e a foto, criar eventos e ofertas, entrar em direto e apagar. Em tablets, o resumo fica numa coluna ao lado.
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CoverPositioner } from "../../../../components/CoverPositioner";
import { useOptions } from "../../../../components/OptionsSheet";
import { OfficialBadge, PageCover, PageKind, PageLogo, PageStats } from "../../../../components/PageParts";
import { PhotoEditor } from "../../../../components/PhotoEditor";
import { PostCard } from "../../../../components/PostCard";
import { VerificationPlans } from "../../../../components/VerificationPlans";
import { Button, Field, Loading, Notice, kz } from "../../../../components/ui";
import { WEB_URL, api, mediaUri, upload } from "../../../../lib/api";
import { pageCategoryPath, pageType } from "../../../../lib/pages";
import { useSession } from "../../../../lib/session";
import { colors } from "../../../../lib/theme";

const SECTIONS = [["posts", "Publicações"], ["about", "Sobre"], ["events", "Eventos"], ["offers", "Loja"]];
const when = value => new Date(value).toLocaleString("pt-PT", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" });

function contactsOf(page) {
  return [
    page.address && { key: "address", icon: "location-outline", label: "Localização", value: page.address },
    page.opening_hours && { key: "hours", icon: "time-outline", label: "Horário", value: page.opening_hours },
    page.contact_phone && { key: "phone", icon: "call-outline", label: "Telefone", value: page.contact_phone, url: `tel:${page.contact_phone.replace(/[^+\d]/g, "")}` },
    page.contact_email && { key: "email", icon: "mail-outline", label: "Email", value: page.contact_email, url: `mailto:${page.contact_email}` },
    page.website && { key: "website", icon: "globe-outline", label: "Site", value: page.website.replace(/^https?:\/\//, "").replace(/\/$/, ""), url: page.website }
  ].filter(Boolean);
}

export default function PageScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [page, setPage] = useState(null);
  const [posts, setPosts] = useState(null);
  const [live, setLive] = useState(null);
  const [events, setEvents] = useState(null);
  const [offers, setOffers] = useState(null);
  const [section, setSection] = useState("posts");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editingAbout, setEditingAbout] = useState(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [logoDraft, setLogoDraft] = useState(null);
  const [coverDraft, setCoverDraft] = useState(null);
  const [options, choose] = useOptions();

  const load = useCallback(async () => {
    try {
      const [list, feed, lives] = await Promise.all([api("/pages"), api(`/posts?pageId=${id}`), api(`/lives?pageId=${id}`).catch(() => ({ lives: [] }))]);
      const found = list.pages.find(item => String(item.id) === String(id));
      if (!found) throw new Error("Esta página não existe ou foi apagada.");
      setPage(found);
      setPosts(feed.posts);
      setLive(lives.lives?.[0] || null);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, [id]);
  const loadEvents = useCallback(() => api(`/events?pageId=${id}`).then(result => setEvents(result.events)).catch(loadError => setError(loadError.message)), [id]);
  const loadOffers = useCallback(() => api(`/pages/${id}/offers`).then(result => setOffers(result.offers)).catch(loadError => setError(loadError.message)), [id]);
  // Volta a carregar ao regressar ao ecrã (por exemplo depois de publicar ou criar um evento).
  useFocusEffect(useCallback(() => {
    load();
    if (section === "events") loadEvents();
    if (section === "offers") loadOffers();
  }, [load, loadEvents, loadOffers, section]));

  if (!page) return error ? <View style={styles.missing}><Ionicons name="document-text-outline" size={28} color={colors.muted} />
    <Text style={styles.missingText}>{error}</Text><Button variant="secondary" label="Ver todas as páginas" onPress={() => router.replace("/pages")} /></View> : <Loading />;

  const owner = Boolean(user && page.owner_username === user.username);
  // "Loja" só aparece nas páginas que a ligaram (quem gere decide, em Editar informações).
  // "Verificação" só aparece a quem criou a página.
  const sections = [...SECTIONS.filter(([key]) => key !== "offers" || page.shop_enabled), ...(owner ? [["verification", "Verificação"]] : [])];
  const activeSection = sections.some(([key]) => key === section) ? section : "posts";
  const contacts = contactsOf(page);
  const aboutText = page.about || page.description || "";
  const act = async (key, task) => {
    setBusy(key);
    try { await task(); } catch (actError) { Alert.alert(page.name, actError.message); } finally { setBusy(""); }
  };
  const openSection = key => {
    setSection(key);
    if (key === "events" && events === null) loadEvents();
    if (key === "offers" && offers === null) loadOffers();
  };
  const toggleFollow = () => act("follow", async () => {
    if (!user) return router.push("/login");
    const following = !page.is_following;
    setPage(current => ({ ...current, is_following: following, follower_count: current.follower_count + (following ? 1 : -1) }));
    try { await api(`/pages/${page.id}/follow`, { method: following ? "POST" : "DELETE" }); }
    catch (followError) { setPage(current => ({ ...current, is_following: !following, follower_count: current.follower_count + (following ? -1 : 1) })); throw followError; }
  });
  const share = () => Share.share({ message: `${page.name} no Tchilar\n${WEB_URL}/pages/${page.id}`, url: `${WEB_URL}/pages/${page.id}`, title: page.name }).catch(() => {});

  // Foto de perfil e capa da página (como no perfil: galeria/câmara, editor e posição da capa).
  const pickImage = async kind => {
    const current = kind === "logo" ? page.logo_url : page.cover_url;
    const key = await choose(kind === "logo" ? "Foto de perfil da página" : "Capa da página", [
      { key: "library", label: "Escolher da galeria", icon: "images-outline" },
      { key: "camera", label: "Tirar foto", icon: "camera-outline" },
      ...(kind === "cover" && current ? [{ key: "position", label: "Ajustar a posição", icon: "move-outline" }] : []),
      ...(current ? [{ key: "remove", label: kind === "logo" ? "Remover foto" : "Remover capa", icon: "trash-outline", danger: true }] : [])
    ]);
    if (!key) return;
    if (key === "remove") return act(kind, async () => { await api(`/pages/${page.id}/${kind}`, { method: "DELETE" }); await load(); });
    if (key === "position") return setCoverDraft({ uri: mediaUri(page.cover_url), existing: true });
    const permission = key === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Tchilar", "Permite o acesso nas definições do telemóvel.");
    const pickerOptions = { mediaTypes: ["images"], quality: 0.9, allowsEditing: kind === "logo", aspect: [1, 1] };
    const result = key === "camera" ? await ImagePicker.launchCameraAsync(pickerOptions) : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled) return;
    if (kind === "logo") setLogoDraft(result.assets[0]);
    else setCoverDraft({ asset: result.assets[0], uri: result.assets[0].uri });
  };
  const saveLogo = edited => { setLogoDraft(null); act("logo", async () => { await upload(`/pages/${page.id}/logo`, {}, edited, "image"); await load(); }); };
  const saveCover = position => {
    const draft = coverDraft;
    setCoverDraft(null);
    act("cover", async () => {
      if (draft.existing) await api(`/pages/${page.id}/cover-position`, { method: "PATCH", body: { position } });
      else await upload(`/pages/${page.id}/cover`, { position: String(position) }, draft.asset, "image");
      await load();
    });
  };
  const moreOptions = async () => {
    const key = await choose(page.name, [
      { key: "about", label: "Editar informações", icon: "information-circle-outline" },
      { key: "cover", label: "Mudar capa", icon: "image-outline" },
      { key: "logo", label: "Mudar foto de perfil", icon: "camera-outline" },
      { key: "event", label: "Criar evento", icon: "calendar-outline" },
      ...(page.shop_enabled ? [{ key: "offer", label: "Criar oferta na loja", icon: "pricetag-outline" }] : [{ key: "about", label: "Ligar a loja (Editar informações)", icon: "pricetag-outline" }]),
      { key: "verify", label: page.verification_tier ? "Verificação da página" : "Verificar página", icon: "checkmark-circle-outline" },
      { key: "share", label: "Partilhar", icon: "share-outline" },
      ...(page.is_official ? [] : [{ key: "delete", label: "Apagar página", icon: "trash-outline", danger: true }])
    ]);
    if (key === "about") setEditingAbout(true);
    if (key === "cover" || key === "logo") pickImage(key);
    if (key === "event") router.push({ pathname: "/community/new", params: { type: "event", pageId: page.id, pageName: page.name } });
    if (key === "offer") { openSection("offers"); setCreatingOffer(true); }
    if (key === "verify") openSection("verification");
    if (key === "share") share();
    if (key === "delete") Alert.alert("Apagar página", `Apagar «${page.name}» e todas as publicações dela? Não pode ser desfeito.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Apagar", style: "destructive", onPress: () => act("delete", async () => { await api(`/pages/${page.id}`, { method: "DELETE" }); router.back(); }) }
    ]);
  };

  // ----- Cabeçalho -----
  const hero = <View style={styles.hero}>
    <PageCover page={page} height={wide ? 260 : 180}>
      {live && <Pressable style={styles.livePill} onPress={() => router.push(`/live/${live.id}`)} accessibilityRole="button">
        <View style={styles.liveDot} /><Text style={styles.liveText}>Em direto agora</Text></Pressable>}
      {owner && <Pressable style={styles.coverButton} onPress={() => pickImage("cover")} accessibilityRole="button" accessibilityLabel="Mudar a capa da página" disabled={Boolean(busy)}>
        <Ionicons name="camera" size={16} color={colors.ink || "#0B0B0C"} /><Text style={styles.coverButtonText}>{busy === "cover" ? "A carregar..." : "Capa"}</Text>
      </Pressable>}
    </PageCover>
    <View style={styles.heroBody}>
      <View style={styles.logoWrap}>
        <PageLogo page={page} size={wide ? 112 : 92} border={4} />
        {owner && <Pressable style={styles.logoButton} onPress={() => pickImage("logo")} accessibilityRole="button" accessibilityLabel="Mudar a foto de perfil da página" disabled={Boolean(busy)}>
          <Ionicons name="camera" size={15} color={colors.text} />
        </Pressable>}
      </View>
      <View style={styles.nameRow}><Text style={styles.name}>{page.name}</Text><OfficialBadge show={page.is_official} tier={page.verification_tier} size={22} /></View>
      {page.business_verified && <BusinessBadge />}
      <PageKind page={page} />
      <PageStats page={page} since />
      <View style={styles.actions}>
        {owner
          ? <>
            <View style={styles.actionMain}><Button label={live ? "Voltar ao direto" : "Iniciar direto"} icon="radio"
              onPress={() => router.push(live ? `/live/${live.id}` : { pathname: "/live/new", params: { pageId: page.id } })} /></View>
            <View style={styles.actionFlex}><Button variant="secondary" label="Publicar" icon="create-outline"
              onPress={() => router.push({ pathname: "/create", params: { pageId: page.id, targetName: page.name } })} /></View>
            <Pressable style={styles.iconButton} onPress={moreOptions} accessibilityRole="button" accessibilityLabel="Mais opções da página">
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} /></Pressable>
          </>
          : <>
            <View style={styles.actionFlex}><Button variant={page.is_following ? "secondary" : "primary"} label={page.is_following ? "A seguir" : "Seguir"}
              icon={page.is_following ? "checkmark" : "add"} onPress={toggleFollow} busy={busy === "follow"} /></View>
            {live && <View style={styles.actionFlex}><Button variant="secondary" label="Ver direto" icon="radio" onPress={() => router.push(`/live/${live.id}`)} /></View>}
            <Pressable style={styles.iconButton} onPress={share} accessibilityRole="button" accessibilityLabel="Partilhar a página">
              <Ionicons name="share-outline" size={20} color={colors.text} /></Pressable>
          </>}
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {sections.map(([key, label]) => <Pressable key={key} style={styles.tab} onPress={() => openSection(key)} accessibilityRole="tab" accessibilityState={{ selected: activeSection === key }}>
        <Text style={[styles.tabText, activeSection === key && styles.tabTextOn]}>{label}</Text>
        {activeSection === key && <View style={styles.tabBar} />}
      </Pressable>)}
    </ScrollView>
  </View>;

  // ----- Coluna de resumo (ao lado em tablets, por baixo do cabeçalho nos telemóveis) -----
  const steps = [
    { key: "logo", done: Boolean(page.logo_url), label: "Foto de perfil", run: () => pickImage("logo") },
    { key: "cover", done: Boolean(page.cover_url), label: "Imagem de capa", run: () => pickImage("cover") },
    { key: "about", done: Boolean(page.about || page.description), label: "Texto sobre a página", run: () => setEditingAbout(true) },
    { key: "contacts", done: contacts.length > 0, label: "Contactos ou horário", run: () => setEditingAbout(true) },
    { key: "post", done: page.post_count > 0, label: "Primeira publicação", run: () => router.push({ pathname: "/create", params: { pageId: page.id, targetName: page.name } }) }
  ];
  const doneSteps = steps.filter(step => step.done).length;
  const side = <View style={{ gap: 12 }}>
    {owner && doneSteps < steps.length && <View style={[styles.panel, styles.setup]}>
      <View style={styles.panelHead}><Text style={styles.panelTitle}>Completa a tua página</Text><Text style={styles.muted}>{doneSteps}/{steps.length}</Text></View>
      <View style={styles.progress}><View style={[styles.progressFill, { width: `${(doneSteps / steps.length) * 100}%` }]} /></View>
      {steps.map(step => <Pressable key={step.key} style={styles.step} onPress={step.done ? undefined : step.run} disabled={step.done} accessibilityRole="button">
        <Ionicons name={step.done ? "checkmark-circle" : "ellipse-outline"} size={20} color={step.done ? colors.accent : colors.muted} />
        <Text style={[styles.stepText, step.done && styles.stepDone]}>{step.label}</Text>
        {!step.done && <Ionicons name="chevron-forward" size={16} color={colors.muted} />}
      </Pressable>)}
    </View>}
    {activeSection !== "about" && <View style={styles.panel}>
      <View style={styles.panelHead}><Text style={styles.panelTitle}>Sobre</Text>
        <Pressable onPress={() => openSection("about")} hitSlop={8}><Text style={styles.link}>Ver tudo</Text></Pressable></View>
      <Text style={aboutText ? styles.body : styles.muted} numberOfLines={5}>{aboutText || (owner ? "Ainda não escreveste sobre a página." : "Sem descrição.")}</Text>
      {contacts.slice(0, 3).map(item => <ContactRow key={item.key} item={item} />)}
    </View>}
  </View>;

  // ----- Conteúdo de cada separador -----
  const emptyState = (icon, title, text, action) => <View style={styles.empty}>
    <View style={styles.emptyIcon}><Ionicons name={icon} size={22} color={colors.text} /></View>
    <Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text>{action}
  </View>;
  let content = null;
  if (activeSection === "about") {
    content = <View style={{ gap: 12 }}>
      <View style={styles.panel}>
        <View style={styles.panelHead}><Text style={styles.panelTitle}>Sobre {page.name}</Text>
          {owner && <Pressable onPress={() => setEditingAbout(true)} hitSlop={8}><Text style={styles.link}>Editar</Text></Pressable>}</View>
        <Text style={aboutText ? styles.body : styles.muted}>{aboutText || (owner ? "Conta às pessoas a história da tua página, o que fazes e porque te devem seguir." : "Esta página ainda não escreveu sobre si.")}</Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Contactos e horário</Text>
        {contacts.length ? contacts.map(item => <ContactRow key={item.key} item={item} />)
          : <Text style={styles.muted}>{owner ? "Adiciona telefone, email, site, morada e horário para as pessoas te encontrarem." : "Sem contactos públicos."}</Text>}
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Informações</Text>
        <Fact icon={pageType(page.page_type).ion || "document-text-outline"} text={pageType(page.page_type).label} />
        {pageCategoryPath(page) ? <Fact icon="grid-outline" text={pageCategoryPath(page)} /> : null}
        <Fact icon="person-outline" text={page.owner_username ? `Criada por ${page.owner_name}` : "Gerida pela equipa Tchilar"}
          onPress={page.owner_username ? () => router.push(`/u/${page.owner_username}`) : undefined} />
        <Fact icon="calendar-outline" text={`Desde ${new Date(page.created_at).toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}`} />
      </View>
    </View>;
  } else if (activeSection === "events") {
    content = <View style={{ gap: 12 }}>
      <SectionHead title="Eventos" text="Também aparecem na lista geral de eventos do Tchilar."
        action={owner ? <Button small label="Criar" icon="add" onPress={() => router.push({ pathname: "/community/new", params: { type: "event", pageId: page.id, pageName: page.name } })} /> : null} />
      {events === null ? <Loading cards={2} /> : events.length === 0
        ? emptyState("calendar-outline", "Sem eventos marcados", owner ? "Cria um evento para juntar quem segue a página: um concerto, uma promoção, um encontro." : "Quando esta página marcar um evento, aparece aqui.")
        : events.map(item => <Pressable key={item.id} style={styles.panel} onPress={() => router.push(`/event/${item.id}`)} accessibilityRole="button">
          <Text style={styles.panelTitle}>{item.name}</Text>
          <Fact icon="time-outline" text={when(item.starts_at)} />
          {item.location ? <Fact icon="location-outline" text={item.location} /> : null}
          <Text style={styles.muted}>{item.attendee_count} {item.attendee_count === 1 ? "pessoa vai" : "pessoas vão"}</Text>
          {!owner && user && <Button small variant={item.is_attending ? "secondary" : "primary"} label={item.is_attending ? "Vou" : "Vou participar"}
            icon={item.is_attending ? "checkmark" : "add"} busy={busy === `event-${item.id}`}
            onPress={() => act(`event-${item.id}`, async () => { await api(`/events/${item.id}/rsvp`, { method: "POST" }); await loadEvents(); })} />}
        </Pressable>)}
    </View>;
  } else if (activeSection === "verification") {
    content = <VerificationPlans endpoint={`/pages/${page.id}/verification`} page={page} />;
  } else if (activeSection === "offers") {
    content = <View style={{ gap: 12 }}>
      <SectionHead title="Loja" text="Produtos e serviços. A compra é feita no WhatsApp ou no site do vendedor."
        action={owner ? <Button small label="Criar" icon="add" onPress={() => setCreatingOffer(true)} /> : null} />
      {offers === null ? <Loading cards={2} /> : offers.length === 0
        ? emptyState("pricetag-outline", "A loja está vazia", owner ? "Mostra um produto ou serviço, com preço, desconto e o link para comprar." : "Esta página ainda não tem produtos ou serviços.")
        : offers.map(offer => <OfferCard key={offer.id} offer={offer} page={page} owner={owner} onRemove={() => Alert.alert("Remover oferta", `Remover «${offer.title}» da loja?`, [
          { text: "Cancelar", style: "cancel" },
          { text: "Remover", style: "destructive", onPress: () => act(`offer-${offer.id}`, async () => { await api(`/pages/${page.id}/offers/${offer.id}`, { method: "DELETE" }); await Promise.all([loadOffers(), load()]); }) }
        ])} />)}
    </View>;
  }
  const postsEmpty = posts === null ? <Loading /> : emptyState("document-text-outline", owner ? "Ainda sem publicações" : "Nada publicado ainda",
    owner ? "Escreve a primeira publicação: quem segue a página vai vê-la no feed." : "Segue a página para veres as novidades no teu feed.",
    owner ? <Button small label="Publicar na página" icon="create-outline" onPress={() => router.push({ pathname: "/create", params: { pageId: page.id, targetName: page.name } })} /> : null);

  const header = <View style={styles.headerWrap}>
    {hero}
    {wide ? null : side}
    {content}
  </View>;
  const showPosts = activeSection === "posts";

  return <>
    <Stack.Screen options={{ title: page.name }} />
    <View style={[styles.layout, wide && styles.layoutWide]}>
      {wide && <ScrollView style={styles.sideColumn} contentContainerStyle={{ paddingVertical: 14 }} contentInsetAdjustmentBehavior="automatic">{side}</ScrollView>}
      <FlatList style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic"
        data={showPosts ? posts || [] : []}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => <View style={styles.postWrap}><PostCard post={item} /></View>}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); if (section === "events") loadEvents(); if (section === "offers") loadOffers(); }} tintColor={colors.primary} />}
        ListHeaderComponent={header}
        ListEmptyComponent={showPosts ? postsEmpty : null}
        contentContainerStyle={styles.listContent}
      />
    </View>
    {options}
    <PhotoEditor asset={logoDraft} visible={Boolean(logoDraft)} fixedCrop="1:1" title="Foto da página" onCancel={() => setLogoDraft(null)} onDone={saveLogo} />
    <CoverPositioner uri={coverDraft?.uri} visible={Boolean(coverDraft)} initial={coverDraft?.existing ? page.cover_position ?? 50 : 50} aspect={wide ? 3.2 : 2}
      onCancel={() => setCoverDraft(null)} onSave={saveCover} />
    <AboutEditor page={page} visible={editingAbout} onClose={() => setEditingAbout(false)} onSaved={updated => setPage(current => ({ ...current, ...updated }))} />
    <OfferEditor page={page} visible={creatingOffer} onClose={() => setCreatingOffer(false)} onCreated={() => { setCreatingOffer(false); loadOffers(); load(); }} />
  </>;
}

function SectionHead({ title, text, action }) {
  return <View style={[styles.panel, styles.sectionHead]}>
    <View style={{ flex: 1, gap: 3 }}><Text style={styles.panelTitle}>{title}</Text><Text style={styles.muted}>{text}</Text></View>
    {action}
  </View>;
}

function ContactRow({ item }) {
  const content = <>
    <View style={styles.contactIcon}><Ionicons name={item.icon} size={16} color={colors.text} /></View>
    <View style={{ flex: 1 }}><Text style={styles.contactLabel}>{item.label}</Text><Text style={styles.contactValue}>{item.value}</Text></View>
  </>;
  return item.url
    ? <Pressable style={styles.contact} onPress={() => Linking.openURL(item.url).catch(() => {})} accessibilityRole="link">{content}</Pressable>
    : <View style={styles.contact}>{content}</View>;
}

function Fact({ icon, text, onPress }) {
  const Wrapper = onPress ? Pressable : View;
  return <Wrapper style={styles.fact} onPress={onPress}>
    <Ionicons name={icon} size={16} color={colors.muted} /><Text style={[styles.factText, onPress && { color: colors.text, fontWeight: "700" }]}>{text}</Text>
  </Wrapper>;
}

// Selo "Negócio verificado": a equipa confirmou o NIF de uma página com loja.
function BusinessBadge() {
  return <View style={styles.businessBadge}><Ionicons name="shield-checkmark" size={13} color="#0B7A3B" />
    <Text style={styles.businessBadgeText}>Negócio verificado</Text></View>;
}

// Mensagem pronta para encomendar pelo WhatsApp de quem vende.
const whatsappOrderUrl = (page, offer, price) => `https://wa.me/${page.whatsapp}?text=${encodeURIComponent(
  `Olá! Quero encomendar «${offer.title}» (${kz(price)}) que vi na loja de ${page.name} no Tchilar: ${WEB_URL}/pages/${page.id}`)}`;

function OfferCard({ offer, page, owner, onRemove }) {
  const [copied, setCopied] = useState(false);
  const price = offer.price_kz * (100 - offer.discount_percent) / 100;
  const copy = async () => { await Clipboard.setStringAsync(offer.promo_code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <View style={styles.panel}>
    <Text style={styles.panelTitle}>{offer.title}</Text>
    {offer.description ? <Text style={styles.body}>{offer.description}</Text> : null}
    <View style={styles.priceRow}>
      {offer.discount_percent > 0 && <Text style={styles.oldPrice}>{kz(offer.price_kz)}</Text>}
      <Text style={styles.price}>{kz(price)}</Text>
      {offer.discount_percent > 0 && <Text style={styles.discount}>-{offer.discount_percent}%</Text>}
    </View>
    {offer.promo_code ? <Pressable style={styles.code} onPress={copy} accessibilityRole="button" accessibilityLabel={`Copiar o código ${offer.promo_code}`}>
      <Text style={styles.codeText}>Código: <Text style={{ fontWeight: "800" }}>{offer.promo_code}</Text></Text>
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.text} /><Text style={styles.muted}>{copied ? "Copiado" : "Copiar"}</Text>
    </Pressable> : null}
    {offer.expires_at ? <Text style={styles.muted}>Válido até {new Date(offer.expires_at).toLocaleDateString("pt-PT", { timeZone: "Africa/Luanda" })}</Text> : null}
    <Text style={styles.muted}>Compra e pagamento fora do Tchilar.</Text>
    <View style={styles.offerActions}>
      <View style={{ flex: 1, gap: 8 }}>
        {page.whatsapp ? <Button label="Encomendar pelo WhatsApp" icon="logo-whatsapp" onPress={() => Linking.openURL(whatsappOrderUrl(page, offer, price)).catch(() => {})} /> : null}
        {offer.checkout_url ? <Button label={page.whatsapp ? "Site" : "Comprar ou contactar"} icon="open-outline" variant={page.whatsapp ? "secondary" : "primary"}
          onPress={() => Linking.openURL(offer.checkout_url).catch(() => {})} /> : null}
      </View>
      {owner && <Pressable style={styles.iconButton} onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remover ${offer.title}`}>
        <Ionicons name="trash-outline" size={19} color={colors.danger} /></Pressable>}
    </View>
  </View>;
}

// Folha que sobe de baixo com um formulário (editar informações, criar oferta).
function FormSheet({ visible, title, onClose, children }) {
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={["top", "bottom"]}>
      <View style={styles.sheetHead}><Text style={styles.sheetTitle}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.link}>Fechar</Text></Pressable></View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function AboutEditor({ page, visible, onClose, onSaved }) {
  const blank = () => ({ about: page.about || page.description || "", contact_email: page.contact_email || "", contact_phone: page.contact_phone || "",
    website: page.website || "", address: page.address || "", opening_hours: page.opening_hours || "", shop_enabled: Boolean(page.shop_enabled),
    whatsapp: page.whatsapp ? `+${page.whatsapp}` : "" });
  const [form, setForm] = useState(blank);
  const [state, setState] = useState({ busy: false, error: "" });
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const save = async () => {
    setState({ busy: true, error: "" });
    try {
      const result = await api(`/pages/${page.id}/about`, { method: "PATCH", body: form });
      onSaved(result.page);
      setState({ busy: false, error: "" });
      onClose();
    } catch (saveError) {
      setState({ busy: false, error: saveError.message });
    }
  };
  return <FormSheet visible={visible} title="Editar informações" onClose={onClose}>
    <Text style={styles.muted}>Estas informações ficam visíveis para todas as pessoas.</Text>
    <Field label={`Sobre a página (${form.about.length}/3000)`} value={form.about} onChangeText={set("about")} multiline maxLength={3000}
      placeholder="A história, a missão ou o que torna esta página especial." style={{ minHeight: 110, textAlignVertical: "top" }} />
    <Field label="Telefone" value={form.contact_phone} onChangeText={set("contact_phone")} keyboardType="phone-pad" maxLength={40} placeholder="+244 9XX XXX XXX" />
    <Field label="Email de contacto" value={form.contact_email} onChangeText={set("contact_email")} keyboardType="email-address" autoCapitalize="none" maxLength={254} placeholder="contacto@exemplo.ao" />
    <Field label="Site" value={form.website} onChangeText={set("website")} keyboardType="url" autoCapitalize="none" maxLength={300} placeholder="https://exemplo.ao" />
    <Field label="Localização" value={form.address} onChangeText={set("address")} maxLength={240} placeholder="Luanda, Angola" />
    <Field label="Horário de funcionamento" value={form.opening_hours} onChangeText={set("opening_hours")} maxLength={300} placeholder="Segunda a sexta, 08:00–17:00" />
    <ShopSwitch value={form.shop_enabled} onChange={set("shop_enabled")} />
    {form.shop_enabled && <Field label="WhatsApp para encomendas" value={form.whatsapp} onChangeText={set("whatsapp")} keyboardType="phone-pad" maxLength={24}
      placeholder="+244 9XX XXX XXX" />}
    {form.shop_enabled && page.shop_enabled && <BusinessSealRequest page={page} onSaved={changes => onSaved({ ...page, ...changes })} />}
    <Notice error={state.error} />
    <Button label="Guardar informações" onPress={save} busy={state.busy} />
  </FormSheet>;
}

// Pedido do selo "Negócio verificado": o NIF do negócio, confirmado pela equipa.
function BusinessSealRequest({ page, onSaved }) {
  const [nif, setNif] = useState(page.business_nif || "");
  const [state, setState] = useState({ busy: false, error: "" });
  if (page.business_verified) return <BusinessBadge />;
  const pending = page.business_requested_at && !page.business_rejected_reason;
  const send = async () => {
    setState({ busy: true, error: "" });
    try {
      const result = await api(`/pages/${page.id}/business`, { method: "POST", body: { nif } });
      onSaved({ business_nif: result.page.business_nif, business_requested_at: result.page.business_requested_at, business_rejected_reason: null });
      setState({ busy: false, error: "" });
    } catch (sendError) { setState({ busy: false, error: sendError.message }); }
  };
  return <View style={styles.panel}>
    <Text style={styles.panelTitle}>Selo «Negócio verificado»</Text>
    <Text style={styles.muted}>Mostra aos clientes que o negócio existe. Indica o NIF; a equipa confirma em poucos dias. É grátis.</Text>
    {pending ? <Text style={styles.body}>Pedido enviado com o NIF {page.business_nif}. A equipa está a confirmar.</Text> : <>
      <Field label="NIF do negócio" value={nif} onChangeText={setNif} autoCapitalize="characters" maxLength={20} />
      <Button label="Pedir selo" variant="secondary" onPress={send} busy={state.busy} disabled={nif.trim().length < 9} />
    </>}
    {page.business_rejected_reason ? <Notice error={`Pedido anterior recusado: ${page.business_rejected_reason}`} /> : null}
    <Notice error={state.error} />
  </View>;
}

// Loja na página: só quem gere decide. Sem loja, o separador "Loja" não aparece.
export function ShopSwitch({ value, onChange }) {
  return <View style={styles.shopSwitch}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.panelTitle}>Loja na página</Text>
      <Text style={styles.muted}>Produtos e serviços com preço, desconto e o link para comprar (WhatsApp ou site). Podes mudar depois.</Text>
    </View>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent }} accessibilityLabel="Loja na página" />
  </View>;
}

// Data DD/MM/AAAA (opcional) → fim desse dia em Luanda.
function expiryIso(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:00+01:00`).toISOString() : null;
}

function OfferEditor({ page, visible, onClose, onCreated }) {
  const empty = { title: "", description: "", priceKz: "", discountPercent: "", promoCode: "", expires: "", checkoutUrl: "" };
  const [form, setForm] = useState(empty);
  const [state, setState] = useState({ busy: false, error: "" });
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const save = async () => {
    setState({ busy: true, error: "" });
    try {
      const expiresAt = form.expires.trim() ? expiryIso(form.expires) : null;
      if (form.expires.trim() && !expiresAt) throw new Error("Escreve a validade como DD/MM/AAAA.");
      await api(`/pages/${page.id}/offers`, { method: "POST", body: {
        title: form.title, description: form.description, priceKz: form.priceKz.replace(",", "."), discountPercent: form.discountPercent,
        promoCode: form.promoCode, expiresAt, checkoutUrl: form.checkoutUrl.trim()
      } });
      setForm(empty);
      setState({ busy: false, error: "" });
      onCreated();
    } catch (saveError) {
      setState({ busy: false, error: saveError.message });
    }
  };
  return <FormSheet visible={visible} title="Criar oferta" onClose={onClose}>
    <Text style={styles.muted}>Aparece na Loja da página e é publicada no feed de quem a segue. A compra é feita no teu WhatsApp ou site.</Text>
    <Field label="Nome" value={form.title} onChangeText={set("title")} maxLength={120} placeholder="Ex.: Camisola Tchilar" />
    <Field label="Descrição" value={form.description} onChangeText={set("description")} multiline maxLength={2000} style={{ minHeight: 80, textAlignVertical: "top" }} />
    <Field label="Preço (Kz)" value={form.priceKz} onChangeText={set("priceKz")} keyboardType="decimal-pad" placeholder="15000" />
    <Field label="Desconto (%)" value={form.discountPercent} onChangeText={value => set("discountPercent")(value.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="0" />
    <Field label="Código de desconto (opcional)" value={form.promoCode} onChangeText={value => set("promoCode")(value.toUpperCase())} autoCapitalize="characters" maxLength={40} placeholder="TCHILAR10" />
    <Field label="Válido até (opcional)" value={form.expires} onChangeText={set("expires")} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="DD/MM/AAAA" />
    <Field label="Link de compra ou contacto" value={form.checkoutUrl} onChangeText={set("checkoutUrl")} keyboardType="url" autoCapitalize="none" placeholder="https://wa.me/244..." />
    <Notice error={state.error} />
    <Button label="Publicar oferta" onPress={save} busy={state.busy} disabled={!form.title.trim() || !form.priceKz.trim() || !form.checkoutUrl.trim()} />
  </FormSheet>;
}

const styles = StyleSheet.create({
  businessBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(37,211,102,0.16)" },
  businessBadgeText: { color: "#0B7A3B", fontSize: 12, fontWeight: "700" },
  layout: { flex: 1 },
  layoutWide: { flexDirection: "row", alignSelf: "center", width: "100%", maxWidth: 1180, gap: 16, paddingHorizontal: 16 },
  sideColumn: { width: 320, flexGrow: 0 },
  listContent: { paddingBottom: 32 },
  headerWrap: { padding: 12, gap: 12 },
  postWrap: { paddingHorizontal: 12, paddingBottom: 12 },
  hero: { overflow: "hidden", borderRadius: 18, backgroundColor: colors.surface },
  heroBody: { paddingHorizontal: 16, paddingBottom: 12, gap: 7 },
  logoWrap: { marginTop: -52, alignSelf: "flex-start" },
  logoButton: { position: "absolute", right: -4, bottom: -2, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  coverButton: { position: "absolute", right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34,
    borderRadius: 10, backgroundColor: "#FFFFFF" },
  coverButtonText: { color: "#0B0B0C", fontWeight: "800", fontSize: 13 },
  livePill: { position: "absolute", left: 12, top: 12, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, height: 30, borderRadius: 999, backgroundColor: colors.accent },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  name: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 },
  actionMain: { flexBasis: "100%" },
  actionFlex: { flex: 1 },
  iconButton: { width: 46, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  tabs: { paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  tab: { paddingHorizontal: 12, paddingTop: 13, paddingBottom: 12 },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  tabTextOn: { color: colors.text },
  tabBar: { position: "absolute", left: 10, right: 10, bottom: 0, height: 3, borderRadius: 2, backgroundColor: colors.accent },
  panel: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.surface },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  setup: { borderWidth: 1, borderColor: `${colors.accent}55` },
  progress: { height: 6, borderRadius: 3, backgroundColor: colors.background, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: colors.accent },
  step: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  stepText: { flex: 1, color: colors.text, fontWeight: "600" },
  stepDone: { color: colors.muted, textDecorationLine: "line-through" },
  body: { color: colors.text, lineHeight: 21 },
  muted: { color: colors.muted, lineHeight: 19 },
  link: { color: colors.accent, fontWeight: "800" },
  contact: { flexDirection: "row", alignItems: "center", gap: 11 },
  contactIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  contactLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  contactValue: { color: colors.text, fontWeight: "600" },
  fact: { flexDirection: "row", alignItems: "center", gap: 9 },
  factText: { color: colors.muted, flexShrink: 1 },
  empty: { alignItems: "center", gap: 8, padding: 26, borderRadius: 16, backgroundColor: colors.surface },
  emptyIcon: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  emptyText: { color: colors.muted, textAlign: "center", lineHeight: 20 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  oldPrice: { color: colors.muted, textDecorationLine: "line-through" },
  price: { color: colors.text, fontSize: 20, fontWeight: "800" },
  discount: { color: colors.accent, fontWeight: "800" },
  code: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  codeText: { color: colors.text },
  offerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  missingText: { color: colors.muted, textAlign: "center" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  sheetBody: { padding: 18, gap: 12 },
  shopSwitch: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.background }
});
