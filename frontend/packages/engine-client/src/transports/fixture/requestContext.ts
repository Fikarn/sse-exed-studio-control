// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { MutableFixtureState } from "./state";
import type { EventName, JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";

/** What a domain's request handler may touch: the double's state, and the way
 *  it raises the events the hardware link would. */
export interface FixtureRequestContext {
  state: MutableFixtureState;
  emit: (event: EventName, payload?: JsonObject) => void;
}

/** A handler's answer for a method that belongs to another domain. */
export const NOT_HANDLED = Symbol("fixture request not handled");

export type FixtureRequestResult = JsonValue | typeof NOT_HANDLED;

export type FixtureRequestHandler = (
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
) => FixtureRequestResult;
