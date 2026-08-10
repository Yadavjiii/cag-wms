import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setToken, getToken } from "../api/client";
import { reconnectRealtime } from "../realtime";
import { User } from "../types";

interface RegisterData {
  fullName: string;
  email: string;
  password: string;
  designation?: string;
  wing?: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const res = await api<{ user: User }>("/auth/me");
          setUser(res.user);
        } catch {
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    setUser(res.user);
    reconnectRealtime();
  }

  async function register(data: RegisterData) {
    const res = await api<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
    setToken(res.token);
    setUser(res.user);
    reconnectRealtime();
  }

  /** Swap a temporary password for a real one. Admin-created accounts land here first. */
  async function changePassword(currentPassword: string, newPassword: string) {
    const res = await api<{ user: User }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setUser(res.user);
  }

  /** Re-read the current user, e.g. after a role or office change. */
  async function refresh() {
    if (!getToken()) return;
    const res = await api<{ user: User }>("/auth/me");
    setUser(res.user);
  }

  function logout() {
    setToken(null);
    setUser(null);
    reconnectRealtime();
  }

  return (
    <Ctx.Provider value={{ user, loading, login, register, changePassword, refresh, logout }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
