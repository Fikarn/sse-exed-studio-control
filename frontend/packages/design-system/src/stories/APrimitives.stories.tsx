import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Drawer } from "../components/Drawer";
import { Footer } from "../components/Footer";
import { ArmKey, Key, Segmented } from "../components/Key";
import { Lamp } from "../components/Lamp";
import { LampChip } from "../components/LampChip";
import { LampWord, Latch } from "../components/LampWord";
import { Meter } from "../components/Meter";
import { DegradedState, EmptyState, LoadingState } from "../components/OperationalState";
import { ControlRow, Danger, Fields, PlateHead, Readouts, Section } from "../components/Plate";
import { Groove, Slider } from "../components/Slider";
import { StateDisplay } from "../components/StateDisplay";
import { StatusBadge } from "../components/StatusBadge";
import { Toast } from "../components/Toast";
import { Field, Readout, Screen } from "../components/Well";

// Visual overhaul A, Slice 3: every primitive per theme, as
// docs/redesign/assets/concepts/A-system-sheet.html draws them. Each story
// declares its theme through `parameters.theme`; the Storybook lane measures
// these pages with the UI contract's light and target checks.

const plate: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 20,
  width: 424,
  background: "var(--elevation-plate-fill)",
  boxShadow: "var(--elevation-plate)",
  color: "var(--text-text)",
  fontFamily: "var(--font-family-ui)",
};

const board: React.CSSProperties = {
  display: "flex",
  gap: 16,
  padding: 16,
  background: "var(--material-bg)",
  minHeight: "100vh",
  alignItems: "flex-start",
};

function Keys() {
  const [engaged, setEngaged] = useState(true);
  const [target, setTarget] = useState("main");
  return (
    <div style={plate} data-material="plate">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Key>Command</Key>
        <Key mode="primary">Primary command</Key>
        <Key mode="danger" cap="Cut all" />
        <Key
          mode="toggle"
          cap="Dim"
          engaged={engaged}
          onClick={() => setEngaged((v) => !v)}
          hint={engaged ? "engaged" : undefined}
          take
        />
        <Key mode="momentary" cap="Talkback" live hint="live · for the hold" layout="stack" size="tall" take />
        <ArmKey armed timeoutMs={4500} secondsLeft={3.9} cap="3" take>
          Interview block
        </ArmKey>
        <Key mode="toggle" cap="Mono" locked reason="Console controls stay locked until the audio probe passes." take />
        <Key mode="hazard" lit>
          48 V
        </Key>
        <Key mode="hazard">48 V</Key>
      </div>
      <Segmented label="Mix target">
        {[
          ["main", "Main Out"],
          ["ph1", "Phones 1"],
          ["ph2", "Phones 2"],
        ].map(([id, cap]) => (
          <Key key={id} mode="segmented" cap={cap} engaged={target === id} onClick={() => setTarget(id!)} take />
        ))}
      </Segmented>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary">Save scene</Button>
        <Button>Run audio probe</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete fixture…</Button>
        <Button disabled>Locked</Button>
      </div>
    </div>
  );
}

function States() {
  return (
    <div style={{ ...plate, gap: 12 }} data-material="plate">
      <StateDisplay
        tone="ok"
        word="VERIFIED"
        sentence="Console · TotalMix on the UFX III"
        meta="42 values confirmed · last sync 18:24"
      />
      <StateDisplay
        tone="attention"
        word="NOT VERIFIED"
        sentence="Console controls stay locked until the audio probe passes."
        actions={
          <Key mode="primary" size="small">
            Run audio probe
          </Key>
        }
      />
      <StateDisplay
        tone="error"
        word="OFFLINE"
        sentence="Audio may still pass, but the app cannot see or change the console right now."
        code="Console did not answer OSC ping · AUDIO_SYNC_FAILED"
        actions={
          <Key mode="primary" size="small">
            Run audio probe
          </Key>
        }
      />
      <StateDisplay
        tone="ok"
        word="VERIFIED"
        sentence="Console · TotalMix on the UFX III"
        armed={{
          text: "Recall Interview block · press again to apply · Esc cancels",
          secondsLeft: 3.9,
          progress: 0.87,
        }}
        actions={<Key size="small">Sync from TotalMix</Key>}
      />
      <StateDisplay
        tone="info"
        word="PREVIEW"
        sentence="Editing offline. The rig is unchanged until you save or discard."
        actions={
          <>
            <Key mode="primary" size="small">
              Save to the rig
            </Key>
            <Key size="small">Discard</Key>
          </>
        }
      />
      <Latch who="1 solo engaged" action={<Key size="small">Clear all solo</Key>}>
        on FX 3/4 · the mix you're hearing isn't the mix you're seeing
      </Latch>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <LampWord tone="ok">VERIFIED</LampWord>
        <LampWord tone="attention">ASSUMED</LampWord>
        <LampWord tone="error">OFFLINE</LampWord>
        <LampWord tone="info">PREVIEW</LampWord>
        <LampWord tone="off">off</LampWord>
        <Lamp tone="ok" />
        <LampChip label="Audio" word="assumed" tone="attention" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <StatusBadge label="passed" tone="ok" />
        <StatusBadge label="unconfirmed" tone="attention" />
        <StatusBadge label="locked" tone="error" />
        <StatusBadge label="editing offline" tone="info" />
        <StatusBadge label="pending" tone="neutral" />
      </div>
    </div>
  );
}

