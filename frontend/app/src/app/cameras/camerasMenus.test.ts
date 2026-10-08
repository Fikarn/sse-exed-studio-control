import { describe, expect, it, vi } from "vitest";

import type { MenuActionItem, MenuEntry } from "@sse/design-system";

import { buildCameraMenu, type CameraMenuOptions } from "./camerasMenus";
import { cameraOf } from "./camerasModel";
import { openCameras } from "./camerasTestData";
import {
  armedCamera,
  armedInGroup,
  camerasArmedWords,
  camerasArmKey,
  camerasMenuArmId,
  menuArmKey,
  releaseArmed,
  STOP_ARM_KEY,
} from "./useCamerasArming";

// The visual overhaul's Cameras page (2026-10-05): one menu per camera, and
// one arm for the page whose every key names the camera it acts on.

function options(overrides: Partial<CameraMenuOptions> & Pick<CameraMenuOptions, "camera">): CameraMenuOptions {
  return {
    selected: false,
    onSelect: vi.fn(),
    onConnect: vi.fn(),
    onReadAgain: vi.fn(),
    onOpenSetup: vi.fn(),
    onRelease: vi.fn(),
    onReleaseElsewhere: vi.fn(),
    testIdPrefix: "menu",
    ...overrides,
  };
}

const ids = (items: readonly MenuEntry[]) => items.map((entry) => (entry.kind === "divider" ? "—" : entry.id));
const item = (items: readonly MenuEntry[], id: string) =>
  items.find((entry) => entry.kind !== "divider" && entry.id === id) as MenuActionItem | undefined;

describe("a camera's menu", () => {
  it("names the camera and how it is reached, and ends the selected camera's in a Release that arms in place", async () => {
    const snapshot = await openCameras().read();
    const cam1 = cameraOf(snapshot, 1)!;
    const menu = buildCameraMenu(options({ camera: cam1, selected: true }));
    expect(menu.head).toEqual({ title: "CAM 1", detail: "Blackmagic Pocket Cinema Camera 6K Pro · Bluetooth" });
    expect(ids(menu.items)).toEqual(["select", "read-again", "—", "setup"]);
    expect(item(menu.items, "select")).toMatchObject({ value: "selected", disabledReason: "selected" });
    expect(menu.destructive).toMatchObject({
      id: "release:1",
      label: "Release CAM 1…",
      armedLabel: "Press again to release CAM 1",
      testId: "menu-release",
    });
  });

  it("hands another camera's Release to the plate's key, and never arms it in the menu", async () => {
    const snapshot = await openCameras().read();
    const onReleaseElsewhere = vi.fn();
    const onRelease = vi.fn();
    const menu = buildCameraMenu(
      options({ camera: cameraOf(snapshot, 2)!, selected: false, onRelease, onReleaseElsewhere })
    );
    expect(menu.destructive).toBeUndefined();
    expect(ids(menu.items)).toEqual(["select", "read-again", "—", "setup", "—", "release"]);
    const release = item(menu.items, "release")!;
    expect(release).toMatchObject({ label: "Release CAM 2…", value: "on the plate", tone: "danger" });
    release.onSelect();
    expect(onReleaseElsewhere).toHaveBeenCalledOnce();
    expect(onRelease).not.toHaveBeenCalled();
    expect(item(menu.items, "select")?.disabledReason).toBeNull();
  });

  it("offers Connect for a released camera, Try again for one that does not answer, and no Release for either", async () => {
    const released = cameraOf(
      await openCameras({ cameras: [{ camera: 2, address: "172.16.16.85", released: true }] }).read(),
      2
    )!;
    const menu = buildCameraMenu(options({ camera: released, selected: true }));
    expect(ids(menu.items)).toEqual(["select", "connect", "—", "setup"]);
    expect(item(menu.items, "connect")).toMatchObject({ label: "Connect CAM 2", value: "released to LUMIX Tether" });
    expect(menu.destructive).toBeUndefined();

    const { hooks, read } = openCameras();
    hooks.stopAnswering(3);
    const lost = cameraOf(await read(), 3)!;
    const lostMenu = buildCameraMenu(options({ camera: lost }));
    expect(ids(lostMenu.items)).toEqual(["select", "try-again", "—", "setup"]);
    expect(item(lostMenu.items, "try-again")?.label).toBe("Try CAM 3 again");
  });
});

describe("the page's one arm", () => {
  it("reads the camera an armed key acts on, a menu's arm included", () => {
    expect(armedCamera(STOP_ARM_KEY)).toBe(1);
    expect(armedCamera(camerasArmKey.release(2))).toBe(2);
    expect(armedCamera(camerasArmKey.format(3, "frameRate", "50"))).toBe(3);
    expect(armedCamera(camerasArmKey.look(1, "displayLutOn", false))).toBe(1);
    // Until 2026-10-05 the page read the camera as the key's second part, so a
    // menu's arm named none and was dropped at once.
    expect(armedCamera(menuArmKey(camerasMenuArmId.release(2)))).toBe(2);
    expect(armedCamera("menu:something-else")).toBeNull();
  });

  it("says a menu's Release as the plate's key says it", async () => {
    const snapshot = await openCameras().read();
    expect(camerasArmedWords({ key: "menu:release:2", label: "Release CAM 2…" }, snapshot)).toBe(
      "Release CAM 2 to LUMIX Tether"
    );
    expect(camerasArmedWords({ key: "stop", label: "Stop recording on CAM 1" }, snapshot)).toBe(
      "Stop recording on CAM 1"
    );
  });

  it("knows a popover's arms and Release in either of its places", () => {
    expect(armedInGroup(camerasArmKey.format(1, "resolution", "UHD"), "format")).toBe(true);
    expect(armedInGroup(camerasArmKey.format(1, "resolution", "UHD"), "look")).toBe(false);
    expect(armedInGroup(null, "look")).toBe(false);
    expect(releaseArmed("release:1", 1)).toBe(true);
    expect(releaseArmed("menu:release:1", 1)).toBe(true);
    expect(releaseArmed("menu:release:2", 1)).toBe(false);
  });
});
