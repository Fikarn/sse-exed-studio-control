import type {
  LightingFixtureSnapshot,
  LightingSceneFixtureSnapshot,
  LightingSnapshot,
  ShellState,
  ShellStore,
} from "@sse/engine-client";
import { act, cleanup, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLightingEditor, type LightingEditor } from "./useLightingEditor";

// Slice 3 review: the Lighting editors' own undo steps and overlay keys, driven
// through `useLightingEditor` against a store that answers as the hardware link
// does (`native/rust-engine/src/lighting/`): ids are the highest in use plus
// one (`next_custom_scene_id`, `next_custom_fixture_id`) — the fixture double
// hands out the lowest free one, which hides some of these cases — a request
// naming a scene or fixture that is not there is refused, an added fixture goes
// into every scene (`append_fixture_to_scenes`), and a read gives each scene a
// state for every fixture with no `intensity` or `cct` in its control values
// and a cct clamped to 2000–10000 (`normalize_lighting_editor_state`).

const toast = vi.hoisted(() => ({ push: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }));
const layout = vi.hoisted(() => ({ isNarrow: false, layoutMode: "studioFull" }));
vi.mock("../shared/toastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/toastContext")>()),
  useToast: () => toast,
}));
vi.mock("../OperatorLayoutProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../OperatorLayoutProvider")>()),
  useOperatorLayout: () => layout,
}));

type SceneCreate = Parameters<ShellStore["createLightingScene"]>[0];
type FixtureCreate = Parameters<ShellStore["createLightingFixture"]>[0];
type FixtureUpdate = Parameters<ShellStore["updateLightingFixture"]>[0];

type StoredFixture = Omit<LightingFixtureSnapshot, "controlValues"> & {
  /** Its controls other than intensity and cct. */
  controls: Record<string, number>;
  hasCct: boolean;
};
interface StoredScene {
  id: string;
  name: string;
  states: LightingSceneFixtureSnapshot[];
  colorIndex: number | null;
  pinned: boolean;
}

const nextId = (prefix: string, ids: readonly string[]) =>
  `${prefix}${
    Math.max(0, ...ids.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length)) || 0)) + 1
  }`;

function fixture(
  id: string,
  name: string,
  fields: Partial<StoredFixture> & Pick<StoredFixture, "on" | "intensity" | "cct">
): StoredFixture {
  return {
    id,
    name,
    type: "astra-bicolor",
    definitionId: "litepanels-astra-bicolor",
    modeId: "default",
    universe: 1,
    dmxStartAddress: 1,
    kind: "profile",
    groupId: null,
    spatialX: null,
    spatialY: null,
    spatialRotation: 0,
    rigZ: null,
    beamAngleDegrees: null,
    effect: null,
    controls: {},
    hasCct: true,
    ...fields,
  };
}

const notThere = (id: string) => new Error(`Lighting fixture '${id}' is not exposed by the native editor state.`);
const sceneNotThere = (id: string) => new Error(`Lighting scene '${id}' is not exposed by the native editor state.`);

/** The populated rig: Key and Fill (Astra Bi-Color), Back (INFINIBAR PB12),
 *  and the scenes Warm wash and Interview. */
