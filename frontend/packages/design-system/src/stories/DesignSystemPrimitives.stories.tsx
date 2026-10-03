import { useState } from "react";
import { Plus, Sun } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../components/Button";
import { ChipStrip, type ChipStripChip } from "../components/ChipStrip";
import { ColorPicker, type ColorPickerSwatch } from "../components/ColorPicker";
import { Crest } from "../components/Crest";
import { EmptyState } from "../components/OperationalState";
import { Footer } from "../components/Footer";
import { Lamp } from "../components/Lamp";
import { LampChip } from "../components/LampChip";
import { Tally } from "../components/Tally";
import { Tab } from "../components/Tab";
import { PlotMeta } from "../components/PlotMeta";
import { PlotPill } from "../components/PlotPill";
import { StatusDot } from "../components/StatusDot";

const dStage: React.CSSProperties = {
  background: "var(--color-bg-deep)",
  color: "var(--color-brand-text-primary)",
  fontFamily: "var(--font-family-ui)",
  padding: "32px",
  minHeight: "100vh",
};

const dRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "24px",
};

const dColumn: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const dDisplayName: React.CSSProperties = {
  fontFamily: "var(--font-family-ui)",
  fontWeight: 700,
  fontSize: 16,
};

const dPreviewLabel: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: 10,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "var(--color-warning-500)",
  fontWeight: 700,
};

const dModYellow: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: 10,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "var(--color-brand-yellow)",
  fontWeight: 700,
};

