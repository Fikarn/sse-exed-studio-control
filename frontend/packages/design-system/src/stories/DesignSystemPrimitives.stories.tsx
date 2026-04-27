import { useState } from "react";
import { Bell, Check, Download, SlidersHorizontal, WandSparkles } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../components/Button";
import { CueRail } from "../components/CueRail";
import { DenseList, DenseListRow, DenseTable } from "../components/DenseRows";
import { EmptyState, DegradedState } from "../components/OperationalState";
import { IconButton } from "../components/IconButton";
import { InspectorPanel, InspectorSection } from "../components/InspectorPanel";
import { MeterBridge } from "../components/MeterBridge";
import { MetricCard } from "../components/MetricCard";
import { SegmentedControl } from "../components/SegmentedControl";
import { StatusBadge } from "../components/StatusBadge";
import { StatusBand } from "../components/StatusBand";
import { Surface } from "../components/Surface";
import { ToggleButton } from "../components/ToggleButton";
import { Toolbar, ToolbarGroup } from "../components/Toolbar";

function PrimitiveConsoleBoard() {
  const [mode, setMode] = useState("program");
  const [armed, setArmed] = useState(true);
  const [selectedCue, setSelectedCue] = useState("cue-2");

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

        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "0.85fr 1.15fr" }}>
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
          <CueRail
            activeId={selectedCue}
            cues={[
              { detail: "Room warmup", id: "cue-1", label: "Preset checks", meta: "09:00", state: "complete" },
              {
                detail: "Lighting and stream deck",
                id: "cue-2",
                label: "Operator setup",
                meta: "Now",
                state: "active",
              },
              { detail: "Audio scene recall", id: "cue-3", label: "Presenter live", meta: "Next", state: "ready" },
              { detail: "Requires device sync", id: "cue-4", label: "Recording wrap", meta: "Hold", state: "blocked" },
            ]}
            label="Session cue rail"
            onSelect={setSelectedCue}
          />
        </div>

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
