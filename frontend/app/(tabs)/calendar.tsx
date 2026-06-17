import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, useIsDark, SPACING, RADIUS, CATEGORIES } from "@/src/theme";
import { api, Bill, BankTransaction } from "@/src/api/client";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

// Category -> accent color for pill left-borders (Outlook-style)
const CAT_COLORS: Record<string, string> = {
  Utilities: "#F59E0B",
  Rent: "#EF4444",
  Subscriptions: "#8B5CF6",
  "Credit Card": "#EC4899",
  Insurance: "#06B6D4",
  Internet: "#3B82F6",
  Phone: "#10B981",
  Food: "#F97316",
  Transport: "#84CC16",
  Other: "#6B7280",
};

export default function CalendarScreen() {
  const theme = useTheme();
  const isDark = useIsDark();
  const weekBarBg = isDark ? "#06080F" : theme.borderStrong;
  const { token } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));
  const [zoom, setZoom] = useState(-1); // -2..+2, default -1 (zoomed in one step from min)

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, t] = await Promise.all([api.listBills(token), api.listTransactions(token)]);
      setBills(b); setTransactions(t);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Build the month grid including leading/trailing days from sibling months
  const month = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const startSunday = new Date(firstOfMonth);
    startSunday.setDate(1 - firstOfMonth.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + i);
      cells.push(d);
    }
    // 6 weeks; trim last row if entirely in next month
    const lastWeek = cells.slice(35, 42);
    const trim = lastWeek.every(d => d.getMonth() !== m);
    return { cells: trim ? cells.slice(0, 35) : cells, y, m };
  }, [cursor]);

  const billsByDate = useMemo(() => {
    const map: Record<string, (Bill & { isVirtual?: boolean })[]> = {};
    // Visible window: current month +/- 1 month
    const winStart = new Date(month.y, month.m - 1, 1);
    const winEnd = new Date(month.y, month.m + 2, 0);
    bills.forEach(b => {
      const original = new Date(b.due_date + "T00:00:00");
      const push = (d: Date, virtual: boolean) => {
        const k = ymd(d);
        if (!map[k]) map[k] = [];
        // For virtual (future recurring) instances, always show as unpaid
        map[k].push(virtual ? { ...b, paid: false, isVirtual: true } : b);
      };
      // Always push the original date
      if (original >= winStart && original <= winEnd) push(original, false);
      // Expand recurrence into the window
      if (b.recurrence && b.recurrence !== "none") {
        const step = (d: Date) => {
          const n = new Date(d);
          if (b.recurrence === "weekly") n.setDate(n.getDate() + 7);
          else if (b.recurrence === "monthly") n.setMonth(n.getMonth() + 1);
          else if (b.recurrence === "yearly") n.setFullYear(n.getFullYear() + 1);
          return n;
        };
        // forward
        let cur = step(original);
        let guard = 0;
        while (cur <= winEnd && guard < 400) {
          if (cur >= winStart) push(cur, true);
          cur = step(cur); guard++;
        }
        // backward (for viewing past months that pre-date the original)
        const stepBack = (d: Date) => {
          const n = new Date(d);
          if (b.recurrence === "weekly") n.setDate(n.getDate() - 7);
          else if (b.recurrence === "monthly") n.setMonth(n.getMonth() - 1);
          else if (b.recurrence === "yearly") n.setFullYear(n.getFullYear() - 1);
          return n;
        };
        cur = stepBack(original);
        guard = 0;
        while (cur >= winStart && guard < 400) {
          if (cur <= winEnd) push(cur, true);
          cur = stepBack(cur); guard++;
        }
      }
    });
    return map;
  }, [bills, month.y, month.m]);

  const txByDate = useMemo(() => {
    const map: Record<string, BankTransaction[]> = {};
    transactions.forEach(t => {
      // Only show "important" transactions: |amount| >= $25 (filter out coffees, etc.)
      if (Math.abs(t.amount) < 20) return;
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    });
    return map;
  }, [transactions]);

  // Group the flat month.cells (length 35 or 42) into weeks of 7
  const weeks = useMemo(() => {
    const arr: Date[][] = [];
    for (let i = 0; i < month.cells.length; i += 7) {
      arr.push(month.cells.slice(i, i + 7));
    }
    return arr;
  }, [month.cells]);

  const todayStr = ymd(new Date());
  const goPrev = () => setCursor(new Date(month.y, month.m - 1, 1));
  const goNext = () => setCursor(new Date(month.y, month.m + 1, 1));

  // Zoom now only adjusts cell HEIGHT (width is always 1/7 of screen).
  const z = Math.max(-2, Math.min(2, zoom));
  const CELL_HEIGHT = [90, 130, 170, 210, 250][z + 2];
  const MAX_BILLS = [2, 3, 4, 5, 6][z + 2];
  const PILL_FS = [10, 11, 12, 13, 14][z + 2];

  const numRows = month.cells.length / 7;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="calendar-screen">
      <View style={s.header}>
        <Pressable testID="today-btn" onPress={() => { setCursor(new Date()); setSelectedDate(todayStr); }} style={[s.todayBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
          <Ionicons name="calendar-clear-outline" size={14} color={theme.onSurface} />
          <Text style={{ color: theme.onSurface, fontSize: 13, fontWeight: "500" }}>Today</Text>
        </Pressable>
        <View style={s.navGroup}>
          <Pressable testID="prev-month-btn" onPress={goPrev} style={s.chev}>
            <Ionicons name="chevron-up" size={20} color={theme.onSurfaceSecondary} />
          </Pressable>
          <Pressable testID="next-month-btn" onPress={goNext} style={s.chev}>
            <Ionicons name="chevron-down" size={20} color={theme.onSurfaceSecondary} />
          </Pressable>
        </View>
        <Text style={[s.headerTitle, { color: theme.onSurface }]} testID="month-title">
          {MONTHS[month.m]} {month.y}
        </Text>
        <View style={{ flex: 1 }} />
        <View style={[s.zoomGroup, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
          <Pressable
            testID="zoom-out-btn"
            onPress={() => setZoom(v => Math.max(-2, v - 1))}
            disabled={z <= -2}
            style={[s.zoomBtn, { opacity: z <= -2 ? 0.4 : 1 }]}
          >
            <Ionicons name="remove" size={16} color={theme.onSurface} />
          </Pressable>
          <View style={[s.zoomDivider, { backgroundColor: theme.border }]} />
          <Pressable
            testID="zoom-in-btn"
            onPress={() => setZoom(v => Math.min(2, v + 1))}
            disabled={z >= 2}
            style={[s.zoomBtn, { opacity: z >= 2 ? 0.4 : 1 }]}
          >
            <Ionicons name="add" size={16} color={theme.onSurface} />
          </Pressable>
        </View>
      </View>

      {loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 24 }} /> : (
        <>
          <View style={[s.weekRow, { borderBottomColor: theme.border }]}>
            {WEEKDAYS.map(w => (
              <View key={w} style={s.weekCell}>
                <Text style={[s.weekday, { color: theme.onSurfaceSecondary }]}>{w}</Text>
              </View>
            ))}
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.brandPrimary} />}
          >
            {weeks.map((week, weekIdx) => {
              // Calculate week totals: unpaid bills + expense transactions (above threshold)
              let billsTotal = 0;
              let txTotal = 0;
              week.forEach(d => {
                const k = ymd(d);
                (billsByDate[k] || []).forEach(b => { if (!b.paid) billsTotal += b.amount; });
                (txByDate[k] || []).forEach(t => { if (t.amount < 0) txTotal += Math.abs(t.amount); });
              });
              const weekTotal = billsTotal + txTotal;
              return (
                <View key={`week-${weekIdx}`}>
                  <View style={s.weekGrid}>
                    {week.map((d, idx) => {
                      const k = ymd(d);
                      const inMonth = d.getMonth() === month.m;
                      const isSelected = k === selectedDate;
                      const isToday = k === todayStr;
                      const dayBills = billsByDate[k] || [];
                      const dayTxs = txByDate[k] || [];
                      const visible = dayBills.slice(0, MAX_BILLS);
                      const txVisible = dayTxs.slice(0, Math.max(1, MAX_BILLS - visible.length));
                      const overflow = (dayBills.length - visible.length) + (dayTxs.length - txVisible.length);
                      return (
                        <Pressable
                          key={idx}
                          testID={`calendar-day-${k}`}
                          style={[
                            s.cell,
                            {
                              height: CELL_HEIGHT,
                              borderColor: theme.border,
                              backgroundColor: theme.surface,
                            },
                            isSelected && { borderColor: theme.brandPrimary, borderWidth: 1.5, backgroundColor: theme.brandTertiary + "33" },
                          ]}
                          onPress={() => setSelectedDate(k)}
                        >
                          <View style={s.cellHeader}>
                            {isToday ? (
                              <View style={[s.todayCircle, { backgroundColor: theme.brandPrimary }]}>
                                <Text style={[s.todayNum, { color: theme.onBrandPrimary }]}>{d.getDate()}</Text>
                              </View>
                            ) : (
                              <Text style={[s.dayNum, { color: inMonth ? theme.onSurface : theme.info, fontWeight: d.getDate() === 1 ? "600" : "400" }]}>
                                {d.getDate() === 1 ? `${MONTHS[d.getMonth()].slice(0, 3)} 1` : String(d.getDate()).padStart(2, "0")}
                              </Text>
                            )}
                          </View>
                          <View style={s.billsStack}>
                            {visible.map(b => {
                              return (
                                <Pressable
                                  key={b.id}
                                  testID={`cell-bill-${b.id}`}
                                  onPress={() => router.push(`/bill/${b.id}`)}
                                  style={[
                                    s.pill,
                                    {
                                      backgroundColor: theme.warning,
                                      opacity: b.paid ? 0.45 : 1,
                                    },
                                  ]}
                                >
                                  <Text numberOfLines={1} style={[s.pillText, { color: "#FFFFFF", fontSize: PILL_FS, textDecorationLine: b.paid ? "line-through" : "none" }]}>
                                    {b.title}
                                  </Text>
                                </Pressable>
                              );
                            })}
                            {txVisible.map(t => {
                              const isCredit = t.amount > 0;
                              return (
                                <Pressable
                                  key={t.id}
                                  testID={`cell-tx-${t.id}`}
                                  onPress={() => router.push("/(tabs)/bank")}
                                  style={[
                                    s.txPill,
                                    {
                                      backgroundColor: theme.surfaceSecondary,
                                      borderLeftColor: isCredit ? theme.success : theme.info,
                                    },
                                  ]}
                                >
                                  <Text numberOfLines={1} style={[s.txPillText, { color: theme.onSurfaceSecondary, fontSize: Math.max(8, PILL_FS - 1) }]}>
                                    {isCredit ? "+" : "−"}${Math.abs(t.amount).toFixed(0)} {t.description}
                                  </Text>
                                </Pressable>
                              );
                            })}
                            {overflow > 0 && (
                              <Text style={[s.moreText, { color: theme.onSurfaceSecondary }]} numberOfLines={1}>
                                +{overflow} more
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={[s.weekTotalRow, { backgroundColor: weekBarBg, borderTopColor: theme.border, borderBottomColor: theme.border }]} testID={`week-total-${weekIdx}`}>
                    <Text style={[s.weekTotalLabel, { color: theme.onSurfaceSecondary }]}>
                      Week of {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Text style={{ color: theme.warning, fontSize: 12, fontWeight: "500" }}>
                        Bills ${billsTotal.toFixed(0)}
                      </Text>
                      <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12 }}>
                        Spent ${txTotal.toFixed(0)}
                      </Text>
                      <Text style={{ color: theme.onSurface, fontSize: 13, fontWeight: "600" }}>
                        = ${weekTotal.toFixed(0)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      <Pressable
        testID="add-bill-fab"
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
  header: {
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md,
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
  },
  todayBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, minHeight: 36 },
  navGroup: { flexDirection: "row", alignItems: "center" },
  chev: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "500" },
  zoomGroup: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, overflow: "hidden", height: 36 },
  zoomBtn: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  zoomDivider: { width: 1, height: "100%" },
  weekRow: { flexDirection: "row", borderBottomWidth: 0.5, paddingVertical: 8 },
  weekCell: { flex: 1, alignItems: "center" },
  weekday: { fontSize: 11, fontWeight: "500", letterSpacing: 0.5, textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekGrid: { flexDirection: "row" },
  weekTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
  },
  weekTotalLabel: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3, textTransform: "uppercase" },
  cell: {
    width: `${100 / 7}%`,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    padding: 4,
  },
  cellHeader: { marginBottom: 4, alignItems: "center" },
  dayNum: { fontSize: 13 },
  todayCircle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  todayNum: { fontSize: 13, fontWeight: "600" },
  billsStack: { gap: 2 },
  pill: {
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    minHeight: 18,
    justifyContent: "center",
  },
  pillText: { fontWeight: "500", textAlign: "center" },
  txPill: {
    borderRadius: 3,
    borderLeftWidth: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    minHeight: 16,
    justifyContent: "center",
  },
  txPillText: { fontWeight: "400" },
  moreText: { fontSize: 10, textAlign: "center", fontWeight: "500" },
  fab: {
    position: "absolute", right: SPACING.lg, bottom: 24, width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
