import type { Decorator, Preview } from "@storybook/react-vite";
import { createElement, useEffect } from "react";

import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/jetbrains-mono/index.css";

import "../src/styles/global.css";

// Visual overhaul A, Slice 3: a story declares its theme through
// `parameters.theme` (studio | graphite | bone); the decorator stamps it on
// <html>, where themes.css keys the material, exactly as the app does.
function ThemeFrame({ theme, children }: { theme: string; children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [theme]);
  return children;
}

const withTheme: Decorator = (Story, context) =>
  createElement(ThemeFrame, { theme: String(context.parameters.theme ?? "studio") }, createElement(Story));

const preview: Preview = {
  decorators: [withTheme],
  parameters: {
    layout: "fullscreen",
  },
};

export default preview;
