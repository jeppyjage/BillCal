import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS, CATEGORIES } from "@/src/theme";
import { api, Bill } from "@/src/api/client";

type Filter = "Upcoming" | "Paid" | "All";
const FILTERS: Filter[] = ["Upcoming", "Paid", "All"];

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default function BillsScreen() {
  const theme = useTheme();
  const { token, user } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("Upcoming");

  const load = useCallback(async () => {
    if (!token) return;
    try { setBills(await api.listBills(token)); } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const { thisMonthTotal, unpaidCount, filtered } = useMemo(() => {
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    let total = 0;
    let unpaid = 0;
    bills.forEach(b => {
      if (b.due_date.startsWith(monthKey)) total += b.amount;
      if (!b.paid && b.due_date >= ymd(today)) unpaid++;
    });
    const sorted = [...bills].sort((a, b) => a.due_date.localeCompare(b.due_date));
    const todayStr = ymd(today);
    const f = filter === "Paid"
      ? sorted.filter(b => b.paid)
      : filter === "Upcoming"
        ? sorted.filter(b => !b.paid && b.due_date >= todayStr)
        : sorted;
    return { thisMonthTotal: total, unpaidCount: unpaid, filtered: f };
  }, [bills, filter]);

  const togglePaid = async (b: Bill) => {
    if (!token) return;
    try {
      const updated = await api.togglePaid(token, b.id);
      setBills(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch {}
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="bills-screen">
      <View style={s.header}>
        <Text style={[s.headerSub, { color: theme.onSurfaceSecondary }]}>Hi, {user?.full_name || user?.email}</Text>
        <Text style={[s.headerTitle, { color: theme.onSurface }]}>Your Bills</Text>
      </View>

      <FlatList
        testID="bills-list"
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            <View style={[s.heroCard, { backgroundColor: theme.brandPrimary }]} testID="dashboard-hero">
              <Text style={[s.heroLabel, { color: theme.onBrandPrimary, opacity: 0.85 }]}>Total Due This Month</Text>
              <Text style={[s.heroAmount, { color: theme.onBrandPrimary }]} testID="total-this-month">
                ${thisMonthTotal.toFixed(2)}
              </Text>
              <View style={s.heroRow}>
                <View style={s.heroStat}>
                  <Ionicons name="time-outline" size={16} color={theme.onBrandPrimary} />
                  <Text style={[s.heroStatText, { color: theme.onBrandPrimary }]}>{unpaidCount} upcoming</Text>
                </View>
                <View style={s.heroStat}>
                  <Ionicons name="receipt-outline" size={16} color={theme.onBrandPrimary} />
                  <Text style={[s.heroStatText, { color: theme.onBrandPrimary }]}>{bills.length} total</Text>
                </View>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chipRow}
              style={{ height: 56 }}
            >
              {FILTERS.map(f => {
                const active = filter === f;
                return (
                  <Pressable
                    key={f}
                    testID={`filter-chip-${f.toLowerCase()}`}
                    onPress={() => setFilter(f)}
                    style={[s.chip, {
                      backgroundColor: active ? theme.brandPrimary : theme.surfaceSecondary,
                      borderColor: active ? theme.brandPrimary : theme.border,
                    }]}
                  >
                    <Text style={{ color: active ? theme.onBrandPrimary : theme.onSurface, fontSize: 13, fontWeight: "500" }}>{f}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 40 }} /> : (
            <View style={s.empty}>
              <Ionicons name="receipt-outline" size={64} color={theme.info} />
              <Text style={[s.emptyTitle, { color: theme.onSurface }]}>No bills yet</Text>
              <Text style={[s.emptySub, { color: theme.onSurfaceSecondary }]}>Tap + to add your first bill</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.brandPrimary} />}
        renderItem={({ item }) => {
          const cat = CATEGORIES.find(c => c.key === item.category) || CATEGORIES[CATEGORIES.length - 1];
          return (
            <Pressable
              testID={`bill-row-${item.id}`}
              onPress={() => router.push(`/bill/${item.id}`)}
              style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
            >
              <View style={[s.catIcon, { backgroundColor: theme.brandTertiary }]}>
                <Ionicons name={cat.icon as any} size={20} color={theme.onBrandTertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowTitle, { color: theme.onSurface }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[s.rowSub, { color: theme.onSurfaceSecondary }]}>
                  Due {new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {item.category}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.rowAmt, { color: theme.onSurface }]}>${item.amount.toFixed(2)}</Text>
                <Pressable
                  testID={`bill-toggle-${item.id}`}
                  onPress={() => togglePaid(item)}
                  style={[s.payTag, { backgroundColor: item.paid ? theme.brandTertiary : theme.surfaceTertiary }]}
                >
                  <Text style={{ color: item.paid ? theme.onBrandTertiary : theme.onSurfaceSecondary, fontSize: 11, fontWeight: "500" }}>
                    {item.paid ? "Paid" : "Mark paid"}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable
        testID="add-bill-fab-bills"
        onPress={() => router.push("/bill/new")}
        style={[s.fab, { backgroundColor: theme.brandPrimary }]}
      >
        <Ionicons name="add" size={28} color={theme.onBrandPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  headerSub: { fontSize: 12 },
  headerTitle: { fontSize: 24, fontWeight: "500", marginTop: 2 },
  heroCard: { marginHorizontal: SPACING.lg, padding: SPACING.xl, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  heroLabel: { fontSize: 13 },
  heroAmount: { fontSize: 36, fontWeight: "500", marginTop: 4 },
  heroRow: { flexDirection: "row", marginTop: SPACING.md, gap: SPACING.lg },
  heroStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroStatText: { fontSize: 13 },
  chipRow: { paddingHorizontal: SPACING.lg, paddingTop: 8, gap: SPACING.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center", flexShrink: 0 },
  row: { flexDirection: "row", alignItems: "center", padding: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 64 },
  catIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: SPACING.md },
  rowTitle: { fontSize: 15, fontWeight: "500" },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: "500" },
  payTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 4 },
  empty: { alignItems: "center", padding: SPACING.xxxl },
  emptyTitle: { fontSize: 17, fontWeight: "500", marginTop: SPACING.md },
  emptySub: { fontSize: 13, marginTop: 4 },
  fab: { position: "absolute", right: SPACING.lg, bottom: 24, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
});
