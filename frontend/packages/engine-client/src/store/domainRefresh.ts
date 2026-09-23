import type { EventName, JsonObject, RequestMethod } from "../generated/protocol";

// 2026-09 production readiness, Slice 9 (finding F11, front-end half): the
// store used to answer every event, and every request it sent, with all ten
// snapshot requests. Each event and each method now names the snapshots it
// can change, and only those are fetched.

/** One key per snapshot the store keeps. */
export type DomainKey =
  | "health"
  | "app"
  | "commissioning"
  | "lightingFixtureCatalog"
  | "lighting"
  | "lightingDmxMonitor"
  | "audio"
  | "planning"
  | "support"
  | "controlSurface";

export const DOMAIN_REQUESTS = {
  health: "health.snapshot",
  app: "app.snapshot",
  commissioning: "commissioning.snapshot",
  lightingFixtureCatalog: "lighting.fixtureCatalog.snapshot",
  lighting: "lighting.snapshot",
  lightingDmxMonitor: "lighting.dmxMonitor.snapshot",
  audio: "audio.snapshot",
  planning: "planning.snapshot",
  support: "support.snapshot",
  controlSurface: "controlSurface.snapshot",
} as const satisfies Record<DomainKey, RequestMethod>;

/** Every snapshot: the bootstrap's set and what an explicit `refresh()` fetches. */
export const ALL_DOMAINS = Object.keys(DOMAIN_REQUESTS) as DomainKey[];

/**
 * What an event or a request nobody mapped refreshes. The fixture catalog is
 * compiled into the hardware link and cannot change while it runs, so it is
 * fetched once per session and again only by an explicit `refresh()`. The
 * deck's page model is as fixed; its one live field, the last key pressed, is
 * polled by the Setup verify step while that step is open.
 */
export const CHANGEABLE_DOMAINS: readonly DomainKey[] = ALL_DOMAINS.filter(
  (domain) => domain !== "lightingFixtureCatalog" && domain !== "controlSurface"
);

// The DMX monitor is the lighting snapshot rendered a second way — the
// hardware link builds the one from the other — so the two are never fetched
// apart. Every list below that names lighting is composed from this one, and
// `domainRefresh.test.ts` holds the rule for whatever is added later.
const LIGHTING_DOMAINS = ["lighting", "lightingDmxMonitor"] as const;

// Commissioning decides more than the commissioning snapshot. Publishing it
// gives the rig its bridge and universe, so the lighting snapshot and its DMX
// monitor fill in; the lighting snapshot's `reachable` and the audio
// snapshot's capabilities are read from the probes' stored status; and no
// lighting or audio event says any of it. (The workspace qualification lane
// found the monitor half of this on the live hardware link.)
const COMMISSIONING_DOMAINS = ["commissioning", "app", "health", ...LIGHTING_DOMAINS, "audio"] as const;

// The commissioning snapshot carries the planning store's project and task
// counts (Setup prints them and offers the sample seed by them), so a planning
// change moves it too. (The setup-support qualification lane found this one.)
const PLANNING_DOMAINS = ["planning", "commissioning"] as const;

/**
 * The snapshots each event can change. `satisfies` keeps the list complete:
 * an event added to the protocol fails the typecheck here until it is mapped.
 * `audio.changed` names its snapshot for the record only — the store routes
 * it through the audio path, which owns echo suppression and the console-echo
 * rule — and the meter and lifecycle events change no snapshot at all.
 */
export const EVENT_DOMAIN_REFRESH = {
  "app.changed": ["app", "health"],
  "audio.changed": ["audio"],
  "audio.meters": [],
  "commissioning.changed": COMMISSIONING_DOMAINS,
  "engine.exited": [],
  "engine.ready": [],
  "engine.startupFailed": [],
  "lighting.changed": LIGHTING_DOMAINS,
  "planning.changed": PLANNING_DOMAINS,
  "settings.changed": ["app"],
  "support.changed": ["support"],
} as const satisfies Record<EventName, readonly DomainKey[]>;

/** The snapshots an event refreshes; an event this build does not know refreshes everything that can change. */
export function domainsForEvent(eventName: string): { domains: readonly DomainKey[]; known: boolean } {
  const domains = (EVENT_DOMAIN_REFRESH as Record<string, readonly DomainKey[] | undefined>)[eventName];
  return domains ? { domains, known: true } : { domains: CHANGEABLE_DOMAINS, known: false };
}

// The refresh that follows a request the store sent stays, scoped the same
// way: the hardware link answers `settings.update` and the Stream Deck profile
// export with no event at all, so a workspace switch reaches the screen only
// through this refresh. (The fixture double raises an event for every mutation
// it implements; it is the hardware link that needs this.) First match wins,
// so the specific methods stand before their prefix.
const METHOD_DOMAIN_REFRESH: ReadonlyArray<readonly [prefix: string, domains: readonly DomainKey[]]> = [
  ["settings.update", ["app"]],
  // Seeds planning data and publishes commissioning in one request.
  ["commissioning.seedPlanningDemo", [...COMMISSIONING_DOMAINS, "planning"]],
  ["commissioning.", COMMISSIONING_DOMAINS],
  // The armed switch is an action-log row of its own, and Setup / Support
  // lists those rows beside the switch: the list moves with it. (Recording
  // an action raises no `support.changed` — that would cost every action
  // one more request — so the list otherwise moves when Setup is opened.)
  ["lighting.output.setArmed", [...LIGHTING_DOMAINS, "support"]],
  // `lighting.settings.update` included: the store's request carries the
  // selection and the grand master only (`LightingSettingsUpdateRequest`),
  // never the bridge address whose change would reset the lighting probe.
  ["lighting.", LIGHTING_DOMAINS],
  ["planning.", PLANNING_DOMAINS],
  // An applied archive rewrites lighting and audio settings as well, and no
  // lighting or audio event says so.
  ["support.backup.restore", CHANGEABLE_DOMAINS],
  ["support.", ["support"]],
  // Writes the Stream Deck profile to a file; no snapshot reads it.
  ["exports.", []],
];

// Opening a workspace refreshes what that workspace shows. Not every change
// on the hardware link raises an event: the daily backup appears in the
// backups folder unannounced, the health sentences describe lighting and
// audio state that moves without a health event, and a recorded action
// raises no `support.changed`. (The Stream Deck's keys raise lighting.changed
// and planning.changed since production readiness Slice 10.) Scoped refreshes no longer sweep those up
// by accident, so the moment the operator looks is when they are fetched —
// two to five requests where every switch used to cost ten.
const WORKSPACE_DOMAINS: Readonly<Record<string, readonly DomainKey[]>> = {
  setup: ["health", "commissioning", "support", "controlSurface"],
  lighting: LIGHTING_DOMAINS,
  audio: ["audio"],
  planning: PLANNING_DOMAINS,
};

/**
 * The snapshots a request can change; a method nobody mapped refreshes
 * everything that can change. `settings.update` with a `workspace` is a
 * workspace switch, and adds that workspace's own snapshots.
 */
export function domainsForMethod(method: string, params: JsonObject = {}): readonly DomainKey[] {
  for (const [prefix, domains] of METHOD_DOMAIN_REFRESH) {
    if (method === prefix || (prefix.endsWith(".") && method.startsWith(prefix))) {
      const opened = method === "settings.update" && typeof params.workspace === "string" ? params.workspace : null;
      return opened ? [...domains, ...(WORKSPACE_DOMAINS[opened] ?? [])] : domains;
    }
  }
  return CHANGEABLE_DOMAINS;
}
