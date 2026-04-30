import { useEffect, useRef, useState } from "react";
import { Pencil, Power, X } from "lucide-react";

import {
  Button,
  ConfirmDialog,
  IconButton,
  InlineRename,
  InspectorSection,
  StatusDot,
  type InlineRenameHandle,
} from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { formatLightingValueRange } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

export interface InspectorGroupProps {
  groupId: string;
  groupName: string;
  fixtures: readonly LightingFixtureSnapshot[];
  onTogglePower: (groupId: string, on: boolean) => void;
  onSelectFixture: (fixtureId: string) => void;
  /** Inline-rename commit handler. Receives the trimmed new name. */
  onRenameGroup?: (groupId: string, newName: string) => void | Promise<void>;
  /** Removes a fixture from this group (sets its groupId to null). When
   *  provided, member rows render a hover-revealed × button gated by a
   *  confirmation dialog. */
  onRemoveFixtureFromGroup?: (fixtureId: string) => void | Promise<void>;
  busy?: boolean;
  renameBusy?: boolean;
  /** Marks a fixture id as currently being removed. Disables the × button. */
  removingFixtureId?: string | null;
  /** When this nonce changes (and is non-null), the inspector triggers
   *  beginEdit() on the inline rename. Driven by chip context-menu "Rename". */
  pendingInlineRenameNonce?: number | null;
}

export function InspectorGroup({
  groupId,
  groupName,
  fixtures,
  onTogglePower,
  onSelectFixture,
  onRenameGroup,
  onRemoveFixtureFromGroup,
  busy = false,
  renameBusy = false,
  removingFixtureId = null,
  pendingInlineRenameNonce = null,
}: InspectorGroupProps) {
  const onCount = fixtures.filter((fixture) => fixture.on).length;
  const allOn = fixtures.length > 0 && onCount === fixtures.length;
  const renameRef = useRef<InlineRenameHandle | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<{ id: string; name: string } | null>(null);

  // Open the inline rename when the parent signals a one-shot request (chip
  // context-menu "Rename"). Effect runs after mount, so the renameRef is
  // wired before beginEdit fires.
  useEffect(() => {
    if (pendingInlineRenameNonce === null) return;
    renameRef.current?.beginEdit();
  }, [pendingInlineRenameNonce]);

  const intensities = fixtures.map((fixture) => fixture.intensity);
  const ccts = fixtures.map((fixture) => fixture.cct);
  const intensityMin = intensities.length > 0 ? Math.min(...intensities) : 0;
  const intensityMax = intensities.length > 0 ? Math.max(...intensities) : 0;
  const cctMin = ccts.length > 0 ? Math.min(...ccts) : 0;
  const cctMax = ccts.length > 0 ? Math.max(...ccts) : 0;

  const dotState = allOn ? "ok" : "info";

  return (
    <>
      <InspectorSection title="Group">
        <div className={styles.fixtureHeader}>
          <div className={styles.fixtureNameStack}>
            <div className={styles.fixtureNameRow}>
              <div className={styles.fixtureName}>
                {onRenameGroup ? (
                  <InlineRename
                    ref={renameRef}
                    value={groupName}
                    onCommit={(next) => onRenameGroup(groupId, next)}
                    busy={renameBusy}
                    inputAriaLabel={`Rename group ${groupName}`}
                    maxLength={120}
                  />
                ) : (
                  groupName
                )}
              </div>
              {onRenameGroup ? (
                <IconButton
                  tone="ghost"
                  size="sm"
                  icon={Pencil}
                  label={`Rename group ${groupName}`}
                  onClick={() => renameRef.current?.beginEdit()}
                  disabled={renameBusy}
                />
              ) : null}
            </div>
            <div className={styles.fixtureSubline}>
              <StatusDot state={dotState} size="sm" />
              {onCount}/{fixtures.length} on
            </div>
          </div>
          <Button
            onClick={() => onTogglePower(groupId, !allOn)}
            disabled={busy || fixtures.length === 0}
            variant={allOn ? "secondary" : "primary"}
            size="compact"
            leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {allOn ? "Turn group off" : "Turn group on"}
          </Button>
        </div>
        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Intensity</dt>
            <dd className={styles.factValue}>
              {fixtures.length > 0 ? formatLightingValueRange(intensityMin, intensityMax, "%") : "—"}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>CCT</dt>
            <dd className={styles.factValue}>
              {fixtures.length > 0 ? formatLightingValueRange(cctMin, cctMax, "K") : "—"}
            </dd>
          </div>
        </dl>
      </InspectorSection>

      <InspectorSection title="Members">
        {fixtures.length === 0 ? (
          <p className={styles.empty}>This group has no fixtures yet.</p>
        ) : (
          <ul className={styles.memberList}>
            {fixtures.map((fixture) => (
              <li key={fixture.id} className={styles.memberItem}>
                <button type="button" className={styles.memberRow} onClick={() => onSelectFixture(fixture.id)}>
                  <span className={styles.memberName}>{fixture.name}</span>
                  <span className={styles.memberMeta}>
                    {fixture.on ? `${fixture.intensity}% · ${fixture.cct}K` : "off"}
                  </span>
                </button>
                {onRemoveFixtureFromGroup ? (
                  <span className={styles.memberRemove}>
                    <IconButton
                      tone="ghost"
                      size="sm"
                      icon={X}
                      label={`Remove ${fixture.name} from ${groupName}`}
                      onClick={() => setConfirmingRemove({ id: fixture.id, name: fixture.name })}
                      disabled={removingFixtureId === fixture.id}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
      {confirmingRemove && onRemoveFixtureFromGroup ? (
        <ConfirmDialog
          title="Remove from group?"
          body={
            <>
              Remove <strong>{confirmingRemove.name}</strong> from <strong>{groupName}</strong>? The fixture stays in
              the rig and keeps its current state — only its group assignment is cleared.
            </>
          }
          confirmLabel="Remove"
          danger
          busy={removingFixtureId === confirmingRemove.id}
          onConfirm={() => {
            const target = confirmingRemove;
            setConfirmingRemove(null);
            void onRemoveFixtureFromGroup(target.id);
          }}
          onCancel={() => setConfirmingRemove(null)}
        />
      ) : null}
    </>
  );
}
