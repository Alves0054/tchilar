import { Image } from "expo-image";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

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
  const { user, signIn } = useSession();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", code: "", displayName: "", username: "", birthDate: "", invite: "", isCreator: false });
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  if (user) return <Redirect href="/" />;
  const set = key => value => setForm(current => ({ ...current, [key]: value }));
  const switchTo = next => { setMode(next); setError(""); setMessage(""); setNeedsCode(false); };

  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "login") {
        await signIn(form.email.trim(), form.password, needsCode ? form.code.trim() : undefined);
      } else if (mode === "register") {
        const birthDate = toIsoDate(form.birthDate);
        if (!birthDate) throw new Error("Escreve a data de nascimento como DD/MM/AAAA.");
        const result = await api("/auth/register", { method: "POST", body: {
          displayName: form.displayName.trim(), username: form.username.trim().toLowerCase(), email: form.email.trim(),
          password: form.password, birthDate, isCreator: form.isCreator, ...(form.invite.trim() ? { invite: form.invite.trim() } : {})
        } });
        setMode("login");
        setMessage(result.message || "Conta criada. Confirma o teu email para entrar.");
      } else {
        await api("/auth/forgot-password", { method: "POST", body: { email: form.email.trim() } });
        setMessage("Se existir uma conta com este email, enviámos uma ligação para redefinir a palavra-passe.");
      }
    } catch (submitError) {
      if (submitError.data?.twoFactorRequired) setNeedsCode(true);
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === "login" ? form.email && form.password
    : mode === "register" ? form.displayName && form.username && form.email && form.password.length >= PASSWORD_MIN && form.birthDate.length === 10
      : form.email;
  const titles = { login: ["Entra no Tchilar", "Conecta, partilha, vive."], register: ["Cria a tua conta", "É grátis e demora um minuto."], forgot: ["Recuperar acesso", "Enviamos uma ligação para o teu email."] };

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Image source={require("../../assets/tchilar-icon.png")} style={styles.logo} contentFit="contain" />
        <Text style={styles.title}>{titles[mode][0]}</Text>
        <Text style={styles.subtitle}>{titles[mode][1]}</Text>

        <View style={styles.form}>
          {mode === "register" && <>
            <Input placeholder="Nome (como te conhecem)" value={form.displayName} onChangeText={set("displayName")} autoComplete="name" maxLength={100} editable={!busy} />
            <Input placeholder="Nome de utilizador (ex.: ana.luanda)" value={form.username} onChangeText={value => set("username")(value.replace(/\s/g, ""))} autoCapitalize="none" autoComplete="username" maxLength={40} editable={!busy} />
          </>}
          <Input placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={form.email} onChangeText={set("email")} editable={!busy} />
          {mode !== "forgot" && <Input placeholder={mode === "register" ? `Palavra-passe (mín. ${PASSWORD_MIN} caracteres)` : "Palavra-passe"} secureTextEntry
            autoComplete={mode === "register" ? "new-password" : "password"} value={form.password} onChangeText={set("password")} editable={!busy} />}
          {mode === "register" && <>
            <Input placeholder="Data de nascimento (DD/MM/AAAA)" keyboardType="number-pad" value={form.birthDate} onChangeText={value => set("birthDate")(formatDateTyping(value))} maxLength={10} editable={!busy} />
            <Input placeholder="Código de convite (opcional)" autoCapitalize="none" value={form.invite} onChangeText={set("invite")} editable={!busy} />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}><Text style={styles.switchTitle}>Sou criador de conteúdo</Text><Text style={styles.switchHint}>Podes ganhar com subscrições, estrelas e campanhas.</Text></View>
              <Switch value={form.isCreator} onValueChange={set("isCreator")} trackColor={{ true: colors.primary }} />
            </View>
          </>}
          {mode === "login" && needsCode && <Input placeholder="Código de 6 dígitos" keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" value={form.code} onChangeText={set("code")} editable={!busy} />}
          {Boolean(error) && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
          {Boolean(message) && <Text style={styles.message}>{message}</Text>}
          <Pressable style={[styles.button, (busy || !ready) && styles.buttonDisabled]} onPress={submit} disabled={busy || !ready}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : "Enviar ligação"}</Text>}
          </Pressable>
        </View>

        {mode === "login" && <>
          <Pressable onPress={() => switchTo("forgot")}><Text style={styles.link}>Esqueceste a palavra-passe?</Text></Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.secondaryButton} onPress={() => switchTo("register")}><Text style={styles.secondaryText}>Criar conta nova</Text></Pressable>
        </>}
        {mode !== "login" && <Pressable onPress={() => switchTo("login")}><Text style={styles.link}>Já tenho conta: entrar</Text></Pressable>}
        {mode === "register" && <Text style={styles.legal}>Ao criar conta aceitas os Termos de utilização e a Política de privacidade do Tchilar.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  wrap: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 10 },
  logo: { width: 84, height: 84, alignSelf: "center" },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center", marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, textAlign: "center", marginBottom: 12 },
  form: { gap: 12 },
  input: { height: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.background },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.background },
  switchTitle: { color: colors.text, fontWeight: "700" },
  switchHint: { color: colors.muted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 14 },
  message: { color: "#1E7A4B", fontSize: 14, fontWeight: "600" },
  button: { height: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  link: { color: colors.primary, fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: 12 },
  secondaryButton: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  legal: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8 }
});
