import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShellFrame } from "../AppShellFrame";
import { Footer } from "../Footer";
import { Lamp } from "../Lamp";
import { LampChip } from "../LampChip";
import { Tab } from "../Tab";
import { toneForSubsystem, worstTone } from "../statusTone";

// Visual overhaul A, Slice 2: the shell primitives (Tab, Lamp, LampChip,
// Footer), the tone map and the frame's regions.

describe("statusTone", () => {
  it("ranks error over attention over info over ok over neutral", () => {
    expect(worstTone("ok", "attention")).toBe("attention");
    expect(worstTone("attention", "error")).toBe("error");
    expect(worstTone("ok", "info")).toBe("info");
    expect(worstTone(null, undefined)).toBe("neutral");
  });

  it("a subsystem lamp shows the worse of the health check and the workspace state (C3)", () => {
    expect(toneForSubsystem("ok", "error")).toBe("error");
    expect(toneForSubsystem("attention", "ok")).toBe("attention");
    expect(toneForSubsystem("ok", null)).toBe("ok");
  });
});

describe("Tab", () => {
  it("keeps the workspace's name as its accessible name with the hint aria-hidden", () => {
    render(<Tab id="lighting" label="Lighting" hint="Ctrl+2" />);
    const tab = screen.getByRole("button", { name: "Lighting" });
    expect(tab).toHaveAttribute("data-nav-id", "lighting");
    expect(tab.querySelector("kbd")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the active tab as the current page and a machined key", () => {
    render(<Tab id="audio" label="Audio" active />);
    const tab = screen.getByRole("button", { name: "Audio" });
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(tab).toHaveAttribute("data-material", "key");
  });

  it("a locked tab is aria-disabled, disabled and does not fire", () => {
    const onClick = vi.fn();
    render(<Tab id="planning" label="Planning" disabled onClick={onClick} />);
    const tab = screen.getByRole("button", { name: "Planning" });
    expect(tab).toHaveAttribute("aria-disabled", "true");
    expect(tab).toBeDisabled();
    fireEvent.click(tab);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Lamp and LampChip", () => {
  it("a lit lamp declares data-lit; an unlit lamp does not", () => {
    const { container } = render(
      <>
        <Lamp tone="ok" />
        <Lamp tone="off" />
      </>
    );
    const lamps = container.querySelectorAll("[data-lamp]");
    expect(lamps[0]).toHaveAttribute("data-lit");
    expect(lamps[1]).not.toHaveAttribute("data-lit");
  });

  it("a chip carries its tone, its word within the chip, and the latch flag", () => {
    render(<LampChip label="Solo" word="1" tone="attention" latch testId="shell-lamp-latched-solo" />);
    const chip = screen.getByTestId("shell-lamp-latched-solo");
    expect(chip).toHaveAttribute("data-tone", "attention");
    expect(chip).toHaveAttribute("data-latch");
    expect(chip).toHaveTextContent("Solo");
    expect(chip).toHaveTextContent("1");
  });

  it("renders a button with the given aria-label when clickable", () => {
    const onClick = vi.fn();
    render(
      <LampChip label="Audio" word="ok" tone="ok" onClick={onClick} ariaLabel="Open Setup / Support for Audio." />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Setup / Support for Audio." }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Footer", () => {
  it("declares the footer region with items, hints and the action slot", () => {
    render(
      <Footer
        items={[{ label: "Console", value: "confirmed · 42 values" }]}
        hints={[{ kbd: ["[", "]"], label: "Bank" }]}
        action={<button type="button">Sync</button>}
        testId="shell-footer"
      />
    );
    const footer = screen.getByTestId("shell-footer");
    expect(footer).toHaveAttribute("data-region", "footer");
    expect(footer).toHaveTextContent("Console");
    expect(footer).toHaveTextContent("confirmed · 42 values");
    expect(footer.querySelectorAll("kbd")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
  });

  // Visual overhaul A, Slice 4a: a workspace that swaps its health bar for this
  // footer must keep its toasts clear of it. The toast stack keys its bottom
  // offset on `html:not(:has([data-health-bar]))`, so the marker moves with the
  // footer — the same assertion HealthBar carries.
  it("carries the inert data-health-bar marker the toast stack keys on", () => {
    render(<Footer items={[{ label: "Console", value: "confirmed" }]} testId="marked-footer" />);
    expect(screen.getByTestId("marked-footer")).toHaveAttribute("data-health-bar");
  });
});

describe("AppShellFrame", () => {
  const workspaces = [
    { id: "setup", label: "Setup / Support", hint: "Ctrl+1" },
    { id: "lighting", label: "Lighting", hint: "Ctrl+2" },
    { id: "audio", label: "Audio", hint: "Ctrl+3" },
    { id: "planning", label: "Planning", hint: "Ctrl+4" },
  ];
  const monitorItems = [
    { id: "lighting", label: "Lighting", detail: "ok", status: "ok" as const },
    { id: "audio", label: "Audio", detail: "failed", status: "error" as const },
    { id: "surface", label: "Surface", detail: "ok", status: "ok" as const },
    { id: "latched:solo", label: "Solo", detail: "1", status: "attention" as const, target: "Audio" },
  ];

  it("declares the header and the bay on every surface, the cluster and the plate when a workspace fills them", () => {
    const { container, rerender } = render(
      <AppShellFrame activeWorkspace="audio" monitorItems={monitorItems} workspaces={workspaces}>
        <p>bay</p>
      </AppShellFrame>
    );
    const regions = () => [...container.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
    expect(regions()).toEqual(["header", "bay"]);
    rerender(
      <AppShellFrame
        activeWorkspace="audio"
        monitorItems={monitorItems}
        workspaces={workspaces}
        cluster={<p>cluster</p>}
        plate={<p>plate</p>}
        footer={{ items: [{ label: "Bank", value: "all 13 strips" }] }}
      >
        <p>bay</p>
      </AppShellFrame>
    );
    expect(regions()).toEqual(["header", "cluster", "bay", "plate", "footer"]);
  });

  it("prints the product with its owner's eyebrow, the four tabs, the lamps with their tones and the clock", () => {
    render(
      <AppShellFrame activeWorkspace="audio" clock="09:11" monitorItems={monitorItems} workspaces={workspaces}>
        <p>bay</p>
      </AppShellFrame>
    );
    expect(screen.getByText("Studio Control")).toBeInTheDocument();
    expect(screen.getByText("SSE Executive Education")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace navigation" }).querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Audio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("shell-lamp-audio")).toHaveAttribute("data-tone", "error");
    expect(screen.getByTestId("shell-lamp-latched-solo")).toHaveAttribute("data-latch");
    expect(screen.getByTestId("shell-clock")).toHaveTextContent("09:11");
  });

  it("locks every tab before the engine is ready, and only the operator workspaces before commissioning is published", () => {
    const { rerender } = render(
      <AppShellFrame activeWorkspace="setup" monitorItems={[]} workspaces={workspaces} tabsDisabled>
        <p>startup</p>
      </AppShellFrame>
    );
    for (const label of ["Setup / Support", "Lighting", "Audio", "Planning"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
    }
    rerender(
      <AppShellFrame
        activeWorkspace="setup"
        monitorItems={[]}
        workspaces={workspaces}
        disabledWorkspaces={["lighting", "audio", "planning"]}
      >
        <p>setup</p>
      </AppShellFrame>
    );
    expect(screen.getByRole("button", { name: "Setup / Support" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Lighting" })).toHaveAttribute("aria-disabled", "true");
  });
});