function linkLikeRig(options: { previewMode?: boolean; highlight?: string[]; solo?: string[] } = {}) {
  const fixtures: StoredFixture[] = [
    fixture("fixture-key", "Key", { on: true, intensity: 76, cct: 3200, groupId: "group-front", dmxStartAddress: 1 }),
    fixture("fixture-fill", "Fill", {
      on: true,
      intensity: 58,
      cct: 4300,
      groupId: "group-front",
      dmxStartAddress: 21,
    }),
    fixture("fixture-back", "Back", {
      on: false,
      intensity: 0,
      cct: 5600,
      groupId: "group-back",
      dmxStartAddress: 41,
      type: "infinibar-pb12",
      definitionId: "aputure-infinibar-pb12",
      kind: "practical",
    }),
  ];
  const state = (fixtureId: string, intensity: number, cct: number, on: boolean) => ({
    fixtureId,
    intensity,
    cct,
    on,
    controlValues: { intensity, cct },
  });
  const scenes: StoredScene[] = [
    {
      id: "scene-warm-wash",
      name: "Warm wash",
      states: [
        state("fixture-key", 76, 3200, true),
        state("fixture-fill", 58, 4300, true),
        state("fixture-back", 0, 5600, false),
      ],
      colorIndex: null,
      pinned: false,
    },
    {
      id: "scene-interview",
      name: "Interview",
      states: [
        state("fixture-key", 92, 4400, true),
        state("fixture-fill", 46, 4300, true),
        state("fixture-back", 18, 5600, true),
      ],
      colorIndex: null,
      pinned: false,
    },
  ];
  const groups = [
    { id: "group-front", name: "Front", fixtureCount: 2, colorIndex: null },
    { id: "group-back", name: "Back", fixtureCount: 1, colorIndex: null },
  ];
  let selectedFixtureId: string | null = "fixture-key";
  let highlight = options.highlight ?? [];
  let solo = options.solo ?? [];
  let highlightRejection: unknown = null;

  // `effective_fixture_control_values`: what a fixture reply, and a scene
  // saved or appended from it, carries.
  const effective = (entry: StoredFixture) => ({
    ...entry.controls,
    intensity: entry.intensity,
    ...(entry.hasCct ? { cct: entry.cct } : {}),
  });
  const snapshotOf = (stored: StoredFixture): LightingFixtureSnapshot => {
    const { controls: _controls, hasCct: _hasCct, ...entry } = stored;
    return { ...entry, controlValues: effective(stored) };
  };
  const withoutLevels = (values: Record<string, number> | undefined) =>
    Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => key !== "intensity" && key !== "cct"));

  const read = (): LightingSnapshot =>
    ({
      status: "ready",
      summary: "",
      adapterMode: "native",
      bridgeIp: "192.168.1.80",
      universe: 1,
      enabled: true,
      grandMaster: 100,
      connected: true,
      reachable: true,
      outputArmed: true,
      lastRecalledSceneId: null,
      lastSceneRecallAt: null,
      lastActionStatus: "succeeded",
      lastActionCode: null,
      lastActionMessage: null,
      selectedSceneId: null,
      selectedFixtureId,
      cameraMarker: null,
      subjectMarker: null,
      fixtures: fixtures.map(snapshotOf),
      groups: groups.map((group) => ({ ...group })),
      scenes: scenes.map((scene) => {
        const fixtureStates = fixtures.map((entry) => {
          const saved = scene.states.find((candidate) => candidate.fixtureId === entry.id);
          return saved
            ? {
                fixtureId: entry.id,
                intensity: saved.intensity,
                cct: Math.min(10_000, Math.max(2000, saved.cct)),
                on: saved.on,
                controlValues: withoutLevels(saved.controlValues),
              }
            : {
                fixtureId: entry.id,
                intensity: entry.intensity,
                cct: entry.cct,
                on: entry.on,
                controlValues: effective(entry),
              };
        });
        return {
          id: scene.id,
          name: scene.name,
          fixtureCount: fixtureStates.length,
          fixtureStates,
          lastRecalled: false,
          lastRecalledAt: null,
          fadeProgress: null,
          fadeDurationMs: null,
          pinned: scene.pinned,
          colorIndex: scene.colorIndex,
        };
      }),
      palettes: [],
      previewMode: options.previewMode ?? false,
      previewDirty: false,
      previewSceneId: null,
      previewFixtures: [],
      highlightFixtureIds: [...highlight],
      soloFixtureIds: [...solo],
    }) as LightingSnapshot;

  const listeners = new Set<() => void>();
  const shellState = (): ShellState =>
    ({
      lifecycle: "ready",
      recovery: "healthy",
      activeWorkspace: "lighting",
      appSnapshot: null,
      healthSnapshot: null,
      commissioningSnapshot: null,
      supportSnapshot: null,
      controlSurfaceSnapshot: null,
      lightingSnapshot: read(),
      lightingFixtureCatalogSnapshot: null,
      lightingDmxMonitorSnapshot: null,
      audioSnapshot: null,
      startupFailure: null,
      lastEvent: null,
      errorSummary: null,
      backgroundFailures: [],
      snapshotFault: null,
    }) as unknown as ShellState;
  let current = shellState();
  // As the store does, the rig is read again before a request's promise settles.
  const changed = () => {
    current = shellState();
    for (const listener of listeners) listener();
  };

  const store = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async createLightingScene(request: SceneCreate) {
      if (fixtures.length === 0) throw new Error("No lighting fixtures are available for scene creation.");
      for (const entry of request.fixtureStates ?? []) {
        if (!fixtures.some((candidate) => candidate.id === entry.fixtureId)) throw notThere(entry.fixtureId);
      }
      const scene: StoredScene = {
        id: nextId(
          "scene-custom-",
          scenes.map((entry) => entry.id)
        ),
        name: request.name,
        states: request.fixtureStates
          ? request.fixtureStates.map((entry) => ({ ...entry, controlValues: { ...entry.controlValues } }))
          : fixtures.map((entry) => ({
              fixtureId: entry.id,
              intensity: entry.intensity,
              cct: entry.cct,
              on: entry.on,
              controlValues: effective(entry),
            })),
        colorIndex: request.colorIndex ?? null,
        pinned: false,
      };
      scenes.push(scene);
      changed();
      return { scene: { id: scene.id, name: scene.name, fixtureStates: scene.states }, summary: "" };
    },
    async deleteLightingScene(sceneId: string) {
      const index = scenes.findIndex((scene) => scene.id === sceneId);
      if (index < 0) throw sceneNotThere(sceneId);
      scenes.splice(index, 1);
      changed();
      return { deleted: true, sceneId };
    },
    async pinLightingScene(sceneId: string, pinned: boolean) {
      const scene = scenes.find((entry) => entry.id === sceneId);
      if (!scene) throw sceneNotThere(sceneId);
      scene.pinned = pinned;
      changed();
      return {};
    },
    async setLightingSceneThumbs() {
      return {};
    },
    async createLightingFixture(request: FixtureCreate) {
      if (request.groupId && !groups.some((group) => group.id === request.groupId)) {
        throw new Error(`Lighting group '${request.groupId}' is not exposed by the native editor state.`);
      }
      // The INFINIBAR PB12's RGB pixel mode has no cct control, so its cct is 0
      // (`fixture_default_cct`); the Astra Bi-Color's default is 4400.
      const pixel = request.modeId === "pixel-rgb-48";
      const created = fixture(
        nextId(
          "fixture-custom-",
          fixtures.map((entry) => entry.id)
        ),
        request.name,
        {
          on: false,
          intensity: 100,
          cct: pixel ? 0 : request.definitionId === "litepanels-astra-bicolor" ? 4400 : 5600,
          type: request.type,
          definitionId: request.definitionId,
          modeId: request.modeId,
          universe: request.universe,
          dmxStartAddress: request.dmxStartAddress,
          groupId: request.groupId ?? null,
          controls: pixel ? { red: 0, green: 0, blue: 0 } : {},
          hasCct: !pixel,
        }
      );
      for (const scene of scenes) {
        scene.states.push({
          fixtureId: created.id,
          intensity: created.intensity,
          cct: created.cct,
          on: created.on,
          controlValues: effective(created),
        });
      }
      fixtures.push(created);
      changed();
      return { fixture: snapshotOf(created), summary: `Lighting fixture '${created.name}' was created.` };
    },
    async updateLightingFixture(request: FixtureUpdate) {
      const target = fixtures.find((entry) => entry.id === request.fixtureId);
      if (!target) throw notThere(request.fixtureId);
      const { fixtureId: _fixtureId, ...fields } = request;
      Object.assign(target, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
      changed();
      return { fixture: snapshotOf(target) };
    },
    async deleteLightingFixture(fixtureId: string) {
      const index = fixtures.findIndex((entry) => entry.id === fixtureId);
      if (index < 0) throw notThere(fixtureId);
      fixtures.splice(index, 1);
      for (const scene of scenes) scene.states = scene.states.filter((entry) => entry.fixtureId !== fixtureId);
      if (selectedFixtureId === fixtureId) selectedFixtureId = null;
      changed();
      return { deleted: true, fixtureId };
    },
    async deleteLightingGroup(groupId: string) {
      const index = groups.findIndex((group) => group.id === groupId);
      if (index < 0) throw new Error(`Lighting group '${groupId}' is not exposed by the native editor state.`);
      groups.splice(index, 1);
      for (const entry of fixtures) if (entry.groupId === groupId) entry.groupId = null;
      changed();
      return {};
    },
    async updateLightingSettings(request: { selectedFixtureId?: string | null }) {
      if (request.selectedFixtureId !== undefined) selectedFixtureId = request.selectedFixtureId;
      changed();
      return {};
    },
    async highlightLightingFixtures(fixtureIds: readonly string[], mode: "highlight" | "solo" | "off") {
      // Tauri's invoke rejects with the shell's plain string when the hardware
      // link is not running.
      if (highlightRejection !== null) return Promise.reject(highlightRejection);
      highlight = mode === "highlight" ? [...fixtureIds] : [];
      solo = mode === "solo" ? [...fixtureIds] : [];
      changed();
      return {};
    },
    async clearLightingIdentifyBursts() {
      return {};
    },
  };

  return {
    store: store as unknown as ShellStore,
    sceneNames: () => scenes.map((scene) => scene.name),
    fixtureNames: () => fixtures.map((entry) => entry.name),
    scene: (name: string) => read().scenes.find((scene) => scene.name === name),
    fixture: (name: string) => read().fixtures.find((entry) => entry.name === name),
    fixtureId: (name: string) => fixtures.find((entry) => entry.name === name)?.id,
    overlays: () => ({ highlight: [...highlight], solo: [...solo] }),
    rejectHighlight: (reason: unknown) => {
      highlightRejection = reason;
    },
    /** A change made where no step here records it: the Stream Deck's Save
     *  scene and Delete scene, say. */
    saveSceneElsewhere: (name: string) =>
      act(async () => {
        await store.createLightingScene({ name });
      }),
    deleteSceneElsewhere: (sceneId: string) =>
      act(async () => {
        await store.deleteLightingScene(sceneId);
      }),
    deleteFixtureElsewhere: (fixtureId: string) =>
      act(async () => {
        await store.deleteLightingFixture(fixtureId);
      }),
  };
}

