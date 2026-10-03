import { useState, type CSSProperties, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bell, Ellipsis, Lightbulb, Pencil, Pin, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "../components/Button";
import { ColorPicker } from "../components/ColorPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Drawer } from "../components/Drawer";
import { Footer } from "../components/Footer";
import { IconButton } from "../components/IconButton";
import { ArmKey, Key, Segmented } from "../components/Key";
import { LampChip } from "../components/LampChip";
import { LampWord, Latch, LatchSlot } from "../components/LampWord";
import { Menu, type MenuEntry } from "../components/Menu";
import { MenuButton } from "../components/MenuButton";
import { Meter } from "../components/Meter";
import { DegradedState, EmptyState, LoadingState } from "../components/OperationalState";
import { ControlRow, Danger, Fields, PlateHead, Readouts, Section } from "../components/Plate";
import { Popover } from "../components/Popover";
import { SegmentedControl } from "../components/SegmentedControl";
import { Groove, Slider } from "../components/Slider";
import { StateDisplay } from "../components/StateDisplay";
import { StatusBadge } from "../components/StatusBadge";
import { Toast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import type { UseArmResult } from "../components/useArm";
import { Field, Readout, Screen } from "../components/Well";

// Every primitive in the Atrium look (visual overhaul 2026-10-03, pull request
// 1; `docs/DESIGN.md`). Each board is a column-wrapping row of cards at the
// cluster's inner width, on the one surface, and fits 2560×1440 without
// scrolling. The page tests measure every board (ui-contract.spec.ts) and
// capture the Sheet, which holds them all, and the board of the menus and
// overlays open (storybook.spec.ts).

/** A card stands at the cluster's inner width (424 less its 24 px gutters). */
const CARD_WIDTH = 376;

const board: CSSProperties = {
  boxSizing: "border-box",
  display: "flex",
  flexFlow: "column wrap",
  alignContent: "flex-start",
  alignItems: "flex-start",
  gap: "20px 32px",
  height: "100vh",
  padding: 24,
  background: "var(--material-bg)",
  color: "var(--text-text)",
  font: "var(--font-weight-regular) var(--font-size-body) / var(--font-line-height-text) var(--font-family-ui)",
};

// The Sheet holds every card above the footer, so it packs a little tighter.
const sheet: CSSProperties = {
  ...board,
  height: "calc(100vh - var(--chrome-studio-footer))",
  padding: 16,
  gap: "16px 24px",
};

const caption: CSSProperties = {
  font: "var(--font-weight-bold) var(--font-size-label) / var(--font-line-height-tight) var(--font-family-ui)",
  color: "var(--text-text3)",
};

const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };

const quiet: CSSProperties = {
  font: "var(--font-weight-regular) var(--font-size-label) / var(--font-line-height-tight) var(--font-family-ui)",
  color: "var(--text-text3)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{ flex: "none", width: CARD_WIDTH, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <span style={caption}>{title}</span>
      {children}
    </section>
  );
}

const MIX_TARGETS = [
  ["main", "Main Out"],
  ["ph1", "Phones 1"],
  ["ph2", "Phones 2"],
] as const;

const CONSOLE_ROWS = [
  ["input", "Input"],
  ["playback", "Playback"],
  ["output", "Output"],
] as const;

const LOCK_REASON = "Console controls stay locked until the audio probe passes.";

