// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asRecord, asNumber, asString, asArray } from "./json";

export function fixtureControl(
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  unit?: string
): JsonObject {
  return {
    id,
    label,
    kind: "slider",
    valueType: "number",
    min,
    max,
    step: id === "cct" ? 100 : 1,
    defaultValue,
    unit: unit ?? null,
    options: [],
  };
}

export function fixtureChannel(
  offset: number,
  label: string,
  controlId: string,
  valueType = "percent",
  defaultDmx = 0
): JsonObject {
  return {
    offset,
    label,
    controlId,
    valueType,
    defaultDmx,
  };
}

export function fixtureMode(
  id: string,
  displayName: string,
  channels: JsonObject[],
  controls: JsonObject[],
  capabilities: string[],
  defaults: Record<string, number> = {}
): JsonObject {
  return {
    id,
    displayName,
    channelCount: channels.length,
    resolution: displayName.includes("16-bit") ? "16-bit" : "8-bit",
    capabilities,
    channels,
    controls,
    defaults,
  };
}

export function fixtureDefinition(
  id: string,
  manufacturer: string,
  family: string,
  model: string,
  kind: string,
  defaultModeId: string,
  modes: JsonObject[],
  visual: JsonObject,
  status = "verified"
): JsonObject {
  const enrichedVisual = withFixtureVisualMetadata(id, family, kind, status, visual);
  return {
    id,
    manufacturer,
    family,
    model,
    displayName: `${family} ${model}`.trim(),
    status,
    sourceUrl: manufacturer === "Aputure" ? "https://help.aputure.com/" : "https://www.litepanels.com/",
    sourceVersion: status === "verified" ? "Fixture transport catalog mirror" : "Profile verification required",
    sourceDate: "2026-05-03",
    kind,
    defaultModeId,
    modes,
    visual: enrichedVisual,
  };
}

export const FIXTURE_VISUAL_BEAM_ANGLES: Record<string, { max: number; min: number }> = {
  "aputure-infinibar-pb12": { min: 120, max: 120 },
  "aputure-infinimat-generic": { min: 100, max: 100 },
  "aputure-ls-600d-pro": { min: 15, max: 60 },
  "aputure-storm-1200x": { min: 12, max: 60 },
  "aputure-storm-80c": { min: 35, max: 60 },
  "litepanels-astra-bicolor": { min: 50, max: 50 },
  "litepanels-astra-ip": { min: 30, max: 30 },
  "litepanels-gemini-1x1": { min: 90, max: 90 },
  "litepanels-gemini-2x1": { min: 90, max: 90 },
  "litepanels-studio-x-bicolor": { min: 8, max: 70 },
};

export function symbolKindForVisualShape(shape: string) {
  switch (shape) {
    case "bar":
      return "linear-bar";
    case "control-node":
      return "control-node";
    case "mat":
      return "soft-mat";
    case "panel":
      return "panel";
    case "fresnel":
    default:
      return "fresnel";
  }
}

export function symbolVariantForFixtureDefinition(id: string, family: string, symbolKind: string) {
  switch (id) {
    case "aputure-infinibar-pb12":
      return "infinibar-pb12";
    case "aputure-infinimat-generic":
      return "infinimat";
    case "litepanels-apollo-bridge":
      return "apollo-bridge";
    case "litepanels-astra-bicolor":
      return "astra";
    case "litepanels-astra-ip":
      return "astra-ip";
    case "litepanels-gemini-1x1":
    case "litepanels-gemini-2x1":
      return "gemini";
    case "aputure-ls-600d-pro":
      return "light-storm";
    case "aputure-storm-80c":
    case "aputure-storm-1200x":
      return "storm";
    case "litepanels-studio-x-bicolor":
    case "litepanels-studio-x-daylight":
      return "studio-x";
    default:
      if (symbolKind === "panel") {
        if (family === "Astra") return "astra";
        if (family === "Astra IP") return "astra-ip";
        if (family === "Gemini") return "gemini";
        return "panel";
      }
      if (symbolKind === "fresnel") {
        if (family === "Light Storm") return "light-storm";
        if (family === "STORM") return "storm";
        if (family === "Studio X") return "studio-x";
        return "fresnel";
      }
      return symbolKind;
  }
}