function Wells() {
  const [level, setLevel] = useState(0.7);
  const [fader, setFader] = useState(0.8172);
  const [cct, setCct] = useState(0.13);
  return (
    <div style={plate} data-material="plate">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Readout value="-3.8 dB" />
        <Readout value="-3.8 dB" doubt />
        <Readout empty />
        <Readout value="100 %" size="hero" />
      </div>
      <Slider label="Main level" value={level} unity={0.8172} onChange={setLevel} valueText="-6.0 dB" take />
      <Slider label="Colour temperature" value={cct} onChange={setCct} cct valueText="3200 K" />
      <Slider label="Send" value={0.4} locked doubt />
      <div style={{ display: "flex", gap: 16, height: 320 }}>
        <Groove label="Host fader" value={fader} onChange={setFader} take />
        <Meter label="Host" level={0.62} peak={0.72} />
        <Meter label="Main" level={0.55} levelRight={0.5} peak={0.8} peakRight={0.75} clip />
        <Meter label="Guest 1" level={0.6} peak={0.7} stale />
        <Meter label="Guest 2" level={0.6} empty />
        <Groove label="Locked fader" value={0.6} locked />
        <Groove label="Doubted fader" value={0.5} doubt />
      </div>
      <Meter label="Master" level={0.7} peak={0.96} orientation="horizontal" />
      <Fields>
        <Field label="Stage X" value="2.9 m" />
        <Field label="DMX" value="U1 · 12" />
      </Fields>
      <Screen head={<span style={{ font: "600 14px/1 var(--font-family-ui)" }}>Stage plot · 12 × 8 m</span>} info>
        <svg viewBox="0 0 400 200" width="100%" height="100%" aria-hidden="true">
          <rect x="1" y="1" width="398" height="198" fill="none" stroke="var(--display-text2)" strokeDasharray="4 4" />
        </svg>
      </Screen>
    </div>
  );
}

