import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { api, BankTransaction } from "@/src/api/client";

function fmt(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default function InsightDetailScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ key: string; mode: string }>();
  const key = String(params.key || "");
  const mode = (params.mode as "category" | "merchant") || "category";
  const [txs, setTxs] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const all = await api.listTransactions(token);
      const filtered = all.filter(t => {
        if (t.amount >= 0) return false;
        return mode === "category" ? t.category === key : t.description === key;
      });
      setTxs(filtered);
    } catch {}
    finally { setLoading(false); }
  }, [token, key, mode]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="insight-detail">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={theme.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.headerSub, { color: theme.onSurfaceSecondary }]}>{mode === "category" ? "Category" : "Merchant"}</Text>
          <Text style={[s.headerTitle, { color: theme.onSurface }]} numberOfLines={1}>{key}</Text>
        </View>
      </View>

      <View style={[s.totalCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
        <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12 }}>Total spent</Text>
        <Text style={{ color: theme.onSurface, fontSize: 28, fontWeight: "500", marginTop: 4 }}>{fmt(total)}</Text>
        <Text style={{ color: theme.info, fontSize: 12, marginTop: 4 }}>{txs.length} transaction{txs.length !== 1 ? "s" : ""}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }}>
        {loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 30 }} /> :
          txs.length === 0 ? (
            <Text style={{ color: theme.info, textAlign: "center", marginTop: 40 }}>No matching transactions</Text>
          ) : txs.map(t => (
            <View key={t.id} style={[s.row, { borderColor: theme.divider }]}>
              <View style={[s.icon, { backgroundColor: theme.surfaceTertiary }]}>
                <Ionicons name="arrow-up" size={16} color={theme.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.onSurface, fontSize: 14, fontWeight: "500" }} numberOfLines={1}>{t.description}</Text>
                <Text style={{ color: theme.onSurfaceSecondary, fontSize: 11, marginTop: 2 }}>{t.category} · {t.date}</Text>
              </View>
              <Text style={{ color: theme.onSurface, fontSize: 14, fontWeight: "500" }}>{fmt(t.amount)}</Text>
            </View>
          ))
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md, gap: SPACING.sm },
  backBtn: { padding: 4 },
  headerSub: { fontSize: 12 },
  headerTitle: { fontSize: 22, fontWeight: "500", marginTop: 2 },
  totalCard: { marginHorizontal: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: SPACING.md },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: SPACING.md, borderBottomWidth: 0.5, gap: SPACING.md },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
