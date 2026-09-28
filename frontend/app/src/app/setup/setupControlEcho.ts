export interface EchoControl {
  body?: { action?: string; value?: string } | null;
  id: string;
  /** The bridge's route the control posts to (`/api/deck/camera-action`); none for a control that sends nothing. */
  url?: string | null;
}

export interface EchoPage {
  buttons: EchoControl[];
  dials: EchoControl[];
  id: string;
}

export interface ControlSurfaceLastEvent {
  action: string;
  at: number;
  route: string;
  value: string | null;
}

/** The control a press of the deck was, and the page it is on. */
export interface EchoMatch {
  controlId: string;
  pageId: string;
}

export function parseControlSurfaceLastEvent(candidate: unknown): ControlSurfaceLastEvent | null {
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.action !== "string" || typeof record.at !== "number") {
    return null;
  }
  return {
    action: record.action,
    at: record.at,
    route: typeof record.route === "string" ? record.route : "",
    value: typeof record.value === "string" ? record.value : null,
  };
}

/** A route without the address before it: the page model gives it bare, a profile may not. */
function routeOf(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
}

// Each page of the deck posts to a route of its own (LIGHTS, AUDIO, CAMERAS and
// PROMPTER; `native/protocol/v1.md`, "Stream Deck bridge"), and a press says
// which route it arrived on: a control of another route is not the one that was
// pressed, whatever its action is called. A control or a press that does not
// say its route is matched by what it sends alone.
function controlMatches(control: EchoControl, event: ControlSurfaceLastEvent) {
  const body = control.body;
  if (!body || body.action !== event.action) {
    return false;
  }
  if (control.url && event.route && routeOf(control.url) !== event.route) {
    return false;
  }
  if (body.value === undefined || body.value === null) {
    return event.value === null;
  }
  return body.value === event.value;
}

/**
 * The control a press of the deck was: on the page Setup shows when that page
 * has it, else on the first page that has it. Two controls of a page may send
 * the same (`PLAY` and a push of the speed dial): the first is taken, a key
 * before a dial.
 */
export function findEcho(
  pages: EchoPage[],
  event: ControlSurfaceLastEvent | null,
  selectedPageId: string | null
): EchoMatch | null {
  if (!event) {
    return null;
  }

  const matches: EchoMatch[] = [];
  for (const page of pages) {
    for (const control of [...page.buttons, ...page.dials]) {
      if (controlMatches(control, event)) {
        matches.push({ controlId: control.id, pageId: page.id });
      }
    }
  }
  return matches.find((match) => match.pageId === selectedPageId) ?? matches[0] ?? null;
}

export function findEchoControlId(
  pages: EchoPage[],
  event: ControlSurfaceLastEvent | null,
  selectedPageId: string | null
): string | null {
  return findEcho(pages, event, selectedPageId)?.controlId ?? null;
}