let current: LightingEditor | null = null;

function Harness({ store }: { store: ShellStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  current = useLightingEditor({
    appSnapshot: state.appSnapshot,
    lightingFixtureCatalogSnapshot: state.lightingFixtureCatalogSnapshot,
    lightingDmxMonitorSnapshot: state.lightingDmxMonitorSnapshot,
    lightingSnapshot: state.lightingSnapshot,
    store,
  });
  return null;
}

function editor(): LightingEditor {
  if (!current) throw new Error("Lighting is not mounted");
  return current;
}

async function run(step: (lighting: LightingEditor) => unknown) {
  await act(async () => {
    await step(editor());
  });
}

/** The Undo key in the Rig section. */
const pressUndo = () => run((lighting) => lighting.rigControls.handleUndo());
const undoKeySays = () => editor().session.undoStack.nextLabel;
const lastMessage = () => (toast.push.mock.calls.at(-1)?.[0] as { message: string } | undefined)?.message;

const astra = {
  type: "astra-bicolor",
  definitionId: "litepanels-astra-bicolor",
  modeId: "default",
  universe: 1,
  dmxStartAddress: 81,
};

beforeEach(() => {
  toast.push.mockClear();
  current = null;
});

afterEach(() => {
  cleanup();
});

// Finding 17: an undo step acted on the id its scene or fixture had when the
// step was taken. A step that could never succeed went back on top, so the
// Undo key stuck on it; one whose id had been given out again undid the wrong
// scene.
describe("the Undo key follows a scene or fixture through the ids an undo gives it", () => {
  it("Delete scene Interview, then Delete fixture Back: Back comes back, then Interview holding Back's state", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-interview"));
    await run((lighting) => lighting.fixtureEditor.handleDeleteFixture("fixture-back"));
    expect(undoKeySays()).toBe("Delete fixture Back");

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Delete fixture Back’.");
    expect(rig.fixtureId("Back")).toBe("fixture-custom-1");
    expect(undoKeySays()).toBe("Delete scene Interview");

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Delete scene Interview’.");
    expect(rig.scene("Interview")?.fixtureStates).toEqual([
      expect.objectContaining({ fixtureId: "fixture-key", intensity: 92, on: true }),
      expect.objectContaining({ fixtureId: "fixture-fill", intensity: 46, on: true }),
      expect.objectContaining({ fixtureId: "fixture-custom-1", intensity: 18, on: true }),
    ]);
    expect(undoKeySays()).toBeNull();
  });

  it("Save Scene 3 and Scene 4, delete 3 then 4: three undos take Scene 4 away and leave Scene 3", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.sceneEditor.handleSaveScene("Scene 3"));
    await run((lighting) => lighting.sceneEditor.handleSaveScene("Scene 4"));
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-custom-1"));
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-custom-2"));

    // Scene 4 comes back as scene-custom-1, then Scene 3 as scene-custom-2.
    await pressUndo();
    await pressUndo();
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview", "Scene 4", "Scene 3"]);
    expect(undoKeySays()).toBe("Save scene Scene 4");

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Save scene Scene 4’.");
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview", "Scene 3"]);
    expect(undoKeySays()).toBe("Save scene Scene 3");
  });

  it("Save Base, S and T, delete S: three undos take S away and the key names Save scene Base", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    for (const name of ["Base", "S", "T"]) await run((lighting) => lighting.sceneEditor.handleSaveScene(name));
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-custom-2"));

    // S comes back as scene-custom-4: the highest in use is T's 3.
    await pressUndo();
    await pressUndo();
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview", "Base", "S"]);

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Save scene S’.");
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview", "Base"]);
    expect(undoKeySays()).toBe("Save scene Base");
  });

  // The same id names different scenes at different times, so a map from old
  // ids to new ones is not enough: S is brought back twice here, as
  // scene-custom-3 and then scene-custom-5, while its Save step still names
  // scene-custom-1.
  it("a scene deleted and brought back twice is still the one its Save step takes away", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.sceneEditor.handleSaveScene("S"));
    await run((lighting) => lighting.sceneEditor.handleSaveScene("T"));
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-custom-1"));
    await pressUndo();
    await run((lighting) => lighting.sceneEditor.handleSaveScene("U"));
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-custom-3"));
    await pressUndo();
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview", "T", "U", "S"]);

    for (const step of ["Save scene U", "Save scene T", "Save scene S"]) {
      expect(undoKeySays()).toBe(step);
      await pressUndo();
      expect(lastMessage()).toBe(`Undid ‘${step}’.`);
    }
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview"]);
    expect(undoKeySays()).toBeNull();
  });

  it("a step whose scene or fixture was deleted elsewhere is refused, and the key moves on to the older step", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.sceneEditor.handleSaveScene("Base"));
    await run((lighting) => lighting.fixtureEditor.handleAddFixture({ ...astra, name: "Stand 4" }));
    await run((lighting) => lighting.sceneEditor.handleSaveScene("S"));

    await rig.deleteSceneElsewhere("scene-custom-2");
    await pressUndo();
    expect(lastMessage()).toBe("Cannot undo ‘Save scene S’: the scene has been deleted.");
    expect(undoKeySays()).toBe("Add fixture Stand 4");

    await rig.deleteFixtureElsewhere("fixture-custom-1");
    await pressUndo();
    expect(lastMessage()).toBe("Cannot undo ‘Add fixture Stand 4’: the fixture has been deleted.");
    expect(undoKeySays()).toBe("Save scene Base");

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Save scene Base’.");
    expect(rig.sceneNames()).toEqual(["Warm wash", "Interview"]);
  });

  it("a deleted scene comes back without the fixtures deleted since, and not at all when none is left", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.sceneEditor.handleDeleteScene("scene-interview"));
    await rig.deleteFixtureElsewhere("fixture-back");
    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Delete scene Interview’.");
    expect(rig.scene("Interview")?.fixtureStates.map((state) => state.fixtureId)).toEqual([
      "fixture-key",
      "fixture-fill",
    ]);

    const restoredId = rig.scene("Interview")!.id;
    await run((lighting) => lighting.sceneEditor.handleDeleteScene(restoredId));
    await rig.deleteFixtureElsewhere("fixture-key");
    await rig.deleteFixtureElsewhere("fixture-fill");
    await pressUndo();
    expect(lastMessage()).toBe("Cannot undo ‘Delete scene Interview’: every fixture it held has been deleted.");
    expect(undoKeySays()).toBeNull();
  });

  it("Delete fixture Back after its group went: the undo brings Back back without a group", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.fixtureEditor.handleDeleteFixture("fixture-back"));
    await run((lighting) => lighting.rigControls.handleDeleteGroup("group-back", "Back"));
    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Delete fixture Back’.");
    expect(rig.fixture("Back")).toMatchObject({ id: "fixture-custom-1", groupId: null, dmxStartAddress: 41 });
    expect(undoKeySays()).toBeNull();
  });
});

