import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "../MetricCard";
import type { StatusTone } from "../StatusBadge";

// plan PR 6 / workstream D2: MetricCard is a purely-visual KPI card (3
// imports). Composes a StatusBadge for tone — tests cover render +
// every tone variant on the embedded badge.

const TONES: readonly StatusTone[] = ["healthy", "ready", "connected", "degraded", "warning", "idle", "error"];

describe("MetricCard", () => {
  it("renders caption and value", () => {
    render(<MetricCard caption="Latency" value="12 ms" />);
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText("12 ms")).toBeInTheDocument();
  });

  it("defaults to the 'idle' tone for the embedded badge", () => {
    render(<MetricCard caption="X" value="1" />);
    // StatusBadge renders the tone string as its visible label.
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("applies every documented tone to the embedded badge", () => {
    for (const tone of TONES) {
      const { unmount } = render(<MetricCard caption="Cue" value="42" tone={tone} />);
      const badge = screen.getByText(tone);
      expect(badge.className).toMatch(new RegExp(tone));
      unmount();
    }
  });

  it("renders an explicit human label instead of the tone enum when `label` is given", () => {
    render(<MetricCard caption="Code" label="Attention" tone="warning" value="PROTOCOL_MISMATCH" />);
    // The human label shows; the raw tone enum does not leak as badge text.
    const badge = screen.getByText("Attention");
    expect(badge.className).toMatch(/warning/);
    expect(screen.queryByText("warning")).toBeNull();
  });

  it("shows the badge by default (showBadge defaults to true)", () => {
    render(<MetricCard caption="Lighting" label="Active" tone="ready" value="2 notes" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("omits the badge entirely when showBadge is false (bare caption+value chip)", () => {
    render(<MetricCard caption="Slipped" value="3" tone="warning" showBadge={false} />);
    expect(screen.getByText("Slipped")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // No StatusBadge is rendered, so neither the tone enum nor a label leaks.
    expect(screen.queryByText("warning")).toBeNull();
  });
});
