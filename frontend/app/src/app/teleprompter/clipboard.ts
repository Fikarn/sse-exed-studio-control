import type { PrompterPasteRequest } from "@sse/engine-client";

// What the Windows clipboard holds, read by the page itself (new pages
// program, Slice 4's first step 3a): its HTML, when something formatted was
// copied, and its plain text. The shell grants the main window the clipboard
// (Slice 6b); the hardware link reads the formatting (`prompter.script.paste`,
// `prompter.paste.convert`).

/** The sentence when the clipboard cannot be read, or holds no text. */
export const CLIPBOARD_EMPTY = "The clipboard holds no text to paste. Copy the script's text, then paste again.";
export const CLIPBOARD_UNREADABLE =
  "Studio Control could not read the clipboard. Copy the text again, then paste again.";

export class ClipboardError extends Error {}

/** The clipboard's HTML and plain text; throws a `ClipboardError` with the operator's sentence when there is neither. */
export async function readClipboard(): Promise<PrompterPasteRequest> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  let html: string | undefined;
  let text: string | undefined;
  try {
    if (clipboard?.read) {
      for (const item of await clipboard.read()) {
        if (html === undefined && item.types.includes("text/html"))
          html = await (await item.getType("text/html")).text();
        if (text === undefined && item.types.includes("text/plain"))
          text = await (await item.getType("text/plain")).text();
      }
    } else if (clipboard?.readText) {
      text = await clipboard.readText();
    } else {
      throw new ClipboardError(CLIPBOARD_UNREADABLE);
    }
  } catch (error) {
    throw error instanceof ClipboardError ? error : new ClipboardError(CLIPBOARD_UNREADABLE);
  }
  if (!html?.trim() && !text?.trim()) throw new ClipboardError(CLIPBOARD_EMPTY);
  return { ...(html?.trim() ? { html } : {}), ...(text?.trim() ? { text } : {}) };
}

/** What a paste event carried (a paste into the editor), in the same shape. */
export function pastedContent(data: DataTransfer | null): PrompterPasteRequest | null {
  if (!data) return null;
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  if (!html.trim() && !text.trim()) return null;
  return { ...(html.trim() ? { html } : {}), ...(text.trim() ? { text } : {}) };
}
