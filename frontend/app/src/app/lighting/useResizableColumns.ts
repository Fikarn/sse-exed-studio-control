import { useCallback, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const RAIL_DEFAULT = 280;
const INSPECTOR_DEFAULT = 360;
const RAIL_MIN = 220;
const RAIL_MAX = 420;
const INSPECTOR_MIN = 280;
const INSPECTOR_MAX = 560;

const STORAGE_KEY_RAIL = "lighting.layout.railWidth";
const STORAGE_KEY_INSPECTOR = "lighting.layout.inspectorWidth";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readStoredWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export type ResizeSide = "rail" | "inspector";

export interface ResizableColumns {
  railWidth: number;
  inspectorWidth: number;
  startResize: (side: ResizeSide) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  isResizing: boolean;
}

export function useResizableColumns(): ResizableColumns {
  const [railWidth, setRailWidth] = useState(() => readStoredWidth(STORAGE_KEY_RAIL, RAIL_DEFAULT, RAIL_MIN, RAIL_MAX));
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readStoredWidth(STORAGE_KEY_INSPECTOR, INSPECTOR_DEFAULT, INSPECTOR_MIN, INSPECTOR_MAX)
  );
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_RAIL, String(railWidth));
  }, [railWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_INSPECTOR, String(inspectorWidth));
  }, [inspectorWidth]);

  const startResize = useCallback(
    (side: ResizeSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startClientX = event.clientX;
      const startWidth = side === "rail" ? railWidth : inspectorWidth;

      setIsResizing(true);

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startClientX;
        if (side === "rail") {
          setRailWidth(clamp(startWidth + dx, RAIL_MIN, RAIL_MAX));
        } else {
          setInspectorWidth(clamp(startWidth - dx, INSPECTOR_MIN, INSPECTOR_MAX));
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
    [railWidth, inspectorWidth]
  );

  return { railWidth, inspectorWidth, startResize, isResizing };
}
