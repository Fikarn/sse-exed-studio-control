import { expect, test, type Page } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// 2026-09 audit remediation, Slice 10. The audit found Console captions at 8
// and 8.5 px painted with the 22 %-alpha hairline colour, and a Bone chrome
// header whose gradient ended in a Studio-only literal. Nothing tested type
// size or contrast; the per-theme visual baselines pinned the broken renders.
// These checks read the live DOM, so a regression fails here before it
// reaches a baseline review.

const MICROTYPE_FLOOR_PX = 9.5;
const BODY_CONTRAST_MIN = 3;
const NAV_CONTRAST_MIN = 4.5;

interface TextRun {
  background: string;
  color: string;
  contrast: number;
  fontSize: number;
  text: string;
  path: string;
}

async function settleTheme(page: Page, theme: "studio" | "graphite" | "bone") {
  if (theme === "studio") return;
  await page.waitForSelector(`html[data-theme="${theme}"]`, { state: "attached" });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// Runs inside the page: every element under the root that owns non-blank text
// nodes, with its computed font size and the contrast of its text colour
// against the first opaque background behind it (alpha colours are composited
// over that background; a gradient cannot be sampled here, so its own
// background-color counts as a layer and the walk continues to the nearest
// solid surface — the Console's gradients are tints of the surface beneath).
// Hidden, aria-hidden, zero-size and disabled text is skipped — disabled
// controls are exempt from contrast requirements.
async function collectTextRuns(page: Page, rootSelector: string) {
  return page.evaluate(
    ({ rootSelector: selector }) => {
      const root = document.querySelector<HTMLElement>(selector);
      if (!root) return { error: `no element matches ${selector}`, runs: [] as TextRun[] };

      const parse = (value: string): [number, number, number, number] | null => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
        return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 1];
      };
      const over = (top: [number, number, number, number], bottom: [number, number, number]) => {
        const alpha = top[3];
        return [
          top[0] * alpha + bottom[0] * (1 - alpha),
          top[1] * alpha + bottom[1] * (1 - alpha),
          top[2] * alpha + bottom[2] * (1 - alpha),
        ] as [number, number, number];
      };
      const luminance = ([r, g, b]: [number, number, number]) => {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const contrast = (a: [number, number, number], b: [number, number, number]) => {
        const la = luminance(a);
        const lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      // The page ground: the first opaque body/html background, else the audio
      // shell's own --bg token (the body is transparent in this app).
      const probe = document.createElement("span");
      probe.style.color = "var(--bg)";
      root.appendChild(probe);
      const shellBg = parse(getComputedStyle(probe).color);
      probe.remove();
      const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
      const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor);
      const ground = [bodyBg, htmlBg, shellBg].find((candidate) => candidate && candidate[3] >= 1) ?? shellBg;
      const fallback: [number, number, number] = ground ? [ground[0], ground[1], ground[2]] : [0, 0, 0];

      const effectiveBackground = (start: HTMLElement): [number, number, number] => {
        // Collect translucent layers from the element up to the first opaque
        // background (or a background-image), then composite top-down.
        const layers: [number, number, number, number][] = [];
        let node: HTMLElement | null = start;
        let base: [number, number, number] | null = null;
        while (node) {
          const style = getComputedStyle(node);
          const bg = parse(style.backgroundColor);
          if (bg && bg[3] >= 1) {
            base = [bg[0], bg[1], bg[2]];
            break;
          }
          if (bg && bg[3] > 0) layers.push(bg);
          node = node.parentElement;
        }
        let result: [number, number, number] = base ?? fallback;
        for (const layer of layers.reverse()) result = over(layer, result);
        return result;
      };

      const isSkipped = (element: HTMLElement) => {
        let node: HTMLElement | null = element;
        while (node && node !== root.parentElement) {
          if (node.getAttribute("aria-hidden") === "true") return true;
          if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") return true;
          if (node.hasAttribute("data-legibility-exempt")) return true;
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return true;
          node = node.parentElement;
        }
        return false;
      };

      const describe = (element: HTMLElement) => {
        const parts: string[] = [];
        let node: HTMLElement | null = element;
        while (node && node !== root && parts.length < 4) {
          const id = node.getAttribute("data-testid");
          parts.unshift(id ? `[${id}]` : node.tagName.toLowerCase());
          node = node.parentElement;
        }
        return parts.join(" > ");
      };

      const runs: TextRun[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const seen = new Set<HTMLElement>();
      let textNode = walker.nextNode();
      while (textNode) {
        const text = textNode.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const element = textNode.parentElement;
        textNode = walker.nextNode();
        if (!text || !element || seen.has(element)) continue;
        if (element.tagName === "SCRIPT" || element.tagName === "STYLE" || element.tagName === "CANVAS") continue;
        seen.add(element);
        if (isSkipped(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const style = getComputedStyle(element);
        const color = parse(style.color);
        if (!color) continue;
        const background = effectiveBackground(element);
        const textColor = over(color, background);
        runs.push({
          background: `rgb(${background.map(Math.round).join(", ")})`,
          color: style.color,
          contrast: Math.round(contrast(textColor, background) * 100) / 100,
          fontSize: Number.parseFloat(style.fontSize),
          path: describe(element),
          text: text.slice(0, 40),
        });
      }
      return { error: null, runs };
    },
    { rootSelector }
  );
}

async function readFg4(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="audio-workspace"]');
    if (!shell) return null;
    const probe = document.createElement("span");
    probe.style.color = "var(--fg-4)";
    shell.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  });
}

