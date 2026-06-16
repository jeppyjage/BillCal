import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";

export default function Login() {
  const theme = useTheme();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    setErr("");
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)/calendar");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} testID="login-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={[s.logo, { backgroundColor: theme.brandTertiary }]}>
            <Ionicons name="calendar" size={40} color={theme.brandPrimary} />
          </View>
          <Text style={[s.title, { color: theme.onSurface }]}>Welcome to BillCal</Text>
          <Text style={[s.subtitle, { color: theme.onSurfaceSecondary }]}>Track your bills, never miss a due date.</Text>

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Email</Text>
          <TextInput
            testID="login-email-input"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.info}
            autoCapitalize="none"
            keyboardType="email-address"
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Password</Text>
          <TextInput
            testID="login-password-input"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={theme.info}
            secureTextEntry
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          {err ? <Text style={[s.err, { color: theme.error }]} testID="login-error">{err}</Text> : null}

          <Pressable
            testID="login-submit-button"
            onPress={handleSubmit}
            disabled={busy || !email || !password}
            style={[s.btn, { backgroundColor: theme.brandPrimary, opacity: busy || !email || !password ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator color={theme.onBrandPrimary} /> :
              <Text style={[s.btnText, { color: theme.onBrandPrimary }]}>Sign In</Text>}
          </Pressable>

          <View style={s.row}>
            <Text style={{ color: theme.onSurfaceSecondary }}>New here? </Text>
            <Link href="/auth/register" asChild>
              <Pressable testID="goto-register-link"><Text style={{ color: theme.brandPrimary, fontWeight: "500" }}>Create account</Text></Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: SPACING.xl, paddingTop: SPACING.xxl, paddingBottom: SPACING.xxxl },
  logo: { width: 80, height: 80, borderRadius: RADIUS.lg, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: SPACING.lg },
  title: { fontSize: 24, fontWeight: "500", textAlign: "center", marginBottom: SPACING.xs },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: SPACING.xxl },
  label: { fontSize: 13, marginBottom: SPACING.xs, marginTop: SPACING.md },
  input: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, fontSize: 16, minHeight: 48 },
  err: { marginTop: SPACING.md, fontSize: 13 },
  btn: { marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.md, alignItems: "center", minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: "500" },
  row: { flexDirection: "row", justifyContent: "center", marginTop: SPACING.xl },
});
