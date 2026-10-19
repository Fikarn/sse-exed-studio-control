// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject, RequestMethod } from "../../generated/protocol";
import type { Session } from "../../generated/snapshots/Session";
import type { SessionBeginReply } from "../../generated/snapshots/SessionBeginReply";
import type { SessionEndReply } from "../../generated/snapshots/SessionEndReply";
import type { SessionSettingsReply } from "../../generated/snapshots/SessionSettingsReply";
import type { SessionSnapshot } from "../../generated/snapshots/SessionSnapshot";
import { EngineRequestError } from "../engineRequestError";
import { cloneJson } from "./json";
import { NOT_HANDLED, type FixtureRequestContext, type FixtureRequestResult } from "./requestContext";
import { folderChoice, folderLeaf, localDay, makeFolder, planFolder } from "./sessionFolder";
import { updatedSettings } from "./sessionSettings";
import {
  SESSION_NAME_MAX_CHARACTERS,
  fixtureSession,
  isSessionKind,
  nameCharacters,
  oneOfEachKind,
  trimmedName,
  type FixtureSession,
} from "./sessionState";

// The session's requests (the Session page, 2026-10-15; D52;
// `native/rust-engine/src/session/commands.rs`): the read, a begin, which makes or chooses its
// folder on the double's disk, an end, and the settings' update, with the hardware link's
// checks in its order, its refusals and its sentences. A begin, an end and an update raise
// `session.changed { reason }`; a read and a refusal raise nothing.

export const SESSION_METHODS: ReadonlySet<RequestMethod> = new Set<RequestMethod>([
  "session.snapshot",
  "session.begin",
  "session.end",
  "session.settings.update",
]);

const KIND_REFUSAL = "kind must be one of: green-screen, podcast, webinar";

function invalidParams(message: string): EngineRequestError {
  return new EngineRequestError("INVALID_PARAMS", message);
}

function snapshotOf(session: FixtureSession): SessionSnapshot {
  return {
    current: session.current,
    last: oneOfEachKind(session.last),
    settings: session.settings,
    places: {
      root: session.simulated ? session.scratchRoot : session.settings.root,
      simulated: session.simulated,
    },
  };
}

/**
 * `session.begin { kind, name?, folder? }`: the folder is made or chosen, then the session
 * begins; a running session ends at the same moment and becomes its kind's last.
 */
function begin(context: FixtureRequestContext, session: FixtureSession, params: JsonObject): SessionBeginReply {
  const { kind, name } = params;
  if (typeof kind !== "string") throw invalidParams(KIND_REFUSAL);
  if (name !== undefined && name !== null && typeof name !== "string") throw invalidParams("name must be a string");
  if (!isSessionKind(kind)) {
    throw new EngineRequestError(
      "SESSION_KIND_UNKNOWN",
      `"${kind}" is not a kind of session: the kinds are green-screen, podcast and webinar.`
    );
  }
  const trimmed = typeof name === "string" ? trimmedName(name) : "";
  const characters = nameCharacters(trimmed);
  if (characters > SESSION_NAME_MAX_CHARACTERS) {
    throw new EngineRequestError(
      "SESSION_NAME_TOO_LONG",
      `A session's name has at most ${SESSION_NAME_MAX_CHARACTERS} characters; this one has ${characters}.`
    );
  }
  const choice = folderChoice(params.folder);
  const now = new Date();
  const plan = planFolder(
    session.disk,
    { simulated: session.simulated, scratchRoot: session.scratchRoot },
    choice,
    folderLeaf(trimmed, kind, localDay(now)),
    session.settings.root,
    session.settings.subfolders[kind]
  );
  const folder = makeFolder(session.disk, plan);

  const at = now.toISOString();
  const ended: Session | null = session.current ? { ...session.current, endedAt: at } : null;
  const begun: Session = { kind, name: trimmed, begunAt: at, endedAt: null, folder: folder.path };
  if (ended) session.last = oneOfEachKind([ended, ...session.last]);
  session.current = begun;
  context.emit("session.changed", { reason: "begun" });
  return { session: begun, ended, folder };
}

/** `session.end`: the running session ends now and becomes its kind's last. */
function end(context: FixtureRequestContext, session: FixtureSession): SessionEndReply {
  if (!session.current) {
    throw new EngineRequestError("SESSION_NOT_RUNNING", "No session is running, so there is none to end.");
  }
  const ended: Session = { ...session.current, endedAt: new Date().toISOString() };
  session.last = oneOfEachKind([ended, ...session.last]);
  session.current = null;
  context.emit("session.changed", { reason: "ended" });
  return { ended };
}

/** `session.settings.update`: what it gives is checked and kept; the settings after it. */
function updateSettings(
  context: FixtureRequestContext,
  session: FixtureSession,
  params: JsonObject
): SessionSettingsReply {
  session.settings = updatedSettings(session.settings, params);
  context.emit("session.changed", { reason: "settings" });
  return { settings: session.settings };
}

/** The session's requests: every `session.*` method. */
export function handleFixtureSessionRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  if (!SESSION_METHODS.has(method)) return NOT_HANDLED;
  const session = fixtureSession(context.state);
  switch (method) {
    case "session.begin":
      return cloneJson(begin(context, session, params));
    case "session.end":
      return cloneJson(end(context, session));
    case "session.settings.update":
      return cloneJson(updateSettings(context, session, params));
    default:
      return cloneJson(snapshotOf(session));
  }
}
