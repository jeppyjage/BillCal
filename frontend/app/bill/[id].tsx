import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS, CATEGORIES, RECURRENCE_OPTIONS } from "@/src/theme";
import { api, Bill } from "@/src/api/client";
import { scheduleBillReminder, cancelBillReminder } from "@/src/notifications";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default function BillEditor() {
  const theme = useTheme();
  const { token } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === "new";

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(ymd(new Date()));
  const [category, setCategory] = useState<string>("Utilities");
  const [recurrence, setRecurrence] = useState<string>("monthly");
  const [notes, setNotes] = useState("");
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (isNew || !token) return;
    (async () => {
      try {
        const b = await api.getBill(token, id as string);
        setTitle(b.title); setAmount(String(b.amount)); setDueDate(b.due_date);
        setCategory(b.category); setRecurrence(b.recurrence); setNotes(b.notes || ""); setPaid(b.paid);
      } catch (e: any) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [id, token, isNew]);

  const save = async () => {
    if (!token) return;
    setErr("");
    const amt = parseFloat(amount);
    if (!title.trim()) { setErr("Title is required"); return; }
    if (Number.isNaN(amt) || amt <= 0) { setErr("Enter a valid amount"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { setErr("Date must be YYYY-MM-DD"); return; }
    setSaving(true);
    try {
      let bill: Bill;
      if (isNew) {
        bill = await api.createBill(token, { title: title.trim(), amount: amt, due_date: dueDate, category, recurrence, notes });
      } else {
        bill = await api.updateBill(token, id as string, { title: title.trim(), amount: amt, due_date: dueDate, category, recurrence, notes, paid });
      }
      if (Platform.OS !== "web" && !bill.paid) await scheduleBillReminder(bill.id, bill.title, bill.amount, bill.due_date);
      router.back();
    } catch (e: any) { setErr(e.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const onDelete = async () => {
    if (!token || isNew) return;
    setSaving(true);
    try {
      await api.deleteBill(token, id as string);
      await cancelBillReminder(id as string);
      router.back();
    } catch (e: any) { setErr(e.message || "Delete failed"); setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={[{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.surface }]}>
        <ActivityIndicator color={theme.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} testID="bill-editor">
      <View style={[s.header, { borderBottomColor: theme.divider }]}>
        <Pressable onPress={() => router.back()} testID="editor-back" style={s.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.onSurface} />
        </Pressable>
        <Text style={[s.title, { color: theme.onSurface }]}>{isNew ? "New Bill" : "Edit Bill"}</Text>
        {!isNew ? (
          <Pressable onPress={onDelete} testID="delete-bill-btn" style={s.iconBtn}>
            <Ionicons name="trash-outline" size={22} color={theme.error} />
          </Pressable>
        ) : <View style={s.iconBtn} />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Title</Text>
          <TextInput
            testID="bill-title-input"
            value={title} onChangeText={setTitle}
            placeholder="e.g. Electricity"
            placeholderTextColor={theme.info}
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Amount (USD)</Text>
          <TextInput
            testID="bill-amount-input"
            value={amount} onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={theme.info}
            keyboardType="decimal-pad"
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Due Date (YYYY-MM-DD)</Text>
          <TextInput
            testID="bill-date-input"
            value={dueDate} onChangeText={setDueDate}
            placeholder="2026-05-30"
            placeholderTextColor={theme.info}
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border }]}
          />

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingVertical: 4 }} style={{ height: 48 }}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  testID={`cat-${c.key}`}
                  onPress={() => setCategory(c.key)}
                  style={[s.chip, { backgroundColor: active ? theme.brandPrimary : theme.surfaceSecondary, borderColor: active ? theme.brandPrimary : theme.border }]}
                >
                  <Ionicons name={c.icon as any} size={14} color={active ? theme.onBrandPrimary : theme.onSurface} />
                  <Text style={{ color: active ? theme.onBrandPrimary : theme.onSurface, fontSize: 12, fontWeight: "500" }}>{c.key}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Repeats</Text>
          <View style={{ flexDirection: "row", gap: SPACING.sm, flexWrap: "wrap" }}>
            {RECURRENCE_OPTIONS.map(r => {
              const active = recurrence === r;
              return (
                <Pressable
                  key={r}
                  testID={`recurrence-${r}`}
                  onPress={() => setRecurrence(r)}
                  style={[s.recChip, { backgroundColor: active ? theme.brandPrimary : theme.surfaceSecondary, borderColor: active ? theme.brandPrimary : theme.border }]}
                >
                  <Text style={{ color: active ? theme.onBrandPrimary : theme.onSurface, fontSize: 13, fontWeight: "500", textTransform: "capitalize" }}>{r}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.label, { color: theme.onSurfaceSecondary }]}>Notes</Text>
          <TextInput
            testID="bill-notes-input"
            value={notes} onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={theme.info}
            multiline numberOfLines={3}
            style={[s.input, { backgroundColor: theme.surfaceSecondary, color: theme.onSurface, borderColor: theme.border, minHeight: 80, textAlignVertical: "top" }]}
          />

          {!isNew && (
            <Pressable
              testID="toggle-paid-btn"
              onPress={() => setPaid(p => !p)}
              style={[s.payToggle, { backgroundColor: paid ? theme.brandTertiary : theme.surfaceSecondary, borderColor: theme.border }]}
            >
              <Ionicons name={paid ? "checkmark-circle" : "ellipse-outline"} size={20} color={paid ? theme.onBrandTertiary : theme.info} />
              <Text style={{ color: paid ? theme.onBrandTertiary : theme.onSurface, fontWeight: "500" }}>{paid ? "Marked as Paid" : "Mark as Paid"}</Text>
            </Pressable>
          )}

          {err ? <Text style={{ color: theme.error, marginTop: SPACING.md }} testID="editor-error">{err}</Text> : null}
        </ScrollView>

        <View style={[s.footer, { backgroundColor: theme.surface, borderTopColor: theme.divider }]}>
          <Pressable
            testID="save-bill-btn"
            disabled={saving}
            onPress={save}
            style={[s.saveBtn, { backgroundColor: theme.brandPrimary, opacity: saving ? 0.6 : 1 }]}
          >
            {saving ? <ActivityIndicator color={theme.onBrandPrimary} /> :
              <Text style={{ color: theme.onBrandPrimary, fontSize: 16, fontWeight: "500" }}>{isNew ? "Add Bill" : "Save Changes"}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 0.5, justifyContent: "space-between" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "500" },
  label: { fontSize: 12, marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, fontSize: 15, minHeight: 48 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, height: 36, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, flexShrink: 0 },
  recChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1 },
  payToggle: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.lg },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: SPACING.lg, paddingBottom: SPACING.xl, borderTopWidth: 0.5 },
  saveBtn: { padding: SPACING.lg, borderRadius: RADIUS.md, alignItems: "center", minHeight: 52 },
});
