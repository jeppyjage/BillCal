const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface Bill {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  due_date: string;
  category: string;
  recurrence: string;
  notes?: string;
  paid: boolean;
  created_at: string;
}

export interface BankAccount {
  id: string;
  name: string;
  type: string;
  masked_number: string;
  balance: number;
  institution: string;
}

export interface BankTransaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
}

async function request<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.detail || `Request failed: ${res.status}`);
  return data as T;
}

export const api = {
  listBills: (token: string) => request<Bill[]>("/bills", token),
  createBill: (token: string, body: Partial<Bill>) =>
    request<Bill>("/bills", token, { method: "POST", body: JSON.stringify(body) }),
  getBill: (token: string, id: string) => request<Bill>(`/bills/${id}`, token),
  updateBill: (token: string, id: string, body: Partial<Bill>) =>
    request<Bill>(`/bills/${id}`, token, { method: "PUT", body: JSON.stringify(body) }),
  deleteBill: (token: string, id: string) =>
    request<{ ok: boolean }>(`/bills/${id}`, token, { method: "DELETE" }),
  togglePaid: (token: string, id: string) =>
    request<Bill>(`/bills/${id}/toggle_paid`, token, { method: "POST" }),
  autoDetect: (token: string) =>
    request<Bill[]>("/bills/auto_detect", token, { method: "POST" }),
  seedExamples: (token: string) =>
    request<Bill[]>("/bills/seed_examples", token, { method: "POST" }),
  listAccounts: (token: string) => request<BankAccount[]>("/bank/accounts", token),
  listTransactions: (token: string) => request<BankTransaction[]>("/bank/transactions", token),
  syncBank: (token: string) =>
    request<{ ok: boolean; last_synced: string; transactions_synced: number }>("/bank/sync", token, { method: "POST" }),
  calendarStatus: (token: string) =>
    request<{
      google: { connected: boolean; connected_at: string | null; configured: boolean; default_calendar_id: string | null; default_calendar_name: string | null };
      microsoft: { connected: boolean; connected_at: string | null; configured: boolean; default_calendar_id: string | null; default_calendar_name: string | null };
    }>("/calendar/status", token),
  calendarDisconnect: (token: string, provider: "google" | "microsoft") =>
    request<{ ok: boolean }>(`/calendar/disconnect/${provider}`, token, { method: "POST" }),
  calendarSyncAll: (token: string) =>
    request<{ ok: boolean; scheduled: number; google: boolean; microsoft: boolean }>(
      "/calendar/sync_all",
      token,
      { method: "POST" }
    ),
  listExternalCalendars: (token: string, provider: "google" | "microsoft") =>
    request<{ calendars: { id: string; name: string; is_primary: boolean; is_current: boolean }[] }>(
      `/calendar/list/${provider}`,
      token
    ),
  setDefaultCalendar: (token: string, provider: "google" | "microsoft", calendar_id: string, calendar_name?: string) =>
    request<{ ok: boolean; moved: number; unchanged?: boolean }>(
      `/calendar/set_default/${provider}`,
      token,
      { method: "POST", body: JSON.stringify({ calendar_id, calendar_name }) }
    ),
  listCategories: (token: string) =>
    request<{ defaults: string[]; custom: string[]; all: string[] }>("/categories", token),
  createCategory: (token: string, name: string) =>
    request<{ ok: boolean; name: string }>("/categories", token, { method: "POST", body: JSON.stringify({ name }) }),
  deleteCategory: (token: string, name: string) =>
    request<{ ok: boolean }>(`/categories/${encodeURIComponent(name)}`, token, { method: "DELETE" }),
  listRules: (token: string) =>
    request<{ user_rules: { id: string; pattern: string; category: string; created_at: string }[]; built_in: { pattern: string; category: string }[] }>(
      "/category_rules",
      token
    ),
  createRule: (token: string, pattern: string, category: string) =>
    request<{ ok: boolean; id: string }>("/category_rules", token, {
      method: "POST",
      body: JSON.stringify({ pattern, category }),
    }),
  deleteRule: (token: string, id: string) =>
    request<{ ok: boolean }>(`/category_rules/${id}`, token, { method: "DELETE" }),
  recategorizeAll: (token: string) =>
    request<{ ok: boolean; scanned: number; updated: number }>("/transactions/recategorize", token, { method: "POST" }),
  listShoppingItems: (token: string) =>
    request<{ items: { id: string; name: string; done: boolean; created_at: string }[] }>("/shopping_list", token),
  createShoppingItem: (token: string, name: string) =>
    request<{ id: string; name: string; done: boolean; created_at: string }>("/shopping_list", token, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateShoppingItem: (token: string, id: string, updates: { name?: string; done?: boolean }) =>
    request<{ id: string; name: string; done: boolean; created_at: string }>(`/shopping_list/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteShoppingItem: (token: string, id: string) =>
    request<{ ok: boolean }>(`/shopping_list/${id}`, token, { method: "DELETE" }),
  clearDoneShoppingItems: (token: string) =>
    request<{ ok: boolean; deleted: number }>("/shopping_list/clear_done", token, { method: "POST" }),
  listTasks: (token: string) =>
    request<{ items: { id: string; name: string; done: boolean; created_at: string }[] }>("/tasks", token),
  createTask: (token: string, name: string) =>
    request<{ id: string; name: string; done: boolean; created_at: string }>("/tasks", token, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateTask: (token: string, id: string, updates: { name?: string; done?: boolean }) =>
    request<{ id: string; name: string; done: boolean; created_at: string }>(`/tasks/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteTask: (token: string, id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, token, { method: "DELETE" }),
  clearDoneTasks: (token: string) =>
    request<{ ok: boolean; deleted: number }>("/tasks/clear_done", token, { method: "POST" }),
  scanListImage: (token: string, image_base64: string, list_type: "shopping" | "tasks") =>
    request<{ list_type: string; extracted: { name: string; matches_existing_id: string | null; existing_done: boolean | null }[] }>(
      "/list_import/scan",
      token,
      { method: "POST", body: JSON.stringify({ image_base64, list_type }) }
    ),
  applyListImport: (token: string, list_type: "shopping" | "tasks", add_items: string[], uncheck_ids: string[]) =>
    request<{ ok: boolean; created: number; unchecked: number }>(
      "/list_import/apply",
      token,
      { method: "POST", body: JSON.stringify({ list_type, add_items, uncheck_ids }) }
    ),
};

export const oauthUrl = (provider: "google" | "microsoft", token: string) =>
  `${API_BASE}/api/oauth/${provider}/start?token=${encodeURIComponent(token)}`;
