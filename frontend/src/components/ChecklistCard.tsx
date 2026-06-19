import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, SPACING, RADIUS } from "@/src/theme";

export type ChecklistItem = { id: string; name: string; done: boolean; created_at: string };

export interface ChecklistApi {
  list: () => Promise<{ items: ChecklistItem[] }>;
  create: (name: string) => Promise<ChecklistItem>;
  update: (id: string, updates: { name?: string; done?: boolean }) => Promise<ChecklistItem>;
  remove: (id: string) => Promise<{ ok: boolean }>;
  clearDone: () => Promise<{ ok: boolean; deleted: number }>;
}

interface Props {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  api: ChecklistApi;
  testIDPrefix?: string;
}

export default function ChecklistCard({ title, icon, accent, api, testIDPrefix = "list" }: Props) {
  const theme = useTheme();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.list();
      setItems(r.items);
    } catch {} finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    setAdding(true);
    const tempId = `tmp-${Date.now()}`;
    const optimistic: ChecklistItem = { id: tempId, name, done: false, created_at: new Date().toISOString() };
    setItems(prev => [...prev, optimistic]);
    setNewItem("");
    try {
      const created = await api.create(name);
      setItems(prev => prev.map(i => (i.id === tempId ? created : i)));
    } catch (e: any) {
      setItems(prev => prev.filter(i => i.id !== tempId));
      const msg = e?.message || "Failed to add";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setAdding(false);
      if (Platform.OS !== "web") setAddOpen(false);
    }
  };

  const toggleDone = async (item: ChecklistItem) => {
    const next = !item.done;
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done: next } : i)));
    try { await api.update(item.id, { done: next }); }
    catch { setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done: item.done } : i))); }
  };

  const deleteItem = async (item: ChecklistItem) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    try { await api.remove(item.id); }
    catch { setItems(prev => [...prev, item]); }
  };

  const clearDone = async () => {
    const remaining = items.filter(i => !i.done);
    setItems(remaining);
    try { await api.clearDone(); }
    catch { load(); }
  };

  const doneCount = items.filter(i => i.done).length;
  const remainingCount = items.length - doneCount;

  return (
    <View style={[s.card, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]} testID={`${testIDPrefix}-card`}>
      <View style={s.header}>
        <Ionicons name={icon} size={18} color={accent} />
        <Text style={[s.title, { color: theme.onSurface }]} numberOfLines={1}>{title}</Text>
        {items.length > 0 && (
          <View style={[s.badge, { backgroundColor: theme.brandTertiary }]}>
            <Text style={{ color: theme.onBrandTertiary, fontSize: 11, fontWeight: "600" }}>
              {remainingCount}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setAddOpen(o => !o)}
          hitSlop={8}
          style={[s.headerIconBtn, { backgroundColor: addOpen ? accent : "transparent" }]}
          testID={`${testIDPrefix}-add-toggle`}
        >
          <Ionicons name={addOpen ? "close" : "add"} size={20} color={addOpen ? theme.onBrandPrimary : accent} />
        </Pressable>
      </View>

      <View style={s.body}>
        {addOpen && (
          <View style={[s.addRow, { borderColor: accent, backgroundColor: theme.surface }]}>
            <TextInput
              value={newItem}
              onChangeText={setNewItem}
              placeholder="Add an item…"
              placeholderTextColor={theme.onSurfaceSecondary}
              style={[s.input, { color: theme.onSurface }]}
              returnKeyType="done"
              onSubmitEditing={addItem}
              editable={!adding}
              autoFocus
              testID={`${testIDPrefix}-input`}
            />
            <Pressable
              onPress={addItem}
              disabled={adding || !newItem.trim()}
              style={[s.addBtn, { backgroundColor: accent, opacity: adding || !newItem.trim() ? 0.4 : 1 }]}
              testID={`${testIDPrefix}-add`}
            >
              {adding ? <ActivityIndicator color={theme.onBrandPrimary} size="small" /> : <Ionicons name="checkmark" size={18} color={theme.onBrandPrimary} />}
            </Pressable>
          </View>
        )}

        {loading ? (
          <View style={{ paddingVertical: SPACING.md, alignItems: "center" }}>
            <ActivityIndicator color={accent} />
          </View>
        ) : items.length === 0 ? (
          <Text style={[s.empty, { color: theme.info }]}>Empty. Tap + to add.</Text>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.sm }} keyboardShouldPersistTaps="handled">
            {items.map(item => (
              <Pressable
                key={item.id}
                onPress={() => toggleDone(item)}
                style={s.itemRow}
                testID={`${testIDPrefix}-item-${item.id}`}
              >
                <View style={[s.checkbox, { borderColor: item.done ? accent : theme.borderStrong, backgroundColor: item.done ? accent : "transparent" }]}>
                  {item.done && <Ionicons name="checkmark" size={12} color={theme.onBrandPrimary} />}
                </View>
                <Text
                  style={[
                    s.itemText,
                    { color: item.done ? theme.onSurfaceSecondary : theme.onSurface, textDecorationLine: item.done ? "line-through" : "none" },
                  ]}
                  numberOfLines={2}
                >
                  {item.name}
                </Text>
                <Pressable onPress={() => deleteItem(item)} hitSlop={10} style={s.delBtn} testID={`${testIDPrefix}-delete-${item.id}`}>
                  <Ionicons name="close" size={16} color={theme.onSurfaceSecondary} />
                </Pressable>
              </Pressable>
            ))}
            {doneCount > 0 && (
              <Pressable onPress={clearDone} style={s.clearBtn} testID={`${testIDPrefix}-clear-done`}>
                <Text style={{ color: accent, fontSize: 12, fontWeight: "500" }}>
                  Clear {doneCount} completed
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, paddingVertical: 8, gap: SPACING.xs, minHeight: 40 },
  title: { fontSize: 14, fontWeight: "600", marginLeft: 4, flexShrink: 1 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, marginLeft: 4, minWidth: 20, alignItems: "center" },
  headerIconBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, gap: 4 },
  addRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 10, paddingVertical: 2, marginBottom: SPACING.xs, minHeight: 40 },
  input: { flex: 1, fontSize: 13, paddingVertical: 6 },
  addBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: SPACING.sm, minHeight: 32 },
  checkbox: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  itemText: { flex: 1, fontSize: 13 },
  delBtn: { padding: 2 },
  empty: { fontSize: 12, textAlign: "center", paddingVertical: SPACING.md, lineHeight: 16 },
  clearBtn: { alignSelf: "center", paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, marginTop: SPACING.xs },
});