function KeyCards() {
  const [engaged, setEngaged] = useState(true);
  const [target, setTarget] = useState<string>("main");
  const [consoleRow, setConsoleRow] = useState<string>("playback");
  const [view, setView] = useState("plot");
  const [rows, setRows] = useState("list");
  return (
    <>
      <Card title="Key · each mode at rest">
        <div style={row}>
          <Key>Command</Key>
          <Key mode="toggle" cap="Dim" />
          <Key mode="momentary" cap="Hold" />
          <Key mode="primary">Save scene</Key>
          <Key mode="danger" cap="Cut all" />
          <Key mode="hazard" lit>
            48 V
          </Key>
          <Key mode="hazard">48 V</Key>
        </div>
      </Card>
      <Card title="Key · lit, locked, selected, disabled">
        <div style={row}>
          <Key mode="toggle" cap="Dim" engaged={engaged} onClick={() => setEngaged((v) => !v)} take />
          <Key mode="momentary" cap="Hold" live take />
          <Key mode="toggle" cap="Mono" locked reason={LOCK_REASON} take />
          <Key mode="primary" locked reason="Nothing has changed since the scene was saved.">
            Save scene
          </Key>
          <Key selected>Key light</Key>
          <Key disabled>Run audio probe</Key>
        </div>
      </Card>
      <Card title="Key · small 28, default 36, large 48, tall 64">
        <div style={{ ...row, alignItems: "flex-end" }}>
          <Key size="small" cap="Dim" />
          <Key cap="Dim" />
          <Key size="large" cap="Dim" />
          <Key size="tall" cap="Dim" />
        </div>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <Key size="small">Rename</Key>
          <Key>Rename</Key>
          <Key size="large">Rename</Key>
          <Key size="tall">Rename</Key>
        </div>
      </Card>
      <Card title="Key · tall, the cap over its hint">
        <div style={row}>
          <Key mode="toggle" cap="Dim" hint="press to dim" layout="stack" size="tall" take />
          <Key mode="toggle" cap="Dim" hint="engaged" engaged layout="stack" size="tall" take />
          <Key mode="momentary" cap="Hold" hint="live · for the hold" live layout="stack" size="tall" take />
        </div>
      </Card>
      <Card title="ArmKey · at rest, then armed">
        <div style={row}>
          <ArmKey armed={false} timeoutMs={4500} cap="3" hint="press twice" take>
            Interview block
          </ArmKey>
          <ArmKey hazard armed={false} timeoutMs={3000} cap="REC" hint="press twice to stop" take />
        </div>
        <div style={row}>
          <ArmKey armed timeoutMs={4500} secondsLeft={3.9} progress={3.9 / 4.5} cap="3" take>
            Interview block
          </ArmKey>
          <ArmKey hazard armed timeoutMs={3000} secondsLeft={2.1} progress={2.1 / 3} cap="STOP?" take />
        </div>
      </Card>
      <Card title="Segmented · default, small, locked, an armed choice">
        <Segmented label="Mix target">
          {MIX_TARGETS.map(([id, name]) => (
            <Key key={id} mode="segmented" cap={name} engaged={target === id} onClick={() => setTarget(id)} take />
          ))}
        </Segmented>
        <Segmented label="Console row">
          {CONSOLE_ROWS.map(([id, name]) => (
            <Key
              key={id}
              mode="segmented"
              size="small"
              cap={name}
              engaged={consoleRow === id}
              onClick={() => setConsoleRow(id)}
            />
          ))}
        </Segmented>
        <Segmented label="Mix target, locked">
          {MIX_TARGETS.map(([id, name]) => (
            <Key key={id} mode="segmented" cap={name} engaged={id === "main"} locked reason={LOCK_REASON} />
          ))}
        </Segmented>
        <Segmented label="Camera power">
          <Key mode="segmented" cap="On" engaged take />
          <ArmKey armed timeoutMs={4500} secondsLeft={3.2} armedWord="ARMED" take>
            Off
          </ArmKey>
        </Segmented>
      </Card>
      <Card title="Button · default 36 and compact 28">
        <div style={row}>
          <Button variant="primary">Save scene</Button>
          <Button>Run audio probe</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete fixture…</Button>
        </div>
        <div style={row}>
          <Button variant="primary" size="compact">
            Save scene
          </Button>
          <Button size="compact">Run audio probe</Button>
          <Button variant="ghost" size="compact">
            Cancel
          </Button>
          <Button variant="danger" size="compact">
            Delete fixture…
          </Button>
        </div>
        <div style={row}>
          <Button leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}>Save as new</Button>
          <Button disabled>Save scene</Button>
        </div>
      </Card>
      <Card title="IconButton · 36 and 28, pressed, a badge, disabled">
        <div style={row}>
          <IconButton icon={Pencil} label="Rename" />
          <IconButton icon={Plus} label="Add fixture" tone="primary" />
          <IconButton icon={Trash2} label="Delete fixture" tone="danger" />
          <IconButton icon={Ellipsis} label="More" tone="ghost" />
          <IconButton icon={Pin} label="Pin the plot" pressed />
          <IconButton icon={Bell} label="Messages" badge="3" />
          <IconButton icon={Pencil} label="Rename" disabled />
        </div>
        <div style={row}>
          <IconButton icon={Pencil} label="Rename" size="sm" />
          <IconButton icon={Plus} label="Add fixture" tone="primary" size="sm" />
          <IconButton icon={Trash2} label="Delete fixture" tone="danger" size="sm" />
          <IconButton icon={Ellipsis} label="More" tone="ghost" size="sm" />
          <IconButton icon={Pin} label="Pin the plot" pressed size="sm" />
        </div>
      </Card>
      <Card title="SegmentedControl · regular and compact">
        <SegmentedControl
          label="Plot view"
          value={view}
          onChange={setView}
          options={[
            { value: "plot", label: "Plot" },
            { value: "list", label: "List" },
            { value: "groups", label: "Groups" },
            { value: "rig", label: "Rig", disabled: true },
          ]}
        />
        <SegmentedControl
          label="Rows"
          size="compact"
          value={rows}
          onChange={setRows}
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
            { value: "both", label: "Both" },
          ]}
        />
      </Card>
    </>
  );
}

