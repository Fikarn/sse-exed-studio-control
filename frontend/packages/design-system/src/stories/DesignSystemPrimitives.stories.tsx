import { useState } from "react";
import {
  Bell,
  Calendar,
  Check,
  Download,
  Mic,
  Plus,
  Sliders,
  SlidersHorizontal,
  Sun,
  WandSparkles,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../components/Button";
import { ChipStrip, type ChipStripChip } from "../components/ChipStrip";
import { ColorPicker, type ColorPickerSwatch } from "../components/ColorPicker";
import { Crest } from "../components/Crest";
import { DenseList, DenseListRow, DenseTable } from "../components/DenseRows";
import { EmptyState, DegradedState } from "../components/OperationalState";
import { HealthBar } from "../components/HealthBar";
import { IconButton } from "../components/IconButton";
import { InspectorPanel, InspectorSection } from "../components/InspectorPanel";
import { MeterBridge } from "../components/MeterBridge";
import { MetricCard } from "../components/MetricCard";
import { NavItem } from "../components/NavItem";
import { PlotMeta } from "../components/PlotMeta";
import { PlotPill } from "../components/PlotPill";
import { SegmentedControl } from "../components/SegmentedControl";
import { StatusBadge } from "../components/StatusBadge";
import { StatusBand } from "../components/StatusBand";
import { StatusDot } from "../components/StatusDot";
import { Surface } from "../components/Surface";
import { ToggleButton } from "../components/ToggleButton";
import { Toolbar, ToolbarGroup } from "../components/Toolbar";

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
  fontFamily: "var(--font-family-display)",
  fontWeight: 600,
  fontSize: 16,
};

const dModBlue: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: 10,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "var(--color-brand-blue-hot)",
  fontWeight: 600,
};

const dModYellow: React.CSSProperties = {
  fontFamily: "var(--font-family-mono)",
  fontSize: 10,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: "var(--color-brand-yellow)",
  fontWeight: 600,
};

function PrimitiveConsoleBoard() {
  const [mode, setMode] = useState("program");
  const [armed, setArmed] = useState(true);

  return (
    <main
      style={{
        display: "grid",
        gap: "16px",
        gridTemplateColumns: "1.2fr 0.8fr",
        minHeight: "100vh",
        padding: "24px",
      }}
    >
      <section aria-labelledby="console-primitives-title" className="console-grid">
        <Surface>
          <div className="console-grid">
            <div>
              <span className="console-eyebrow">Shared Controls</span>
              <h1 className="console-sectionTitle" id="console-primitives-title">
                Operator Console Primitives
              </h1>
            </div>
            <Toolbar label="Operator workspace actions">
              <ToolbarGroup label="Mode">
                <SegmentedControl
                  label="Workspace mode"
                  onChange={setMode}
                  options={[
                    { label: "Program", value: "program" },
                    { label: "Preview", value: "preview" },
                    { label: "Safe", value: "safe" },
                  ]}
                  value={mode}
                />
              </ToolbarGroup>
              <ToolbarGroup label="Tools">
                <IconButton icon={SlidersHorizontal} label="Open mixer inspector" />
                <IconButton badge="2" icon={Bell} label="Show operator alerts" tone="primary" />
                <IconButton icon={Download} label="Export diagnostics" tone="ghost" />
              </ToolbarGroup>
              <ToolbarGroup label="State">
                <ToggleButton
                  description="Local UI gate only"
                  onClick={() => setArmed((value) => !value)}
                  pressed={armed}
                >
                  Armed
                </ToggleButton>
              </ToolbarGroup>
            </Toolbar>
          </div>
        </Surface>

        <StatusBand
          actions={<Button size="compact">Review</Button>}
          summary="Engine snapshot current, Companion profile export available."
          title="Studio control ready"
          tone="ready"
        />

        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <MetricCard caption="Protocol" tone="ready" value="v1" />
          <MetricCard caption="Audio" tone="connected" value="OSC live" />
          <MetricCard caption="Lighting" tone="warning" value="2 notes" />
        </div>

        <MeterBridge
          channels={[
            { id: "pgm-l", label: "L", level: 72, peak: 80, state: "signal" },
            { id: "pgm-r", label: "R", level: 69, peak: 77, state: "signal" },
            { id: "mic-1", label: "Mic 1", level: 84, peak: 90, state: "hot" },
            { id: "zoom", label: "Zoom", level: 24, peak: 41, state: "signal" },
            { id: "usb", label: "USB", level: 0, peak: 3, state: "idle" },
          ]}
          label="Program audio meter bridge"
        />

        <DenseTable
          caption="Patch diagnostics"
          columns={[
            { key: "fixture", label: "Fixture" },
            { key: "address", label: "Address" },
            { align: "end", key: "state", label: "State" },
          ]}
          rows={[
            {
              cells: { address: "1-6", fixture: "Key Astra", state: <StatusBadge label="ready" tone="ready" /> },
              id: "fixture-key",
              tone: "ready",
            },
            {
              cells: {
                address: "7-18",
                fixture: "Infinibar PB12",
                state: <StatusBadge label="warning" tone="warning" />,
              },
              id: "fixture-bar",
              tone: "warning",
            },
            {
              cells: { address: "19-26", fixture: "Apollo Bridge", state: <StatusBadge label="idle" tone="idle" /> },
              id: "fixture-bridge",
              tone: "muted",
            },
          ]}
        />
      </section>

      <InspectorPanel
        actions={<IconButton icon={WandSparkles} label="Run local preview" />}
        eyebrow="Inspector"
        status={<StatusBadge label="degraded" tone="degraded" />}
        title="Selected workspace"
      >
        <InspectorSection title="Dense list rows">
          <DenseList aria-label="Workspace health rows">
            <DenseListRow
              detail="Local gate active"
              leading={<Check aria-hidden="true" size={16} />}
              meta="Ready"
              title="Setup runner"
              tone="ready"
            />
            <DenseListRow detail="Engine diagnostic available" meta="2 notes" title="Lighting patch" tone="warning" />
            <DenseListRow detail="No scheduled task selected" meta="Idle" title="Planning board" tone="muted" />
          </DenseList>
        </InspectorSection>

        <InspectorSection title="State surfaces">
          <EmptyState
            actions={<Button size="compact">Create placeholder</Button>}
            message="The operator can continue; no engine state is synthesized here."
            title="No task selected"
          />
          <DegradedState
            actions={
              <Button size="compact" variant="secondary">
                Open diagnostics
              </Button>
            }
            message="The bridge is reachable, but one configured action is stale."
            title="Control surface needs review"
          />
        </InspectorSection>
      </InspectorPanel>
    </main>
  );
}

