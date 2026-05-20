import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "../AudioWorkspace.module.css";
import { AUDIO_DRAFT_CLEAR_MS } from "../audioConstants";
import { AUDIO_FADER_UNITY, snapFaderValue } from "../audioFormatting";

export interface AudioSliderControlProps {
  "data-testid"?: string;
  className?: string;
  disabled?: boolean;
  fineStep?: number;
  label: string;
  max?: number;
  min?: number;
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  onRequestNumericValue?: (currentValue: number) => number | null;
  orientation: "vertical" | "horizontal";
  snapUnity?: boolean;
  step?: number;
  value: number;
  valueText?: string;
}

interface DragState {
  axisSize: number;
  fine: boolean;
  latestValue: number;
  pointerId: number;
  rectLeft: number;
  rectTop: number;
  startPointer: number;
  startValue: number;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function quantize(value: number, step: number, min: number, max: number) {
  if (!Number.isFinite(step) || step <= 0) {
    return clamp(value, min, max);
  }
  const rounded = Math.round((value - min) / step) * step + min;
  return clamp(Number(rounded.toFixed(5)), min, max);
}

function formatAriaNumber(value: number) {
  return Number(value.toFixed(5)).toString();
}

export function AudioSliderControl({
  "data-testid": testId,
  className,
  disabled = false,
  fineStep,
  label,
  max = 1,
  min = 0,
  onCommit,
  onPreview,
  onRequestNumericValue,
  orientation,
  snapUnity = false,
  step = 0.01,
  value,
  valueText,
}: AudioSliderControlProps) {
  const dragRef = useRef<DragState | null>(null);
  const lastPointerDownAtRef = useRef(0);
  const localClearTimerRef = useRef<number | null>(null);
  const [localDraftValue, setLocalDraftValue] = useState<number | null>(null);
  const span = Math.max(0.00001, max - min);
  const currentValue = clamp(localDraftValue ?? value, min, max);
  const effectiveFineStep = fineStep ?? step;
  const pct = ((currentValue - min) / span) * 100;

  useEffect(() => {
    if (dragRef.current) return;
    setLocalDraftValue(null);
  }, [value]);

  useEffect(
    () => () => {
      if (localClearTimerRef.current !== null) {
        window.clearTimeout(localClearTimerRef.current);
      }
    },
    []
  );

  const normalizeValue = (nextValue: number, { shouldSnap, valueStep }: { shouldSnap: boolean; valueStep: number }) => {
    const stepped = quantize(nextValue, valueStep, min, max);
    return shouldSnap ? snapFaderValue(stepped) : stepped;
  };

  const preview = (nextValue: number) => {
    setLocalDraftValue(nextValue);
    onPreview?.(nextValue);
  };

  const previewAndCommit = (nextValue: number) => {
    preview(nextValue);
    onCommit(nextValue);
    if (localClearTimerRef.current !== null) {
      window.clearTimeout(localClearTimerRef.current);
    }
    localClearTimerRef.current = window.setTimeout(() => {
      localClearTimerRef.current = null;
      setLocalDraftValue(null);
    }, AUDIO_DRAFT_CLEAR_MS);
  };

  const requestNumericEntry = () => {
    if (!onRequestNumericValue) return;
    const nextValue = onRequestNumericValue(currentValue);
    if (typeof nextValue === "number") {
      previewAndCommit(quantize(nextValue, step, min, max));
    }
  };

  const valueFromPointer = (event: ReactPointerEvent<HTMLElement>, drag?: DragState) => {
    const rectLeft = drag?.rectLeft ?? event.currentTarget.getBoundingClientRect().left;
    const rectTop = drag?.rectTop ?? event.currentTarget.getBoundingClientRect().top;
    const axisSize =
      drag?.axisSize ??
      (orientation === "vertical"
        ? Math.max(1, event.currentTarget.getBoundingClientRect().height)
        : Math.max(1, event.currentTarget.getBoundingClientRect().width));
    if (orientation === "vertical") {
      return min + (1 - (event.clientY - rectTop) / axisSize) * span;
    }
    return min + ((event.clientX - rectLeft) / axisSize) * span;
  };

  const valueFromFineDrag = (event: ReactPointerEvent<HTMLElement>, drag: DragState) => {
    const pointer = orientation === "vertical" ? event.clientY : event.clientX;
    const direction = orientation === "vertical" ? -1 : 1;
    const delta = ((pointer - drag.startPointer) / drag.axisSize) * direction * span * 0.1;
    return drag.startValue + delta;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();

    const now = performance.now();
    if (onRequestNumericValue && now - lastPointerDownAtRef.current <= 360) {
      lastPointerDownAtRef.current = 0;
      requestNumericEntry();
      return;
    }
    lastPointerDownAtRef.current = now;

    if (snapUnity && event.shiftKey) {
      const unity = clamp(AUDIO_FADER_UNITY, min, max);
      previewAndCommit(unity);
      return;
    }

    const fine = event.metaKey || event.ctrlKey;
    const rect = event.currentTarget.getBoundingClientRect();
    const axisSize = orientation === "vertical" ? Math.max(1, rect.height) : Math.max(1, rect.width);
    const nextValue = fine
      ? currentValue
      : normalizeValue(
          valueFromPointer(event, {
            axisSize,
            fine,
            latestValue: currentValue,
            pointerId: event.pointerId,
            rectLeft: rect.left,
            rectTop: rect.top,
            startPointer: orientation === "vertical" ? event.clientY : event.clientX,
            startValue: currentValue,
          }),
          { shouldSnap: snapUnity, valueStep: step }
        );
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      axisSize,
      fine,
      latestValue: nextValue,
      pointerId: event.pointerId,
      rectLeft: rect.left,
      rectTop: rect.top,
      startPointer: orientation === "vertical" ? event.clientY : event.clientX,
      startValue: currentValue,
    };
    preview(nextValue);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const rawValue = drag.fine ? valueFromFineDrag(event, drag) : valueFromPointer(event, drag);
    const nextValue = normalizeValue(rawValue, {
      shouldSnap: snapUnity,
      valueStep: drag.fine ? effectiveFineStep : step,
    });
    drag.latestValue = nextValue;
    preview(nextValue);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    previewAndCommit(drag.latestValue);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    const multiplier = event.shiftKey ? 5 : 1;
    let nextValue: number;

    switch (event.key) {
      case "Enter":
        if (onRequestNumericValue) {
          event.preventDefault();
          requestNumericEntry();
        }
        return;
      case "ArrowUp":
      case "ArrowRight":
        nextValue = currentValue + step * multiplier;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        nextValue = currentValue - step * multiplier;
        break;
      case "PageUp":
        nextValue = currentValue + step * 5;
        break;
      case "PageDown":
        nextValue = currentValue - step * 5;
        break;
      case "Home":
        nextValue = min;
        break;
      case "End":
        nextValue = max;
        break;
      default:
        return;
    }

    event.preventDefault();
    previewAndCommit(quantize(nextValue, step, min, max));
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || !onRequestNumericValue) return;
    event.preventDefault();
    event.stopPropagation();
    requestNumericEntry();
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      handleDoubleClick(event);
    }
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail < 2 || disabled || !onRequestNumericValue) return;
    event.preventDefault();
    event.stopPropagation();
    requestNumericEntry();
  };

  return (
    <div
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Number(formatAriaNumber(currentValue))}
      aria-valuetext={valueText}
      className={[styles.sliderControl, className].filter(Boolean).join(" ")}
      data-orientation={orientation}
      data-testid={testId}
      data-unity={snapUnity && currentValue === AUDIO_FADER_UNITY ? "true" : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDownCapture={handleMouseDown}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      role="slider"
      style={{ "--slider-pct": `${pct}%` } as CSSProperties}
      tabIndex={disabled ? -1 : 0}
    >
      <span className={styles.sliderTrack} aria-hidden="true" />
      <span className={styles.sliderFill} aria-hidden="true" />
      <span className={styles.sliderCap} aria-hidden="true" />
    </div>
  );
}