function StateCards() {
  return (
    <>
      <Card title="StateDisplay · ok with the page's ⋯, and a long word">
        <StateDisplay
          tone="ok"
          word="VERIFIED"
          sentence="Console · TotalMix on the UFX III"
          meta="42 values confirmed · last sync 18:24"
          menu={
            <MenuButton
              buttonLabel="Audio menu"
              menu={{
                head: { title: "Audio" },
                items: [
                  { id: "sync", label: "Sync from TotalMix", onSelect: () => {} },
                  { id: "probe", label: "Run audio probe", onSelect: () => {} },
                ],
              }}
            />
          }
        />
        <StateDisplay
          tone="attention"
          word="NOT VERIFIED"
          sentence="Console controls stay locked until the audio probe passes."
          meta="0 values confirmed"
          actions={
            <Key mode="primary" size="small">
              Run audio probe
            </Key>
          }
        />
      </Card>
      <Card title="StateDisplay · error keyline, information">
        <StateDisplay
          tone="error"
          word="OFFLINE"
          sentence="The console did not answer."
          code="TotalMix did not answer · AUDIO_SYNC_FAILED"
          actions={
            <Key mode="primary" size="small">
              Run audio probe
            </Key>
          }
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
      </Card>
      <Card title="StateDisplay · the armed row">
        <StateDisplay
          tone="ok"
          word="VERIFIED"
          sentence="Console · TotalMix on the UFX III"
          armed={{
            text: "Recall Interview block · press again to apply",
            secondsLeft: 3.9,
            progress: 0.87,
          }}
          actions={<Key size="small">Sync from TotalMix</Key>}
        />
        <StateDisplay
          tone="ok"
          word="VERIFIED"
          sentence="Console · TotalMix on the UFX III"
          armed={{
            text: "Recall Interview block · press again to apply",
            secondsLeft: 3.9,
            timeoutMs: 4500,
          }}
        />
      </Card>
      <Card title="LatchSlot · nothing latched, one latch, two">
        <LatchSlot />
        <LatchSlot>
          <Latch who="Solo" action={<Key size="small">Clear all solo</Key>}>
            on FX 3/4 · the mix you're hearing isn't the mix you're seeing
          </Latch>
        </LatchSlot>
        <LatchSlot>
          <Latch who="Solo" action={<Key size="small">Clear</Key>}>
            on FX 3/4
          </Latch>
          <Latch who="Scene" tone="info" action={<Key size="small">Save</Key>}>
            changed since it was saved
          </Latch>
        </LatchSlot>
      </Card>
      <Card title="LampWord · state words, then labels">
        <div style={{ ...row, gap: 16 }}>
          <LampWord tone="ok">VERIFIED</LampWord>
          <LampWord tone="attention">ASSUMED</LampWord>
          <LampWord tone="error">OFFLINE</LampWord>
          <LampWord tone="info">PREVIEW</LampWord>
          <LampWord tone="off">OFF</LampWord>
        </div>
        <div style={{ ...row, gap: 16 }}>
          <LampWord tone="attention" cap={false}>
            last known REC
          </LampWord>
          <LampWord tone="ok" cap={false}>
            Phones 1
          </LampWord>
          <LampWord tone="off" cap={false}>
            Dim
          </LampWord>
        </div>
      </Card>
      <Card title="LampChip · the header's chips">
        <div style={{ ...row, gap: 4 }}>
          <LampChip label="Surface" word="READY" tone="ok" />
          <LampChip label="Solo" word="LATCHED" tone="attention" latch />
          <LampChip label="Lighting" word="NO BRIDGE" tone="error" />
          <LampChip label="Cameras" word="NOT SET UP" tone="neutral" />
          <LampChip label="Audio" word="ASSUMED" tone="attention" onClick={() => {}} />
        </div>
      </Card>
      <Card title="StatusBadge · five tones">
        <div style={row}>
          <StatusBadge label="passed" tone="ok" />
          <StatusBadge label="unconfirmed" tone="attention" />
          <StatusBadge label="locked" tone="error" />
          <StatusBadge label="editing offline" tone="info" />
          <StatusBadge label="pending" tone="neutral" />
        </div>
      </Card>
      <Card title="Toast · the floating layer">
        <Toast
          tone="attention"
          title="Not confirmed"
          message="TotalMix did not confirm the last change."
          onDismiss={() => {}}
        />
        <Toast
          tone="error"
          title="Action failed"
          message="Scene 3 did not match the console's layout."
          action={{ label: "Sync", onClick: () => {} }}
          onDismiss={() => {}}
        />
        <Toast tone="ok" message="Scene saved." onDismiss={() => {}} />
      </Card>
    </>
  );
}

