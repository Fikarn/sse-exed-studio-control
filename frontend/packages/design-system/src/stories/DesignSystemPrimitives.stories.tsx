import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../components/Button";
import { MetricCard } from "../components/MetricCard";
import { StatusBadge } from "../components/StatusBadge";
import { Surface } from "../components/Surface";

const meta = {
  title: "Design System/Primitives",
  parameters: {
    layout: "fullscreen"
  },
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "16px",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        padding: "24px"
      }}
    >
      <Surface>
        <div className="console-grid">
          <span className="console-eyebrow">Buttons</span>
          <div className="console-chipList">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </div>
        </div>
      </Surface>
      <Surface tone="raised">
        <div className="console-grid">
          <span className="console-eyebrow">Status</span>
          <div className="console-chipList">
            <StatusBadge label="ready" tone="ready" />
            <StatusBadge label="warning" tone="warning" />
            <StatusBadge label="error" tone="error" />
          </div>
        </div>
      </Surface>
      <Surface>
        <MetricCard caption="Protocol" tone="ready" value="v1" />
      </Surface>
      <Surface>
        <MetricCard caption="Target Surface" tone="connected" value="Operator UI" />
      </Surface>
    </div>
  )
} satisfies Meta;

export default meta;

export const Overview: StoryObj<typeof meta> = {};
