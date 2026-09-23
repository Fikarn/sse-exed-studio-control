/**
 * DES-07: the canonical status-tone axis the four status primitives converge on.
 *
 * StatusDot / StatusPill / StatusBand / StatusBadge each now accept a `tone`
 * prop (Slice 8e aligned the divergent `state`/`status` prop names). Their
 * individual unions are presentation synonyms of these semantic members:
 *   - ok        — StatusBadge healthy/ready/connected, StatusBand ready, StatusDot ok
 *   - attention — StatusBadge degraded/warning, StatusBand degraded/warning, StatusDot attn
 *   - error     — every primitive's error/err
 *   - info      — StatusPill/StatusDot info (no StatusBand/StatusBadge equivalent today)
 *   - neutral   — StatusBadge idle, StatusBand neutral
 *
 * New consumers should reason in these semantic terms; the per-primitive
 * synonyms are kept for backward compatibility.
 */
export type SharedStatusTone = "ok" | "attention" | "error" | "info" | "neutral";

// Visual overhaul A, Slice 2 (plan D1, finding C3): the shell lamp mirrors
// the worst state its workspace shows, so `ACTION FAILED` is red in the
// header too. Severity is the state vocabulary's: error > attention > info >
// ok > neutral.
const TONE_SEVERITY: Record<SharedStatusTone, number> = {
  error: 4,
  attention: 3,
  info: 2,
  ok: 1,
  neutral: 0,
};

export function worstTone(...tones: ReadonlyArray<SharedStatusTone | null | undefined>): SharedStatusTone {
  let worst: SharedStatusTone = "neutral";
  for (const tone of tones) {
    if (tone && TONE_SEVERITY[tone] > TONE_SEVERITY[worst]) worst = tone;
  }
  return worst;
}

/** The tone a subsystem lamp shows: the engine's health check for the
 *  subsystem, or the workspace's own state when that is worse. */
export function toneForSubsystem(
  healthCheck: SharedStatusTone | null | undefined,
  workspaceState: SharedStatusTone | null | undefined
): SharedStatusTone {
  return worstTone(healthCheck, workspaceState);
}