/** The fader law's marks, as fractions of the travel (unity draws its own tick). */
const FADER_TICKS = [1, 0.66, 0.5, 0.33, 0.2, 0.1];

/** A strip's column: the groove grows to the column's height and keeps its 44 px. */
const strip: CSSProperties = { display: "flex", flexDirection: "column", flex: "none" };

function PlotSketch() {
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <rect x="8" y="8" width="384" height="184" fill="none" stroke="var(--material-line2)" strokeDasharray="4 4" />
    </svg>
  );
}

function WellCards() {
  const [level, setLevel] = useState(0.7);
  const [fader, setFader] = useState(0.62);
  const [cct, setCct] = useState(0.13);
  return (
    <>
      <Card title="Readout · word, value, hero; doubt; empty">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Readout value="-3.8 dB" />
          <Readout value="-3.8" unit="dB" />
          <Readout value="48 kHz" size="value" />
          <Readout value="48" unit="kHz" size="value" />
          <Readout value="100 %" size="hero" />
          <Readout value="100" unit="%" size="hero" />
          <Readout value="-3.8" unit="dB" />
          <Readout value="-3.8" unit="dB" doubt />
          <Readout empty />
          <Readout value="-12.0" unit="dB" align="right" />
        </div>
      </Card>
      <Card title="Slider · level, colour temperature, doubt, locked">
        <div style={{ display: "grid", gridTemplateColumns: "136px minmax(0, 1fr)", alignItems: "center", gap: 12 }}>
          <span style={quiet}>Main level</span>
          <Slider label="Main level" value={level} unity={0.8172} onChange={setLevel} valueText="-6.0 dB" take />
          <span style={quiet}>Colour temperature</span>
          <Slider label="Colour temperature" value={cct} onChange={setCct} cct valueText="3200 K" />
          <span style={quiet}>Send to FX 3/4</span>
          <Slider label="Send to FX 3/4" value={0.55} unity={0.8172} doubt />
          <span style={quiet}>Send to Phones 1</span>
          <Slider label="Send to Phones 1" value={0.4} unity={0.8172} locked doubt />
        </div>
      </Card>
      <Card title="Groove and Meter · a strip at rest">
        <div style={{ display: "flex", gap: 10, height: 248 }}>
          <div style={strip}>
            <Groove label="Host fader" value={fader} onChange={setFader} ticks={FADER_TICKS} take />
          </div>
          <Meter label="Host" level={0.62} peak={0.72} />
          <div style={strip}>
            <Groove label="Guest 1 fader" value={0.8172} ticks={FADER_TICKS} />
          </div>
          <Meter label="Main" level={0.55} levelRight={0.5} peak={0.8} peakRight={0.75} clip />
          <div style={strip}>
            <Groove label="Locked fader" value={0.6} ticks={FADER_TICKS} locked />
          </div>
          <Meter label="Guest 1" level={0.6} peak={0.7} stale />
          <div style={strip}>
            <Groove label="Doubted fader" value={0.5} ticks={FADER_TICKS} doubt />
          </div>
          <Meter label="Guest 2" level={0.6} empty />
        </div>
        <Meter
          label="Master"
          level={0.7}
          levelRight={0.68}
          peak={0.96}
          peakRight={0.93}
          orientation="horizontal"
          style={{ "--master-meter-height": "24px" } as CSSProperties}
        />
      </Card>
      <Card title="Field · a value on a well">
        <Fields>
          <Field label="Stage X" value="2.9 m" />
          <Field label="DMX" value="U1 · 12" />
        </Fields>
      </Card>
      <Card title="Screen · with a head, then editing offline">
        <div style={{ display: "flex", flexDirection: "column", height: 150 }}>
          <Screen
            head={
              <>
                <b style={{ font: "var(--font-weight-bold) var(--font-size-body) / 1 var(--font-family-ui)" }}>
                  Stage plot
                </b>
                <span style={quiet}>12 × 8 m · 3 fixtures</span>
              </>
            }
          >
            <PlotSketch />
          </Screen>
        </div>
        <div style={{ display: "flex", flexDirection: "column", height: 96 }}>
          <Screen info>
            <PlotSketch />
          </Screen>
        </div>
      </Card>
    </>
  );
}

