import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { isOperatorUiScale, type OperatorUiScale } from "./operatorLayout";

import styles from "./OperatorLayoutProvider.module.css";

const UI_SCALE_STORAGE_KEY = "app.operator.uiScale";
const THEME_STORAGE_KEY = "app.operator.theme";

export type OperatorTheme = "studio" | "graphite" | "bone";

function isOperatorTheme(value: unknown): value is OperatorTheme {
  return value === "studio" || value === "graphite" || value === "bone";
}

// New pages program, Slice SW (D22): one layout, the studio one at 2560 × 1440,
// so the provider measures nothing. It carries the operator's two preferences.
interface OperatorLayoutContextValue {
  uiScale: OperatorUiScale;
  setUiScale: Dispatch<SetStateAction<OperatorUiScale>>;
  theme: OperatorTheme;
  setTheme: Dispatch<SetStateAction<OperatorTheme>>;
}

const OperatorLayoutContext = createContext<OperatorLayoutContextValue | null>(null);

function readStoredUiScale(): OperatorUiScale {
  if (typeof window === "undefined") return 100;
  const parsed = Number.parseInt(window.localStorage.getItem(UI_SCALE_STORAGE_KEY) ?? "", 10);
  return isOperatorUiScale(parsed) ? parsed : 100;
}

function readStoredTheme(): OperatorTheme {
  if (typeof window === "undefined") return "studio";
  const requested = new URL(window.location.href).searchParams.get("theme");
  if (isOperatorTheme(requested)) return requested;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isOperatorTheme(stored) ? stored : "studio";
}

export function OperatorLayoutProvider({ children }: { children: ReactNode }) {
  const [uiScale, setUiScale] = useState<OperatorUiScale>(readStoredUiScale);
  const [theme, setTheme] = useState<OperatorTheme>(readStoredTheme);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(uiScale));
  }, [uiScale]);

  // Overlays (dialogs, drawers, context menu, color picker, toasts) portal to
  // document.body, outside the `.root` scope that defines the --operator-*
  // scale tokens. Stamp body so the grouped rule in
  // OperatorLayoutProvider.module.css also resolves there — same single token
  // source, never a :root copy (the S2 regression).
  useEffect(() => {
    const body = document.body;
    body.setAttribute("data-operator-scale-host", "");
    body.setAttribute("data-ui-scale", String(uiScale));
    return () => {
      body.removeAttribute("data-operator-scale-host");
      body.removeAttribute("data-ui-scale");
    };
  }, [uiScale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Theme lives on <html> so portaled overlays inherit it. Studio is the
    // generated `tokens.css` default; graphite/bone match `themes.css` blocks.
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const value = useMemo<OperatorLayoutContextValue>(() => ({ setTheme, setUiScale, theme, uiScale }), [theme, uiScale]);

  return (
    <OperatorLayoutContext.Provider value={value}>
      <div className={styles.root} data-operator-layout-root data-ui-scale={uiScale}>
        {children}
      </div>
    </OperatorLayoutContext.Provider>
  );
}

export function useOperatorLayout() {
  const value = useContext(OperatorLayoutContext);
  if (!value) {
    throw new Error("useOperatorLayout must be used within OperatorLayoutProvider.");
  }
  return value;
}
