export type { MeterSample } from "@sse/engine-client";

export type MeterChannelKind = "channel" | "mixTarget";

export interface BallisticsHardRiseConfig {
  releaseDbPerSec: number;
  peakHoldMs: number;
  clipLatchMs: number;
}

export interface BallisticsVuConfig {
  attackMs: number;
  releaseMs: number;
}

export type BallisticsPreset =
  | ({ kind: "digital-peak" } & BallisticsHardRiseConfig)
  | { kind: "ppm-i" }
  | { kind: "ppm-iia" }
  | { kind: "ppm-iib" }
  | ({ kind: "vu" } & BallisticsVuConfig)
  | { kind: "k-system"; reference: 12 | 14 | 20 };

export interface MeterState {
  level: number;
  peakHold: number;
  peakHoldExpiresMs: number;
  clipLatchExpiresMs: number;
}