const sections: CSSProperties = { display: "flex", flexDirection: "column", gap: 40 };

function PlateCards() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Card title="PlateHead · the Dark Green title plate">
        <PlateHead
          title="FX 3/4"
          sub="Playback 02 · stereo, linked · group FX"
          action={<Key size="small">Rename</Key>}
        />
        <PlateHead title="Interview block, wide, with the guest on the left" action={<Key size="small">Rename</Key>} />
        <PlateHead
          title="Warm wash"
          sub="Six fixtures on the front truss. Edits stay on the rig until you save the scene."
        />
      </Card>
      <Card title="Section · a title, then a detail">
        <div style={sections}>
          <Section title="Monitor">
            <ControlRow label="Main level" value="+2.1 dB">
              <Slider label="Main level on the plate" value={0.86} unity={0.8172} />
            </ControlRow>
          </Section>
          <Section title="Sends" detail="into Phones 1 and 2">
            <ControlRow label="Phones 1" detail="post-fader" value="-7.2" unit="dB">
              <Slider label="Send to Phones 1 on the plate" value={0.62} unity={0.8172} />
            </ControlRow>
            <ControlRow label="Phones 2" detail="unity" value="0.0" unit="dB">
              <Slider label="Send to Phones 2 on the plate" value={0.8172} unity={0.8172} />
            </ControlRow>
          </Section>
        </div>
      </Card>
      <Card title="Section · with keys">
        <div style={sections}>
          <Section title="Meter" detail="RME · live" actions={<Key size="small">Reset</Key>}>
            <Readouts
              rows={[
                { label: "Peak L", value: "-6.1 dB", tone: "ok" },
                { label: "Peak R", value: "-6.4 dB" },
                { label: "Hold", value: "-3.0 dB", tone: "attention" },
                { label: "Clips since the meters were last reset", value: "2", tone: "error" },
              ]}
            />
          </Section>
          <Section title="Channel" detail="as the desk reports it" actions={<Key>Rename</Key>}>
            <Fields>
              <Field label="Stereo link" value="Linked" />
              <Field label="Sends" value="post-fader" />
            </Fields>
          </Section>
        </div>
      </Card>
      <Card title="EmptyState · no box, one key">
        <EmptyState
          title="No fixtures on the rig yet"
          message="Add a fixture or import a profile."
          action={{ label: "Add fixture", onClick: () => {} }}
        />
        <EmptyState
          icon={Lightbulb}
          title="No scene chosen"
          message="Pick a scene in the rail to edit it."
          action={{ label: "Show scenes", onClick: () => {}, variant: "ghost" }}
        />
        <div style={{ width: 280 }}>
          <EmptyState
            title="No cameras found"
            message="Search for the cameras in Setup."
            action={{ label: "Open Setup", onClick: () => {} }}
          />
        </div>
      </Card>
      <Card title="DegradedState · a yellow keyline">
        <DegradedState
          title="Bridge unreachable"
          message="Lighting commands wait until the bridge answers."
          actions={<Key size="small">Retry</Key>}
        />
        <div style={{ width: 280 }}>
          <DegradedState
            title="Bridge unreachable"
            message="Commands wait for the bridge."
            actions={<Key size="small">Retry</Key>}
          />
        </div>
      </Card>
      <Card title="LoadingState · still bars">
        <LoadingState label="Loading the console…" rows={2} />
        <div style={{ height: 120 }}>
          <LoadingState label="Loading the plot…" rows={1} fill />
        </div>
      </Card>
      <Card title="Danger, and the floating layer">
        <div style={row}>
          <Key onClick={() => setOpen(true)}>Open drawer</Key>
          <Key onClick={() => setConfirm(true)}>Open dialog</Key>
        </div>
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
      </Card>
    </>
  );
}

