import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  Platform,
  FlatList,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme, SPACING, RADIUS } from "@/src/theme";
import { api } from "@/src/api/client";

type Rule = { id: string; pattern: string; category: string; created_at: string };

export default function CategoriesScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const [tab, setTab] = useState<"categories" | "rules">("categories");
  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [allCats, setAllCats] = useState<string[]>([]);
  const [userRules, setUserRules] = useState<Rule[]>([]);
  const [builtIn, setBuiltIn] = useState<{ pattern: string; category: string }[]>([]);
  const [addCatModal, setAddCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [addRuleModal, setAddRuleModal] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [pickCategoryModal, setPickCategoryModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [c, r] = await Promise.all([api.listCategories(token), api.listRules(token)]);
      setDefaults(c.defaults); setCustom(c.custom); setAllCats(c.all);
      setUserRules(r.user_rules); setBuiltIn(r.built_in);
    } catch {} finally { setLoading(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const showError = (msg: string) => {
    if (Platform.OS === "web") window.alert(msg);
    else Alert.alert("Error", msg);
  };

  const handleAddCategory = async () => {
    const name = newCatName.trim();
    if (!name || !token) return;
    setSaving(true);
    try {
      await api.createCategory(token, name);
      setNewCatName(""); setAddCatModal(false);
      await load();
    } catch (e: any) {
      showError(e?.message || "Failed to add");
    } finally { setSaving(false); }
  };

  const handleDeleteCategory = async (name: string) => {
    if (!token) return;
    const confirm = Platform.OS === "web"
      ? window.confirm(`Delete category "${name}"?`)
      : await new Promise<boolean>((res) => {
          Alert.alert("Delete category?", `\"${name}\" will be removed.`, [
            { text: "Cancel", style: "cancel", onPress: () => res(false) },
            { text: "Delete", style: "destructive", onPress: () => res(true) },
          ]);
        });
    if (!confirm) return;
    try { await api.deleteCategory(token, name); await load(); }
    catch (e: any) { showError(e?.message || "Failed to delete"); }
  };

  const handleAddRule = async () => {
    const pat = newRulePattern.trim();
    const cat = newRuleCategory.trim();
    if (!pat || !cat || !token) return showError("Both pattern and category are required");
    setSaving(true);
    try {
      await api.createRule(token, pat, cat);
      setNewRulePattern(""); setNewRuleCategory(""); setAddRuleModal(false);
      await load();
    } catch (e: any) {
      showError(e?.message || "Failed to add rule");
    } finally { setSaving(false); }
  };

  const handleDeleteRule = async (id: string) => {
    if (!token) return;
    try { await api.deleteRule(token, id); await load(); }
    catch (e: any) { showError(e?.message || "Failed"); }
  };

  const handleRecategorize = async () => {
    if (!token) return;
    setRecategorizing(true);
    try {
      const r = await api.recategorizeAll(token);
      const msg = `Scanned ${r.scanned} transactions, updated ${r.updated}.`;
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Re-categorized", msg);
    } catch (e: any) { showError(e?.message || "Failed"); }
    finally { setRecategorizing(false); }
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.surface }]} edges={["top"]} testID="categories-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.onSurface} />
        </Pressable>
        <Text style={[s.headerTitle, { color: theme.onSurface }]}>Categories & Rules</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={s.tabRow}>
        {(["categories", "rules"] as const).map(t => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[s.tab, { backgroundColor: tab === t ? theme.brandPrimary : theme.surfaceSecondary, borderColor: theme.border }]}
            testID={`tab-${t}`}
          >
            <Text style={{ color: tab === t ? theme.onBrandPrimary : theme.onSurface, fontWeight: "500", textTransform: "capitalize" }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.brandPrimary} style={{ marginTop: 40 }} />
      ) : tab === "categories" ? (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }}>
          <Text style={[s.sectionTitle, { color: theme.onSurfaceSecondary }]}>Custom ({custom.length})</Text>
          {custom.length === 0 ? (
            <Text style={{ color: theme.info, fontSize: 13, marginBottom: SPACING.md }}>
              No custom categories yet. Tap + Add to create one.
            </Text>
          ) : custom.map(name => (
            <View key={name} style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
              <Ionicons name="pricetag" size={16} color={theme.brandPrimary} />
              <Text style={[s.rowText, { color: theme.onSurface }]}>{name}</Text>
              <Pressable onPress={() => handleDeleteCategory(name)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={theme.error} />
              </Pressable>
            </View>
          ))}

          <Pressable onPress={() => setAddCatModal(true)} style={[s.addBtn, { borderColor: theme.brandPrimary }]} testID="add-category-btn">
            <Ionicons name="add" size={18} color={theme.brandPrimary} />
            <Text style={{ color: theme.brandPrimary, fontWeight: "500", marginLeft: 6 }}>Add Category</Text>
          </Pressable>

          <Text style={[s.sectionTitle, { color: theme.onSurfaceSecondary, marginTop: SPACING.xl }]}>Built-in ({defaults.length})</Text>
          <View style={s.chipWrap}>
            {defaults.map(name => (
              <View key={name} style={[s.chip, { borderColor: theme.border, backgroundColor: theme.surfaceTertiary }]}>
                <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12 }}>{name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }}>
          <Text style={{ color: theme.info, fontSize: 12, lineHeight: 17, marginBottom: SPACING.md }}>
            Rules auto-tag transactions. If a transaction description contains the pattern (case-insensitive), it gets that category. Your rules take priority over built-in ones.
          </Text>

          <Text style={[s.sectionTitle, { color: theme.onSurfaceSecondary }]}>Your Rules ({userRules.length})</Text>
          {userRules.length === 0 ? (
            <Text style={{ color: theme.info, fontSize: 13, marginBottom: SPACING.md }}>
              No custom rules yet. Tap + Add to create one.
            </Text>
          ) : userRules.map(r => (
            <View key={r.id} style={[s.row, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border, alignItems: "flex-start" }]}>
              <Ionicons name="funnel" size={16} color={theme.brandPrimary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.onSurface, fontSize: 14, fontWeight: "500" }}>
                  {'if contains "'}<Text style={{ color: theme.brandPrimary }}>{r.pattern}</Text>{'"'}
                </Text>
                <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12, marginTop: 2 }}>
                  → {r.category}
                </Text>
              </View>
              <Pressable onPress={() => handleDeleteRule(r.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={theme.error} />
              </Pressable>
            </View>
          ))}

          <Pressable onPress={() => setAddRuleModal(true)} style={[s.addBtn, { borderColor: theme.brandPrimary }]} testID="add-rule-btn">
            <Ionicons name="add" size={18} color={theme.brandPrimary} />
            <Text style={{ color: theme.brandPrimary, fontWeight: "500", marginLeft: 6 }}>Add Rule</Text>
          </Pressable>

          <Pressable onPress={handleRecategorize} disabled={recategorizing} style={[s.recatBtn, { backgroundColor: theme.brandPrimary, opacity: recategorizing ? 0.6 : 1 }]} testID="recategorize-btn">
            {recategorizing ? (
              <ActivityIndicator color={theme.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color={theme.onBrandPrimary} />
                <Text style={{ color: theme.onBrandPrimary, fontWeight: "500", marginLeft: 8 }}>Re-apply to all transactions</Text>
              </>
            )}
          </Pressable>

          <Text style={[s.sectionTitle, { color: theme.onSurfaceSecondary, marginTop: SPACING.xl }]}>Built-in Rules ({builtIn.length})</Text>
          <Text style={{ color: theme.info, fontSize: 11, marginBottom: SPACING.sm }}>
            These cover common merchants. Your custom rules override these on match.
          </Text>
          {builtIn.slice(0, 20).map((r, i) => (
            <View key={i} style={[s.builtInRow, { borderColor: theme.divider }]}>
              <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12 }}>"{r.pattern}"</Text>
              <Ionicons name="arrow-forward" size={12} color={theme.onSurfaceSecondary} />
              <Text style={{ color: theme.onSurface, fontSize: 12, fontWeight: "500" }}>{r.category}</Text>
            </View>
          ))}
          {builtIn.length > 20 && (
            <Text style={{ color: theme.info, fontSize: 12, marginTop: 8 }}>
              + {builtIn.length - 20} more…
            </Text>
          )}
        </ScrollView>
      )}

      {/* Add Category Modal */}
      <Modal visible={addCatModal} transparent animationType="slide" onRequestClose={() => setAddCatModal(false)}>
        <Pressable style={s.backdrop} onPress={() => !saving && setAddCatModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
              <View style={s.handle} />
              <Text style={[s.modalTitle, { color: theme.onSurface }]}>New Category</Text>
              <TextInput
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder="Category name (e.g. Pets, Gym)"
                placeholderTextColor={theme.onSurfaceSecondary}
                style={[s.input, { borderColor: theme.border, color: theme.onSurface, backgroundColor: theme.surfaceSecondary }]}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleAddCategory}
                testID="new-category-input"
              />
              <View style={s.modalActions}>
                <Pressable onPress={() => setAddCatModal(false)} style={[s.cancelBtn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.onSurfaceSecondary, fontWeight: "500" }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleAddCategory} disabled={saving || !newCatName.trim()} style={[s.saveBtn, { backgroundColor: theme.brandPrimary, opacity: saving || !newCatName.trim() ? 0.5 : 1 }]} testID="save-category-btn">
                  {saving ? <ActivityIndicator color={theme.onBrandPrimary} /> : <Text style={{ color: theme.onBrandPrimary, fontWeight: "500" }}>Add</Text>}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Add Rule Modal */}
      <Modal visible={addRuleModal} transparent animationType="slide" onRequestClose={() => setAddRuleModal(false)}>
        <Pressable style={s.backdrop} onPress={() => !saving && setAddRuleModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
              <View style={s.handle} />
              <Text style={[s.modalTitle, { color: theme.onSurface }]}>New Rule</Text>
              <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12, marginBottom: SPACING.md, lineHeight: 17 }}>
                {"If a transaction description contains the text below (case-insensitive), it'll be tagged with the selected category."}
              </Text>
              <Text style={[s.fieldLabel, { color: theme.onSurfaceSecondary }]}>Match text</Text>
              <TextInput
                value={newRulePattern}
                onChangeText={setNewRulePattern}
                placeholder="e.g. petsmart"
                placeholderTextColor={theme.onSurfaceSecondary}
                style={[s.input, { borderColor: theme.border, color: theme.onSurface, backgroundColor: theme.surfaceSecondary }]}
                autoFocus
                autoCapitalize="none"
                testID="new-rule-pattern-input"
              />
              <Text style={[s.fieldLabel, { color: theme.onSurfaceSecondary, marginTop: SPACING.md }]}>Category</Text>
              <Pressable
                onPress={() => setPickCategoryModal(true)}
                style={[s.input, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                testID="new-rule-category-picker"
              >
                <Text style={{ color: newRuleCategory ? theme.onSurface : theme.onSurfaceSecondary, fontSize: 15 }}>
                  {newRuleCategory || "Select a category"}
                </Text>
                <Ionicons name="chevron-down" size={18} color={theme.onSurfaceSecondary} />
              </Pressable>
              <View style={s.modalActions}>
                <Pressable onPress={() => setAddRuleModal(false)} style={[s.cancelBtn, { borderColor: theme.border }]}>
                  <Text style={{ color: theme.onSurfaceSecondary, fontWeight: "500" }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleAddRule} disabled={saving || !newRulePattern.trim() || !newRuleCategory} style={[s.saveBtn, { backgroundColor: theme.brandPrimary, opacity: saving || !newRulePattern.trim() || !newRuleCategory ? 0.5 : 1 }]} testID="save-rule-btn">
                  {saving ? <ActivityIndicator color={theme.onBrandPrimary} /> : <Text style={{ color: theme.onBrandPrimary, fontWeight: "500" }}>Add</Text>}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Category picker (for rule creation) */}
      <Modal visible={pickCategoryModal} transparent animationType="slide" onRequestClose={() => setPickCategoryModal(false)}>
        <Pressable style={s.backdrop} onPress={() => setPickCategoryModal(false)}>
          <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: "70%" }]} onPress={(e) => e.stopPropagation()}>
            <View style={s.handle} />
            <Text style={[s.modalTitle, { color: theme.onSurface }]}>Pick a Category</Text>
            <FlatList
              data={allCats}
              keyExtractor={(item) => item}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border }} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { setNewRuleCategory(item); setPickCategoryModal(false); }}
                  style={s.pickRow}
                  testID={`pick-cat-${item}`}
                >
                  <Text style={{ color: theme.onSurface, fontSize: 15 }}>{item}</Text>
                  {newRuleCategory === item && <Ionicons name="checkmark" size={20} color={theme.brandPrimary} />}
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md, gap: SPACING.sm },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "500", textAlign: "center" },
  tabRow: { flexDirection: "row", paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.sm },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: RADIUS.pill, borderWidth: 1 },
  sectionTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: SPACING.sm, marginTop: SPACING.sm },
  row: { flexDirection: "row", alignItems: "center", padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: SPACING.sm, gap: SPACING.md, minHeight: 50 },
  rowText: { flex: 1, fontSize: 15, fontWeight: "500" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: "dashed", marginTop: SPACING.sm },
  recatBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, marginTop: SPACING.md, minHeight: 44 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  builtInRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 0.5, gap: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#94a3b8", marginVertical: SPACING.xs, marginBottom: SPACING.md },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: SPACING.md, paddingHorizontal: SPACING.xs },
  fieldLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, fontSize: 15, minHeight: 44 },
  modalActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.lg },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 44 },
  saveBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, minHeight: 44 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: SPACING.md, minHeight: 50 },
});
