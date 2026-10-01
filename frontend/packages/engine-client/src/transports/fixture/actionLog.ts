// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import { cameraModel } from "./camerasModel";
import { asArray, asBoolean, asNumber, asRecord } from "./json";
import type { MutableFixtureState } from "./state";

// The action log as the hardware link keeps it for the screen
// (`native/rust-engine/src/action_log.rs`): one row per discrete action that
// changed what a device receives, written after the request has succeeded, and
// `support.snapshot` carrying the newest fifty as `recentEvents`. The two lists
// and every sentence below are that file's; `actionLog.test.ts` reads the lists
// from it, so a method the hardware link starts recording fails there first.

/** The screen's methods that can leave a row (`RECORDED_UI_METHODS`). */
export const RECORDED_UI_METHODS: readonly RequestMethod[] = [
  "audio.channel.dynamics.update",
  "audio.channel.eq.update",
  "audio.channel.send.update",
  "audio.channel.update",
  "audio.mixTarget.update",
  "audio.settings.update",
  // TotalMix loads one of its own snapshots at the operator's second press (2026-10-01).
  "audio.snapshot.load",
  "audio.solo.clearAll",
  // The cameras (new pages program, Slice 8): the record's start and stop, the format and
  // the look, and who holds a camera.
  "cameras.connect",
  "cameras.format.set",
  "cameras.look.set",
  "cameras.record.start",
  "cameras.record.stop",
  "cameras.release",
  "commissioning.check.run",
  "lighting.fixture.create",
  "lighting.fixture.delete",
  "lighting.fixture.highlight",
  "lighting.fixture.identify",
  "lighting.fixture.identify.clearAll",
  "lighting.fixture.identifySequence",
  "lighting.fixture.update",
  "lighting.group.power",
  "lighting.output.setArmed",
  "lighting.palette.apply",
  "lighting.power.all",
  "lighting.scene.recall",
  "lighting.settings.update",
  // The Teleprompter: what the presenter reads changes (the proposal §5.5).
  "prompter.clear",
  "prompter.putOn",
  "prompter.update",
  "support.backup.restore",
];

/** The lighting methods that only stage their change while the preview is on
 *  (`PREVIEW_AWARE_UI_METHODS`): nothing reached the rig, so no row. */
export const PREVIEW_AWARE_UI_METHODS: readonly RequestMethod[] = [
  "lighting.fixture.update",
  "lighting.group.power",
  "lighting.palette.apply",
  "lighting.power.all",
  "lighting.scene.recall",
];

/** How many rows `support.snapshot` carries (`RECENT_ACTIONS_LIMIT`). */
export const RECENT_ACTIONS_LIMIT = 50;

/** The cameras' rows' actions (Slice 8). */
export const CAMERA_ACTIONS = {
  "cameras.record.start": "recording-started",
  "cameras.record.stop": "recording-stopped",
  "cameras.format.set": "format-changed",
  "cameras.look.set": "look-changed",
  "cameras.release": "released",
  "cameras.connect": "held-again",
} as const;

/** One row before it is stored: which part of the studio, what, on what, and the sentence the operator reads. */
export interface UiActionRow {
  domain: "lighting" | "audio" | "setup" | "prompter" | "cameras";
  action: string;
  target: string;
  detail: string;
}

// `text`: a string at the pointer, trimmed, and not empty.
function text(value: JsonValue, path: readonly string[]): string | null {
  let node: JsonValue | undefined = value;
  for (const key of path) {
    node = asRecord(node)?.[key];
  }
  const trimmed = typeof node === "string" ? node.trim() : "";
  return trimmed ? trimmed : null;
}

// `flag`: a boolean under the key, or nothing.
function flag(value: JsonValue, key: string): boolean | null {
  const entry = asRecord(value)?.[key];
  return typeof entry === "boolean" ? entry : null;
}

// `as_i64` / `as_u64` read whole numbers only; anything else counts as 0.
function wholeNumber(value: JsonValue, path: readonly string[], options: { unsigned?: boolean } = {}): number {
  let node: JsonValue | undefined = value;
  for (const key of path) {
    node = asRecord(node)?.[key];
  }
  if (typeof node !== "number" || !Number.isInteger(node)) return 0;
  return options.unsigned && node < 0 ? 0 : node;
}

// `params.get(key).is_some()`: the key is there, whatever its value.
function has(value: JsonValue, key: string): boolean {
  const record = asRecord(value);
  return record !== null && Object.prototype.hasOwnProperty.call(record, key);
}

