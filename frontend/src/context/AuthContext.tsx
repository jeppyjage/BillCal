import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { setOnUnauthorized } from "@/src/api/client";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "billcal_token";
const USER_KEY = "billcal_user";

export interface User {
  id: string;
  email: string;
  full_name?: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Avoid bouncing the user out repeatedly on a burst of 401s from
  // parallel screen-mount requests.
  const loggingOutRef = useRef(false);

  const clearStorage = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(USER_KEY);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const logout = useCallback(async () => {
    await clearStorage();
    setToken(null);
    setUser(null);
    try {
      router.replace("/auth/login");
    } catch {
      /* router may not be ready */
    }
  }, [clearStorage]);

  // Register a single global 401 handler so every API call in client.ts
  // can flick us back to the login screen instead of dead-ending on
  // "User not found".
  useEffect(() => {
    setOnUnauthorized(() => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      (async () => {
        await clearStorage();
        setToken(null);
        setUser(null);
        try {
          router.replace("/auth/login");
        } catch {
          /* ignore */
        }
        // Allow a fresh logout after a short cool-down window
        setTimeout(() => {
          loggingOutRef.current = false;
        }, 1500);
      })();
    });
    return () => setOnUnauthorized(null);
  }, [clearStorage]);

  // On boot: rehydrate token, then validate it with /auth/me.
  // If the server says it's stale, silently clear and stay on login.
  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        const u = await AsyncStorage.getItem(USER_KEY);
        if (!t || !u) {
          return;
        }
        // Validate with backend before trusting the cached user.
        try {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${t}` },
          });
          if (res.status === 401) {
            await clearStorage();
            return;
          }
          if (!res.ok) {
            // Network or transient error — keep cached user but don't crash.
            setToken(t);
            setUser(JSON.parse(u));
            return;
          }
          const fresh = await res.json();
          setToken(t);
          setUser(fresh);
          // Refresh cached profile in case full_name etc. changed
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh));
        } catch {
          // Network down — fall back to cached identity so the app still opens
          setToken(t);
          setUser(JSON.parse(u));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [clearStorage]);

  const persist = async (t: string, u: User) => {
    await AsyncStorage.setItem(TOKEN_KEY, t);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    await persist(data.token, data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, full_name?: string) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");
    await persist(data.token, data.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
