import type { Meta, StoryObj } from "@storybook/react-vite";

import { OperatorShell } from "../app/OperatorShell";

const meta = {
  component: OperatorShell,
  // STA-01 (S12): the global.css reset heights only html/body/#root, but
  // storybook mounts at #storybook-root — its auto height collapsed to 0,
  // so the shell's height:100% chain resolved to 0 and overflow:hidden
  // clipped every story to a blank frame (8 of 10 baselines were ONE
  // byte-identical PNG). Give the story a real viewport-height box. Scoped
  // here so DS component stories are untouched.
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
  },
  title: "Shell/OperatorShell",
} satisfies Meta<typeof OperatorShell>;

export default meta;

type Story = StoryObj<typeof meta>;

function renderFixtureStory(fixtureId: string) {
  window.__SSE_FIXTURE_ID__ = fixtureId;
  return <OperatorShell />;
}

export const SetupRequired: Story = {
  render: () => renderFixtureStory("setup-required"),
};

export const SetupReady: Story = {
  render: () => renderFixtureStory("setup-ready"),
};

export const SetupDegraded: Story = {
  render: () => renderFixtureStory("setup-degraded"),
};

export const LightingPopulated: Story = {
  render: () => renderFixtureStory("lighting-populated"),
};

export const AudioPopulated: Story = {
  render: () => renderFixtureStory("audio-populated"),
};

export const AudioStateAssumed: Story = {
  render: () => renderFixtureStory("audio-state-assumed"),
};

export const PlanningPopulated: Story = {
  render: () => renderFixtureStory("planning-populated"),
};

export const StartupLoading: Story = {
  render: () => renderFixtureStory("startup-loading"),
};

export const ProtocolMismatch: Story = {
  render: () => renderFixtureStory("protocol-mismatch"),
};

export const BootstrapFailed: Story = {
  render: () => renderFixtureStory("bootstrap-failed"),
};
