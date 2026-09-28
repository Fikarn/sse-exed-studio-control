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

// New pages program, Slice SW (D22): one layout, the studio one at 2560 × 1440,
// so the provider measures nothing. It carries the operator's one preference,
// the UI scale. One theme, Studio (D25, 2026-09-28): the theme it also kept,
// its keys in Setup / Support and the `?theme=` of an address are gone, and a
// theme an older build remembered is left unread.
interface OperatorLayoutContextValue {
  uiScale: OperatorUiScale;
  setUiScale: Dispatch<SetStateAction<OperatorUiScale>>;
}

const OperatorLayoutContext = createContext<OperatorLayoutContextValue | null>(null);

function readStoredUiScale(): OperatorUiScale {
  if (typeof window === "undefined") return 100;
  const parsed = Number.parseInt(window.localStorage.getItem(UI_SCALE_STORAGE_KEY) ?? "", 10);
  return isOperatorUiScale(parsed) ? parsed : 100;
}

export function OperatorLayoutProvider({ children }: { children: ReactNode }) {
  const [uiScale, setUiScale] = useState<OperatorUiScale>(readStoredUiScale);

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

  const value = useMemo<OperatorLayoutContextValue>(() => ({ setUiScale, uiScale }), [uiScale]);

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
