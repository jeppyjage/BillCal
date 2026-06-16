import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { ensureNotificationPermission } from "@/src/notifications";

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const [notifsEnabled, setNotifsEnabled] = useState(true);

  const handleLogout = async () => {
    await logout();
    router.replace("/auth/login");
  };

  const toggleNotifs = async (val: boolean) => {
    if (val) {
      const ok = await ensureNotificationPermission();
      setNotifsEnabled(ok);
    } else setNotifsEnabled(false);
  };

  const SettingRow = ({ icon, label, value, onPress, rightEl }: any) => (
    <Pressable onPress={onPress} style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
      <View style={[s.iconWrap, { backgroundColor: theme.brandTertiary }]}>
        <Ionicons name={icon} size={18} color={theme.onBrandTertiary} />
      </View>
      <Text style={[s.label, { color: theme.onSurface }]}>{label}</Text>
      <View style={{ flex: 1 }} />
      {rightEl ?? (value ? <Text style={{ color: theme.onSurfaceSecondary, fontSize: 13 }}>{value}</Text> : null)}
    </Pressable>
  );

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="settings-screen">
      <View style={s.header}>
        <Text style={[s.headerTitle, { color: theme.onSurface }]}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}>
        <View style={[s.profile, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
          <View style={[s.avatar, { backgroundColor: theme.brandPrimary }]}>
            <Text style={{ color: theme.onBrandPrimary, fontSize: 22, fontWeight: "500" }}>
              {(user?.full_name || user?.email || "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.name, { color: theme.onSurface }]} testID="settings-name">{user?.full_name || "User"}</Text>
            <Text style={{ color: theme.onSurfaceSecondary, fontSize: 13 }} testID="settings-email">{user?.email}</Text>
          </View>
        </View>

        <Text style={[s.section, { color: theme.onSurfaceSecondary }]}>Preferences</Text>
        <SettingRow
          icon="notifications"
          label="Bill Reminders"
          rightEl={<Switch value={notifsEnabled} onValueChange={toggleNotifs} trackColor={{ true: theme.brandPrimary, false: theme.borderStrong }} testID="notifications-switch" />}
        />
        <SettingRow icon="color-palette" label="Theme" value="Auto (System)" />

        <Text style={[s.section, { color: theme.onSurfaceSecondary }]}>Account</Text>
        <Pressable
          testID="logout-button"
          onPress={handleLogout}
          style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
        >
          <View style={[s.iconWrap, { backgroundColor: theme.error + "22" }]}>
            <Ionicons name="log-out" size={18} color={theme.error} />
          </View>
          <Text style={[s.label, { color: theme.error }]}>Log out</Text>
        </Pressable>

        <Text style={{ color: theme.info, textAlign: "center", marginTop: SPACING.xl, fontSize: 12 }}>BillCal v1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  headerTitle: { fontSize: 24, fontWeight: "500" },
  profile: { flexDirection: "row", alignItems: "center", padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACING.md, marginBottom: SPACING.xl },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "500" },
  section: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingLeft: SPACING.xs },
  row: { flexDirection: "row", alignItems: "center", padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm, minHeight: 56, gap: SPACING.md },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "500" },
});
