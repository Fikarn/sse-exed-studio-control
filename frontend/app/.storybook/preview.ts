import type { Preview } from "@storybook/react-vite";

import "@fontsource-variable/inter/index.css";

import "../src/styles/global.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
};

export default preview;
