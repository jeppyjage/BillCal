import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert, ScrollView, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTheme, SPACING, RADIUS } from "@/src/theme";

export type ChecklistItem = { id: string; name: string; done: boolean; created_at: string };

type ExtractedItem = { name: string; matches_existing_id: string | null; existing_done: boolean | null; include: boolean };

export interface ChecklistApi {
  list: () => Promise<{ items: ChecklistItem[] }>;
  create: (name: string) => Promise<ChecklistItem>;
  update: (id: string, updates: { name?: string; done?: boolean }) => Promise<ChecklistItem>;
  remove: (id: string) => Promise<{ ok: boolean }>;
  clearDone: () => Promise<{ ok: boolean; deleted: number }>;
  scan: (image_base64: string) => Promise<{ extracted: { name: string; matches_existing_id: string | null; existing_done: boolean | null }[] }>;
  apply: (add_items: string[], uncheck_ids: string[]) => Promise<{ ok: boolean; created: number; unchecked: number }>;
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

  // ---------- Photo import ----------
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedItem[]>([]);
  const [importing, setImporting] = useState(false);

  const showError = (msg: string) => {
    if (Platform.OS === "web") window.alert(msg);
    else Alert.alert("Error", msg);
  };

  const pickImage = async (source: "camera" | "gallery") => {
    setSourceMenuOpen(false);
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showError("Camera permission is required to scan a list.");
          return;
        }
        const r = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, allowsEditing: false });
        if (r.canceled || !r.assets?.[0]?.base64) return;
        await runScan(r.assets[0].base64);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          showError("Photo access is required to import a list.");
          return;
        }
        const r = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, allowsEditing: false });
        if (r.canceled || !r.assets?.[0]?.base64) return;
        await runScan(r.assets[0].base64);
      }
    } catch (e: any) {
      showError(e?.message || "Image picker failed");
    }
  };

  const runScan = async (b64: string) => {
    setScanning(true);
    try {
      const r = await api.scan(b64);
      if (!r.extracted || r.extracted.length === 0) {
        showError("No list items detected. Try a clearer photo.");
        return;
      }
      setExtracted(r.extracted.map(x => ({ ...x, include: true })));
      setPreviewOpen(true);
    } catch (e: any) {
      showError(e?.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const toggleExtract = (idx: number) => {
    setExtracted(prev => prev.map((x, i) => (i === idx ? { ...x, include: !x.include } : x)));
  };

  const doImport = async () => {
    setImporting(true);
    const newItems = extracted.filter(x => x.include && !x.matches_existing_id).map(x => x.name);
    const uncheckIds = extracted
      .filter(x => x.include && x.matches_existing_id && x.existing_done)
      .map(x => x.matches_existing_id!) as string[];
    try {
      await api.apply(newItems, uncheckIds);
      setPreviewOpen(false);
      setExtracted([]);
      await load();
    } catch (e: any) {
      showError(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const includedCount = extracted.filter(x => x.include).length;
  const willAdd = extracted.filter(x => x.include && !x.matches_existing_id).length;
  const willUncheck = extracted.filter(x => x.include && x.matches_existing_id && x.existing_done).length;

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
          onPress={() => setSourceMenuOpen(true)}
          hitSlop={8}
          disabled={scanning}
          style={[s.headerIconBtn, { opacity: scanning ? 0.5 : 1 }]}
          testID={`${testIDPrefix}-camera`}
        >
          {scanning ? <ActivityIndicator color={accent} size="small" /> : <Ionicons name="camera" size={18} color={accent} />}
        </Pressable>
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

      {/* Image source picker */}
      <Modal visible={sourceMenuOpen} transparent animationType="fade" onRequestClose={() => setSourceMenuOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setSourceMenuOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={(e) => e.stopPropagation()}>
            <View style={s.handle} />
            <Text style={[s.sheetTitle, { color: theme.onSurface }]}>Scan a list</Text>
            <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12, marginBottom: SPACING.md, textAlign: "center", paddingHorizontal: SPACING.md }}>
              Take or pick a photo of a handwritten or printed list. AI will extract the items.
            </Text>
            <Pressable
              onPress={() => pickImage("camera")}
              style={[s.sheetBtn, { backgroundColor: accent }]}
              testID={`${testIDPrefix}-source-camera`}
            >
              <Ionicons name="camera" size={18} color={theme.onBrandPrimary} />
              <Text style={{ color: theme.onBrandPrimary, fontSize: 15, fontWeight: "500", marginLeft: 10 }}>Take Photo</Text>
            </Pressable>
            <Pressable
              onPress={() => pickImage("gallery")}
              style={[s.sheetBtn, { backgroundColor: theme.surfaceTertiary, borderColor: theme.border, borderWidth: 1 }]}
              testID={`${testIDPrefix}-source-gallery`}
            >
              <Ionicons name="images" size={18} color={accent} />
              <Text style={{ color: theme.onSurface, fontSize: 15, fontWeight: "500", marginLeft: 10 }}>Choose from Gallery</Text>
            </Pressable>
            <Pressable onPress={() => setSourceMenuOpen(false)} style={[s.sheetCancel, { borderColor: theme.border }]}>
              <Text style={{ color: theme.onSurfaceSecondary, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Extracted items preview */}
      <Modal visible={previewOpen} transparent animationType="slide" onRequestClose={() => !importing && setPreviewOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => !importing && setPreviewOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: "85%" }]} onPress={(e) => e.stopPropagation()}>
            <View style={s.handle} />
            <Text style={[s.sheetTitle, { color: theme.onSurface }]}>Review {extracted.length} item{extracted.length !== 1 ? "s" : ""}</Text>
            <Text style={{ color: theme.onSurfaceSecondary, fontSize: 12, marginBottom: SPACING.md, textAlign: "center", paddingHorizontal: SPACING.md }}>
              Uncheck anything you don't want to import. {willAdd} new · {willUncheck} will be un-checked
            </Text>
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {extracted.map((it, idx) => {
                const isMatch = !!it.matches_existing_id;
                return (
                  <Pressable
                    key={`${it.name}-${idx}`}
                    onPress={() => toggleExtract(idx)}
                    style={[s.previewRow, { borderBottomColor: theme.divider }]}
                    testID={`${testIDPrefix}-preview-${idx}`}
                  >
                    <View style={[s.checkbox, { borderColor: it.include ? accent : theme.borderStrong, backgroundColor: it.include ? accent : "transparent", width: 22, height: 22, borderRadius: 11 }]}>
                      {it.include && <Ionicons name="checkmark" size={14} color={theme.onBrandPrimary} />}
                    </View>
                    <Text style={{ flex: 1, color: theme.onSurface, fontSize: 15, marginLeft: 12 }} numberOfLines={2}>{it.name}</Text>
                    {isMatch ? (
                      <View style={[s.tag, { backgroundColor: theme.brandTertiary }]}>
                        <Text style={{ color: theme.onBrandTertiary, fontSize: 10, fontWeight: "500" }}>
                          {it.existing_done ? "Will uncheck" : "Already in list"}
                        </Text>
                      </View>
                    ) : (
                      <View style={[s.tag, { backgroundColor: accent + "22" }]}>
                        <Text style={{ color: accent, fontSize: 10, fontWeight: "500" }}>New</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable
                onPress={() => setPreviewOpen(false)}
                disabled={importing}
                style={[s.cancelBtn, { borderColor: theme.border }]}
                testID={`${testIDPrefix}-import-cancel`}
              >
                <Text style={{ color: theme.onSurfaceSecondary, fontWeight: "500" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={doImport}
                disabled={importing || includedCount === 0}
                style={[s.saveBtn, { backgroundColor: accent, opacity: importing || includedCount === 0 ? 0.5 : 1 }]}
                testID={`${testIDPrefix}-import-confirm`}
              >
                {importing ? <ActivityIndicator color={theme.onBrandPrimary} /> : <Text style={{ color: theme.onBrandPrimary, fontWeight: "500" }}>Import {includedCount}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#94a3b8", marginVertical: SPACING.xs, marginBottom: SPACING.md },
  sheetTitle: { fontSize: 18, fontWeight: "600", marginBottom: 4, textAlign: "center" },
  sheetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: RADIUS.md, marginBottom: SPACING.sm, minHeight: 48 },
  sheetCancel: { paddingVertical: 12, alignItems: "center", borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.xs, minHeight: 44 },
  previewRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: SPACING.xs, borderBottomWidth: 0.5, minHeight: 48 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginLeft: 8 },
  modalActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  cancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 44 },
  saveBtn: { flex: 1.5, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: RADIUS.md, minHeight: 44 },
});
