import { View, Text, StyleSheet, Pressable } from "react-native";
import Svg, { Path, Circle, G } from "react-native-svg";

const PALETTE = ["#15803D", "#F59E0B", "#EF4444", "#3B82F6", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6B7280"];

interface Slice { label: string; value: number; }

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
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
  let cumulative = 0;
  const selectedSlice = selectedLabel ? data.find(d => d.label === selectedLabel) : null;
  const selectedPct = selectedSlice ? (selectedSlice.value / total) * 100 : 0;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {data.length === 0 ? (
            <Circle cx={r} cy={r} r={r - 1} fill="none" stroke={secondaryColor} strokeWidth={1} />
          ) : (
            <G>
              {data.map((d, i) => {
                const startAngle = (cumulative / total) * 360;
                cumulative += d.value;
                const endAngle = (cumulative / total) * 360;
                const path = arcPath(r, r, r - 1, startAngle, endAngle === 360 ? 359.99 : endAngle);
                const baseColor = PALETTE[i % PALETTE.length];
                const isSelected = selectedLabel === d.label;
                const isDimmed = selectedLabel !== null && !isSelected;
                return (
                  <Path
                    key={i}
                    d={path}
                    fill={baseColor}
                    opacity={isDimmed ? 0.3 : 1}
                    onPress={() => onSlicePress && onSlicePress(isSelected ? null : d.label)}
                  />
                );
              })}
            </G>
          )}
          <Circle cx={r} cy={r} r={r * 0.55} fill="transparent" />
        </Svg>
        {/* Center overlay (clickable when selected) */}
        <Pressable
          onPress={() => {
            if (selectedSlice && onCenterPress) {
              onCenterPress(selectedSlice.label);
            } else if (selectedLabel && onSlicePress) {
              onSlicePress(null);
            }
          }}
          style={[StyleSheet.absoluteFillObject, { alignItems: "center", justifyContent: "center" }]}
          testID="pie-center"
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
        </Pressable>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {data.slice(0, 6).map((d, i) => {
          const isSelected = selectedLabel === d.label;
          const isDimmed = selectedLabel !== null && !isSelected;
          return (
            <Pressable
              key={i}
              onPress={() => onSlicePress && onSlicePress(isSelected ? null : d.label)}
              style={[s.row, { opacity: isDimmed ? 0.4 : 1 }]}
              testID={`pie-legend-${d.label}`}
            >
              <View style={[s.dot, { backgroundColor: PALETTE[i % PALETTE.length], transform: [{ scale: isSelected ? 1.3 : 1 }] }]} />
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