function PlateAndOverlays() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ ...plate, width: 416 }} data-material="plate">
      <PlateHead title="FX 3/4" sub="Playback bus · Stereo → Main Out" action={<Key size="small">Rename</Key>} />
      <Section title="Sends" detail="into Phones 1 and 2">
        <ControlRow label="Send to Main Out" detail="post-fader" value="+2.1 dB">
          <Slider label="Send to Main Out" value={0.7} unity={0.8172} />
        </ControlRow>
      </Section>
      <Section title="Meter" detail="RME · live">
        <Readouts
          rows={[
            { label: "Peak L", value: "-6.1 dB" },
            { label: "Peak R", value: "-6.4 dB" },
            { label: "Hold", value: "-3.0 dB", tone: "attention" },
          ]}
        />
      </Section>
      <Section title="Channel" detail="as the desk reports it">
        <Fields>
          <Field label="Stereo link" value="Linked" />
          <Field label="Sends" value="post-fader" />
        </Fields>
      </Section>
      <div style={{ display: "flex", gap: 8 }}>
        <Key onClick={() => setOpen(true)}>Open drawer</Key>
        <Key onClick={() => setConfirm(true)}>Open dialog</Key>
      </div>
      <Toast
        tone="attention"
        title="Armed"
        message="Recall Interview block. Press again to apply."
        onDismiss={() => {}}
      />
      <Toast
        tone="error"
        title="Action failed"
        message="Snapshot slot 3 did not match the current console layout."
        action={{ label: "Sync", onClick: () => {} }}
        onDismiss={() => {}}
      />
      <EmptyState
        title="No fixtures on the rig yet"
        message="Add a fixture or import a profile."
        action={{ label: "Add fixture", onClick: () => {} }}
      />
      <DegradedState
        title="Bridge unreachable"
        message="Lighting commands won't reach the rig until the bridge responds."
      />
      <LoadingState label="Loading the console…" rows={2} />
      <Danger>
        <Key mode="danger">Delete fixture…</Key>
      </Danger>
      <Drawer open={open} title="Fixture" onClose={() => setOpen(false)}>
        <Fields>
          <Field label="Stage X" value="2.9 m" />
          <Field label="Stage Y" value="1.4 m" />
        </Fields>
      </Drawer>
      {confirm ? (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body="The rig keeps its current levels. The scene stays as it was last saved."
          confirmLabel="Discard changes"
          danger
          onConfirm={() => setConfirm(false)}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function Sheet() {
  return (
    <div style={board}>
      <Keys />
      <States />
      <Wells />
      <PlateAndOverlays />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0 }}>
        <Footer
          items={[
            { label: "Console", value: "confirmed · 42 values" },
            { label: "Metering", value: "RME · live" },
          ]}
          hints={[
            { kbd: "Ctrl+K", label: "Palette" },
            { kbd: "T", label: "hold to talk" },
          ]}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Design System/A primitives",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const KeysStudio: Story = {
  name: "Keys · Studio",
  parameters: { theme: "studio" },
  render: () => (
    <div style={board}>
      <Keys />
    </div>
  ),
};
export const KeysGraphite: Story = {
  name: "Keys · Graphite",
  parameters: { theme: "graphite" },
  render: () => (
    <div style={board}>
      <Keys />
    </div>
  ),
};
export const KeysBone: Story = {
  name: "Keys · Bone",
  parameters: { theme: "bone" },
  render: () => (
    <div style={board}>
      <Keys />
    </div>
  ),
};
export const StatesStudio: Story = {
  name: "State displays · Studio",
  parameters: { theme: "studio" },
  render: () => (
    <div style={board}>
      <States />
    </div>
  ),
};
export const StatesGraphite: Story = {
  name: "State displays · Graphite",
  parameters: { theme: "graphite" },
  render: () => (
    <div style={board}>
      <States />
    </div>
  ),
};
export const StatesBone: Story = {
  name: "State displays · Bone",
  parameters: { theme: "bone" },
  render: () => (
    <div style={board}>
      <States />
    </div>
  ),
};
export const WellsStudio: Story = {
  name: "Wells · Studio",
  parameters: { theme: "studio" },
  render: () => (
    <div style={board}>
      <Wells />
    </div>
  ),
};
export const WellsGraphite: Story = {
  name: "Wells · Graphite",
  parameters: { theme: "graphite" },
  render: () => (
    <div style={board}>
      <Wells />
    </div>
  ),
};
export const WellsBone: Story = {
  name: "Wells · Bone",
  parameters: { theme: "bone" },
  render: () => (
    <div style={board}>
      <Wells />
    </div>
  ),
};
export const PlateStudio: Story = {
  name: "Plate and overlays · Studio",
  parameters: { theme: "studio" },
  render: () => (
    <div style={board}>
      <PlateAndOverlays />
    </div>
  ),
};
export const PlateGraphite: Story = {
  name: "Plate and overlays · Graphite",
  parameters: { theme: "graphite" },
  render: () => (
    <div style={board}>
      <PlateAndOverlays />
    </div>
  ),
};
export const PlateBone: Story = {
  name: "Plate and overlays · Bone",
  parameters: { theme: "bone" },
  render: () => (
    <div style={board}>
      <PlateAndOverlays />
    </div>
  ),
};
export const SheetStudio: Story = { name: "Sheet · Studio", parameters: { theme: "studio" }, render: () => <Sheet /> };
export const SheetGraphite: Story = {
  name: "Sheet · Graphite",
  parameters: { theme: "graphite" },
  render: () => <Sheet />,
};
export const SheetBone: Story = { name: "Sheet · Bone", parameters: { theme: "bone" }, render: () => <Sheet /> };