export function beamTypeForVisualShape(shape: string) {
  switch (shape) {
    case "bar":
      return "rectangle";
    case "control-node":
      return "none";
    case "mat":
    case "panel":
      return "wash";
    case "fresnel":
    default:
      return "fresnel";
  }
}

export function visualConfidenceForFixtureDefinition(id: string, status: string) {
  if (status === "research-needed") return "fallback";
  if (id === "aputure-infinibar-pb12" || id === "litepanels-apollo-bridge") return "verified";
  return "catalogue-derived";
}

export function photometricSamplesForFixtureDefinition(id: string): JsonObject[] {
  if (id !== "aputure-infinibar-pb12") return [];
  return [
    {
      cct: 5600,
      distanceMeters: 0.5,
      lux: 1600,
      modifier: "none",
      source: "Aputure INFINIBAR PB12 product page",
    },
    {
      cct: 5600,
      distanceMeters: 1.0,
      lux: 593,
      modifier: "none",
      source: "Aputure INFINIBAR PB12 product page",
    },
  ];
}

export function emitterLayoutForVisual(id: string, symbolKind: string, visual: JsonObject): JsonObject | null {
  const pixelLayout = asRecord(visual.pixelLayout);
  if (!pixelLayout) return null;
  return {
    emitterKind: symbolKind === "linear-bar" ? "pixel-line" : symbolKind === "soft-mat" ? "pixel-mat" : "pixel-grid",
    rows: Math.max(1, Math.round(asNumber(pixelLayout.rows, 1))),
    columns: Math.max(1, Math.round(asNumber(pixelLayout.columns, 1))),
    segments: Math.max(1, Math.round(asNumber(pixelLayout.segments, 1))),
    physicalPixels: id === "aputure-infinibar-pb12" ? 96 : null,
    direction: asString(pixelLayout.order, "row-major"),
  };
}

export function withFixtureVisualMetadata(
  id: string,
  family: string,
  kind: string,
  status: string,
  visual: JsonObject
): JsonObject {
  const shape = asString(visual.shape, kind === "panel" ? "panel" : "fresnel");
  const beamAngles = FIXTURE_VISUAL_BEAM_ANGLES[id];
  const beamAngleMin = typeof visual.beamAngleMin === "number" ? visual.beamAngleMin : (beamAngles?.min ?? null);
  const beamAngleMax = typeof visual.beamAngleMax === "number" ? visual.beamAngleMax : (beamAngles?.max ?? null);
  const symbolKind = symbolKindForVisualShape(shape);
  const beamType = beamTypeForVisualShape(shape);
  const output = {
    beamType,
    beamAngle: beamType === "none" ? null : (beamAngleMax ?? beamAngleMin),
    fieldAngle: beamType === "none" ? null : typeof visual.fieldAngle === "number" ? visual.fieldAngle : null,
    photometricSamples: photometricSamplesForFixtureDefinition(id),
  };

  return {
    ...visual,
    shape,
    symbolKind,
    symbolVariant: symbolVariantForFixtureDefinition(id, family, symbolKind),
    beamAngleMin,
    beamAngleMax,
    fieldAngle: typeof visual.fieldAngle === "number" ? visual.fieldAngle : null,
    emitterLayout: emitterLayoutForVisual(id, symbolKind, visual),
    output,
    visualConfidence: visualConfidenceForFixtureDefinition(id, status),
  };
}

export function noDmxMode() {
  return fixtureMode("default", "No DMX profile", [], [], [], {});
}

export function repeatedPixelChannels(pixelCount: number, labels: string[]) {
  const channels: JsonObject[] = [];
  for (let pixel = 1; pixel <= pixelCount; pixel += 1) {
    for (const label of labels) {
      channels.push(
        fixtureChannel(
          channels.length + 1,
          `Px ${pixel} ${label}`,
          label.toLowerCase().replace(/[ /]/g, "-"),
          label === "CCT" ? "kelvin" : "percent"
        )
      );
    }
  }
  return channels;
}