const meta = {
  title: "Design System/Primitives",
  parameters: {
    a11y: {
      test: "error",
    },
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

export const CrestSizes: StoryObj<typeof meta> = {
  name: "Crest sizes",
  render: () => (
    <div style={dStage}>
      <div style={dRow}>
        <Crest size="sm" />
        <Crest size="md" />
        <Crest size="lg" />
      </div>
    </div>
  ),
};

export const StatusDots: StoryObj<typeof meta> = {
  name: "Status dots",
  render: () => (
    <div style={dStage}>
      <div style={dColumn}>
        <div style={dRow}>
          <span style={{ width: "120px" }}>md, glow on</span>
          <StatusDot tone="ok" />
          <StatusDot tone="attn" />
          <StatusDot tone="err" />
          <StatusDot tone="info" />
        </div>
        <div style={dRow}>
          <span style={{ width: "120px" }}>sm, glow on</span>
          <StatusDot tone="ok" size="sm" />
          <StatusDot tone="attn" size="sm" />
          <StatusDot tone="err" size="sm" />
          <StatusDot tone="info" size="sm" />
        </div>
        <div style={dRow}>
          <span style={{ width: "120px" }}>md, glow off</span>
          <StatusDot tone="ok" glow={false} />
          <StatusDot tone="attn" glow={false} />
          <StatusDot tone="err" glow={false} />
          <StatusDot tone="info" glow={false} />
        </div>
      </div>
    </div>
  ),
};

export const PlotPills: StoryObj<typeof meta> = {
  name: "Plot pills",
  render: () => (
    <div style={dStage}>
      <div style={dColumn}>
        <div style={dRow}>
          <PlotPill state="default">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Recall:</span>
            <span style={dDisplayName}>Standup</span>
          </PlotPill>
        </div>
        <div style={dRow}>
          <PlotPill state="modified">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Recall:</span>
            <span style={dDisplayName}>Standup</span>
            <span style={dModYellow}>· Modified</span>
          </PlotPill>
        </div>
        <div style={dRow}>
          <PlotPill state="preview">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Preview</span>
            <span style={dPreviewLabel}>· Offline edits</span>
          </PlotPill>
        </div>
      </div>
    </div>
  ),
};

export const PlotMetaTones: StoryObj<typeof meta> = {
  name: "Plot meta tones",
  render: () => (
    <div style={dStage}>
      <div style={dRow}>
        <PlotMeta label="Floor" value="12 m × 8 m" />
        <PlotMeta label="Grid" value="0.5 / 1 / 5 m" />
        <PlotMeta label="Selected" value="Key · Astra 1" tone="selected" />
      </div>
    </div>
  ),
};

const colorPickerSwatches: readonly ColorPickerSwatch[] = [
  { index: 0, name: "Rose", hex: "#fb7185" },
  { index: 1, name: "Orange", hex: "#fb923c" },
  { index: 2, name: "Yellow", hex: "#facc15" },
  { index: 3, name: "Lime", hex: "#a3e635" },
  { index: 4, name: "Emerald", hex: "#34d399" },
  { index: 5, name: "Cyan", hex: "#22d3ee" },
  { index: 6, name: "Violet", hex: "#a78bfa" },
  { index: 7, name: "Pink", hex: "#f472b6" },
];

function ColorPickerStoryHarness({ initial }: { initial: number | null }) {
  const [selected, setSelected] = useState<number | null>(initial);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ ...dStage, paddingTop: 80 }}>
      <p style={{ color: "var(--color-brand-text-muted)", marginBottom: 16 }}>
        Selected:{" "}
        <strong style={{ color: "var(--color-brand-text-primary)" }}>
          {selected === null ? "none" : `index ${selected} (${colorPickerSwatches[selected]?.name ?? "?"})`}
        </strong>
      </p>
      <Button onClick={() => setOpen(true)} size="compact">
        Reopen picker
      </Button>
      {open ? (
        <ColorPicker
          x={120}
          y={160}
          swatches={colorPickerSwatches}
          selectedIndex={selected}
          onSelect={(idx) => setSelected(idx)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const ColorPickerSelected: StoryObj<typeof meta> = {
  name: "Colour picker, one chosen",
  render: () => <ColorPickerStoryHarness initial={2} />,
};

export const ColorPickerCleared: StoryObj<typeof meta> = {
  name: "Colour picker, none chosen",
  render: () => <ColorPickerStoryHarness initial={null} />,
};

const chipStripDemoChips: readonly ChipStripChip[] = [
  { id: "a", label: "Astra L", accentColor: "#fbbf6f", leadingBadge: 1 },
  { id: "b", label: "Astra R", accentColor: "#fbbf6f", leadingBadge: 2 },
  { id: "c", label: "Infinibar PB12", accentColor: "#a3e635", leadingBadge: 3 },
  { id: "d", label: "Apollo Bridge", accentColor: "#22d3ee", leadingBadge: 4 },
  { id: "e", label: "Infinimat", accentColor: "#fb923c", leadingBadge: 5 },
];

export const ChipStripSelection: StoryObj<typeof meta> = {
  name: "Chip strip",
  render: () => (
    <div style={dStage}>
      <div style={{ ...dColumn, maxWidth: 720 }}>
        <ChipStrip chips={chipStripDemoChips} ariaLabel="Selected fixtures sample" />
      </div>
    </div>
  ),
};

export const EmptyStateWithAction: StoryObj<typeof meta> = {
  name: "Empty state with an action",
  render: () => (
    <div style={dStage}>
      <div style={dColumn}>
        <EmptyState
          icon={Sun}
          title="No fixtures on the rig yet"
          message="Add your first fixture to start patching DMX addresses."
          action={{ label: "Add fixture", onClick: () => undefined, icon: Plus }}
        />
        <EmptyState
          icon={Sun}
          title="No scenes saved yet"
          message="Adjust fixtures, then save the current rig state as a scene."
          action={{ label: "Save first scene", onClick: () => undefined, variant: "primary" }}
        />
      </div>
    </div>
  ),
};

// Visual overhaul A, Slice 2: the shell primitives — the tab, the lamp, the
// header chip and the footer — as the A-system-sheet specimen draws them.
export const TabRow: StoryObj<typeof meta> = {
  name: "Tab row",
  render: () => (
    <div style={{ display: "flex", gap: 4 }}>
      <Tab id="setup" label="Setup / Support" />
      <Tab id="lighting" label="Lighting" word="no bridge" tone="error" />
      <Tab id="audio" label="Audio" active />
      <Tab id="cameras" label="Cameras" word="not set up" tone="attention" />
      <Tab id="teleprompter" label="Teleprompter" word="playing" value="2:31 left" tone="ok" />
    </div>
  ),
};

export const Lamps: StoryObj<typeof meta> = {
  name: "Lamps and lamp chips",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <Lamp tone="ok" />
        <Lamp tone="attention" />
        <Lamp tone="error" />
        <Lamp tone="info" />
        <Lamp tone="off" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <LampChip label="Surface" word="ready" tone="ok" />
        <LampChip label="Backup" word="overdue" tone="attention" />
        <LampChip label="Surface" word="unavailable" tone="error" />
        <LampChip label="" word="Solo" tone="attention" latch />
        <LampChip label="" word="Scene drift" tone="attention" latch />
      </div>
      {/* The REC tally: at rest, recording, last known, not read. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Tally name="REC" state={null} />
        <Tally name="REC" state={{ detail: "CAM 1", tone: "error" }} />
        <Tally name="REC" state={{ detail: "last known", tone: "attention", doubt: true }} />
        <Tally name="REC" state={{ detail: "not read while released", tone: "attention" }} />
      </div>
    </div>
  ),
};

export const FooterBar: StoryObj<typeof meta> = {
  name: "Footer",
  render: () => (
    <Footer
      items={[
        { label: "Console", value: "confirmed · 42 values" },
        { label: "Metering", value: "RME · live" },
        { label: "Last sync", value: "18:24" },
        { label: "Bank", value: "all 13 strips" },
      ]}
      action={
        <Button size="compact" variant="ghost">
          DMX strip
        </Button>
      }
    />
  ),
};
