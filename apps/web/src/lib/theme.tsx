"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "botlings-theme";

/** Runs before paint to avoid a flash of the wrong theme. */
export const themeScript = `(function(){try{var p=localStorage.getItem('${STORAGE_KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", resolved === "dark" ? "#0b0b10" : "#ffffff");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    let stored: ThemePreference = "system";
    try {
      stored = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system";
    } catch {}
    const r = resolve(stored);
    // Sync React state with what the pre-paint script already applied.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(stored);
    setResolved(r);
    apply(r);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      apply(r);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((value: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
    const r = resolve(value);
    setPref(value);
    setResolved(r);
    apply(r);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
