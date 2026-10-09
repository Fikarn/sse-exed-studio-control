import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { AppShellFrame } from "../AppShellFrame";
import { Footer } from "../Footer";
import { Lamp } from "../Lamp";
import { LampChip } from "../LampChip";
import { Tab } from "../Tab";
import { toneForSubsystem, worstTone } from "../statusTone";

// Visual overhaul A, Slice 2: the shell primitives (Tab, Lamp, LampChip,
// Footer), the tone map and the frame's regions. New pages program, Slice 3
// (D6): the tabs and the footer print no key hints.

const cssOf = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", name), "utf8");

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
  // Slice 3 (D6). Old: the tab took `hint="Ctrl+2"` and printed it in an
  // aria-hidden <kbd>. New: the tab has no hint and prints only its name.
  // Reason: Ctrl+1–3 are gone, and so is every hint that advertised them.
  it("carries the workspace's name as its accessible name and prints no key hint", () => {
    render(<Tab id="lighting" label="Lighting" />);
    const tab = screen.getByRole("button", { name: "Lighting" });
    expect(tab).toHaveAttribute("data-nav-id", "lighting");
    expect(tab).toHaveTextContent(/^Lighting$/);
    expect(tab.querySelector("kbd")).toBeNull();
  });

  // The shell (overhaul 3): a tab carries its page's lamp and state word. The
  // word describes the tab and is never part of its name.
  it("carries its page's lamp and word after its name, outside its accessible name", () => {
    render(<Tab id="lighting" label="Lighting" word="no bridge" tone="error" wordTestId="shell-lamp-lighting" />);
    const tab = screen.getByRole("button", { name: "Lighting" });
    expect(tab).toHaveAccessibleDescription("no bridge");
    expect(screen.getByTestId("shell-lamp-lighting")).toHaveAttribute("data-tone", "error");
    expect(screen.getByTestId("shell-lamp-lighting")).toHaveTextContent("no bridge");
  });

  it("marks the active tab as the current page (its `data-material` hook stays)", () => {
    render(<Tab id="audio" label="Audio" active />);
    const tab = screen.getByRole("button", { name: "Audio" });
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(tab).toHaveAttribute("data-material", "key");
  });

  // Visual overhaul 2026-10 (Atrium): a tab has no box at rest; the active
  // tab is the selection, the 2 px Beige keyline, in the main ink and bold;
  // hover changes only the ink.
  // The skylight (D48, 2026-10-09): a segment of the header's platter, its
  // name bold in the second ink; the open tab is the one Dark Green segment in
  // Beige Light, with no keyline; hover is the platter's hover tone.
  it("draws the open tab as the one Dark Green segment and hover as the platter's hover tone", () => {
    const css = cssOf("Tab.module.css");
    expect(css).toMatch(
      /\.tab \{[^}]*border-radius: var\(--radius-control\);[^}]*color: var\(--text-text2\);[^}]*font: 700 /
    );
    expect(css).toMatch(/\.active \{[^}]*background: var\(--sse-dark-green\);[^}]*color: var\(--sse-beige-light\)/);
    // Bold on the name itself too (until 2026-10-09 the reset outranked the button's own font).
    expect(css).toMatch(/\.name \{[^}]*font: 700 var\(--font-size-body\)/);
    expect(css).not.toMatch(/\.active::after/);
    expect(css).toMatch(/:hover \{\s*background: var\(--material-platter-hover\);\s*\}/);
    expect(css).not.toMatch(/--radius-key|--elevation-/);
  });

  it("a locked tab is aria-disabled, disabled and does not fire", () => {
    const onClick = vi.fn();
    render(<Tab id="lighting" label="Lighting" disabled onClick={onClick} />);
    const tab = screen.getByRole("button", { name: "Lighting" });
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
  // Slice 3 (D6). Old: the footer took `hints` and printed two <kbd>s for
  // "[ ] Bank". New: no hint slot, no <kbd>. Reason: the key hints went with
  // the keys; the telemetry and the action key stay.
  it("declares the footer region with items and the action slot, and no key hint", () => {
    render(
      <Footer
        items={[{ label: "Console", value: "confirmed · 42 values" }]}
        action={<button type="button">Sync</button>}
        testId="shell-footer"
      />
    );
    const footer = screen.getByTestId("shell-footer");
    expect(footer).toHaveAttribute("data-region", "footer");
    expect(footer).toHaveTextContent("Console");
    expect(footer).toHaveTextContent("confirmed · 42 values");
    expect(footer.querySelector("kbd")).toBeNull();
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
  });

  // Inventory §7 note 9: the hints used to push the action key to the right
  // edge; with them gone the action pushes itself there.
  it("keeps the action key at the right edge", () => {
    expect(cssOf("Footer.module.css")).toMatch(/\.action \{[^}]*margin-left: auto/);
  });

  // Visual overhaul 2026-10 (Atrium): its facts are quiet PT Sans at label
  // size, 40 px apart. The skylight (D48): the footer is the header's raised
  // layer, closed by its line at the top, and ends with the colophon.
  it("is the raised bar under its line, with quiet facts 40 px apart and the colophon last", () => {
    const css = cssOf("Footer.module.css");
    expect(css).toMatch(
      /\.footer \{[^}]*border-top: 1px solid var\(--material-bar-line\);[^}]*background: var\(--material-bar\)/
    );
    expect(css).toMatch(
      /\.colophon \{[^}]*margin-left: auto;[^}]*var\(--font-family-display\);[^}]*letter-spacing: var\(--font-tracking-colophon\)/
    );
    expect(css).toMatch(/\.items \{[^}]*gap: 40px/);
    expect(css).toMatch(/\.label \{\s*color: var\(--text-text3\)/);
    expect(css).toMatch(/\.value \{[^}]*color: var\(--text-text2\)/);
    expect(css).not.toMatch(/gradient\(|--font-family-mono|--material-panel/);
  });

  // Visual overhaul A, Slice 4a: a workspace that swaps its health bar for this
  // footer must keep its toasts clear of it. The toast stack keys its bottom
  // offset on `html:not(:has([data-health-bar]))`, so the marker moves with the
  // footer — the same assertion HealthBar carries.
  // The skylight (D48): inside the shell the footer ends with the product's
  // name, which the frame hands it; on its own it has none.
  it("ends with the product's name inside the shell, and with nothing on its own", () => {
    const { unmount } = render(<Footer items={[{ label: "Console", value: "confirmed" }]} />);
    expect(screen.queryByTestId("shell-colophon")).toBeNull();
    unmount();
    render(
      <AppShellFrame activeWorkspace="" monitorItems={[]} workspaces={[]} footer={{ items: [], action: <b>Act</b> }}>
        <p>bay</p>
      </AppShellFrame>
    );
    const colophon = screen.getByTestId("shell-colophon");
    expect(colophon).toHaveTextContent("Studio Control");
    expect(colophon.parentElement).toHaveAttribute("data-region", "footer");
    expect(colophon.previousElementSibling).toHaveTextContent("Act");
  });

  it("carries the inert data-health-bar marker the toast stack keys on", () => {
    render(<Footer items={[{ label: "Console", value: "confirmed" }]} testId="marked-footer" />);
    expect(screen.getByTestId("marked-footer")).toHaveAttribute("data-health-bar");
  });
});