export function buildDefaultLightingFixtureCatalogSnapshot(): JsonObject {
  const cctDefaults = (min: number, max: number, cct: number) => ({ intensity: 100, cct, cctMin: min, cctMax: max });
  const cctControls = (min: number, max: number, cct: number) => [
    fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
    fixtureControl("cct", "CCT", min, max, cct, "K"),
    fixtureControl("green-magenta", "Green/Magenta", -100, 100, 0),
    fixtureControl("fan", "Fan", 0, 255, 0),
  ];
  const hsiControls = (min: number, max: number, cct: number) => [
    ...cctControls(min, max, cct),
    fixtureControl("hue", "Hue", 0, 359, 0, "deg"),
    fixtureControl("saturation", "Saturation", 0, 100, 0, "%"),
  ];
  const visual = (
    shape: string,
    widthMm: number,
    heightMm: number,
    depthMm: number,
    pixelLayout: JsonObject | null = null
  ) => ({
    shape,
    widthMm,
    heightMm,
    depthMm,
    beamAngleMin: null,
    beamAngleMax: null,
    fieldAngle: null,
    pixelLayout,
  });
  const astraMode = fixtureMode(
    "default",
    "2 ch Dimmer + CCT",
    [fixtureChannel(1, "Dimmer", "intensity"), fixtureChannel(2, "CCT", "cct", "kelvin", 68)],
    [fixtureControl("intensity", "Intensity", 0, 100, 100, "%"), fixtureControl("cct", "CCT", 3200, 5600, 4400, "K")],
    ["intensity", "cct"],
    cctDefaults(3200, 5600, 4400)
  );
  const definitions = [
    fixtureDefinition(
      "litepanels-astra-bicolor",
      "Litepanels",
      "Astra",
      "Bi-Color",
      "profile",
      "default",
      [astraMode],
      visual("panel", 450, 300, 90)
    ),
    fixtureDefinition(
      "aputure-infinimat-generic",
      "Aputure",
      "INFINIMAT",
      "Generic mat profile",
      "wash",
      "default",
      [
        fixtureMode(
          "default",
          "4 ch Dimmer + CCT + Green/Magenta + Strobe",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 102),
            fixtureChannel(3, "+/- G/M", "green-magenta", "offset", 127),
            fixtureChannel(4, "Strobe", "strobe", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
            fixtureControl("green-magenta", "Green/Magenta", -100, 100, 0),
            fixtureControl("strobe", "Strobe", 0, 255, 0),
          ],
          ["intensity", "cct", "green-magenta", "strobe"],
          cctDefaults(2000, 10000, 5600)
        ),
        fixtureMode(
          "le-1x4-rgbww-8bit",
          "1x4 light-engine RGBWW 20 ch",
          repeatedPixelChannels(4, ["Dimmer", "CCT", "Red", "Green", "Blue"]),
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
          ],
          ["intensity", "cct", "rgb", "pixel"],
          cctDefaults(2000, 10000, 5600)
        ),
      ],
      visual("mat", 1220, 305, 80, { pixelCount: 4, rows: 1, columns: 4, segments: 4, order: "row-major" })
    ),
    fixtureDefinition(
      "aputure-infinibar-pb12",
      "Aputure",
      "INFINIBAR",
      "PB12",
      "practical",
      "default",
      [
        fixtureMode(
          "default",
          "8 ch basic RGBWW",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 102),
            fixtureChannel(3, "Mix", "mix"),
            fixtureChannel(4, "Red", "red"),
            fixtureChannel(5, "Green", "green"),
            fixtureChannel(6, "Blue", "blue"),
            fixtureChannel(7, "FX", "fx", "range"),
            fixtureChannel(8, "Speed", "speed", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
            fixtureControl("red", "Red", 0, 255, 0),
            fixtureControl("green", "Green", 0, 255, 0),
            fixtureControl("blue", "Blue", 0, 255, 0),
            fixtureControl("fx", "FX", 0, 255, 0),
            fixtureControl("speed", "Speed", 0, 255, 0),
          ],
          ["intensity", "cct", "rgb", "fx"],
          cctDefaults(2000, 10000, 5600)
        ),
        fixtureMode(
          "pixel-rgb-48",
          "48 px RGB pixel map 144 ch",
          repeatedPixelChannels(48, ["Red", "Green", "Blue"]),
          [
            fixtureControl("red", "Red", 0, 255, 0),
            fixtureControl("green", "Green", 0, 255, 0),
            fixtureControl("blue", "Blue", 0, 255, 0),
          ],
          ["rgb", "pixel"],
          { red: 0, green: 0, blue: 0 }
        ),
      ],
      visual("bar", 1200, 45, 45, { pixelCount: 48, rows: 1, columns: 48, segments: 48, order: "left-to-right" })
    ),
    fixtureDefinition(
      "litepanels-apollo-bridge",
      "Litepanels",
      "Apollo",
      "Bridge",
      "control-node",
      "default",
      [noDmxMode()],
      visual("control-node", 180, 120, 40)
    ),
    fixtureDefinition(
      "aputure-ls-600d-pro",
      "Aputure",
      "Light Storm",
      "LS 600d Pro",
      "beam",
      "5ch-fx",
      [
        fixtureMode(
          "5ch-fx",
          "5 ch Dimmer + FX",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "Mode Selection", "mode", "range"),
            fixtureChannel(3, "FX Control", "fx", "range"),
            fixtureChannel(4, "FX Frequency", "speed", "range"),
            fixtureChannel(5, "FX Trigger", "trigger", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("fx", "FX", 0, 255, 0),
            fixtureControl("speed", "Speed", 0, 255, 0),
          ],
          ["intensity", "fx"],
          cctDefaults(5600, 5600, 5600)
        ),
      ],
      visual("fresnel", 335, 338, 557)
    ),
    fixtureDefinition(
      "aputure-storm-80c",
      "Aputure",
      "STORM",
      "80c",
      "beam",
      "cct-rgb-8bit-7ch",
      [
        fixtureMode(
          "cct-rgb-8bit-7ch",
          "CCT & RGB 8-bit 7 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 49),
            fixtureChannel(3, "+/- Green", "green-magenta", "offset", 127),
            fixtureChannel(4, "Red", "red"),
            fixtureChannel(5, "Green", "green"),
            fixtureChannel(6, "Blue", "blue"),
            fixtureChannel(7, "Color Crossfade", "mix"),
          ],
          hsiControls(1800, 20000, 5600),
          ["intensity", "cct", "rgb", "green-magenta"],
          cctDefaults(1800, 20000, 5600)
        ),
        fixtureMode(
          "hsic-control-16bit-13ch",
          "Limited HSIC+ Control 16-bit 13 ch",
          [
            fixtureChannel(1, "Dimmer coarse", "intensity"),
            fixtureChannel(2, "Dimmer fine", "intensity", "fine"),
            fixtureChannel(3, "Hue coarse", "hue", "degrees"),
            fixtureChannel(4, "Hue fine", "hue", "fine"),
            fixtureChannel(5, "Saturation coarse", "saturation"),
            fixtureChannel(6, "Saturation fine", "saturation", "fine"),
            fixtureChannel(7, "CCT coarse", "cct", "kelvin", 49),
            fixtureChannel(8, "CCT fine", "cct", "fine"),
            fixtureChannel(9, "+/- Green coarse", "green-magenta", "offset", 127),
            fixtureChannel(10, "+/- Green fine", "green-magenta", "fine"),
            fixtureChannel(11, "Control", "control", "range"),
            fixtureChannel(12, "Fan", "fan", "range"),
            fixtureChannel(13, "Dimming Curve", "dimming-curve", "range"),
          ],
          hsiControls(1800, 20000, 5600),
          ["intensity", "hsi", "cct", "green-magenta", "control"],
          cctDefaults(1800, 20000, 5600)
        ),
      ],
      visual("fresnel", 167, 225, 147)
    ),
    fixtureDefinition(
      "aputure-storm-1200x",
      "Aputure",
      "STORM",
      "1200x",
      "beam",
      "cct-plus-8bit-3ch",
      [
        fixtureMode(
          "cct-plus-8bit-3ch",
          "CCT+ 8-bit 3 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 91),
            fixtureChannel(3, "+/- Green", "green-magenta", "offset", 127),
          ],
          cctControls(2500, 10000, 5600),
          ["intensity", "cct", "green-magenta"],
          cctDefaults(2500, 10000, 5600)
        ),
      ],
      visual("fresnel", 335, 338, 557)
    ),
    fixtureDefinition(
      "litepanels-astra-ip",
      "Litepanels",
      "Astra IP",
      "Astra IP",
      "profile",
      "p02-cct-8bit",
      [
        fixtureMode(
          "p01-cct-rgbw-8bit",
          "P01 CCT & RGBW 8-bit 12 ch",
          Array.from({ length: 12 }, (_, index) =>
            fixtureChannel(
              index + 1,
              [
                "Dimmer",
                "CCT",
                "Green Offset",
                "White/RGB Crossfade",
                "Red",
                "Green",
                "Blue",
                "White",
                "Fan",
                "Reserved",
                "Reserved",
                "Reserved",
              ][index]!,
              [
                "intensity",
                "cct",
                "green-magenta",
                "mix",
                "red",
                "green",
                "blue",
                "white",
                "fan",
                "reserved",
                "reserved",
                "reserved",
              ][index]!
            )
          ),
          cctControls(2700, 6500, 3200),
          ["intensity", "cct", "rgb", "fan"],
          cctDefaults(2700, 6500, 3200)
        ),
        fixtureMode(
          "p02-cct-8bit",
          "P02 CCT 8-bit 6 ch",
          Array.from({ length: 6 }, (_, index) =>
            fixtureChannel(
              index + 1,
              ["Dimmer", "CCT", "Green Offset", "Reserved", "DMX Mode Control", "Fan"][index]!,
              ["intensity", "cct", "green-magenta", "reserved", "mode", "fan"][index]!
            )
          ),
          cctControls(2700, 6500, 3200),
          ["intensity", "cct", "green-magenta", "fan"],
          cctDefaults(2700, 6500, 3200)
        ),
      ],
      visual("panel", 450, 300, 110)
    ),
    ...["1x1", "2x1"].map((model) =>
      fixtureDefinition(
        `litepanels-gemini-${model}`,
        "Litepanels",
        "Gemini",
        model,
        "wash",
        "p02-cct-8bit",
        [
          fixtureMode(
            "p02-cct-8bit",
            "P02 CCT 8-bit 6 ch",
            Array.from({ length: 6 }, (_, index) =>
              fixtureChannel(
                index + 1,
                ["Dimmer", "CCT", "Green Offset", "Reserved", "DMX Mode Control", "Fan"][index]!,
                ["intensity", "cct", "green-magenta", "reserved", "mode", "fan"][index]!
              )
            ),
            cctControls(2700, 10000, 3200),
            ["intensity", "cct", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p03-cct-hsi-8bit",
            "P03 CCT & HSI 8-bit 10 ch",
            Array.from({ length: 10 }, (_, index) =>
              fixtureChannel(
                index + 1,
                [
                  "Dimmer",
                  "CCT",
                  "Green Offset",
                  "White/HSI Crossfade",
                  "Hue",
                  "Saturation",
                  "Fan",
                  "Reserved",
                  "Reserved",
                  "Reserved",
                ][index]!,
                [
                  "intensity",
                  "cct",
                  "green-magenta",
                  "mix",
                  "hue",
                  "saturation",
                  "fan",
                  "reserved",
                  "reserved",
                  "reserved",
                ][index]!
              )
            ),
            hsiControls(2700, 10000, 3200),
            ["intensity", "cct", "hsi", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p07-cct-16bit",
            "P07 CCT 16-bit 8 ch",
            Array.from({ length: 8 }, (_, index) =>
              fixtureChannel(
                index + 1,
                [
                  "Dimmer coarse",
                  "Dimmer fine",
                  "CCT coarse",
                  "CCT fine",
                  "Green Offset coarse",
                  "Green Offset fine",
                  "DMX Mode Control",
                  "Fan",
                ][index]!,
                ["intensity", "intensity", "cct", "cct", "green-magenta", "green-magenta", "mode", "fan"][index]!
              )
            ),
            cctControls(2700, 10000, 3200),
            ["intensity", "cct", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p08-cct-hsi-16bit",
            "P08 CCT & HSI 16-bit 16 ch",
            Array.from({ length: 16 }, (_, index) =>
              fixtureChannel(
                index + 1,
                `Channel ${index + 1}`,
                [
                  "intensity",
                  "intensity",
                  "cct",
                  "cct",
                  "green-magenta",
                  "green-magenta",
                  "mix",
                  "mix",
                  "hue",
                  "hue",
                  "saturation",
                  "saturation",
                  "fan",
                  "reserved",
                  "reserved",
                  "reserved",
                ][index]!
              )
            ),
            hsiControls(2700, 10000, 3200),
            ["intensity", "cct", "hsi", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
        ],
        visual("panel", 635, 305, 150)
      )
    ),
    fixtureDefinition(
      "litepanels-studio-x-bicolor",
      "Litepanels",
      "Studio X",
      "Bi-Color",
      "profile",
      "bicolor-8bit",
      [
        fixtureMode(
          "bicolor-8bit",
          "Bi-Color 8-bit 3 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 60),
            fixtureChannel(3, "Spot/Flood", "zoom"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2700, 6500, 3200, "K"),
            fixtureControl("zoom", "Spot/Flood", 0, 100, 0, "%"),
          ],
          ["intensity", "cct", "zoom"],
          cctDefaults(2700, 6500, 3200)
        ),
        fixtureMode(
          "bicolor-16bit",
          "Bi-Color 16-bit 6 ch",
          Array.from({ length: 6 }, (_, index) =>
            fixtureChannel(
              index + 1,
              ["Dimmer coarse", "Dimmer fine", "CCT coarse", "CCT fine", "Spot/Flood coarse", "Spot/Flood fine"][
                index
              ]!,
              ["intensity", "intensity", "cct", "cct", "zoom", "zoom"][index]!
            )
          ),
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2700, 6500, 3200, "K"),
            fixtureControl("zoom", "Spot/Flood", 0, 100, 0, "%"),
          ],
          ["intensity", "cct", "zoom"],
          cctDefaults(2700, 6500, 3200)
        ),
      ],
      visual("fresnel", 300, 300, 420)
    ),
    ...[
      ["aputure-ls-600d", "Aputure", "Light Storm", "LS 600d", "beam"],
      ["aputure-ls-600x-pro", "Aputure", "Light Storm", "LS 600x Pro", "beam"],
      ["aputure-ls-600c-pro", "Aputure", "Light Storm", "LS 600c Pro", "beam"],
      ["aputure-ls-1200d-pro", "Aputure", "Light Storm", "LS 1200d Pro", "beam"],
      ["aputure-storm-1000c", "Aputure", "STORM", "1000c", "beam"],
      ["aputure-electro-storm-cs15", "Aputure", "Electro Storm", "CS15", "beam"],
      ["aputure-electro-storm-xt26", "Aputure", "Electro Storm", "XT26", "beam"],
      ["aputure-nova-p300c", "Aputure", "NOVA", "P300c", "panel"],
      ["aputure-nova-p600c", "Aputure", "NOVA", "P600c", "panel"],
      ["aputure-nova-ii", "Aputure", "NOVA II", "Series", "panel"],
      ["aputure-nova-9", "Aputure", "NOVA", "9", "panel"],
      ["litepanels-astra-ip-half", "Litepanels", "Astra IP", "Half", "profile"],
      ["litepanels-astra-ip-2x1", "Litepanels", "Astra IP", "2x1", "profile"],
      ["litepanels-studio-x-daylight", "Litepanels", "Studio X", "Daylight", "profile"],
    ].map(([id, manufacturer, family, model, kind]) =>
      fixtureDefinition(
        id!,
        manufacturer!,
        family!,
        model!,
        kind!,
        "default",
        [noDmxMode()],
        visual(kind === "panel" ? "panel" : "fresnel", 300, 300, 150),
        "research-needed"
      )
    ),
  ];

  return { definitions };
}

