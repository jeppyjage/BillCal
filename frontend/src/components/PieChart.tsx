import { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, GestureResponderEvent } from "react-native";
import Svg, { Path, Circle, G } from "react-native-svg";

// Deterministic color per category — Rent & Utilities is ALWAYS orange.
const CATEGORY_COLORS: Record<string, string> = {
  "Rent & Utilities": "#F97316", // orange (matches Outlook BillCal category)
  "Internet":         "#3B82F6", // blue
  "Phone":            "#06B6D4", // cyan
  "Subscriptions":    "#8B5CF6", // purple
  "Insurance":        "#0EA5E9", // sky
  "Credit Card":      "#EF4444", // red
  "Food":             "#F59E0B", // amber
  "Groceries":        "#15803D", // green
  "Transportation":   "#84CC16", // lime
  "Shopping":         "#EC4899", // pink
  "Health":           "#10B981", // emerald
  "Entertainment":    "#A855F7", // violet
  "Income":           "#22C55E", // green
  "Other":            "#6B7280", // gray
};

const FALLBACK_PALETTE = ["#15803D", "#F59E0B", "#EF4444", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6B7280"];

function colorForLabel(label: string): string {
  if (CATEGORY_COLORS[label]) return CATEGORY_COLORS[label];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

interface Slice { label: string; value: number; }

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const outerStart = polarToCartesian(cx, cy, rOuter, endAngle);
  const outerEnd = polarToCartesian(cx, cy, rOuter, startAngle);
  const innerStart = polarToCartesian(cx, cy, rInner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}

interface Props {
  data: Slice[];
  size?: number;
  onColor: string;
  secondaryColor: string;
  selectedLabel?: string | null;
  onSlicePress?: (label: string | null) => void;
  onCenterPress?: (label: string) => void;
}

export default function PieChart({ data, size = 180, onColor, secondaryColor, selectedLabel = null, onSlicePress, onCenterPress }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2;
  const rInner = r * 0.55;
  const selectedSlice = selectedLabel ? data.find(d => d.label === selectedLabel) : null;
  const selectedPct = selectedSlice ? (selectedSlice.value / total) * 100 : 0;

  // Pre-compute slice ranges (for hit-testing)
  const slices = useMemo(() => {
    const out: { label: string; startAngle: number; endAngle: number; color: string }[] = [];
    let cumulative = 0;
    for (const d of data) {
      const startAngle = (cumulative / total) * 360;
      cumulative += d.value;
      const endAngle = (cumulative / total) * 360;
      out.push({ label: d.label, startAngle, endAngle, color: colorForLabel(d.label) });
    }
    return out;
  }, [data, total]);

  // Hit-test: determine which slice contains a (x, y) press
  const hitSlice = (x: number, y: number): string | null => {
    const dx = x - r;
    const dy = y - r;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rInner) return "__center__";
    if (dist > r) return null; // outside the donut
    // angle in degrees, 0 at top, going clockwise
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    for (const sl of slices) {
      if (angle >= sl.startAngle && angle < sl.endAngle) return sl.label;
    }
    return null;
  };

  const handlePress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const hit = hitSlice(locationX, locationY);
    if (hit === null) return;
    if (hit === "__center__") {
      if (selectedSlice && onCenterPress) onCenterPress(selectedSlice.label);
      else if (selectedLabel && onSlicePress) onSlicePress(null);
      return;
    }
    if (onSlicePress) onSlicePress(hit === selectedLabel ? null : hit);
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <Pressable style={{ width: size, height: size }} onPress={handlePress} testID="pie-svg-area">
        <Svg width={size} height={size} pointerEvents="none">
          {data.length === 0 ? (
            <Circle cx={r} cy={r} r={r - 1} fill="none" stroke={secondaryColor} strokeWidth={1} />
          ) : (
            <G>
              {slices.map((sl, i) => {
                const safeEnd = sl.endAngle === 360 ? 359.99 : sl.endAngle;
                const path = donutSlicePath(r, r, r - 1, rInner, sl.startAngle, safeEnd);
                const isSelected = selectedLabel === sl.label;
                const isDimmed = selectedLabel !== null && !isSelected;
                return (
                  <Path
                    key={`${sl.label}-${i}`}
                    d={path}
                    fill={sl.color}
                    opacity={isDimmed ? 0.3 : 1}
                  />
                );
              })}
            </G>
          )}
        </Svg>
        {/* Center text overlay — transparent, no event handling (parent Pressable handles) */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { alignItems: "center", justifyContent: "center" }]}
        >
          {selectedSlice ? (
            <>
              <Text style={{ color: onColor, fontSize: 10, opacity: 0.7 }} numberOfLines={1}>
                {selectedSlice.label}
              </Text>
              <Text style={{ color: onColor, fontSize: 18, fontWeight: "600", marginTop: 2 }}>
                ${selectedSlice.value.toFixed(0)}
              </Text>
              <Text style={{ color: onColor, fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                {selectedPct.toFixed(1)}%
              </Text>
              <Text style={{ color: onColor, fontSize: 9, opacity: 0.5, marginTop: 4 }}>
                Tap to view ›
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: onColor, fontSize: 10, opacity: 0.6 }}>Total</Text>
              <Text style={{ color: onColor, fontSize: 18, fontWeight: "600", marginTop: 2 }}>
                ${total.toFixed(0)}
              </Text>
            </>
          )}
        </View>
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        {data.slice(0, 6).map((d, i) => {
          const isSelected = selectedLabel === d.label;
          const isDimmed = selectedLabel !== null && !isSelected;
          return (
            <Pressable
              key={`${d.label}-${i}`}
              onPress={() => onSlicePress && onSlicePress(isSelected ? null : d.label)}
              style={[s.row, { opacity: isDimmed ? 0.4 : 1 }]}
              testID={`pie-legend-${d.label}`}
            >
              <View style={[s.dot, { backgroundColor: colorForLabel(d.label), transform: [{ scale: isSelected ? 1.3 : 1 }] }]} />
              <Text style={[s.label, { color: onColor, fontWeight: isSelected ? "600" : "500" }]} numberOfLines={1}>{d.label}</Text>
              <Text style={[s.value, { color: onColor }]}>${d.value.toFixed(0)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 12, flex: 1 },
  value: { fontSize: 12 },
});
