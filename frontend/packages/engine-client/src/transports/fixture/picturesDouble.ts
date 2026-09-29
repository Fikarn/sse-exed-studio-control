// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { EngineTransport } from "../../types";
import { FULL_PICTURE, SMALL_PICTURE, testCardUyvy, type PictureFrame } from "../pictureFrame";
import type { PictureCamera, PicturesLink } from "../picturesLink";
import { fixtureContextOf } from "./camerasRequests";
import { cameraPicture, fixtureCameras } from "./camerasState";

// The pictures as the double hands them to the page, in place of the shell's
// `pictures_next`: each camera's test card, the helper's (`pictureFrame.ts`), still — as
// tests get their pictures (docs/HARDWARE.md, rule 3) — and only while the double says
// its picture arrives. The selected camera's is big, the others small, as the helper
// sends them; a card is made new (its sequence one up) only when its size changes. One
// take brings the card of every camera whose picture arrives, in camera order, as the
// shell's one take brings the three. The double hands the same cards at every take and
// does not wait, where the shell hands each frame once and waits for the next: the page
// draws a card again only when its sequence moved, so a page opened again draws it.

const CAMERAS: readonly PictureCamera[] = [1, 2, 3];

/** The pictures of the double behind `transport` (made by `createFixtureTransport`). */
export function fixturePicturesLink(transport: EngineTransport): PicturesLink {
  const context = fixtureContextOf(transport);
  const served = new Map<PictureCamera, PictureFrame>();
  const cardOf = (camera: PictureCamera, big: boolean): PictureFrame => {
    const size = big ? FULL_PICTURE : SMALL_PICTURE;
    let frame = served.get(camera);
    if (!frame || frame.width !== size.width) {
      frame = {
        camera,
        format: "uyvy",
        width: size.width,
        height: size.height,
        sequence: (frame?.sequence ?? 0) + 1,
        pixels: testCardUyvy(camera, big),
      };
      served.set(camera, frame);
    }
    return frame;
  };
  return {
    async next() {
      const cameras = fixtureCameras(context.state);
      cameras.picturesPulled += 1;
      return CAMERAS.filter((camera) => cameraPicture(cameras, camera).state === "showing").map((camera) =>
        cardOf(camera, cameras.selected === camera)
      );
    },
  };
}