export function catalogDefinitions(catalog?: JsonObject | null): JsonObject[] {
  return asArray((catalog ?? DEFAULT_LIGHTING_FIXTURE_CATALOG).definitions)
    .map((definition) => asRecord(definition))
    .filter((definition): definition is JsonObject => definition !== null);
}

export function resolveFixtureAlias(value: unknown): string | null {
  const cleaned = asString(value).trim().toLowerCase().replace(/[_ ]+/g, "-");
  switch (cleaned) {
    case "astra":
    case "astra-bi-color":
    case "astra-bicolor":
    case "litepanels-astra":
      return "litepanels-astra-bicolor";
    case "infinimat":
    case "aputure-infinimat":
      return "aputure-infinimat-generic";
    case "infinibar":
    case "infinibar-pb12":
    case "aputure-infinibar-pb12":
      return "aputure-infinibar-pb12";
    case "apollo-bridge":
    case "litepanels-apollo":
    case "litepanels-apollo-bridge":
      return "litepanels-apollo-bridge";
    default:
      return cleaned || null;
  }
}

export function fixtureTypeForDefinition(definitionId: string) {
  switch (definitionId) {
    case "litepanels-astra-bicolor":
      return "astra-bicolor";
    case "aputure-infinimat-generic":
      return "infinimat";
    case "aputure-infinibar-pb12":
      return "infinibar-pb12";
    case "litepanels-apollo-bridge":
      return "Apollo Bridge";
    default:
      return definitionId;
  }
}

