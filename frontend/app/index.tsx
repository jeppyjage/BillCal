import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const theme = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={theme.brandPrimary} />
      </View>
    );
  }

  return user ? <Redirect href="/(tabs)/calendar" /> : <Redirect href="/auth/login" />;
}