function Sheet() {
  return (
    <>
      <div style={sheet}>
        <KeyCards />
        <StateCards />
        <WellCards />
        <PlateCards />
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0 }}>
        <Footer
          items={[
            { label: "Console", value: "confirmed · 42 values" },
            { label: "Metering", value: "RME · live" },
          ]}
          action={<Key size="small">Open the log</Key>}
        />
      </div>
    </>
  );
}

// Visual overhaul B: the menus and overlays, open at rest (DESIGN.md §9). Each
// stands beside what opened it, over empty surface, so the measures read its
// own pixels: the ⋯ menu with its head, values, toggles, a disabled item with
// its reason and the destructive item at rest; the same item armed in place
// (a still countdown); a menu with groups of choices; a popover; a list of
// values in a popover; the tooltip, which takes another side rather than
// cover a take-time key; the colour-tag picker.

const overlayBoard: CSSProperties = {
  position: "relative",
  height: "100vh",
  overflow: "hidden",
  background: "var(--material-bg)",
  color: "var(--text-text)",
  font: "var(--font-weight-regular) var(--font-size-body) / var(--font-line-height-text) var(--font-family-ui)",
};

function At({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", flexDirection: "column", gap: 12 }}>
      {children}
    </div>
  );
}

const STRIP_ITEMS: MenuEntry[] = [
  { id: "level", label: "Set fader level…", value: "−3.8 dB", onSelect: () => undefined },
  { id: "send", label: "Set Main Out send to 0 dB", onSelect: () => undefined },
  { id: "gain", label: "Set preamp gain…", value: "32 dB", onSelect: () => undefined },
  { kind: "divider" },
  { kind: "check", id: "hiz", label: "Hi-Z", checked: false, onCheckedChange: () => undefined },
  { kind: "check", id: "polarity", label: "Flip polarity", checked: false, onCheckedChange: () => undefined },
  { kind: "check", id: "autoset", label: "AutoSet", checked: true, onCheckedChange: () => undefined },
  { id: "clip", label: "Clear clip", onSelect: () => undefined, disabledReason: "no clip held" },
];

