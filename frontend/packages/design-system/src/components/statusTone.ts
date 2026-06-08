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