describe("AppShellFrame", () => {
  const workspaces = [
    { id: "setup", label: "Setup / Support", system: true },
    { id: "lighting", label: "Lighting" },
    { id: "audio", label: "Audio" },
  ];
  const monitorItems = [
    { id: "lighting", label: "Lighting", detail: "unreachable", status: "error" as const, tab: "lighting" },
    { id: "audio", label: "Audio", detail: "failed", status: "error" as const, tab: "audio" },
    { id: "surface", label: "Surface", detail: "ready", status: "ok" as const },
    { id: "latched:solo", label: "Solo", detail: "latched", status: "attention" as const, target: "Audio" },
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

  // The shell (overhaul 3): each page's lamp in its tab, none in the active
  // one; the REC tally in its own slot, quiet at rest. The skylight (D48): the
  // logotype first and alone, no product name in the header; the pages on
  // their platter; the lamps without a page, the latches and then Setup /
  // Support on the system's platter.
  it("prints the logotype, the pages' tabs with their lamps, the system's platter, the REC tally and the clock", () => {
    const { rerender } = render(
      <AppShellFrame
        activeWorkspace="audio"
        clock="09:11"
        monitorItems={monitorItems}
        recTally={null}
        workspaces={workspaces}
      >
        <p>bay</p>
      </AppShellFrame>
    );
    const header = screen.getByRole("banner");
    expect(header).not.toHaveTextContent("Studio Control");
    const logo = screen.getByRole("img", { name: "SSE Executive Education" });
    expect(header.firstElementChild).toBe(logo);
    const nav = screen.getByRole("navigation", { name: "Workspace navigation" });
    expect(nav).toHaveAttribute("data-platter", "pages");
    expect([...nav.querySelectorAll("button")].map((tab) => tab.getAttribute("data-nav-id"))).toEqual([
      "lighting",
      "audio",
    ]);
    expect(nav.querySelector("kbd")).toBeNull();
    const system = header.querySelector('[data-platter="system"]')!;
    expect(
      [...system.children].map((item) => item.getAttribute("data-nav-id") ?? item.getAttribute("data-testid"))
    ).toEqual(["shell-lamp-surface", "shell-lamp-latched-solo", "setup"]);
    expect(screen.getByRole("button", { name: "Audio" })).toHaveAttribute("aria-current", "page");
    // The active tab carries no word: its page's state display says it.
    expect(screen.queryByTestId("shell-lamp-audio")).toBeNull();
    // The polish (2026-10-05): but it keeps the word's room, unseen and
    // unspoken, so the tabs after it do not move with the page.
    const audioTab = screen.getByRole("button", { name: "Audio" });
    expect(audioTab).not.toHaveAttribute("aria-describedby");
    const reserve = nav.querySelectorAll("[data-tab-reserve]");
    expect(reserve).toHaveLength(1);
    expect(reserve[0]).toHaveAttribute("aria-hidden", "true");
    expect(reserve[0]!.querySelector("[data-lamp], [data-testid]")).toBeNull();
    expect(nav.querySelector('[data-testid="shell-lamp-lighting"]')).toHaveAttribute("data-tone", "error");
    expect(screen.getByTestId("shell-lamp-surface")).toHaveTextContent("Surface");
    expect(screen.getByTestId("shell-lamp-latched-solo")).toHaveAttribute("data-latch");
    expect(screen.getByTestId("shell-rec-slot")).toHaveTextContent("REC");
    expect(screen.queryByTestId("shell-lamp-latched-rec")).toBeNull();
    expect(screen.getByTestId("shell-clock")).toHaveTextContent("09:11");

    rerender(
      <AppShellFrame
        activeWorkspace="audio"
        clock="09:11"
        monitorItems={monitorItems}
        recTally={{ id: "latched:rec", label: "REC", detail: "CAM 1", status: "error", target: "Cameras" }}
        workspaces={workspaces}
      >
        <p>bay</p>
      </AppShellFrame>
    );
    const rec = screen.getByTestId("shell-lamp-latched-rec");
    expect(rec).toHaveAttribute("data-tone", "error");
    expect(rec).toHaveTextContent("RECCAM 1");
    expect(screen.getByTestId("shell-rec-slot")).toContainElement(rec);
  });

  it("locks every tab before the engine is ready, and only the operator workspaces before commissioning is published", () => {
    const { rerender } = render(
      <AppShellFrame activeWorkspace="setup" monitorItems={[]} workspaces={workspaces} tabsDisabled>
        <p>startup</p>
      </AppShellFrame>
    );
    for (const label of ["Setup / Support", "Lighting", "Audio"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
    }
    rerender(
      <AppShellFrame
        activeWorkspace="setup"
        monitorItems={[]}
        workspaces={workspaces}
        disabledWorkspaces={["lighting", "audio"]}
      >
        <p>setup</p>
      </AppShellFrame>
    );
    expect(screen.getByRole("button", { name: "Setup / Support" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Lighting" })).toHaveAttribute("aria-disabled", "true");
  });
});