const STAGE_ITEMS: MenuEntry[] = [
  { kind: "label", id: "show", label: "Show" },
  { kind: "radio", id: "rig", label: "Rig", checked: true, onSelect: () => undefined },
  { kind: "radio", id: "coverage", label: "Coverage", checked: false, onSelect: () => undefined },
  { kind: "radio", id: "photometric", label: "Photometric", checked: false, onSelect: () => undefined },
  { kind: "label", id: "frame", label: "Frame" },
  { kind: "radio", id: "fit", label: "Fit room", checked: true, onSelect: () => undefined },
  { kind: "radio", id: "fill", label: "Fill screen", checked: false, onSelect: () => undefined },
  { kind: "radio", id: "actual", label: "100 %", checked: false, onSelect: () => undefined, value: "1 : 1" },
  { kind: "divider" },
  { id: "add", label: "Add fixture…", onSelect: () => undefined },
  { id: "clear", label: "Clear selection", onSelect: () => undefined, disabledReason: "nothing selected" },
];

const PHANTOM = {
  id: "phantom",
  label: "Turn 48 V off…",
  armedLabel: "Press again to turn 48 V off",
  onConfirm: () => undefined,
};

/** The surface's arm, held with the strip's 48 V armed (a board does not run it). */
const HELD_ARM: UseArmResult = {
  armed: { key: "menu:phantom", label: "Turn 48 V off", armedAt: 0, timeoutMs: 4500 },
  armOrApply: () => undefined,
  cancel: () => false,
  clear: () => undefined,
  remainingMs: () => 2700,
};

const ISO_VALUES = ["200", "400", "800", "1600"];

const valueRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  minHeight: 36,
  padding: "0 12px",
  border: 0,
  borderRadius: "var(--radius-base)",
  background: "transparent",
  color: "var(--text-text)",
  font: "var(--font-weight-regular) var(--font-size-body) / var(--font-line-height-tight) var(--font-family-ui)",
};

