import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS, CATEGORIES } from "@/src/theme";
import { api, Bill } from "@/src/api/client";

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
  const { token } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(ymd(new Date()));

  const load = useCallback(async () => {
    if (!token) return;
    try { setBills(await api.listBills(token)); } catch {}
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
    const map: Record<string, Bill[]> = {};
    bills.forEach(b => {
      const k = b.due_date;
      if (!map[k]) map[k] = [];
      map[k].push(b);
    });
    return map;
  }, [bills]);

  const todayStr = ymd(new Date());
  const goPrev = () => setCursor(new Date(month.y, month.m - 1, 1));
  const goNext = () => setCursor(new Date(month.y, month.m + 1, 1));

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
      </View>

      <View style={[s.weekRow, { borderBottomColor: theme.border }]}>
        {WEEKDAYS.map(w => (
          <View key={w} style={s.weekCell}>
            <Text style={[s.weekday, { color: theme.onSurfaceSecondary }]}>{w}</Text>
          </View>
        ))}
      </View>

      {loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 24 }} /> : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.brandPrimary} />}
        >
          <View style={s.grid}>
            {month.cells.map((d, idx) => {
              const k = ymd(d);
              const inMonth = d.getMonth() === month.m;
              const isSelected = k === selectedDate;
              const isToday = k === todayStr;
              const dayBills = billsByDate[k] || [];
              const visible = dayBills.slice(0, 3);
              const overflow = dayBills.length - visible.length;
              return (
                <Pressable
                  key={idx}
                  testID={`calendar-day-${k}`}
                  style={[
                    s.cell,
                    {
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
                      const accent = CAT_COLORS[b.category] || CAT_COLORS.Other;
                      return (
                        <Pressable
                          key={b.id}
                          testID={`cell-bill-${b.id}`}
                          onPress={() => router.push(`/bill/${b.id}`)}
                          style={[
                            s.pill,
                            {
                              backgroundColor: theme.surfaceSecondary,
                              borderLeftColor: accent,
                              opacity: b.paid ? 0.5 : 1,
                            },
                          ]}
                        >
                          <Text numberOfLines={1} style={[s.pillText, { color: theme.onSurface, textDecorationLine: b.paid ? "line-through" : "none" }]}>
                            ${b.amount.toFixed(0)} {b.title}
                          </Text>
                          {b.recurrence !== "none" && (
                            <Ionicons name="repeat" size={9} color={theme.onSurfaceSecondary} style={{ marginLeft: 2 }} />
                          )}
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
        </ScrollView>
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

const CELL_HEIGHT = 110;

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
  weekRow: { flexDirection: "row", borderBottomWidth: 0.5, paddingVertical: 6 },
  weekCell: { flex: 1, alignItems: "center" },
  weekday: { fontSize: 10, fontWeight: "500", letterSpacing: 0.5, textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    height: CELL_HEIGHT,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    padding: 3,
  },
  cellHeader: { marginBottom: 4 },
  dayNum: { fontSize: 12 },
  todayCircle: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  todayNum: { fontSize: 12, fontWeight: "600" },
  billsStack: { gap: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 3,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    minHeight: 16,
  },
  pillText: { fontSize: 9, fontWeight: "500", flex: 1 },
  moreText: { fontSize: 9, marginLeft: 4, fontWeight: "500" },
  fab: {
    position: "absolute", right: SPACING.lg, bottom: 24, width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
