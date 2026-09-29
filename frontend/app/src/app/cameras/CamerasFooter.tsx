import { Footer } from "@sse/design-system";
import type { CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { cameraOf, dialsView, heldWord, picturesWord, recordingWord } from "./camerasModel";
import { bigViewWord, type BigView } from "./pictures/pictureGeometry";

// The Cameras page's footer (board 2): who holds the cameras, where the
// pictures come from and how many arrive, what the big picture shows, what
// the Stream Deck's dials set, and the take.

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
        { id: "pictures", label: "Pictures", value: picturesWord(snapshot) },
        { id: "big", label: "Big picture", value: `${selected.tag} · ${bigViewWord(view)}` },
        { id: "dials", label: "Dials", value: dialsView(snapshot)?.footer ?? selected.tag },
        { id: "recording", label: "Recording", value: recordingWord(cameraOf(snapshot, 1), stopArmed, now) },
      ]}
    />
  );
}
