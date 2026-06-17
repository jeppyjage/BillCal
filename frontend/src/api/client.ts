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
  seedExamples: (token: string) =>
    request<Bill[]>("/bills/seed_examples", token, { method: "POST" }),
  listAccounts: (token: string) => request<BankAccount[]>("/bank/accounts", token),
  listTransactions: (token: string) => request<BankTransaction[]>("/bank/transactions", token),
  syncBank: (token: string) =>
    request<{ ok: boolean; last_synced: string; transactions_synced: number }>("/bank/sync", token, { method: "POST" }),
};
