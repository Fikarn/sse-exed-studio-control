import { Calendar, LayoutGrid, Mic, Sliders, Sun } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Crest } from "../components/Crest";
import { HealthBar } from "../components/HealthBar";
import { NavItem } from "../components/NavItem";
import { PlotMeta } from "../components/PlotMeta";
import { PlotPill } from "../components/PlotPill";
import { StatusDot } from "../components/StatusDot";

type StoryFn = StoryObj["render"];

const stage: React.CSSProperties = {
  background: "var(--color-bg-deep)",
  color: "var(--color-brand-text-primary)",
  fontFamily: "var(--font-family-ui)",
  padding: "32px",
  minHeight: "100vh",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "24px",
};

const column: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const meta: Meta = {
  title: "Lighting Direction D / Foundation primitives",
  parameters: { layout: "fullscreen" },
};

export default meta;

export const CrestSizes: StoryObj = {
  name: "Crest — sm / md / lg",
  render: (() => (
    <div style={stage}>
      <div style={row}>
        <Crest size="sm" />
        <Crest size="md" />
        <Crest size="lg" />
      </div>
    </div>
  )) as StoryFn,
};

export const NavItemStates: StoryObj = {
  name: "NavItem — default / hover / active",
  render: (() => (
    <div style={stage}>
      <div style={{ ...row, gap: "4px" }}>
        <NavItem id="setup" label="Setup" icon={<Sliders size={16} />} />
        <NavItem id="planning" label="Planning" icon={<Calendar size={16} />} />
        <NavItem id="lighting" label="Lighting" icon={<Sun size={16} />} active />
        <NavItem id="audio" label="Audio" icon={<Mic size={16} />} />
        <NavItem id="streamdeck" label="Stream Deck" icon={<LayoutGrid size={16} />} />
      </div>
    </div>
  )) as StoryFn,
};

export const StatusDotStates: StoryObj = {
  name: "StatusDot — ok / attn / err / info, sm / md, glow on/off",
  render: (() => (
    <div style={stage}>
      <div style={column}>
        <div style={row}>
          <span style={{ width: "120px" }}>md, glow on</span>
          <StatusDot state="ok" />
          <StatusDot state="attn" />
          <StatusDot state="err" />
          <StatusDot state="info" />
        </div>
        <div style={row}>
          <span style={{ width: "120px" }}>sm, glow on</span>
          <StatusDot state="ok" size="sm" />
          <StatusDot state="attn" size="sm" />
          <StatusDot state="err" size="sm" />
          <StatusDot state="info" size="sm" />
        </div>
        <div style={row}>
          <span style={{ width: "120px" }}>md, glow off</span>
          <StatusDot state="ok" glow={false} />
          <StatusDot state="attn" glow={false} />
          <StatusDot state="err" glow={false} />
          <StatusDot state="info" glow={false} />
        </div>
      </div>
    </div>
  )) as StoryFn,
};

export const HealthBarFull: StoryObj = {
  name: "HealthBar — six items + hint",
  render: (() => (
    <div style={{ ...stage, padding: 0 }}>
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
  )) as StoryFn,
};

export const HealthBarDirty: StoryObj = {
  name: "HealthBar — drift state (auto-save attn)",
  render: (() => (
    <div style={{ ...stage, padding: 0 }}>
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
  )) as StoryFn,
};

export const PlotPillStates: StoryObj = {
  name: "PlotPill — default / modified / patch",
  render: (() => (
    <div style={stage}>
      <div style={column}>
        <div style={row}>
          <PlotPill state="default">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Recall:</span>
            <span style={{ fontFamily: "var(--font-family-display)", fontWeight: 600, fontSize: 16 }}>
              Standup
            </span>
          </PlotPill>
        </div>
        <div style={row}>
          <PlotPill state="modified">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Recall:</span>
            <span style={{ fontFamily: "var(--font-family-display)", fontWeight: 600, fontSize: 16 }}>
              Standup
            </span>
            <span
              style={{
                fontFamily: "var(--font-family-mono)",
                fontSize: 10,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "var(--color-brand-yellow)",
                fontWeight: 600,
              }}
            >
              · Modified
            </span>
          </PlotPill>
        </div>
        <div style={row}>
          <PlotPill state="patch">
            <span style={{ color: "var(--color-brand-text-muted)" }}>Patch mode</span>
            <span
              style={{
                fontFamily: "var(--font-family-mono)",
                fontSize: 10,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "var(--color-brand-blue-hot)",
                fontWeight: 600,
              }}
            >
              · DMX overlay
            </span>
          </PlotPill>
        </div>
      </div>
    </div>
  )) as StoryFn,
};

export const PlotMetaTones: StoryObj = {
  name: "PlotMeta — default / blue",
  render: (() => (
    <div style={stage}>
      <div style={row}>
        <PlotMeta label="Floor" value="12 m × 8 m" />
        <PlotMeta label="Grid" value="0.5 / 1 / 5 m" />
        <PlotMeta label="Universe" value="U1 · 512 ch" tone="blue" />
      </div>
    </div>
  )) as StoryFn,
};
