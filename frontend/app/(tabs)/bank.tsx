import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { api, BankAccount, BankTransaction } from "@/src/api/client";
import PieChart from "@/src/components/PieChart";

function fmt(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default function BankScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [insightMode, setInsightMode] = useState<"category" | "merchant">("category");

  const insightData = useMemo(() => {
    const groups: Record<string, number> = {};
    // Treat Rent and Utilities as a single category for insights
    const normalizeCategory = (c: string) => (c === "Rent" || c === "Utilities") ? "Rent & Utilities" : c;
    txs.forEach(t => {
      if (t.amount >= 0) return; // expenses only
      const key = insightMode === "category" ? normalizeCategory(t.category) : t.description;
      groups[key] = (groups[key] || 0) + Math.abs(t.amount);
    });
    return Object.entries(groups)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [txs, insightMode]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [a, t] = await Promise.all([api.listAccounts(token), api.listTransactions(token)]);
      setAccounts(a); setTxs(t);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSync = async () => {
    if (!token) return;
    setSyncing(true);
    try {
      const r = await api.syncBank(token);
      setLastSync(new Date(r.last_synced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      await load();
    } catch {} finally { setSyncing(false); }
  };

  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="bank-screen">
      <View style={s.header}>
        <View>
          <Text style={[s.headerSub, { color: theme.onSurfaceSecondary }]}>Linked Accounts</Text>
          <Text style={[s.headerTitle, { color: theme.onSurface }]}>Bank Sync</Text>
        </View>
        <Pressable
          testID="sync-button"
          onPress={handleSync}
          disabled={syncing}
          style={[s.syncBtn, { backgroundColor: theme.brandPrimary, opacity: syncing ? 0.6 : 1 }]}
        >
          {syncing ? <ActivityIndicator color={theme.onBrandPrimary} size="small" /> :
            <>
              <Ionicons name="sync" size={16} color={theme.onBrandPrimary} />
              <Text style={[s.syncText, { color: theme.onBrandPrimary }]}>Sync</Text>
            </>}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.brandPrimary} />}
      >
        {loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 40 }} /> : (
          <>
            <View style={[s.totalCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]} testID="bank-total">
              <Text style={[{ color: theme.onSurfaceSecondary, fontSize: 12 }]}>Net Balance</Text>
              <Text style={{ color: theme.onSurface, fontSize: 30, fontWeight: "500", marginTop: 4 }}>{fmt(total)}</Text>
              {lastSync && (
                <Text style={{ color: theme.info, fontSize: 11, marginTop: 6 }}>Last synced at {lastSync}</Text>
              )}
              <View style={[s.mockBadge, { backgroundColor: theme.warning + "22" }]}>
                <Ionicons name="information-circle" size={12} color={theme.warning} />
                <Text style={{ color: theme.warning, fontSize: 11, marginLeft: 4 }}>Demo data (mock sync)</Text>
              </View>
            </View>

            <Text style={[s.sectionTitle, { color: theme.onSurface }]}>Accounts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.md }}>
              {accounts.map(a => (
                <View key={a.id} testID={`account-card-${a.id}`} style={[s.accCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                  <View style={[s.accIcon, { backgroundColor: theme.brandTertiary }]}>
                    <Ionicons name={a.type === "credit" ? "card" : a.type === "savings" ? "trending-up" : "wallet"} size={20} color={theme.onBrandTertiary} />
                  </View>
                  <Text style={[{ color: theme.onSurface, fontSize: 14, fontWeight: "500", marginTop: 8 }]}>{a.name}</Text>
                  <Text style={{ color: theme.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>{a.institution} · {a.masked_number}</Text>
                  <Text style={{ color: a.balance < 0 ? theme.error : theme.onSurface, fontSize: 18, fontWeight: "500", marginTop: 10 }}>{fmt(a.balance)}</Text>
                </View>
              ))}
            </ScrollView>

            <Text style={[s.sectionTitle, { color: theme.onSurface, marginTop: SPACING.xl }]}>Spending Insights</Text>
            <View style={[s.insightCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]} testID="spending-insights">
              <View style={s.toggleRow}>
                {(["category", "merchant"] as const).map(mode => {
                  const active = insightMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      testID={`insight-${mode}`}
                      onPress={() => setInsightMode(mode)}
                      style={[s.toggleBtn, { backgroundColor: active ? theme.brandPrimary : theme.surfaceTertiary, borderColor: active ? theme.brandPrimary : theme.border }]}
                    >
                      <Text style={{ color: active ? theme.onBrandPrimary : theme.onSurface, fontSize: 12, fontWeight: "500", textTransform: "capitalize" }}>By {mode}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <PieChart data={insightData} onColor={theme.onSurface} secondaryColor={theme.surfaceSecondary} />
            </View>

            <Text style={[s.sectionTitle, { color: theme.onSurface, marginTop: SPACING.xl }]}>Recent Activity</Text>
            <View style={{ paddingHorizontal: SPACING.lg }}>
              {txs.length === 0 ? (
                <Text style={{ color: theme.info, padding: SPACING.lg, textAlign: "center" }}>No transactions yet</Text>
              ) : txs.map(t => (
                <View key={t.id} testID={`tx-row-${t.id}`} style={[s.txRow, { borderColor: theme.divider }]}>
                  <View style={[s.txIcon, { backgroundColor: t.amount > 0 ? theme.brandTertiary : theme.surfaceTertiary }]}>
                    <Ionicons name={t.amount > 0 ? "arrow-down" : "arrow-up"} size={16} color={t.amount > 0 ? theme.onBrandTertiary : theme.onSurfaceSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.onSurface, fontSize: 14, fontWeight: "500" }} numberOfLines={1}>{t.description}</Text>
                    <Text style={{ color: theme.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>{t.category} · {t.date}</Text>
                  </View>
                  <Text style={{ color: t.amount > 0 ? theme.success : theme.onSurface, fontSize: 14, fontWeight: "500" }}>
                    {fmt(t.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerSub: { fontSize: 12 },
  headerTitle: { fontSize: 24, fontWeight: "500", marginTop: 2 },
  syncBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, gap: 6, minHeight: 40 },
  syncText: { fontSize: 13, fontWeight: "500" },
  totalCard: { marginHorizontal: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1 },
  mockBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginTop: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "500", marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg },
  accCard: { width: 200, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1 },
  accIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txRow: { flexDirection: "row", alignItems: "center", paddingVertical: SPACING.md, borderBottomWidth: 0.5, gap: SPACING.md },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  insightCard: { marginHorizontal: SPACING.lg, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1 },
  toggleRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1 },
});
