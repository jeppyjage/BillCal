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

export default function Register() {
  const theme = useTheme();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    setErr("");
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      await register(email.trim(), password, name.trim() || undefined);
      router.replace("/(tabs)/calendar");
    } catch (e: any) {
      setErr(e.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} testID="register-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={s.back} testID="back-button">
            <Ionicons name="chevron-back" size={28} color={theme.onSurface} />
          </Pressable>
          <Text style={[s.title, { color: theme.onSurface }]}>Create your account</Text>
          <Text style={[s.subtitle, { color: theme.onSurfaceSecondary }]}>It only takes a minute.</Text>

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Full name (optional)</Text>
          <TextInput
            testID="register-name-input"
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            placeholderTextColor={theme.info}
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Email</Text>
          <TextInput
            testID="register-email-input"
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
            testID="register-password-input"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor={theme.info}
            secureTextEntry
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          {err ? <Text style={[s.err, { color: theme.error }]} testID="register-error">{err}</Text> : null}

          <Pressable
            testID="register-submit-button"
            onPress={handleSubmit}
            disabled={busy || !email || !password}
            style={[s.btn, { backgroundColor: theme.brandPrimary, opacity: busy || !email || !password ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator color={theme.onBrandPrimary} /> :
              <Text style={[s.btnText, { color: theme.onBrandPrimary }]}>Create Account</Text>}
          </Pressable>

          <View style={s.row}>
            <Text style={{ color: theme.onSurfaceSecondary }}>Have an account? </Text>
            <Link href="/auth/login" asChild>
              <Pressable testID="goto-login-link"><Text style={{ color: theme.brandPrimary, fontWeight: "500" }}>Sign In</Text></Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: SPACING.xl, paddingTop: SPACING.lg, paddingBottom: SPACING.xxxl },
  back: { width: 44, height: 44, justifyContent: "center", marginBottom: SPACING.md },
  title: { fontSize: 24, fontWeight: "500", marginBottom: SPACING.xs },
  subtitle: { fontSize: 14, marginBottom: SPACING.xl },
  label: { fontSize: 13, marginBottom: SPACING.xs, marginTop: SPACING.md },
  input: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, fontSize: 16, minHeight: 48 },
  err: { marginTop: SPACING.md, fontSize: 13 },
  btn: { marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.md, alignItems: "center", minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: "500" },
  row: { flexDirection: "row", justifyContent: "center", marginTop: SPACING.xl },
});