function OverlaysOpen() {
  const [stripKey, setStripKey] = useState<HTMLElement | null>(null);
  const [bandKey, setBandKey] = useState<HTMLElement | null>(null);
  const [isoKey, setIsoKey] = useState<HTMLElement | null>(null);
  const none = () => undefined;
  return (
    <div style={overlayBoard}>
      <At x={40} y={40}>
        <span style={caption}>The ⋯ on an object, and its menu</span>
        <div style={{ ...row, width: 352, justifyContent: "space-between" }}>
          <span style={{ font: "var(--font-weight-bold) var(--font-size-word) / 1 var(--font-family-ui)" }}>Host</span>
          <span ref={setStripKey} style={{ display: "inline-flex" }}>
            <IconButton icon={Ellipsis} label="Host menu" title={undefined} aria-haspopup="menu" aria-expanded />
          </span>
        </div>
      </At>
      <Menu
        open={stripKey !== null}
        anchor={stripKey}
        placement="bottom-end"
        onClose={none}
        head={{ title: "Host", detail: "Preamp 1 · mic" }}
        items={STRIP_ITEMS}
        destructive={PHANTOM}
      />

      <At x={560} y={40}>
        <span style={caption}>Its destructive item, armed in place</span>
      </At>
      <Menu
        open
        anchor={{ x: 560, y: 72 }}
        onClose={none}
        head={{ title: "Host", detail: "Preamp 1 · mic" }}
        items={STRIP_ITEMS}
        destructive={PHANTOM}
        arm={HELD_ARM}
        armedProgress={0.6}
      />

      <At x={1080} y={40}>
        <span style={caption}>A menu with groups of choices, at the pointer</span>
      </At>
      <Menu open anchor={{ x: 1080, y: 72 }} onClose={none} head={{ title: "Stage" }} items={STAGE_ITEMS} />

      <At x={1600} y={40}>
        <span style={caption}>A popover beside its key</span>
        <span ref={setBandKey} style={{ display: "inline-flex" }}>
          <Key size="small" selected aria-expanded>
            Band 2
          </Key>
        </span>
      </At>
      <Popover
        open={bandKey !== null}
        anchor={bandKey}
        onClose={none}
        title="Band 2 · Bell"
        initialFocus="panel"
        width={320}
      >
        <Readouts
          rows={[
            { label: "Frequency", value: "1.6 kHz" },
            { label: "Gain", value: "0.0 dB" },
            { label: "Q", value: "1.2" },
          ]}
        />
      </Popover>

      <At x={2080} y={40}>
        <span style={caption}>A list of values in a popover</span>
        <span ref={setIsoKey} style={{ display: "inline-flex" }}>
          <Key size="small" aria-expanded>
            ISO 400
          </Key>
        </span>
      </At>
      <Popover open={isoKey !== null} anchor={isoKey} onClose={none} label="ISO" initialFocus="panel" width={240}>
        <div role="listbox" aria-label="ISO values">
          {ISO_VALUES.map((value) => (
            <div
              key={value}
              role="option"
              aria-selected={value === "400"}
              style={{ ...valueRow, background: value === "400" ? "var(--material-hover)" : "transparent" }}
            >
              <span>{value}</span>
              {value === "400" ? <span style={quiet}>now</span> : null}
            </div>
          ))}
        </div>
      </Popover>

      <At x={40} y={1040}>
        <span style={caption}>The tooltip takes another side rather than cover a take-time key</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 352, marginTop: 72 }}>
          <Tooltip content="Faders set the sends into this mix" placement="bottom" open>
            <Key size="small">Main Out</Key>
          </Tooltip>
          <Key mode="toggle" cap="Dim" hint="−20 dB" layout="stack" size="tall" take>
            {null}
          </Key>
        </div>
      </At>

      <At x={560} y={1040}>
        <span style={caption}>The colour-tag picker</span>
      </At>
      <ColorPicker
        x={560}
        y={1072}
        swatches={[
          { index: 0, name: "Sage", hex: "#99BA92" },
          { index: 1, name: "Sand", hex: "#EDEBD1" },
          { index: 2, name: "Sun", hex: "#F2DE6F" },
          { index: 3, name: "Ember", hex: "#FF7D55" },
          { index: 4, name: "Sky", hex: "#3A87E5" },
          { index: 5, name: "Moss", hex: "#5E8A6A" },
          { index: 6, name: "Clay", hex: "#CAA363" },
          { index: 7, name: "Slate", hex: "#8D9389" },
        ]}
        selectedIndex={2}
        onSelect={none}
        onClose={none}
        ariaLabel="Pick a color tag for scene Warm wash"
      />

      <At x={1080} y={1040}>
        <span style={caption}>An armed key with a still countdown</span>
        <div style={row}>
          <ArmKey armed timeoutMs={4500} progress={0.6} cap="Save" take>
            Warm wash
          </ArmKey>
        </div>
      </At>
    </div>
  );
}

const meta = {
  title: "Design System/A primitives",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const KeysBoard: Story = {
  name: "Keys",
  render: () => (
    <div style={board}>
      <KeyCards />
    </div>
  ),
};
export const StateDisplaysBoard: Story = {
  name: "State displays",
  render: () => (
    <div style={board}>
      <StateCards />
    </div>
  ),
};
export const WellsBoard: Story = {
  name: "Wells",
  render: () => (
    <div style={board}>
      <WellCards />
    </div>
  ),
};
export const PlateAndOverlaysBoard: Story = {
  name: "Plate and overlays",
  render: () => (
    <div style={board}>
      <PlateCards />
    </div>
  ),
};
export const WholeSheet: Story = { name: "Sheet", render: () => <Sheet /> };
export const MenusAndOverlaysOpenBoard: Story = { name: "Menus and overlays, open", render: () => <OverlaysOpen /> };