const meta = {
  title: "Design System/Primitives",
  parameters: {
    a11y: {
      test: "error",
    },
    layout: "fullscreen",
  },
  render: () => <PrimitiveConsoleBoard />,
} satisfies Meta;

export default meta;

export const Overview: StoryObj<typeof meta> = {};

export const DirectionDCrest: StoryObj<typeof meta> = {
  name: "Direction D · Crest sizes",
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

export const DirectionDNavItem: StoryObj<typeof meta> = {
  name: "Direction D · NavItem rail",
  render: () => (
    <div style={dStage}>
      <div style={{ ...dRow, gap: "4px" }}>
        <NavItem id="setup" label="Setup" icon={<Sliders size={16} />} />
        <NavItem id="planning" label="Planning" icon={<Calendar size={16} />} />
        <NavItem id="lighting" label="Lighting" icon={<Sun size={16} />} active />
        <NavItem id="audio" label="Audio" icon={<Mic size={16} />} />
      </div>
    </div>
  ),
};

export const DirectionDStatusDot: StoryObj<typeof meta> = {
  name: "Direction D · StatusDot matrix",
  render: () => (
    <div style={dStage}>
      <div style={dColumn}>
        <div style={dRow}>
          <span style={{ width: "120px" }}>md, glow on</span>
          <StatusDot state="ok" />
          <StatusDot state="attn" />
          <StatusDot state="err" />
          <StatusDot state="info" />
        </div>
        <div style={dRow}>
          <span style={{ width: "120px" }}>sm, glow on</span>
          <StatusDot state="ok" size="sm" />
          <StatusDot state="attn" size="sm" />
          <StatusDot state="err" size="sm" />
          <StatusDot state="info" size="sm" />
        </div>
        <div style={dRow}>
          <span style={{ width: "120px" }}>md, glow off</span>
          <StatusDot state="ok" glow={false} />
          <StatusDot state="attn" glow={false} />
          <StatusDot state="err" glow={false} />
          <StatusDot state="info" glow={false} />
        </div>
      </div>
    </div>
  ),
};

export const DirectionDHealthBar: StoryObj<typeof meta> = {
  name: "Direction D · HealthBar (clean)",
  render: () => (
    <div style={{ ...dStage, padding: 0 }}>
      <div style={{ height: "320px" }} />
      <HealthBar
        items={[
          { label: "Bridge", dot: "ok", value: "DMX U1 · reachable" },
          { label: "Universe", dot: "ok", value: "12 / 512 ch" },
          { label: "Fixtures", dot: "ok", value: "6 / 6 patched" },
          { label: "Auto-save", dot: "ok", value: "Saved", suffix: "· last 19:38 UTC" },
          { label: "Session", value: "2h 47m" },
          { label: "App", value: "v2.2.2" },
        ]}
        hint={{ kbd: "?", label: "Shortcuts" }}
      />
    </div>
  ),
};

export const DirectionDHealthBarDirty: StoryObj<typeof meta> = {
  name: "Direction D · HealthBar (drift)",
  render: () => (
    <div style={{ ...dStage, padding: 0 }}>
      <div style={{ height: "320px" }} />
      <HealthBar
        items={[
          { label: "Bridge", dot: "ok", value: "DMX U1 · reachable" },
          { label: "Universe", dot: "ok", value: "12 / 512 ch" },
          { label: "Fixtures", dot: "ok", value: "6 / 6 patched" },
          { label: "Auto-save", dot: "attn", value: "Unsaved changes" },
          { label: "Session", value: "2h 47m" },
          { label: "App", value: "v2.2.2" },
        ]}
        hint={{ kbd: "?", label: "Shortcuts" }}
      />
    </div>
  ),
};

export const DirectionDPlotPill: StoryObj<typeof meta> = {
  name: "Direction D · PlotPill states",
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
          <PlotPill state="patch">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Patch mode</span>
            <span style={dModBlue}>· DMX overlay</span>
          </PlotPill>
        </div>
      </div>
    </div>
  ),
};

