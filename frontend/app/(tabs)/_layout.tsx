import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, View, ActivityIndicator } from "react-native";
import { useTheme } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

export default function TabsLayout() {
  const theme = useTheme();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={theme.brandPrimary} />
      </View>
    );
  }

  // If a 401 cleared the user out from under us, bounce back to login
  // instead of letting tab screens spam the dead token.
  if (!user) {
    return <Redirect href="/auth/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brandPrimary,
        tabBarInactiveTintColor: theme.info,
        tabBarStyle: {
          backgroundColor: theme.surfaceSecondary,
          borderTopColor: theme.border,
          borderTopWidth: 0.5,
          height: Platform.OS === "ios" ? 84 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bills"
        options={{
          title: "Bills",
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bank"
        options={{
          title: "Bank",
          tabBarIcon: ({ color, size }) => <Ionicons name="business" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
