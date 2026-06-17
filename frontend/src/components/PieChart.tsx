import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";

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

export default function PieChart({ data, size = 180, onColor, secondaryColor }: { data: Slice[]; size?: number; onColor: string; secondaryColor: string; }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2;
  let cumulative = 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <Svg width={size} height={size}>
        {data.length === 0 ? (
          <Circle cx={r} cy={r} r={r - 1} fill="none" stroke={secondaryColor} strokeWidth={1} />
        ) : (
          data.map((d, i) => {
            const startAngle = (cumulative / total) * 360;
            cumulative += d.value;
            const endAngle = (cumulative / total) * 360;
            const path = arcPath(r, r, r - 1, startAngle, endAngle === 360 ? 359.99 : endAngle);
            return <Path key={i} d={path} fill={PALETTE[i % PALETTE.length]} />;
          })
        )}
        <Circle cx={r} cy={r} r={r * 0.55} fill={secondaryColor} />
      </Svg>
      <View style={{ flex: 1, gap: 6 }}>
        {data.slice(0, 6).map((d, i) => (
          <View key={i} style={s.row}>
            <View style={[s.dot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={[s.label, { color: onColor }]} numberOfLines={1}>{d.label}</Text>
            <Text style={[s.value, { color: onColor }]}>${d.value.toFixed(0)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 12, fontWeight: "500", flex: 1 },
  value: { fontSize: 12 },
});