export const DirectionDPlotMeta: StoryObj<typeof meta> = {
  name: "Direction D · PlotMeta tones",
  render: () => (
    <div style={dStage}>
      <div style={dRow}>
        <PlotMeta label="Floor" value="12 m × 8 m" />
        <PlotMeta label="Grid" value="0.5 / 1 / 5 m" />
        <PlotMeta label="Universe" value="U1 · 512 ch" tone="blue" />
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

export const DirectionDColorPicker: StoryObj<typeof meta> = {
  name: "Direction D · ColorPicker (selected)",
  render: () => <ColorPickerStoryHarness initial={2} />,
};

export const DirectionDColorPickerCleared: StoryObj<typeof meta> = {
  name: "Direction D · ColorPicker (cleared)",
  render: () => <ColorPickerStoryHarness initial={null} />,
};

const chipStripDemoChips: readonly ChipStripChip[] = [
  { id: "a", label: "Astra L", accentColor: "#fbbf6f", leadingBadge: 1 },
  { id: "b", label: "Astra R", accentColor: "#fbbf6f", leadingBadge: 2 },
  { id: "c", label: "Infinibar PB12", accentColor: "#a3e635", leadingBadge: 3 },
  { id: "d", label: "Apollo Bridge", accentColor: "#22d3ee", leadingBadge: 4 },
  { id: "e", label: "Infinimat", accentColor: "#fb923c", leadingBadge: 5 },
];

export const DirectionDChipStrip: StoryObj<typeof meta> = {
  name: "Direction D · ChipStrip (selection-style)",
  render: () => (
    <div style={dStage}>
      <div style={{ ...dColumn, maxWidth: 720 }}>
        <ChipStrip chips={chipStripDemoChips} ariaLabel="Selected fixtures sample" />
      </div>
    </div>
  ),
};

export const DirectionDHealthBarActions: StoryObj<typeof meta> = {
  name: "Direction D · HealthBar (with actions slot)",
  render: () => (
    <div style={{ ...dStage, padding: 0 }}>
      <div style={{ height: "320px" }} />
      <HealthBar
        items={[
          { label: "Bridge", dot: "ok", value: "DMX U1 · reachable" },
          { label: "Universe", dot: "ok", value: "12 / 512 ch" },
          { label: "Fixtures", dot: "ok", value: "6 / 6 patched" },
          { label: "Auto-save", dot: "ok", value: "Saved", suffix: "· last 19:38 UTC" },
          { label: "Session", value: "2h 47m" },
          { label: "App", value: "v2.2.2" },
        ]}
        hints={[
          { kbd: "⌘ K", label: "command palette" },
          { kbd: "⌘ ⇧ M", label: "full DMX monitor" },
        ]}
        actions={
          <Button size="compact" variant="ghost">
            DMX strip
          </Button>
        }
      />
    </div>
  ),
};

export const DirectionDEmptyStateAction: StoryObj<typeof meta> = {
  name: "Direction D · EmptyState (hasAction)",
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