// Finding 15: the reply to Add fixture carries `intensity` (and a cct fixture's
// `cct`) in its control values, and a cct of 0 for a fixture without colour
// temperature; the scenes read back carry neither. Every scene at the add
// counted, so the add's Undo was refused whenever a scene existed.
describe("the Undo of Add fixture, on the hardware link's shapes", () => {
  it("takes an added Astra Bi-Color off again although every scene holds it", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.fixtureEditor.handleAddFixture({ ...astra, name: "Stand 4" }));
    expect(rig.scene("Interview")?.fixtureStates.at(-1)).toEqual({
      fixtureId: "fixture-custom-1",
      intensity: 100,
      cct: 4400,
      on: false,
      controlValues: {},
    });

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Add fixture Stand 4’.");
    expect(rig.fixtureNames()).toEqual(["Key", "Fill", "Back"]);
  });

  it("takes an added INFINIBAR PB12 in its RGB pixel mode off again: no colour temperature, cct 0", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) =>
      lighting.fixtureEditor.handleAddFixture({
        name: "Bar 2",
        type: "infinibar-pb12",
        definitionId: "aputure-infinibar-pb12",
        modeId: "pixel-rgb-48",
        universe: 1,
        dmxStartAddress: 101,
      })
    );
    expect(rig.scene("Warm wash")?.fixtureStates.at(-1)).toEqual({
      fixtureId: "fixture-custom-1",
      intensity: 100,
      cct: 2000,
      on: false,
      controlValues: { red: 0, green: 0, blue: 0 },
    });

    await pressUndo();
    expect(lastMessage()).toBe("Undid ‘Add fixture Bar 2’.");
    expect(rig.fixtureNames()).toEqual(["Key", "Fill", "Back"]);
  });

  it("is still refused while a scene saved after the add holds the fixture", async () => {
    const rig = linkLikeRig();
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.fixtureEditor.handleAddFixture({ ...astra, name: "Stand 4" }));
    await rig.saveSceneElsewhere("Scene 3");
    await pressUndo();
    expect(lastMessage()).toBe(
      "Cannot undo ‘Add fixture Stand 4’: fixture is referenced by 1 scene saved after it was added."
    );
    expect(rig.fixtureNames()).toEqual(["Key", "Fill", "Back", "Stand 4"]);
  });
});

