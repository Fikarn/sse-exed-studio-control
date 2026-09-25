import type { JsonObject, JsonValue } from "../generated/protocol";
import { DOMAIN_REQUESTS, type DomainKey } from "./domainRefresh";

// 2026-09 production readiness, Slice 9 (finding F32): a reply used to be cast
// to its snapshot type with no look at it, so a malformed one surfaced as a
// render error somewhere inside a workspace. These guards check the top of
// each shape — the lists a workspace maps over are lists, the rows it keys by
// carry an id — and nothing deeper: they run on every refresh, so they stay
// one pass over each list with no allocation.

/** A reply that failed its guard. The message names the request and the field. */
export class SnapshotShapeError extends Error {
  readonly domain: DomainKey;

  constructor(domain: DomainKey, problem: string) {
    super(`${DOMAIN_REQUESTS[domain]}: ${problem}`);
    this.name = "SnapshotShapeError";
    this.domain = domain;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listProblem(record: JsonObject, field: string, options: { ids: boolean; optional?: boolean }): string | null {
  const value = record[field];
  if (value === undefined && options.optional) {
    return null;
  }
  if (!Array.isArray(value)) {
    return `${field} is not a list`;
  }
  if (options.ids) {
    for (let index = 0; index < value.length; index += 1) {
      const row = value[index];
      if (!isRecord(row) || typeof row.id !== "string" || row.id.length === 0) {
        return `${field}[${index}] has no id`;
      }
    }
  }
  return null;
}

function firstProblem(...problems: Array<string | null>): string | null {
  return problems.find((problem) => problem !== null) ?? null;
}

/** The snapshots assembled as loose JSON: an object is all the store relies on. */
const LOOSE_DOMAINS: ReadonlySet<DomainKey> = new Set(["health", "app", "commissioning", "support", "controlSurface"]);

/**
 * What is wrong with `value` as the snapshot of `domain`, or `null`. A typed
 * snapshot may be absent (`null`: no console yet) and the
 * workspace renders its empty state; a loose one is always an object.
 */
export function snapshotProblem(domain: DomainKey, value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return LOOSE_DOMAINS.has(domain) ? "the reply is empty" : null;
  }
  if (!isRecord(value)) {
    return "the reply is not an object";
  }

  switch (domain) {
    case "lighting":
      return firstProblem(
        listProblem(value, "fixtures", { ids: true }),
        listProblem(value, "groups", { ids: true }),
        listProblem(value, "scenes", { ids: true }),
        listProblem(value, "palettes", { ids: true, optional: true }),
        listProblem(value, "previewFixtures", { ids: true, optional: true })
      );
    case "lightingFixtureCatalog":
      return listProblem(value, "definitions", { ids: true });
    case "lightingDmxMonitor":
      return listProblem(value, "channels", { ids: false });
    case "audio":
      return firstProblem(
        listProblem(value, "channels", { ids: true }),
        listProblem(value, "mixTargets", { ids: true }),
        listProblem(value, "snapshots", { ids: true, optional: true })
      );
    default:
      return null;
  }
}
