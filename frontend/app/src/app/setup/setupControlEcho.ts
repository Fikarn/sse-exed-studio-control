export interface EchoControl {
  body?: { action?: string; value?: string } | null;
  id: string;
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

const routePagePreference: Record<string, string[]> = {
  "/api/deck/action": ["projects", "tasks"],
  "/api/deck/audio-action": ["audio"],
  "/api/deck/light-action": ["lights"],
};

function controlMatches(control: EchoControl, event: ControlSurfaceLastEvent) {
  const body = control.body;
  if (!body || body.action !== event.action) {
    return false;
  }
  if (body.value === undefined || body.value === null) {
    return event.value === null;
  }
  return body.value === event.value;
}

export function findEchoControlId(
  pages: EchoPage[],
  event: ControlSurfaceLastEvent | null,
  selectedPageId: string | null
): string | null {
  if (!event) {
    return null;
  }

  const matches: { controlId: string; pageId: string }[] = [];
  for (const page of pages) {
    for (const control of [...page.buttons, ...page.dials]) {
      if (controlMatches(control, event)) {
        matches.push({ controlId: control.id, pageId: page.id });
      }
    }
  }
  if (matches.length === 0) {
    return null;
  }

  const onSelectedPage = matches.find((match) => match.pageId === selectedPageId);
  if (onSelectedPage) {
    return onSelectedPage.controlId;
  }

  const preferredPages = routePagePreference[event.route] ?? [];
  for (const pageId of preferredPages) {
    const preferred = matches.find((match) => match.pageId === pageId);
    if (preferred) {
      return preferred.controlId;
    }
  }

  return matches[0]?.controlId ?? null;
}