// `params.get(key).is_some_and(|value| !value.is_null())`
function hasValue(value: JsonValue, key: string): boolean {
  const entry = asRecord(value)?.[key];
  return entry !== undefined && entry !== null;
}

function onOff(on: boolean) {
  return on ? "on" : "off";
}

/**
 * The rows a successful request from the screen leaves (`ui_actions`). `params`
 * is what was asked, `result` what was answered; `staged` is true when the
 * method is preview-aware and the preview was on, so nothing reached the rig.
 */
export function uiActions(method: RequestMethod, params: JsonValue, result: JsonValue, staged: boolean): UiActionRow[] {
  if (staged) return [];
  const lighting = (action: string, target: string, detail: string): UiActionRow => ({
    domain: "lighting",
    action,
    target,
    detail,
  });
  const audio = (action: string, target: string, detail: string): UiActionRow => ({
    domain: "audio",
    action,
    target,
    detail,
  });

  switch (method) {
    case "lighting.power.all": {
      const on = flag(params, "on");
      return on === null ? [] : [lighting(on ? "all-on" : "all-off", "All lights", `All lights ${onOff(on)}`)];
    }
    case "lighting.group.power": {
      const on = flag(params, "on");
      if (on === null) return [];
      const name = text(result, ["groupName"]) ?? "Group";
      return [lighting(on ? "group-on" : "group-off", name, `Group ${name} ${onOff(on)}`)];
    }
    case "lighting.fixture.update": {
      const name = text(result, ["fixture", "name"]) ?? "Light";
      const rows: UiActionRow[] = [];
      const on = flag(params, "on");
      if (on !== null) {
        rows.push(lighting(on ? "light-on" : "light-off", name, `${name} ${onOff(on)}`));
      }
      if (["universe", "dmxStartAddress", "type", "definitionId", "modeId"].some((key) => hasValue(params, key))) {
        rows.push(
          lighting(
            "light-repatched",
            name,
            `${name} repatched to U${wholeNumber(result, ["fixture", "universe"])} · ${wholeNumber(result, ["fixture", "dmxStartAddress"])}`
          )
        );
      }
      return rows;
    }
    case "lighting.fixture.create": {
      const name = text(result, ["fixture", "name"]) ?? "Light";
      return [lighting("light-added", name, `${name} added to the rig`)];
    }
    case "lighting.fixture.delete": {
      const fixtureId = text(result, ["fixtureId"]) ?? "light";
      return [lighting("light-removed", fixtureId, `Light removed from the rig (${fixtureId})`)];
    }
    case "lighting.scene.recall": {
      const name = text(result, ["sceneName"]) ?? "Scene";
      const fade = asRecord(result)?.fadeDurationSeconds;
      const fadeSeconds = typeof fade === "number" ? fade : 0;
      const detail =
        fadeSeconds > 0 ? `Scene recalled: ${name} · ${fadeSeconds.toFixed(1)} s fade` : `Scene recalled: ${name}`;
      return [lighting("scene-recalled", name, detail)];
    }
    case "lighting.palette.apply": {
      const name = text(result, ["paletteName"]) ?? "Palette";
      const lights = wholeNumber(result, ["affectedFixtures"], { unsigned: true });
      return [lighting("palette-applied", name, `Palette applied: ${name} · ${lights} light(s)`)];
    }
    case "lighting.settings.update": {
      const rows: UiActionRow[] = [];
      const enabled = flag(params, "enabled");
      if (enabled !== null) {
        rows.push(
          lighting(
            enabled ? "lighting-enabled" : "lighting-disabled",
            "Lighting",
            `Lighting switched ${onOff(enabled)}`
          )
        );
      }
      if (has(params, "bridgeIp") || has(params, "universe")) {
        rows.push(
          lighting(
            "bridge-address-set",
            "Bridge",
            `Bridge address set: ${text(result, ["bridgeIp"]) ?? "none"} · universe ${wholeNumber(result, ["universe"])}`
          )
        );
      }
      return rows;
    }
    case "lighting.fixture.identify": {
      const fixtureId = text(result, ["fixtureId"]) ?? "light";
      return [lighting("identify", fixtureId, `Identify flash (${fixtureId})`)];
    }
    case "lighting.fixture.identifySequence": {
      const lights = wholeNumber(result, ["fixtureCount"], { unsigned: true });
      return [lighting("identify-sequence", "Rig", `Identify sequence across ${lights} light(s)`)];
    }
    case "lighting.fixture.identify.clearAll":
      return [lighting("identify-cleared", "Rig", "Identify flashes cleared")];
    case "lighting.fixture.highlight": {
      const lights = wholeNumber(result, ["fixtureCount"], { unsigned: true });
      switch (text(result, ["mode"])) {
        case "highlight":
          return [lighting("highlight-on", "Rig", `Highlight on · ${lights} light(s)`)];
        case "solo":
          return [lighting("solo-on", "Rig", `Light solo on · ${lights} light(s)`)];
        default:
          return [lighting("highlight-off", "Rig", "Highlight and light solo off")];
      }
    }
    case "lighting.output.setArmed": {
      const armed = flag(result, "armed");
      if (armed === null) return [];
      return [
        lighting(
          armed ? "outputs-armed" : "outputs-held",
          "Light outputs",
          armed ? "Light outputs armed" : "Light outputs held"
        ),
      ];
    }

    case "audio.channel.update": {
      const name = text(result, ["name"]) ?? "Channel";
      return (
        [
          ["mute", "mute", "Mute"],
          ["solo", "solo", "Solo"],
          ["phantom", "phantom", "48 V"],
          ["phase", "phase", "Phase invert"],
          ["pad", "pad", "Pad"],
          ["instrument", "instrument", "Instrument input"],
          ["autoSet", "auto-set", "AutoSet"],
        ] as const
      ).flatMap(([key, action, label]) => {
        const on = flag(params, key);
        return on === null ? [] : [audio(action, name, `${label} ${onOff(on)}: ${name}`)];
      });
    }
    case "audio.mixTarget.update": {
      const name = text(result, ["name"]) ?? "Output";
      return (
        [
          ["mute", "mute", "Mute"],
          ["dim", "dim", "Dim"],
          ["mono", "mono", "Mono"],
        ] as const
      ).flatMap(([key, action, label]) => {
        const on = flag(params, key);
        return on === null ? [] : [audio(action, name, `${label} ${onOff(on)}: ${name}`)];
      });
    }
    case "audio.channel.eq.update": {
      const name = text(result, ["name"]) ?? "Channel";
      const rows: UiActionRow[] = [];
      const enabled = flag(params, "enabled");
      if (enabled !== null) rows.push(audio("eq", name, `EQ ${onOff(enabled)}: ${name}`));
      const lowCut = flag(params, "lowCutEnabled");
      if (lowCut !== null) rows.push(audio("low-cut", name, `Low cut ${onOff(lowCut)}: ${name}`));
      const band = flag(params, "bandEnabled");
      if (band !== null) {
        rows.push(audio("eq-band", name, `EQ band ${text(params, ["bandId"]) ?? "?"} ${onOff(band)}: ${name}`));
      }
      return rows;
    }
    case "audio.channel.dynamics.update": {
      const name = text(result, ["name"]) ?? "Channel";
      const enabled = flag(params, "enabled");
      return enabled === null
        ? []
        : [audio("dynamics", name, `Dynamics (${text(params, ["section"]) ?? "section"}) ${onOff(enabled)}: ${name}`)];
    }
    case "audio.channel.send.update": {
      const name = text(result, ["name"]) ?? "Channel";
      const output = text(params, ["mixTargetId"]) ?? "output";
      return (
        [
          ["mute", "send-mute", "Send mute"],
          ["solo", "send-solo", "Send solo"],
          ["preFader", "send-pre-fader", "Send pre-fader"],
          ["linkStereo", "send-link", "Send stereo link"],
        ] as const
      ).flatMap(([key, action, label]) => {
        const on = flag(params, key);
        return on === null ? [] : [audio(action, name, `${label} ${onOff(on)}: ${name} to ${output}`)];
      });
    }
    case "audio.snapshot.load": {
      // A slot TotalMix saved no name for is named by its number; the rows never say "snapshot".
      const name = text(result, ["name"]) ?? `slot ${wholeNumber(result, ["slot"])}`;
      return [audio("console-snapshot-loaded", name, `Console mix loaded in TotalMix: ${name}`)];
    }
    case "audio.solo.clearAll":
      return [audio("solo-cleared", "Console", "Every solo cleared")];
    case "audio.settings.update": {
      const rows: UiActionRow[] = [];
      const oscEnabled = flag(params, "oscEnabled");
      if (oscEnabled !== null) {
        rows.push(
          audio(
            oscEnabled ? "console-control-on" : "console-control-off",
            "TotalMix",
            `TotalMix control switched ${onOff(oscEnabled)}`
          )
        );
      }
      if (["sendHost", "sendPort", "receivePort"].some((key) => hasValue(params, key))) {
        rows.push(
          audio(
            "console-address-set",
            "TotalMix",
            `TotalMix address set: ${text(result, ["sendHost"]) ?? "none"}:${wholeNumber(result, ["sendPort"])}`
          )
        );
      }
      return rows;
    }

    // A probe that was given an address stores it, and the address is where
    // the light output and the console sends go from then on.
    case "commissioning.check.run": {
      const target = text(params, ["target"]);
      if (target === "lighting" && (has(params, "bridgeIp") || has(params, "universe"))) {
        return [
          lighting(
            "bridge-address-set",
            "Bridge",
            `Bridge address set by the bridge probe: ${text(params, ["bridgeIp"]) ?? "unchanged"}`
          ),
        ];
      }
      if (target === "audio" && ["sendHost", "sendPort", "receivePort"].some((key) => hasValue(params, key))) {
        return [
          audio(
            "console-address-set",
            "TotalMix",
            `TotalMix address set by the audio probe: ${text(params, ["sendHost"]) ?? "unchanged"}`
          ),
        ];
      }
      return [];
    }

    // An applied archive rewrites the lighting and audio state the devices
    // are driven from; a database backup is only staged here, and the start
    // that applies it writes its own row.
    case "support.backup.restore":
      if (flag(result, "requiresRestart") === true) return [];
      return [
        {
          domain: "setup",
          action: "backup-restored",
          target: "Saved data",
          detail: "Backup archive restored: lighting and audio state replaced; light outputs held",
        },
      ];

    // The Teleprompter (Slice 4): putting a script on, replacing, updating and clearing
    // what the prompter shows (the proposal §5.5); the result carries the sentence.
    case "prompter.putOn":
    case "prompter.update":
    case "prompter.clear": {
      const action = text(result, ["action"]);
      if (action !== "put-on" && action !== "replaced" && action !== "updated" && action !== "cleared") return [];
      return [
        {
          domain: "prompter",
          action,
          target: text(result, ["name"]) ?? "Prompter",
          detail: (text(result, ["sentence"]) ?? "The prompter changed").replace(/\.+$/, ""),
        },
      ];
    }

    // The cameras (Slice 8): the record's start and stop, the format and the look, Release,
    // and Connect when the camera is held again (not one that still does not answer); the
    // answer names the camera and carries the sentence, and the row keeps it as the operator
    // read it, its full stop included.
    case "cameras.record.start":
    case "cameras.record.stop":
    case "cameras.format.set":
    case "cameras.look.set":
    case "cameras.release":
    case "cameras.connect": {
      const camera = wholeNumber(result, ["camera"]);
      const detail = text(result, ["sentence"]);
      if ((camera !== 1 && camera !== 2 && camera !== 3) || detail === null) return [];
      if (method === "cameras.connect" && text(result, ["state"]) !== "held") return [];
      return [{ domain: "cameras", action: CAMERA_ACTIONS[method], target: cameraModel(camera).tag, detail }];
    }
    default:
      return [];
  }
}

/**
 * Where the rows are written: after a request from the screen has been
 * answered, as the hardware link does at its one entry point
 * (`EngineApp::handle_request`). A refused request never gets here, and a
 * lighting change staged in the preview leaves no row. The newest row comes
 * first, the ids only grow, and the list keeps fifty.
 */
export function recordUiActions(
  state: MutableFixtureState,
  method: RequestMethod,
  params: JsonObject,
  result: JsonValue
) {
  if (!RECORDED_UI_METHODS.includes(method)) return;
  const staged =
    PREVIEW_AWARE_UI_METHODS.includes(method) && asBoolean(asRecord(state.lightingSnapshot)?.previewMode, false);
  const rows = uiActions(method, params, result, staged);
  if (rows.length === 0) return;

  const recentEvents = asArray(state.supportSnapshot.recentEvents)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  let newestId = recentEvents.reduce((highest, entry) => Math.max(highest, asNumber(entry.id, 0)), 0);
  const at = new Date().toISOString();
  const written: JsonObject[] = rows.map((row) => {
    newestId += 1;
    return { id: newestId, at, source: "ui", ...row };
  });
  state.supportSnapshot.recentEvents = [...written.reverse(), ...recentEvents].slice(0, RECENT_ACTIONS_LIMIT);
}
