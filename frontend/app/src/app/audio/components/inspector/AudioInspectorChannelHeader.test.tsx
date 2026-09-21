import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlateHead } from "@sse/design-system";

import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioInspectorChannelHeader } from "./AudioInspectorChannelHeader";
import type { SelectedAudioChannel } from "./audioInspectorHelpers";

// Production readiness S15: the Console's plate head prints this header as its
// `sub`, which the design system's PlateHead puts in a `<p>`. It used to render
// two `<div>`s there — invalid markup React warned about in every development
// build (both qualification lanes printed it).
describe("AudioInspectorChannelHeader", () => {
  afterEach(cleanup);

  const channel = { id: "audio-input-9", role: "front-preamp", stereo: false } as unknown as SelectedAudioChannel;
  const viewModel = { channels: [channel] } as unknown as AudioWorkspaceViewModel;
  const main = { name: "Main" } as unknown as AudioMixTargetEntry;

  it("puts nothing but phrasing content inside the plate head's paragraph", () => {
    const { container } = render(
      <PlateHead
        title="Host"
        sub={
          <AudioInspectorChannelHeader
            selectedChannel={channel}
            selectedGroup="mics"
            selectedMixTarget={main}
            viewModel={viewModel}
          />
        }
      />
    );
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    expect(paragraph!.querySelectorAll("div, p, section, header, ul, ol, table, h1, h2, h3")).toHaveLength(0);
    expect(paragraph!.textContent).toContain("Channel · Channel 01");
    expect(paragraph!.textContent).toContain("Mic preamp · Mono →");
    expect(paragraph!.textContent).toContain("Main");
  });
});
