import { useCallback, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { OperatorLayoutMode } from "../operatorLayout";

const LEGACY_STORAGE_KEY_RAIL = "lighting.layout.railWidth";
const LEGACY_STORAGE_KEY_INSPECTOR = "lighting.layout.inspectorWidth";

export type ResizeSide = "rail" | "inspector";

interface ColumnSpec {
  railDefault: number;
  railMin: number;
  railMax: number;
  inspectorDefault: number;
  inspectorMin: number;
  inspectorMax: number;
}

const COLUMN_SPECS: Record<OperatorLayoutMode, ColumnSpec> = {
  studioFull: {
    railDefault: 280,
    railMin: 220,
    railMax: 420,
    inspectorDefault: 360,
    inspectorMin: 280,
    inspectorMax: 560,
  },
  desktopCompact: {
    railDefault: 260,
    railMin: 220,
    railMax: 320,
    inspectorDefault: 320,
    inspectorMin: 280,
    inspectorMax: 380,
  },
  narrowUtility: {
    railDefault: 300,
    railMin: 240,
    railMax: 360,
    inspectorDefault: 360,
    inspectorMin: 320,
    inspectorMax: 440,
  },
  constrained: {
    railDefault: 260,
    railMin: 220,
    railMax: 300,
    inspectorDefault: 320,
    inspectorMin: 300,
    inspectorMax: 380,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function storageKey(mode: OperatorLayoutMode, side: ResizeSide) {
  return `lighting.layout.${mode}.${side}Width`;
}

function readStoredWidth(key: string, legacyKey: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export interface ResizableColumns {
  railWidth: number;
  inspectorWidth: number;
  startResize: (side: ResizeSide) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  isResizing: boolean;
}

function readWidths(mode: OperatorLayoutMode) {
  const spec = COLUMN_SPECS[mode];
  return {
    inspectorWidth: readStoredWidth(
      storageKey(mode, "inspector"),
      LEGACY_STORAGE_KEY_INSPECTOR,
      spec.inspectorDefault,
      spec.inspectorMin,
      spec.inspectorMax
    ),
    railWidth: readStoredWidth(
      storageKey(mode, "rail"),
      LEGACY_STORAGE_KEY_RAIL,
      spec.railDefault,
      spec.railMin,
      spec.railMax
    ),
  };
}

export function useResizableColumns(layoutMode: OperatorLayoutMode): ResizableColumns {
  const [widths, setWidths] = useState(() => readWidths(layoutMode));
  const [isResizing, setIsResizing] = useState(false);
  const spec = COLUMN_SPECS[layoutMode];

  useEffect(() => {
    setWidths(readWidths(layoutMode));
  }, [layoutMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(layoutMode, "rail"), String(widths.railWidth));
  }, [layoutMode, widths.railWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(layoutMode, "inspector"), String(widths.inspectorWidth));
  }, [layoutMode, widths.inspectorWidth]);

  const startResize = useCallback(
    (side: ResizeSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startClientX = event.clientX;
      const startWidth = side === "rail" ? widths.railWidth : widths.inspectorWidth;

      setIsResizing(true);

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startClientX;
        if (side === "rail") {
          setWidths((current) => ({
            ...current,
            railWidth: clamp(startWidth + dx, spec.railMin, spec.railMax),
          }));
        } else {
          setWidths((current) => ({
            ...current,
            inspectorWidth: clamp(startWidth - dx, spec.inspectorMin, spec.inspectorMax),
          }));
        }
      };

      const onUp = (upEvent: PointerEvent) => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setIsResizing(false);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [spec.inspectorMax, spec.inspectorMin, spec.railMax, spec.railMin, widths.inspectorWidth, widths.railWidth]
  );

  return { railWidth: widths.railWidth, inspectorWidth: widths.inspectorWidth, startResize, isResizing };
}