// Finding 16: the Highlight and Solo keys were disabled all through Preview and
// their handlers refused there before switching off, so with the page-wide Esc
// gone a live Highlight or Solo could not be ended from the page while
// previewing.
describe("Highlight and Solo in Preview", () => {
  it("pressing the lit Solo key switches Solo off on the rig; unlit, it still waits for the live rig", async () => {
    const rig = linkLikeRig({ previewMode: true, solo: ["fixture-key"] });
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.fixtureEditor.handleToggleSolo());
    expect(rig.overlays().solo).toEqual([]);
    expect(lastMessage()).toBeUndefined();

    await run((lighting) => lighting.fixtureEditor.handleToggleSolo());
    expect(rig.overlays().solo).toEqual([]);
    expect(lastMessage()).toBe("Exit preview to use live Solo.");
  });

  it("pressing the lit Highlight key switches Highlight off on the rig; unlit, it still waits", async () => {
    const rig = linkLikeRig({ previewMode: true, highlight: ["fixture-key"] });
    render(<Harness store={rig.store} />);
    await run((lighting) => lighting.fixtureEditor.handleToggleHighlight());
    expect(rig.overlays().highlight).toEqual([]);
    expect(lastMessage()).toBeUndefined();

    await run((lighting) => lighting.fixtureEditor.handleToggleHighlight());
    expect(rig.overlays().highlight).toEqual([]);
    expect(lastMessage()).toBe("Exit preview to use live Highlight.");
  });
});

// Finding 19: Highlight and Solo are cleared when Lighting closes. If that
// fails, the message is read on the page the operator went to, where there is
// no lit key: it names the way back.
describe("leaving Lighting while Highlight or Solo is on", () => {
  it.each([
    ["Highlight", { highlight: ["fixture-key"] }],
    ["Solo", { solo: ["fixture-key"] }],
  ])("when %s cannot be cleared, the message says to open Lighting and press the lit key", async (_name, overlay) => {
    const rig = linkLikeRig(overlay);
    const view = render(<Harness store={rig.store} />);
    rig.rejectHighlight("Engine is not running");
    await act(async () => {
      view.unmount();
    });
    await vi.waitFor(() =>
      expect(toast.push).toHaveBeenCalledWith({
        message: "Could not clear Highlight and Solo. Open Lighting and press the lit Highlight or Solo key.",
        tone: "error",
      })
    );
  });
});
