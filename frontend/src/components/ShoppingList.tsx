import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { api } from "@/src/api/client";

type Item = { id: string; name: string; done: boolean; created_at: string };

export default function ShoppingList({ token }: { token: string }) {
  const theme = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [newItem, setNewItem] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.listShoppingItems(token);
      setItems(r.items);
    } catch {} finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    setAdding(true);
    // Optimistic add
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Item = { id: tempId, name, done: false, created_at: new Date().toISOString() };
    setItems(prev => [...prev, optimistic]);
    setNewItem("");
    try {
      const created = await api.createShoppingItem(token, name);
      setItems(prev => prev.map(i => (i.id === tempId ? created : i)));
    } catch (e: any) {
      setItems(prev => prev.filter(i => i.id !== tempId));
      const msg = e?.message || "Failed to add item";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setAdding(false);
      // Keep the input bar open if user is on web (so they can quickly add more); auto-collapse on mobile
      if (Platform.OS !== "web") setAddOpen(false);
    }
  };

  const toggleDone = async (item: Item) => {
    const next = !item.done;
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done: next } : i)));
    try { await api.updateShoppingItem(token, item.id, { done: next }); }
    catch { setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done: item.done } : i))); }
  };

  const deleteItem = async (item: Item) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    try { await api.deleteShoppingItem(token, item.id); }
    catch { setItems(prev => [...prev, item]); }
  };

  const clearDone = async () => {
    const remaining = items.filter(i => !i.done);
    setItems(remaining);
    try { await api.clearDoneShoppingItems(token); }
    catch { load(); }
  };

  const doneCount = items.filter(i => i.done).length;
  const remainingCount = items.length - doneCount;

  return (
    <View style={[s.card, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]} testID="shopping-list-card">
      <Pressable
        onPress={() => setExpanded(e => !e)}
        style={s.header}
        testID="shopping-list-toggle"
      >
        <Ionicons name="basket" size={18} color={theme.brandPrimary} />
        <Text style={[s.title, { color: theme.onSurface }]}>Shopping List</Text>
        {items.length > 0 && (
          <View style={[s.badge, { backgroundColor: theme.brandTertiary }]}>
            <Text style={{ color: theme.onBrandTertiary, fontSize: 11, fontWeight: "600" }}>
              {remainingCount}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); setAddOpen(o => !o); if (!expanded) setExpanded(true); }}
          hitSlop={8}
          style={[s.headerIconBtn, { backgroundColor: addOpen ? theme.brandPrimary : "transparent" }]}
          testID="shopping-add-toggle"
        >
          <Ionicons name={addOpen ? "close" : "add"} size={20} color={addOpen ? theme.onBrandPrimary : theme.brandPrimary} />
        </Pressable>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={theme.onSurfaceSecondary} style={{ marginLeft: 4 }} />
      </Pressable>

      {expanded && (
        <View style={s.body}>
          {/* Add input (collapsed by default — toggled via header + button) */}
          {addOpen && (
            <View style={[s.addRow, { borderColor: theme.brandPrimary, backgroundColor: theme.surface }]}>
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
                testID="shopping-input"
              />
              <Pressable
                onPress={addItem}
                disabled={adding || !newItem.trim()}
                style={[s.addBtn, { backgroundColor: theme.brandPrimary, opacity: adding || !newItem.trim() ? 0.4 : 1 }]}
                testID="shopping-add"
              >
                {adding ? <ActivityIndicator color={theme.onBrandPrimary} size="small" /> : <Ionicons name="checkmark" size={18} color={theme.onBrandPrimary} />}
              </Pressable>
            </View>
          )}

          {/* Items */}
          {loading ? (
            <View style={{ paddingVertical: SPACING.md, alignItems: "center" }}>
              <ActivityIndicator color={theme.brandPrimary} />
            </View>
          ) : items.length === 0 ? (
            <Text style={[s.empty, { color: theme.info }]}>No items yet. Add your first one above.</Text>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.sm }} keyboardShouldPersistTaps="handled">
              {items.map(item => (
                <Pressable
                  key={item.id}
                  onPress={() => toggleDone(item)}
                  style={s.itemRow}
                  testID={`shopping-item-${item.id}`}
                >
                  <View style={[s.checkbox, { borderColor: item.done ? theme.brandPrimary : theme.borderStrong, backgroundColor: item.done ? theme.brandPrimary : "transparent" }]}>
                    {item.done && <Ionicons name="checkmark" size={14} color={theme.onBrandPrimary} />}
                  </View>
                  <Text
                    style={[
                      s.itemText,
                      { color: item.done ? theme.onSurfaceSecondary : theme.onSurface, textDecorationLine: item.done ? "line-through" : "none" },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Pressable onPress={() => deleteItem(item)} hitSlop={10} style={s.delBtn} testID={`shopping-delete-${item.id}`}>
                    <Ionicons name="close" size={18} color={theme.onSurfaceSecondary} />
                  </Pressable>
                </Pressable>
              ))}
              {doneCount > 0 && (
                <Pressable onPress={clearDone} style={s.clearBtn} testID="shopping-clear-done">
                  <Text style={{ color: theme.brandPrimary, fontSize: 13, fontWeight: "500" }}>
                    Clear {doneCount} completed
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", padding: SPACING.md, gap: SPACING.sm, minHeight: 48 },
  title: { fontSize: 15, fontWeight: "500", marginLeft: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginLeft: 6, minWidth: 22, alignItems: "center" },
  headerIconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, gap: SPACING.xs },
  addRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 4, marginBottom: SPACING.xs, minHeight: 44 },
  input: { flex: 1, fontSize: 14, paddingVertical: 8 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: 6 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: SPACING.md, minHeight: 40 },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  itemText: { flex: 1, fontSize: 14 },
  delBtn: { padding: 4 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: SPACING.md, lineHeight: 18 },
  clearBtn: { alignSelf: "center", paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md, marginTop: SPACING.xs },
});
