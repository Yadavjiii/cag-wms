import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api/client";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const ORIGIN = API_URL.replace(/\/api\/?$/, "");

export interface Branding {
  name: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
}

const DEFAULT: Branding = {
  name: "CAG Work Management",
  primaryColor: "#0B2447",
  accentColor: "#C1922B",
  logoUrl: null,
};

const Ctx = createContext<{ branding: Branding; refresh: () => Promise<void> }>({
  branding: DEFAULT,
  refresh: async () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT);

  async function refresh() {
    try {
      const b = await api<Branding>("/settings");
      const merged: Branding = {
        ...DEFAULT,
        ...b,
        logoUrl: b.logoUrl ? `${ORIGIN}${b.logoUrl}` : null,
      };
      setBranding(merged);
      document.title = merged.name;
      document.documentElement.style.setProperty("--brand", merged.primaryColor);
      document.documentElement.style.setProperty("--brand-2", merged.accentColor);
    } catch {
      /* keep defaults if settings can't be loaded */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ branding, refresh }}>{children}</Ctx.Provider>;
}

export const useBranding = () => useContext(Ctx);
