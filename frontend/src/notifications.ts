import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  const { status: newStatus } = await Notifications.requestPermissionsAsync();
  return newStatus === "granted";
}

export async function scheduleBillReminder(billId: string, title: string, amount: number, dueDate: string): Promise<string | null> {
  try {
    const ok = await ensureNotificationPermission();
    if (!ok) return null;
    // reminder at 9am the day before due date
    const due = new Date(dueDate + "T09:00:00");
    const trigger = new Date(due.getTime() - 24 * 60 * 60 * 1000);
    if (trigger.getTime() < Date.now() + 60_000) return null;
    if (Platform.OS === "web") return null;
    const id = await Notifications.scheduleNotificationAsync({
      identifier: `bill-${billId}`,
      content: {
        title: `Bill due tomorrow: ${title}`,
        body: `Amount: $${amount.toFixed(2)}`,
        data: { billId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger } as any,
    });
    return id;
  } catch {
    return null;
  }
}

export async function cancelBillReminder(billId: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(`bill-${billId}`);
  } catch {}
}