export function fixtureDefinitionByIdentity(
  catalog: JsonObject | null | undefined,
  definitionId?: unknown,
  fixtureType?: unknown,
  kind?: unknown
) {
  const definitions = catalogDefinitions(catalog);
  const aliases = [
    asString(definitionId).trim().toLowerCase(),
    resolveFixtureAlias(fixtureType),
    resolveFixtureAlias(kind),
  ].filter(Boolean);
  return (
    definitions.find((definition) => aliases.includes(asString(definition.id))) ??
    definitions.find((definition) => asString(definition.id) === "litepanels-astra-bicolor") ??
    definitions[0] ??
    null
  );
}

export function fixtureDefinitionSelectable(definition: JsonObject | null) {
  return asString(definition?.status) === "verified" && asString(definition?.kind) !== "control-node";
}

export function fixtureModeForDefinition(definition: JsonObject | null, modeId?: unknown): JsonObject | null {
  const modes = asArray(definition?.modes)
    .map((mode) => asRecord(mode))
    .filter((mode): mode is JsonObject => mode !== null);
  const requested = asString(modeId).trim();
  return (
    modes.find((mode) => asString(mode.id) === requested) ??
    modes.find((mode) => asString(mode.id) === asString(definition?.defaultModeId)) ??
    modes[0] ??
    null
  );
}

