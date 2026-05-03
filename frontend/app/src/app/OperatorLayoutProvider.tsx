import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  deriveOperatorLayoutMode,
  isOperatorReviewSurface,
  isOperatorUiScale,
  OPERATOR_STUDIO_PREVIEW_SIZE,
  type OperatorLayoutMode,
  type OperatorReviewSurface,
  type OperatorUiScale,
} from "./operatorLayout";

import styles from "./OperatorLayoutProvider.module.css";

const UI_SCALE_STORAGE_KEY = "app.operator.uiScale";
const REVIEW_SURFACE_STORAGE_KEY = "app.operator.reviewSurface";

interface OperatorLayoutContextValue {
  layoutMode: OperatorLayoutMode;
  uiScale: OperatorUiScale;
  setUiScale: Dispatch<SetStateAction<OperatorUiScale>>;
  reviewSurface: OperatorReviewSurface;
  setReviewSurface: Dispatch<SetStateAction<OperatorReviewSurface>>;
  reviewScale: number;
  reviewTargetWidth: number | null;
  reviewTargetHeight: number | null;
  isStudioSurface: boolean;
  isCompact: boolean;
  isNarrow: boolean;
  bodyWidth: number;
  bodyHeight: number;
  devicePixelRatio: number;
}

const OperatorLayoutContext = createContext<OperatorLayoutContextValue | null>(null);

function readStoredUiScale(): OperatorUiScale {
  if (typeof window === "undefined") return 100;
  const parsed = Number.parseInt(window.localStorage.getItem(UI_SCALE_STORAGE_KEY) ?? "", 10);
  return isOperatorUiScale(parsed) ? parsed : 100;
}

function readStoredReviewSurface(): OperatorReviewSurface {
  if (typeof window === "undefined") return "native";
  const params = new URL(window.location.href).searchParams;
  const requested = params.get("operatorReview") ?? params.get("reviewSurface");
  if (requested === "studio" || requested === "studioPreview") return "studioPreview";
  if (requested === "native") return "native";
  const stored = window.localStorage.getItem(REVIEW_SURFACE_STORAGE_KEY);
  return isOperatorReviewSurface(stored) ? stored : "native";
}

function shouldShowConstrainedWarning() {
  if (typeof window === "undefined") return false;
  const params = new URL(window.location.href).searchParams;
  return import.meta.env.DEV || params.get("transport") === "fixture";
}

export function OperatorLayoutProvider({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(() => ({
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
  }));
  const [viewportSize, setViewportSize] = useState(() => ({
    height: typeof window === "undefined" ? 1080 : window.innerHeight,
    width: typeof window === "undefined" ? 1920 : window.innerWidth,
  }));
  const [devicePixelRatio, setDevicePixelRatio] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio
  );
  const [uiScale, setUiScale] = useState<OperatorUiScale>(readStoredUiScale);
  const [reviewSurface, setReviewSurface] = useState<OperatorReviewSurface>(readStoredReviewSurface);

  const reviewEnabled = reviewSurface === "studioPreview";
  const reviewTarget = reviewEnabled ? OPERATOR_STUDIO_PREVIEW_SIZE : null;

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const update = (width: number, height: number) => {
      setSize({
        height: Math.round(height),
        width: Math.round(width),
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    update(node.clientWidth, node.clientHeight);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const update = (rect: DOMRectReadOnly) => {
      setViewportSize({
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect);
    });
    observer.observe(node);
    update(node.getBoundingClientRect());

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateDpr = () => setDevicePixelRatio(window.devicePixelRatio);
    window.addEventListener("resize", updateDpr);
    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", updateDpr);

    return () => {
      window.removeEventListener("resize", updateDpr);
      media.removeEventListener("change", updateDpr);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REVIEW_SURFACE_STORAGE_KEY, reviewSurface);
  }, [reviewSurface]);

  const layoutMode = deriveOperatorLayoutMode(size);
  const reviewScale =
    reviewTarget === null
      ? 1
      : Math.min(1, viewportSize.width / reviewTarget.width, viewportSize.height / reviewTarget.height);
  const boundedReviewScale = Number.isFinite(reviewScale) && reviewScale > 0 ? reviewScale : 1;
  const value = useMemo<OperatorLayoutContextValue>(
    () => ({
      bodyHeight: size.height,
      bodyWidth: size.width,
      devicePixelRatio,
      isCompact: layoutMode !== "studioFull",
      isNarrow: layoutMode === "narrowUtility" || layoutMode === "constrained",
      isStudioSurface: layoutMode === "studioFull",
      layoutMode,
      reviewScale: boundedReviewScale,
      reviewSurface,
      reviewTargetHeight: reviewTarget?.height ?? null,
      reviewTargetWidth: reviewTarget?.width ?? null,
      setReviewSurface,
      setUiScale,
      uiScale,
    }),
    [
      boundedReviewScale,
      devicePixelRatio,
      layoutMode,
      reviewSurface,
      reviewTarget?.height,
      reviewTarget?.width,
      size.height,
      size.width,
      uiScale,
    ]
  );
  const rootStyle = reviewEnabled
    ? ({
        "--operator-review-scale": String(boundedReviewScale),
        height: `${OPERATOR_STUDIO_PREVIEW_SIZE.height}px`,
        width: `${OPERATOR_STUDIO_PREVIEW_SIZE.width}px`,
      } as CSSProperties)
    : undefined;

  return (
    <OperatorLayoutContext.Provider value={value}>
      <div
        ref={viewportRef}
        className={`${styles.viewport} ${reviewEnabled ? styles.reviewViewport : styles.nativeViewport}`}
        data-operator-review-viewport
        data-review-surface={reviewSurface}
      >
        <div
          ref={rootRef}
          className={styles.root}
          style={rootStyle}
          data-operator-layout-root
          data-layout-mode={layoutMode}
          data-ui-scale={uiScale}
          data-review-surface={reviewSurface}
          data-review-scale={Math.round(boundedReviewScale * 1000) / 1000}
          data-layout-width={size.width}
          data-layout-height={size.height}
          data-device-pixel-ratio={Math.round(devicePixelRatio * 100) / 100}
        >
          {children}
          {layoutMode === "constrained" && shouldShowConstrainedWarning() ? (
            <div className={styles.constrainedWarning} role="status">
              Constrained operator viewport: {size.width}x{size.height}. Minimum utility mode is 1280x800 logical CSS
              pixels.
            </div>
          ) : null}
        </div>
        {reviewEnabled ? (
          <div className={styles.reviewBadge} role="status">
            Studio Preview - {OPERATOR_STUDIO_PREVIEW_SIZE.width}x{OPERATOR_STUDIO_PREVIEW_SIZE.height} @{" "}
            {Math.round(boundedReviewScale * 100)}%
          </div>
        ) : null}
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
