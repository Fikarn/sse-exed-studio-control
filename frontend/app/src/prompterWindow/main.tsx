import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter/index.css";

import { createGlassLink } from "./createGlassLink";
import { PrompterWindow } from "./PrompterWindow";
import "../styles/global.css";

// The prompter's window's page (`prompter.html`): the glass on the Prompter
// XL. It is a page of its own, not the operator's with a parameter: it loads
// no store, no page of the operator's and no command of the shell's but its
// own. The page is black before this runs (`prompter.html`).

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

createGlassLink().then(
  (link) => createRoot(rootElement).render(<PrompterWindow link={link} />),
  (error: unknown) => console.error("The prompter's window could not start:", error)
);
