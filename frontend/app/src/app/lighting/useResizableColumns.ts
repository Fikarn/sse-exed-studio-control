import { useCallback, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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

// Visual overhaul A, Slice 5: the plate is D4's 416 px. The rail's numbers are
// kept for the stored widths, but the rail itself is the shell's cluster now.
const COLUMN_SPEC: ColumnSpec = {
  railDefault: 280,
  railMin: 220,
  railMax: 420,
  inspectorDefault: 416,
  inspectorMin: 280,
  inspectorMax: 560,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// New pages program, Slice SW (D22): one layout, so one pair of widths. Their
// names keep the studio layout's "studioFull", so the widths the operator has
// set survive.
function storageKey(side: ResizeSide) {
  return `lighting.layout.studioFull.${side}Width`;
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

function readWidths() {
  return {
    inspectorWidth: readStoredWidth(
      storageKey("inspector"),
      LEGACY_STORAGE_KEY_INSPECTOR,
      COLUMN_SPEC.inspectorDefault,
      COLUMN_SPEC.inspectorMin,
      COLUMN_SPEC.inspectorMax
    ),
    railWidth: readStoredWidth(
      storageKey("rail"),
      LEGACY_STORAGE_KEY_RAIL,
      COLUMN_SPEC.railDefault,
      COLUMN_SPEC.railMin,
      COLUMN_SPEC.railMax
    ),
  };
}

export function useResizableColumns(): ResizableColumns {
  const [widths, setWidths] = useState(readWidths);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey("rail"), String(widths.railWidth));
  }, [widths.railWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey("inspector"), String(widths.inspectorWidth));
  }, [widths.inspectorWidth]);

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
            railWidth: clamp(startWidth + dx, COLUMN_SPEC.railMin, COLUMN_SPEC.railMax),
          }));
        } else {
          setWidths((current) => ({
            ...current,
            inspectorWidth: clamp(startWidth - dx, COLUMN_SPEC.inspectorMin, COLUMN_SPEC.inspectorMax),
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
    [widths.inspectorWidth, widths.railWidth]
  );

  return { railWidth: widths.railWidth, inspectorWidth: widths.inspectorWidth, startResize, isResizing };
}
