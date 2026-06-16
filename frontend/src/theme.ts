import { useColorScheme } from "react-native";

export const LIGHT = {
  surface: "#F9FAFB",
  onSurface: "#111827",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#374151",
  surfaceTertiary: "#F3F4F6",
  onSurfaceTertiary: "#4B5563",
  surfaceInverse: "#111827",
  onSurfaceInverse: "#FFFFFF",
  brand: "#15803D",
  brandPrimary: "#15803D",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#86EFAC",
  onBrandSecondary: "#14532D",
  brandTertiary: "#DCFCE7",
  onBrandTertiary: "#166534",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#6B7280",
  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  divider: "#F3F4F6",
};

export const DARK = {
  surface: "#111827",
  onSurface: "#F9FAFB",
  surfaceSecondary: "#1F2937",
  onSurfaceSecondary: "#E5E7EB",
  surfaceTertiary: "#374151",
  onSurfaceTertiary: "#D1D5DB",
  surfaceInverse: "#F9FAFB",
  onSurfaceInverse: "#111827",
  brand: "#22C55E",
  brandPrimary: "#22C55E",
  onBrandPrimary: "#000000",
  brandSecondary: "#166534",
  onBrandSecondary: "#86EFAC",
  brandTertiary: "#14532D",
  onBrandTertiary: "#DCFCE7",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#9CA3AF",
  border: "#374151",
  borderStrong: "#4B5563",
  divider: "#1F2937",
};

export type Theme = typeof LIGHT;

export const useTheme = (): Theme => {
  const scheme = useColorScheme();
  return scheme === "dark" ? DARK : LIGHT;
};

export const useIsDark = () => useColorScheme() === "dark";

export const CATEGORIES = [
  { key: "Utilities", icon: "flash" },
  { key: "Rent", icon: "home" },
  { key: "Subscriptions", icon: "play-circle" },
  { key: "Credit Card", icon: "card" },
  { key: "Insurance", icon: "shield-checkmark" },
  { key: "Internet", icon: "wifi" },
  { key: "Phone", icon: "call" },
  { key: "Food", icon: "fast-food" },
  { key: "Transport", icon: "car" },
  { key: "Other", icon: "ellipsis-horizontal-circle" },
] as const;

export const RECURRENCE_OPTIONS = ["none", "weekly", "monthly", "yearly"] as const;

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };
