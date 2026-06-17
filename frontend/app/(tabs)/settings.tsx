import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { ensureNotificationPermission } from "@/src/notifications";
import { api, oauthUrl } from "@/src/api/client";

type CalStatus = {
  google: { connected: boolean; connected_at: string | null; configured: boolean };
  microsoft: { connected: boolean; connected_at: string | null; configured: boolean };
};

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, token, logout } = useAuth();
  const [notifsEnabled, setNotifsEnabled] = useState(true);
  const [calStatus, setCalStatus] = useState<CalStatus | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const loadCalStatus = useCallback(async () => {
    if (!token) return;
    setCalLoading(true);
    try {
      const s = await api.calendarStatus(token);
      setCalStatus(s);
    } catch (e) {
      // ignore
    } finally {
      setCalLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadCalStatus();
  }, [loadCalStatus]);

  useFocusEffect(
    useCallback(() => {
      loadCalStatus();
    }, [loadCalStatus])
  );

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

  const handleConnect = async (provider: "google" | "microsoft") => {
    if (!token) return;
    setBusyProvider(provider);
    const url = oauthUrl(provider, token);
    try {
      const result = await WebBrowser.openAuthSessionAsync(url, undefined, {
        showInRecents: true,
      });
      // refresh status regardless of result (server-side stores token)
      await loadCalStatus();
      if (result.type === "success" || result.type === "cancel" || result.type === "dismiss") {
        // ok
      }
      // After connect, if connected, kick off initial sync
      const fresh = await api.calendarStatus(token);
      setCalStatus(fresh);
      const justConnected =
        (provider === "google" && fresh.google.connected) ||
        (provider === "microsoft" && fresh.microsoft.connected);
      if (justConnected) {
        try {
          const r = await api.calendarSyncAll(token);
          if (Platform.OS === "web") {
            window.alert(`Connected! Scheduled ${r.scheduled} bills to push to your ${provider === "google" ? "Google" : "Outlook"} calendar.`);
          } else {
            Alert.alert(
              "Connected!",
              `Scheduled ${r.scheduled} bills to push to your ${provider === "google" ? "Google" : "Outlook"} calendar.\n\nFuture bills will auto-sync.`
            );
          }
        } catch {
          // ignore
        }
      }
    } catch (e: any) {
      const msg = e?.message || "Failed to open authorization window";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setBusyProvider(null);
    }
  };

  const handleDisconnect = async (provider: "google" | "microsoft") => {
    if (!token) return;
    const confirm = Platform.OS === "web"
      ? window.confirm(`Disconnect ${provider === "google" ? "Google Calendar" : "Outlook Calendar"}? Future bills will not sync, but events already created in your calendar will remain.`)
      : await new Promise<boolean>((res) => {
          Alert.alert(
            "Disconnect?",
            `Future bills will not sync to ${provider === "google" ? "Google" : "Outlook"} Calendar. Events already created will remain.`,
            [
              { text: "Cancel", style: "cancel", onPress: () => res(false) },
              { text: "Disconnect", style: "destructive", onPress: () => res(true) },
            ]
          );
        });
    if (!confirm) return;
    setBusyProvider(provider);
    try {
      await api.calendarDisconnect(token, provider);
      await loadCalStatus();
    } catch (e: any) {
      if (Platform.OS === "web") window.alert(e?.message || "Failed");
      else Alert.alert("Error", e?.message || "Failed to disconnect");
    } finally {
      setBusyProvider(null);
    }
  };

  const handleSyncNow = async () => {
    if (!token) return;
    setBusyProvider("__all__");
    try {
      const r = await api.calendarSyncAll(token);
      const msg = `Pushing ${r.scheduled} bills to ${[r.google ? "Google" : null, r.microsoft ? "Outlook" : null].filter(Boolean).join(" & ")}.`;
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Sync started", msg);
    } catch (e: any) {
      if (Platform.OS === "web") window.alert(e?.message || "Sync failed");
      else Alert.alert("Sync failed", e?.message || "Try again later");
    } finally {
      setBusyProvider(null);
    }
  };

  const SettingRow = ({ icon, label, value, onPress, rightEl }: any) => (
    <Pressable
      onPress={onPress}
      style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
    >
      <View style={[s.iconWrap, { backgroundColor: theme.brandTertiary }]}>
        <Ionicons name={icon} size={18} color={theme.onBrandTertiary} />
      </View>
      <Text style={[s.label, { color: theme.onSurface }]}>{label}</Text>
      <View style={{ flex: 1 }} />
      {rightEl ?? (value ? <Text style={{ color: theme.onSurfaceSecondary, fontSize: 13 }}>{value}</Text> : null)}
    </Pressable>
  );

  const CalendarRow = ({
    icon,
    iconColor,
    label,
    provider,
    state,
  }: {
    icon: any;
    iconColor: string;
    label: string;
    provider: "google" | "microsoft";
    state: { connected: boolean; configured: boolean; connected_at: string | null };
  }) => {
    const isBusy = busyProvider === provider;
    return (
      <View style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border, alignItems: "center" }]}>
        <View style={[s.iconWrap, { backgroundColor: iconColor + "22" }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: theme.onSurface }]}>{label}</Text>
          <Text style={{ color: state.connected ? theme.success ?? "#16a34a" : theme.onSurfaceSecondary, fontSize: 12, marginTop: 2 }}>
            {!state.configured
              ? "Not configured on server"
              : state.connected
              ? "Connected · Auto-syncing"
              : "Tap Connect to enable sync"}
          </Text>
        </View>
        {isBusy ? (
          <ActivityIndicator color={theme.brandPrimary} />
        ) : state.connected ? (
          <Pressable
            onPress={() => handleDisconnect(provider)}
            style={[s.actionBtn, { borderColor: theme.borderStrong }]}
            testID={`disconnect-${provider}`}
          >
            <Text style={{ color: theme.error, fontSize: 13, fontWeight: "500" }}>Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => state.configured && handleConnect(provider)}
            disabled={!state.configured}
            style={[
              s.actionBtn,
              { borderColor: theme.brandPrimary, backgroundColor: state.configured ? theme.brandPrimary : theme.borderStrong, opacity: state.configured ? 1 : 0.5 },
            ]}
            testID={`connect-${provider}`}
          >
            <Text style={{ color: theme.onBrandPrimary, fontSize: 13, fontWeight: "500" }}>Connect</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const anyConnected = !!(calStatus?.google.connected || calStatus?.microsoft.connected);

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

        <Text style={[s.section, { color: theme.onSurfaceSecondary }]}>External Calendars</Text>
        <Text style={[s.sectionHint, { color: theme.onSurfaceSecondary }]}>
          Push bills as events with a 1-day-before reminder. Future bills auto-sync after first connect.
        </Text>
        {calLoading && !calStatus ? (
          <View style={{ paddingVertical: SPACING.md }}>
            <ActivityIndicator color={theme.brandPrimary} />
          </View>
        ) : calStatus ? (
          <>
            <CalendarRow
              icon="logo-google"
              iconColor="#4285F4"
              label="Google Calendar"
              provider="google"
              state={calStatus.google}
            />
            <CalendarRow
              icon="mail"
              iconColor="#0078D4"
              label="Outlook Calendar"
              provider="microsoft"
              state={calStatus.microsoft}
            />
            {anyConnected ? (
              <Pressable
                onPress={handleSyncNow}
                disabled={busyProvider === "__all__"}
                style={[s.syncBtn, { borderColor: theme.brandPrimary }]}
                testID="sync-all-now"
              >
                {busyProvider === "__all__" ? (
                  <ActivityIndicator color={theme.brandPrimary} />
                ) : (
                  <>
                    <Ionicons name="sync" size={16} color={theme.brandPrimary} />
                    <Text style={{ color: theme.brandPrimary, fontWeight: "500", marginLeft: 8 }}>
                      Re-sync all bills now
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </>
        ) : null}

        <Text style={[s.section, { color: theme.onSurfaceSecondary }]}>Preferences</Text>
        <SettingRow
          icon="notifications"
          label="Bill Reminders"
          rightEl={
            <Switch
              value={notifsEnabled}
              onValueChange={toggleNotifs}
              trackColor={{ true: theme.brandPrimary, false: theme.borderStrong }}
              testID="notifications-switch"
            />
          }
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
  profile: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "500" },
  section: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingLeft: SPACING.xs,
  },
  sectionHint: { fontSize: 12, marginBottom: SPACING.md, paddingHorizontal: SPACING.xs, lineHeight: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.sm,
    minHeight: 56,
    gap: SPACING.md,
  },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "500" },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
});
