import type { MenuContent, MenuDestructiveItem, MenuEntry } from "@sse/design-system";
import type { CameraSnapshot } from "@sse/engine-client";

import { cameraNumber, linkLabel, releasedTo } from "./camerasModel";
import { camerasMenuArmId } from "./useCamerasArming";

// The visual overhaul's Cameras page (2026-10-05, DESIGN.md §9): one menu per
// camera, shared by its key's ⋯ in the cluster, a right-click on that key, a
// small picture's ⋯ and right-click, and the plate title's ⋯, so all of them
// open the same menu. Each host passes the page's arm (`menu={{ ...menu, arm }}`).
//
// Release is press twice (D11, D19). Release, the format and the look act on
// the selected camera only, and the page drops an arm whose camera is not the
// selected one. So the selected camera's menu ends in the destructive item,
// which arms in place and releases at the second press, while the menu stays
// open; the menu of a camera that is not selected selects it and hands off to
// the plate's fixed Release key, which arms once the hardware link says that
// camera is selected. A menu never arms the selected camera for another one.

export type CamerasMenu = Omit<MenuContent, "arm">;

export interface CameraMenuOptions {
  camera: CameraSnapshot;
  /** The camera is the selected one: the plate shows it. */
  selected: boolean;
  onSelect: () => void;
  onConnect: () => void;
  /** One read of the cameras, which sends nothing. */
  onReadAgain: () => void;
  onOpenSetup: () => void;
  /** The selected camera's Release, at the destructive item's second press. */
  onRelease: () => void;
  /** Another camera's Release: select it, and arm the plate's Release key. */
  onReleaseElsewhere: () => void;
  testIdPrefix: string;
}

export function buildCameraMenu(options: CameraMenuOptions): CamerasMenu {
  const { camera, selected, testIdPrefix } = options;
  const tag = camera.tag;
  const held = camera.state === "held";
  const items: MenuEntry[] = [
    {
      id: "select",
      label: "Select",
      value: selected ? "selected" : undefined,
      disabledReason: selected ? "selected" : null,
      onSelect: options.onSelect,
      testId: `${testIdPrefix}-select`,
    },
  ];
  switch (camera.state) {
    case "held":
      items.push({
        id: "read-again",
        label: `Read ${tag} again`,
        onSelect: options.onReadAgain,
        testId: `${testIdPrefix}-read-again`,
      });
      break;
    case "released":
      items.push({
        id: "connect",
        label: `Connect ${tag}`,
        value: `released to ${releasedTo(camera)}`,
        onSelect: options.onConnect,
        testId: `${testIdPrefix}-connect`,
      });
      break;
    case "unreachable":
      items.push({
        id: "try-again",
        label: `Try ${tag} again`,
        onSelect: options.onReadAgain,
        testId: `${testIdPrefix}-try-again`,
      });
      break;
    case "not-set-up":
      break;
  }
  items.push(
    { kind: "divider", id: "setup-divider" },
    {
      id: "setup",
      label: "Camera setup",
      value: camera.state === "not-set-up" ? "not set up" : undefined,
      onSelect: options.onOpenSetup,
      testId: `${testIdPrefix}-setup`,
    }
  );

  let destructive: MenuDestructiveItem | undefined;
  if (held && selected) {
    destructive = {
      id: camerasMenuArmId.release(cameraNumber(camera)),
      label: `Release ${tag}…`,
      armedLabel: `Press again to release ${tag} to ${releasedTo(camera)}`,
      onConfirm: options.onRelease,
      testId: `${testIdPrefix}-release`,
    };
  } else if (held) {
    items.push(
      { kind: "divider", id: "release-divider" },
      {
        id: "release",
        label: `Release ${tag}…`,
        value: "on the plate",
        tone: "danger",
        onSelect: options.onReleaseElsewhere,
        testId: `${testIdPrefix}-release`,
      }
    );
  }

  return {
    head: { title: tag, detail: `${camera.model} · ${linkLabel(camera)}` },
    items,
    destructive,
  };
}
