import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PREAMP_GAIN_DEFAULT_DB } from "../audioConstants";
import { AudioStripGainKey } from "./AudioStripGainKey";

// New pages program, Slice 3 (decisions 8 and 9): the strip's Gain key is a
// button that opens typed entry. Before, the arrows nudged it a dB (Shift five),
// Home / End sent it to the ends and Backspace / Delete reset it; the plate's
// gain knob takes the arrows, and typed entry's Reset key resets it.
describe("AudioStripGainKey", () => {
  afterEach(cleanup);

  function renderGainKey() {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(
      <AudioStripGainKey
        channelId="audio-input-9"
        gain={30}
        label="Host preamp gain"
        onCommit={onCommit}
        onPreview={onPreview}
      />
    );
    return { key: screen.getByRole("button", { name: "Host preamp gain" }), onCommit };
  }

  it("takes no arrows, Home, End, Backspace or Delete", () => {
    const { key, onCommit } = renderGainKey();
    for (const name of ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End", "Backspace", "Delete"]) {
      fireEvent.keyDown(key, { key: name });
    }
    fireEvent.keyDown(key, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(key.getAttribute("title")).toBe("Host preamp gain — press to type a value");
  });

  it("opens typed entry when pressed, and its Reset key sets the default gain", () => {
    const { key, onCommit } = renderGainKey();
    fireEvent.click(key);
    expect(screen.getByRole("dialog", { name: "Set Host preamp gain" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Reset to ${PREAMP_GAIN_DEFAULT_DB} dB` }));
    expect(onCommit).toHaveBeenLastCalledWith(PREAMP_GAIN_DEFAULT_DB);
  });
});
