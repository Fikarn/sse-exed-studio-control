import { Readouts, Section } from "@sse/design-system";
import type { LightingFixtureSnapshot, LightingSceneSnapshot } from "@sse/engine-client";

// Visual overhaul A, Slice 5b (A-lighting.html's plate): what the saved scene
// holds for the fixture in front of the operator — so "the rig has drifted" can
// be read fixture by fixture, not just as a word in the state display. Every
// value is the engine's; nothing here is inferred.

export interface LightingPlateSceneValuesProps {
  channelCount?: number | null;
  fixture: LightingFixtureSnapshot;
  overlapNote?: string | null;
  scene: LightingSceneSnapshot | null;
}

// The address the fixture answers on, printed where the operator can read it
// without leaving for patch mode.
export function LightingPlatePatchFacts({
  channelCount,
  fixture,
  overlapNote,
}: Pick<LightingPlateSceneValuesProps, "channelCount" | "fixture" | "overlapNote">) {
  const span =
    channelCount && channelCount > 1
      ? `${fixture.dmxStartAddress}–${fixture.dmxStartAddress + channelCount - 1}`
      : String(fixture.dmxStartAddress);
  return (
    <Section
      title="Patch"
      detail={overlapNote ?? `no overlaps on universe ${fixture.universe}`}
      data-plate-section="patch-facts"
      testId="lighting-plate-patch-facts"
    >
      <Readouts
        rows={[
          { id: "start", label: "DMX start", value: span },
          {
            id: "mode",
            label: "Mode",
            value: channelCount ? `${channelCount} ch` : `not in the catalog (${fixture.modeId})`,
          },
          { id: "universe", label: "Universe", value: `U${fixture.universe}` },
        ]}
      />
    </Section>
  );
}

export function LightingPlateSceneValues({ fixture, scene }: LightingPlateSceneValuesProps) {
  const saved = scene?.fixtureStates.find((entry) => entry.fixtureId === fixture.id) ?? null;

  return (
    <Section
      title={scene ? `In scene ${scene.name}` : "In scene"}
      detail={scene ? "what the saved scene holds" : "no scene recalled"}
      data-plate-section="scene-values"
      testId="lighting-plate-scene-values"
    >
      {scene && saved ? (
        <Readouts
          rows={[
            { id: "state", label: "Saved state", value: saved.on ? "on" : "off" },
            { id: "intensity", label: "Saved intensity", value: `${Math.round(saved.intensity)} %` },
            { id: "cct", label: "Saved colour temperature", value: `${Math.round(saved.cct)} K` },
            {
              id: "now",
              label: "On the rig now",
              value: fixture.on ? `${Math.round(fixture.intensity)} % · ${Math.round(fixture.cct)} K` : "off",
              tone:
                saved.on === fixture.on &&
                Math.round(saved.intensity) === Math.round(fixture.intensity) &&
                Math.round(saved.cct) === Math.round(fixture.cct)
                  ? "ok"
                  : "attention",
            },
          ]}
        />
      ) : (
        <Readouts
          rows={[
            {
              id: "none",
              label: scene ? "This fixture" : "No scene",
              value: scene ? "is not in this scene" : "recall a scene to compare",
            },
          ]}
        />
      )}
    </Section>
  );
}