export function normalizeFixtureType(value: unknown) {
  const definition = fixtureDefinitionByIdentity(DEFAULT_LIGHTING_FIXTURE_CATALOG, undefined, value);
  return definition ? fixtureTypeForDefinition(asString(definition.id)) : asString(value).trim().toLowerCase();
}

export function fixtureProfileForFixture(
  fixture: JsonObject,
  catalog: JsonObject | null = DEFAULT_LIGHTING_FIXTURE_CATALOG
) {
  const definition = fixtureDefinitionByIdentity(catalog, fixture.definitionId, fixture.type, fixture.kind);
  const mode = fixtureModeForDefinition(definition, fixture.modeId);
  return {
    definition,
    mode,
    definitionId: asString(definition?.id, "litepanels-astra-bicolor"),
    modeId: asString(mode?.id, "default"),
    fixtureType: fixtureTypeForDefinition(asString(definition?.id, "litepanels-astra-bicolor")),
    kind: asString(definition?.kind, "profile"),
    channelCount: asNumber(mode?.channelCount, asArray(mode?.channels).length),
    channels: asArray(mode?.channels)
      .map((channel) => asRecord(channel))
      .filter((channel): channel is JsonObject => channel !== null),
    controls: asArray(mode?.controls)
      .map((control) => asRecord(control))
      .filter((control): control is JsonObject => control !== null),
    defaults: asRecord(mode?.defaults) ?? {},
  };
}

