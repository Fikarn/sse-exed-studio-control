// supply-chain-expiry.mjs — the one date rule shared by the two supply-chain
// exception lists (production readiness 2026-09, Slice 12 — finding F17):
// `scripts/npm-audit-allowlist.json` and the `ignore` entries of
// `native/deny.toml`. An exception is a decision with a date on it: the date
// must be a real calendar day, must not have passed, and may not be set further
// out than MAX_EXCEPTION_DAYS — otherwise "2099-01-01" would be a permanent
// mute with extra steps.

export const MAX_EXCEPTION_DAYS = 90;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDay(value) {
  if (typeof value !== "string" || !ISO_DAY.test(value)) {
    return null;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) {
    return null;
  }
  // Date.parse rolls 2026-02-31 over into March; a day that does not
  // round-trip is not a calendar day.
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** Today as a UTC calendar day, the form every exception date is written in. */
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Why `expires` is not acceptable on `today`, or null when it is. The day
 * itself is still valid: an exception that expires 2026-10-01 fails from
 * 2026-10-02.
 */
export function expiryProblem(expires, today, maxDays = MAX_EXCEPTION_DAYS) {
  const todayTime = parseDay(today);
  if (todayTime === null) {
    throw new Error(`today must be a YYYY-MM-DD day, got ${JSON.stringify(today)}`);
  }
  const expiresTime = parseDay(expires);
  if (expiresTime === null) {
    return `the date ${JSON.stringify(expires)} is not a YYYY-MM-DD calendar day`;
  }
  if (expiresTime < todayTime) {
    return `expired on ${expires}`;
  }
  const daysOut = Math.round((expiresTime - todayTime) / MS_PER_DAY);
  if (daysOut > maxDays) {
    return `${expires} is ${daysOut} days out; an exception may be set at most ${maxDays} days ahead`;
  }
  return null;
}
