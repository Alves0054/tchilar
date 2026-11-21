import { Image } from "expo-image";
import { Redirect } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, LayoutAnimation, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import PhoneInput from "../components/PhoneInput";
import { WEB_URL, api } from "../lib/api";
import { DEFAULT_PHONE_COUNTRY, formatPhone, parsePhone, phoneError } from "../lib/phones";
import { useSession } from "../lib/session";
import { useSmsChannels } from "../lib/smsChannels";
import { colors, isDark } from "../lib/theme";

// Ordem dos ecrãs: decide para que lado o formulário desliza (para a frente → da direita; para trás → da esquerda).
const ORDER = { forgot: -1, login: 0, register: 1 };

const PASSWORD_MIN = 8;
// Data de nascimento escrita como DD/MM/AAAA → AAAA-MM-DD (o formato da API).
function toIsoDate(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
function formatDateTyping(text) {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/");
}

function Input(props) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={styles.input} />;
}

// Entrar, criar conta e recuperar a palavra-passe: tudo na app, como no site.
export default function Login() {
  const { user, signIn, expiredNotice } = useSession();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", code: "", displayName: "", username: "", birthDate: "", phone: "", phoneCountry: DEFAULT_PHONE_COUNTRY, invite: "", isCreator: false });
  const [needsCode, setNeedsCode] = useState(false);
  // Entrar e recuperar com o email ou com o telemóvel (país + número). Recuperar por SMS: código + nova palavra-passe.
  const [via, setVia] = useState("email");
  const smsChannels = useSmsChannels();   // o 1.º canal ligado no servidor (WhatsApp ou SMS)
  const [smsSent, setSmsSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  // Animação ao mudar entre Entrar, Criar conta e Recuperar: o formulário sai para um lado e entra pelo outro,
  // e a pílula do seletor desliza para o separador escolhido.
  const slide = useRef(new Animated.Value(0)).current;      // -1 … 1: posição horizontal do formulário
  const fade = useRef(new Animated.Value(1)).current;
  const pill = useRef(new Animated.Value(0)).current;       // 0 = Entrar, 1 = Criar conta
  const [tabsWidth, setTabsWidth] = useState(0);
  // Já com sessão: vai para o Início. Fica depois de todos os hooks (o React exige o mesmo número de hooks em cada desenho).
  if (user) return <Redirect href="/" />;
  const switchTo = next => {
    if (next === mode) return;
    const direction = ORDER[next] > ORDER[mode] ? 1 : -1;
    if (next !== "forgot") Animated.spring(pill, { toValue: next === "register" ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    Animated.parallel([
      Animated.timing(slide, { toValue: -direction, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true })
    ]).start(() => {
      LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
      setMode(next); setError(""); setMessage(""); setNeedsCode(false); setSmsSent(null);
      slide.setValue(direction);
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true })
      ]).start();
    });
  };
  const formMotion = { opacity: fade, transform: [{ translateX: slide.interpolate({ inputRange: [-1, 1], outputRange: [-40, 40] }) }] };

  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const phone = parsePhone(form.phone, form.phoneCountry);
      if (mode === "login") {
        if (via === "phone" && !phone) throw new Error(phoneError(form.phoneCountry));
        await signIn(via === "phone" ? phone.e164 : form.email.trim(), form.password, needsCode ? form.code.trim() : undefined);
      } else if (mode === "register") {
        const birthDate = toIsoDate(form.birthDate);
        if (!birthDate) throw new Error("Escreve a data de nascimento como DD/MM/AAAA.");
        if (!parsePhone(form.phone, form.phoneCountry)) throw new Error(phoneError(form.phoneCountry));
        const result = await api("/auth/register", { method: "POST", body: {
          displayName: form.displayName.trim(), username: form.username.trim().toLowerCase(), email: form.email.trim(),
          password: form.password, birthDate, isCreator: form.isCreator, phone: form.phone.trim(), phoneCountry: form.phoneCountry, ...(form.invite.trim() ? { invite: form.invite.trim() } : {})
        } });
        // Volta a "Entrar" com a mesma animação; a mensagem aparece depois de o formulário entrar.
        switchTo("login");
        setTimeout(() => setMessage(result.message || "Conta criada. Confirma o teu email para entrar."), 420);
      } else if (via === "email") {
        await api("/auth/forgot-password", { method: "POST", body: { email: form.email.trim() } });
        setMessage("Se existir uma conta com este email, enviámos uma ligação para redefinir a palavra-passe.");
      } else if (!smsSent) {
        if (!phone) throw new Error(phoneError(form.phoneCountry));
        const result = await api("/auth/forgot-password/phone", { method: "POST", body: { phone: phone.e164, channel: smsChannels[0] } });
        setSmsSent(result.phone || phone.e164);
        if (result.devCode) set("code")(result.devCode);
        setMessage(result.message);
      } else {
        if (form.password.length < PASSWORD_MIN) throw new Error(`A palavra-passe precisa de pelo menos ${PASSWORD_MIN} caracteres.`);
        const result = await api("/auth/reset-password/phone", { method: "POST", body: { phone: smsSent, code: form.code.trim(), password: form.password } });
        setSmsSent(null);
        set("password")("");
        set("code")("");
        switchTo("login");
        setTimeout(() => setMessage(result.message), 420);
      }
    } catch (submitError) {
      if (submitError.data?.twoFactorRequired) setNeedsCode(true);
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const hasIdentifier = via === "phone" ? form.phone.trim().length >= 7 : Boolean(form.email.trim());
  const ready = mode === "login" ? hasIdentifier && form.password
    : mode === "register" ? form.displayName && form.username && form.email && form.password.length >= PASSWORD_MIN && form.birthDate.length === 10 && form.phone.trim().length >= 7
      : via === "phone" && smsSent ? form.code.length >= 4 && form.password.length >= PASSWORD_MIN : hasIdentifier;
  const titles = { login: ["Entra no Tchilar", "Conecta, partilha, vive."], register: ["Cria a tua conta", "É grátis e demora um minuto."], forgot: ["Recuperar acesso", via === "phone" ? `Enviamos um código por ${smsChannels[0] === "whatsapp" ? "WhatsApp" : "SMS"} para o teu número confirmado. Se ainda tens o email, usa-o.` : "Enviamos uma ligação para o teu email."] };

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Image source={isDark ? require("../../assets/tchilar-splash-dark.png") : require("../../assets/tchilar-logo-full.png")}
          style={styles.logo} contentFit="contain" accessibilityLabel="Tchilar" />

        {mode !== "forgot" && <View style={styles.tabs} onLayout={event => setTabsWidth(event.nativeEvent.layout.width)}>
          {tabsWidth > 0 && <Animated.View style={[styles.pill, { width: (tabsWidth - 8) / 2,
            transform: [{ translateX: pill.interpolate({ inputRange: [0, 1], outputRange: [0, (tabsWidth - 8) / 2] }) }] }]} />}
          {[["login", "Entrar"], ["register", "Criar conta"]].map(([key, label]) => <Pressable key={key} style={styles.tab} onPress={() => switchTo(key)}
            accessibilityRole="tab" accessibilityState={{ selected: mode === key }}>
            <Text style={[styles.tabText, mode === key && styles.tabTextOn]}>{label}</Text>
          </Pressable>)}
        </View>}

        <Animated.View style={[{ gap: 10 }, formMotion]}>
        <Text style={styles.title}>{titles[mode][0]}</Text>
        <Text style={styles.subtitle}>{titles[mode][1]}</Text>

        <View style={styles.form}>
          {mode === "register" && <>
            <Input placeholder="Nome (como te conhecem)" value={form.displayName} onChangeText={set("displayName")} autoComplete="name" maxLength={100} editable={!busy} />
            <Input placeholder="Nome de utilizador (ex.: ana.luanda)" value={form.username} onChangeText={value => set("username")(value.replace(/\s/g, ""))} autoCapitalize="none" autoComplete="username" maxLength={40} editable={!busy} />
          </>}
          {mode !== "register" && <View style={styles.via} accessibilityRole="radiogroup">
            {[["email", "Email"], ["phone", "Telemóvel"]].map(([key, label]) => <Pressable key={key} onPress={() => { setVia(key); setError(""); setSmsSent(null); }}
              style={[styles.viaOption, via === key && styles.viaOptionOn]} accessibilityRole="radio" accessibilityState={{ checked: via === key }} disabled={busy}>
              <Text style={[styles.viaText, via === key && styles.viaTextOn]}>{label}</Text>
            </Pressable>)}
          </View>}
          {mode !== "register" && via === "phone"
            ? smsSent
              ? <>
                <Text style={styles.hint}>Escreve o código que recebeste em {formatPhone(smsSent)} e a nova palavra-passe.</Text>
                <Input placeholder="Código do SMS" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10}
                  value={form.code} onChangeText={value => set("code")(value.replace(/\D/g, ""))} editable={!busy} />
                <Input placeholder={`Nova palavra-passe (mín. ${PASSWORD_MIN} caracteres)`} secureTextEntry autoComplete="new-password"
                  value={form.password} onChangeText={set("password")} editable={!busy} />
                <Pressable onPress={() => { setSmsSent(null); setMessage(""); }}><Text style={styles.smallLink}>Mudar de número ou pedir outro código</Text></Pressable>
              </>
              : <PhoneInput country={form.phoneCountry} onCountryChange={set("phoneCountry")} value={form.phone} onChangeText={set("phone")} editable={!busy} />
            : <Input placeholder="Email" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address"
              value={form.email} onChangeText={set("email")} editable={!busy} />}
          {mode === "login" && via === "phone" && <Text style={styles.hint}>Só funciona com o número confirmado (Definições → Conta).</Text>}
          {mode !== "forgot" && <Input placeholder={mode === "register" ? `Palavra-passe (mín. ${PASSWORD_MIN} caracteres)` : "Palavra-passe"} secureTextEntry
            autoComplete={mode === "register" ? "new-password" : "password"} value={form.password} onChangeText={set("password")} editable={!busy} />}
          {mode === "register" && <>
            <Input placeholder="Data de nascimento (DD/MM/AAAA)" keyboardType="number-pad" value={form.birthDate} onChangeText={value => set("birthDate")(formatDateTyping(value))} maxLength={10} editable={!busy} />
            <PhoneInput country={form.phoneCountry} onCountryChange={set("phoneCountry")} value={form.phone} onChangeText={set("phone")} editable={!busy} />
            <Text style={styles.hint}>Privado. Se quiseres entrar com o telemóvel, confirma-o depois em Definições → Conta (opcional).</Text>
            <Input placeholder="Código de convite (opcional)" autoCapitalize="none" value={form.invite} onChangeText={set("invite")} editable={!busy} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}><Text style={styles.switchTitle}>Sou criador de conteúdo</Text><Text style={styles.switchHint}>Podes ganhar com subscrições, estrelas e campanhas.</Text></View>
              <Switch value={form.isCreator} onValueChange={set("isCreator")} trackColor={{ true: colors.primary }} />
            </View>
          </>}
          {mode === "login" && needsCode && <Input placeholder="Código de 6 dígitos" keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" value={form.code} onChangeText={set("code")} editable={!busy} />}
          {Boolean(expiredNotice) && !error && !message && mode === "login" && <Text style={styles.expired}>{expiredNotice}</Text>}
          {Boolean(error) && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          {Boolean(message) && <Text style={styles.message}>{message}</Text>}
          <Pressable style={[styles.button, (busy || !ready) && styles.buttonDisabled]} onPress={submit} disabled={busy || !ready}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : via === "email" ? "Enviar ligação" : smsSent ? "Guardar nova palavra-passe" : "Enviar código"}</Text>}
          </Pressable>
        </View>

        {mode === "login" && <>
          <Pressable onPress={() => switchTo("forgot")}><Text style={styles.link}>Esqueceste a palavra-passe?</Text></Pressable>
        </>}
        {mode === "forgot" && <Pressable onPress={() => switchTo("login")}><Text style={styles.link}>Voltar a entrar</Text></Pressable>}
        {mode === "register" && <Text style={styles.legal}>Ao criar conta aceitas os{" "}
          <Text style={styles.legalLink} onPress={() => Linking.openURL(`${WEB_URL}/terms`)} accessibilityRole="link">Termos de utilização</Text> e a{" "}
          <Text style={styles.legalLink} onPress={() => Linking.openURL(`${WEB_URL}/privacy`)} accessibilityRole="link">Política de privacidade</Text> do Tchilar.
          Não é tolerado conteúdo abusivo: podes denunciar e bloquear quem não cumpre as regras.</Text>}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  // Em tablets, o formulário fica numa coluna centrada (não estica a toda a largura do iPad).
  wrap: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 10, width: "100%", maxWidth: 520, alignSelf: "center" },
  logo: { width: 210, height: 52, alignSelf: "center", marginBottom: 8 },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: colors.background, marginBottom: 6 },
  pill: { position: "absolute", top: 4, left: 4, bottom: 4, borderRadius: 12, backgroundColor: colors.surface,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 11 },
  tabText: { color: colors.muted, fontWeight: "800", fontSize: 15 },
  tabTextOn: { color: colors.text },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center", marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, textAlign: "center", marginBottom: 12 },
  form: { gap: 12 },
  input: { height: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.background },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.background },
  switchTitle: { color: colors.text, fontWeight: "700" },
  switchHint: { color: colors.muted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, marginTop: -6, paddingHorizontal: 4 },
  via: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 14, backgroundColor: colors.background },
  viaOption: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 10 },
  viaOptionOn: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  viaText: { color: colors.muted, fontWeight: "700" },
  viaTextOn: { color: colors.text },
  smallLink: { color: colors.primary, fontSize: 14, fontWeight: "600", textAlign: "center" },
  expired: { color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "center" },
  message: { color: colors.good, fontSize: 14, fontWeight: "600" },
  button: { height: 52, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  link: { color: colors.primary, fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 12 },
  legal: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 17 },
  legalLink: { color: colors.text, fontWeight: "700", textDecorationLine: "underline" }
});
