import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from "react-native";
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
    try {
      const data = await api.listBills(token);
      setBills(data);
    } catch {} finally {
      setLoading(false); setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const monthInfo = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const firstWeekday = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return { cells, y, m };
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

  const agenda = billsByDate[selectedDate] || [];
  const todayStr = ymd(new Date());

  const goPrev = () => setCursor(new Date(monthInfo.y, monthInfo.m - 1, 1));
  const goNext = () => setCursor(new Date(monthInfo.y, monthInfo.m + 1, 1));

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="calendar-screen">
      <View style={s.header}>
        <View>
          <Text style={[s.headerSub, { color: theme.onSurfaceSecondary }]}>BillCal</Text>
          <Text style={[s.headerTitle, { color: theme.onSurface }]} testID="month-title">
            {MONTHS[monthInfo.m]} {monthInfo.y}
          </Text>
        </View>
        <View style={s.headerActions}>
          <Pressable testID="prev-month-btn" onPress={goPrev} style={[s.iconBtn, { backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name="chevron-back" size={20} color={theme.onSurface} />
          </Pressable>
          <Pressable testID="today-btn" onPress={() => { setCursor(new Date()); setSelectedDate(todayStr); }} style={[s.iconBtn, { backgroundColor: theme.surfaceSecondary, marginHorizontal: 6 }]}>
            <Text style={{ color: theme.onSurface, fontSize: 12, fontWeight: "500" }}>Today</Text>
          </Pressable>
          <Pressable testID="next-month-btn" onPress={goNext} style={[s.iconBtn, { backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name="chevron-forward" size={20} color={theme.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={[s.calendarCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
        <View style={s.weekRow}>
          {WEEKDAYS.map(w => (
            <Text key={w} style={[s.weekday, { color: theme.info }]}>{w}</Text>
          ))}
        </View>
        <View style={s.grid}>
          {monthInfo.cells.map((d, idx) => {
            if (!d) return <View key={idx} style={[s.cell, { borderColor: theme.divider }]} />;
            const k = ymd(d);
            const isSelected = k === selectedDate;
            const isToday = k === todayStr;
            const dayBills = billsByDate[k] || [];
            const visible = dayBills.slice(0, 2);
            const overflow = dayBills.length - visible.length;
            return (
              <Pressable
                key={idx}
                testID={`calendar-day-${k}`}
                style={[s.cell, { borderColor: theme.divider }]}
                onPress={() => setSelectedDate(k)}
              >
                <View style={[
                  s.cellInner,
                  isSelected && { backgroundColor: theme.brandTertiary, borderColor: theme.brandPrimary, borderWidth: 1 },
                ]}>
                  <View style={s.cellHeader}>
                    <View style={[
                      s.dayNumWrap,
                      isToday && { backgroundColor: theme.brandPrimary },
                    ]}>
                      <Text style={[
                        s.cellNum,
                        { color: isToday ? theme.onBrandPrimary : (isSelected ? theme.onBrandTertiary : theme.onSurface) },
                      ]}>{d.getDate()}</Text>
                    </View>
                  </View>
                  <View style={s.billsStack}>
                    {visible.map(b => (
                      <View
                        key={b.id}
                        style={[
                          s.billPill,
                          {
                            backgroundColor: b.paid ? theme.success : theme.warning,
                            opacity: b.paid ? 0.55 : 1,
                          },
                        ]}
                      >
                        <Text numberOfLines={1} style={s.billPillText}>
                          {b.title}
                        </Text>
                      </View>
                    ))}
                    {overflow > 0 && (
                      <Text style={[s.moreText, { color: theme.onSurfaceSecondary }]} numberOfLines={1}>
                        +{overflow} more
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={s.agendaHeader}>
        <Text style={[s.agendaTitle, { color: theme.onSurface }]} testID="agenda-title">
          {new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </Text>
        <Text style={[s.agendaCount, { color: theme.onSurfaceSecondary }]}>{agenda.length} bill{agenda.length === 1 ? "" : "s"}</Text>
      </View>

      {loading ? <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 24 }} /> : (
        <FlatList
          testID="agenda-list"
          data={agenda}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={56} color={theme.info} />
              <Text style={[s.emptyText, { color: theme.onSurfaceSecondary }]}>No bills on this day</Text>
              <Text style={[s.emptySubtext, { color: theme.info }]}>Tap + to add a new bill.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.brandPrimary} />}
          renderItem={({ item }) => {
            const cat = CATEGORIES.find(c => c.key === item.category) || CATEGORIES[CATEGORIES.length - 1];
            return (
              <Pressable
                testID={`agenda-item-${item.id}`}
                onPress={() => router.push(`/bill/${item.id}`)}
                style={[s.agendaItem, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
              >
                <View style={[s.catIcon, { backgroundColor: theme.brandTertiary }]}>
                  <Ionicons name={cat.icon as any} size={20} color={theme.onBrandTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.itemTitle, { color: theme.onSurface }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={[s.itemSub, { color: theme.onSurfaceSecondary }]}>{item.category} · {item.recurrence}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.amount, { color: theme.onSurface }]}>${item.amount.toFixed(2)}</Text>
                  {item.paid
                    ? <Text style={[s.paidTag, { color: theme.success }]}>Paid</Text>
                    : <Text style={[s.paidTag, { color: theme.warning }]}>Due</Text>}
                </View>
              </Pressable>
            );
          }}
        />
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
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerSub: { fontSize: 12, fontWeight: "500", letterSpacing: 0.5, textTransform: "uppercase" },
  headerTitle: { fontSize: 24, fontWeight: "500", marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  calendarCard: { marginHorizontal: SPACING.lg, padding: SPACING.sm, borderRadius: RADIUS.lg, borderWidth: 1 },
  weekRow: { flexDirection: "row", marginBottom: SPACING.xs, paddingHorizontal: 2 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: 78, padding: 2, borderTopWidth: 0.5 },
  cellInner: { width: "100%", height: "100%", borderRadius: 8, padding: 3, justifyContent: "flex-start" },
  cellHeader: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 2 },
  dayNumWrap: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  cellNum: { fontSize: 11, fontWeight: "500" },
  billsStack: { gap: 2 },
  billPill: { borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  billPillText: { color: "#FFFFFF", fontSize: 9, fontWeight: "500" },
  moreText: { fontSize: 9, marginLeft: 2 },
  agendaHeader: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.sm, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  agendaTitle: { fontSize: 16, fontWeight: "500" },
  agendaCount: { fontSize: 13 },
  empty: { alignItems: "center", padding: SPACING.xxl, marginTop: SPACING.lg },
  emptyText: { fontSize: 15, marginTop: SPACING.md },
  emptySubtext: { fontSize: 13, marginTop: 4 },
  agendaItem: { flexDirection: "row", alignItems: "center", padding: SPACING.md, marginBottom: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 64 },
  catIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: SPACING.md },
  itemTitle: { fontSize: 15, fontWeight: "500" },
  itemSub: { fontSize: 12, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: "500" },
  paidTag: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  fab: { position: "absolute", right: SPACING.lg, bottom: 24, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
});