const SURFACES = [
  { width: 2560, height: 1440, theme: "studio" as const },
  { width: 1920, height: 1080, theme: "studio" as const },
  { width: 2560, height: 1440, theme: "bone" as const },
  { width: 1920, height: 1080, theme: "bone" as const },
];

for (const { width, height, theme } of SURFACES) {
  test(`Console text at ${width}x${height} (${theme}) meets the 9.5 px floor and 3:1 contrast`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openFixture(page, "audio-populated", theme === "bone" ? { theme } : undefined);
    await settleTheme(page, theme);
    await expect(page.getByTestId("audio-workspace")).toBeVisible();
    await expect(page.getByTestId("audio-tiered-mixer")).toBeVisible();

    const { error, runs } = await collectTextRuns(page, '[data-testid="audio-workspace"]');
    expect(error).toBeNull();
    expect(runs.length, "the Console should expose text runs to measure").toBeGreaterThan(50);

    const tooSmall = runs.filter((run) => run.fontSize < MICROTYPE_FLOOR_PX - 0.01);
    expect(
      tooSmall.map((run) => `${run.fontSize}px ${run.path} "${run.text}"`),
      `text below ${MICROTYPE_FLOOR_PX}px`
    ).toEqual([]);

    const fg4 = await readFg4(page);
    expect(fg4).not.toBeNull();
    const paintedFg4 = runs.filter((run) => run.color === fg4);
    expect(
      paintedFg4.map((run) => `${run.path} "${run.text}"`),
      `text painted --fg-4 (${fg4})`
    ).toEqual([]);

    const lowContrast = runs.filter((run) => run.contrast < BODY_CONTRAST_MIN);
    expect(
      lowContrast.map((run) => `${run.contrast}:1 ${run.color} on ${run.background} ${run.path} "${run.text}"`),
      `text below ${BODY_CONTRAST_MIN}:1`
    ).toEqual([]);
  });
}

for (const theme of ["studio", "graphite", "bone"] as const) {
  test(`workspace navigation labels read at 4.5:1 on the ${theme} header`, async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await openFixture(page, "audio-populated", theme === "studio" ? undefined : { theme });
    await settleTheme(page, theme);
    const nav = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(nav).toBeVisible();

    const result = await page.evaluate(() => {
      const parse = (value: string): [number, number, number, number] | null => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1]
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 1];
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
      };
      const contrast = (a: number[], b: number[]) => {
        const la = luminance(a);
        const lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      const header = document.querySelector<HTMLElement>("header");
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Workspace navigation"]');
      if (!header || !nav) return { error: "header or nav missing" };
      // The header paints `linear-gradient(180deg, top, bottom)`; the tokens
      // that feed it are read back, and each label is checked against the
      // worst of the two stops (there is no way to rasterise the DOM here).
      const probe = document.createElement("span");
      header.appendChild(probe);
      probe.style.color = "var(--color-bg-deep)";
      const top = parse(getComputedStyle(probe).color);
      probe.style.color = "var(--color-shell-header-bottom)";
      const bottom = parse(getComputedStyle(probe).color);
      probe.remove();
      if (!top || !bottom) return { error: `header stops unresolved: ${String(top)} / ${String(bottom)}` };
      const labels = Array.from(nav.querySelectorAll<HTMLElement>("button")).map((button) => {
        const color = parse(getComputedStyle(button).color) ?? [0, 0, 0, 1];
        const worst = Math.min(contrast(color, top), contrast(color, bottom));
        return {
          active: button.getAttribute("aria-current") === "page",
          color: getComputedStyle(button).color,
          contrast: Math.round(worst * 100) / 100,
          label: button.textContent?.trim() ?? "",
        };
      });
      return {
        bottom: `rgb(${bottom.slice(0, 3).join(", ")})`,
        error: null,
        labels,
        top: `rgb(${top.slice(0, 3).join(", ")})`,
      };
    });

    expect(result.error).toBeNull();
    expect(result.labels?.length ?? 0).toBeGreaterThanOrEqual(3);
    const weak = (result.labels ?? []).filter((label) => label.contrast < NAV_CONTRAST_MIN);
    expect(
      weak.map((label) => `${label.label}: ${label.contrast}:1 (${label.color} on ${result.top} → ${result.bottom})`),
      `nav labels below ${NAV_CONTRAST_MIN}:1 on ${theme}`
    ).toEqual([]);
  });
}