export function lightingFixtureChannelCount(fixture: string | JsonObject) {
  if (typeof fixture === "string") {
    return fixtureProfileForFixture({ type: fixture }).channelCount;
  }
  return fixtureProfileForFixture(fixture).channelCount;
}

export function lightingFixtureMaxStartAddress(fixture: string | JsonObject) {
  const channelCount = lightingFixtureChannelCount(fixture);
  return channelCount <= 0 ? 0 : 512 - channelCount + 1;
}

export function lightingFixtureCctRange(fixture: string | JsonObject) {
  const profile =
    typeof fixture === "string" ? fixtureProfileForFixture({ type: fixture }) : fixtureProfileForFixture(fixture);
  return {
    max: asNumber(profile.defaults.cctMax, profile.channelCount > 0 ? 5600 : 0),
    min: asNumber(profile.defaults.cctMin, profile.channelCount > 0 ? 3200 : 0),
  };
}

export function defaultLightingFixtureCct(fixture: string | JsonObject) {
  const profile =
    typeof fixture === "string" ? fixtureProfileForFixture({ type: fixture }) : fixtureProfileForFixture(fixture);
  return asNumber(profile.defaults.cct, profile.channelCount > 0 ? 5600 : 0);
}

export const DEFAULT_LIGHTING_FIXTURE_CATALOG = buildDefaultLightingFixtureCatalogSnapshot();
