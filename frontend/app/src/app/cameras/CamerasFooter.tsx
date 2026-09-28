import { Footer } from "@sse/design-system";
import type { CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { cameraOf, heldWord, recordingWord } from "./camerasModel";
import { bigViewWord, type BigView } from "./pictures/pictureGeometry";

// The Cameras page's footer (board 2): who holds the cameras, where the
// pictures come from, what the big picture shows, and the take. What the
// dials set joins it with the deck's CAMERAS page.

export interface CamerasFooterProps {
  snapshot: CamerasSnapshot;
  selected: CameraSnapshot;
  view: BigView;
  stopArmed: boolean;
  /** The clock the take's length is counted against. */
  now: number;
}

export function CamerasFooter({ snapshot, selected, view, stopArmed, now }: CamerasFooterProps) {
  return (
    <Footer
      testId="cameras-footer"
      items={[
        { id: "cameras", label: "Cameras", value: heldWord(snapshot) },
        { id: "pictures", label: "Pictures", value: "test pictures" },
        { id: "big", label: "Big picture", value: `${selected.tag} · ${bigViewWord(view)}` },
        { id: "recording", label: "Recording", value: recordingWord(cameraOf(snapshot, 1), stopArmed, now) },
      ]}
    />
  );
}
