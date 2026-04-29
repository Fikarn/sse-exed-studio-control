import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { Button, Dialog } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import {
  findNextLightingFixtureStartAddress,
  lightingFixtureChannelCount,
  lightingFixtureMaxStartAddress,
} from "../lightingPatch";

import styles from "./RenameDialog.module.css";

interface FixtureTypeOption {
  value: string;
  label: string;
  description: string;
}

const FIXTURE_TYPE_OPTIONS: ReadonlyArray<FixtureTypeOption> = [
  { value: "astra-bicolor", label: "Astra Bi-Color", description: "Stand · 2 ch (Dimmer + CCT)" },
  { value: "apollo bridge", label: "Apollo Bridge", description: "Grid panel · 2 ch" },
  { value: "infinimat", label: "Infinimat", description: "Grid soft · 4 ch" },
  { value: "infinibar-pb12", label: "Infinibar PB12", description: "Wall bar · 8 ch" },
];

export interface CreateFixtureDialogProps {
  /** Live fixtures used to suggest the next safe DMX start address. */
  fixtures: readonly LightingFixtureSnapshot[];
  /** Default fixture name (e.g. "Fixture 4"). User can edit before save. */
  defaultName: string;
  busy?: boolean;
  onConfirm: (request: { name: string; type: string; dmxStartAddress: number }) => void;
  onCancel: () => void;
}

export function CreateFixtureDialog({
  fixtures,
  defaultName,
  busy = false,
  onConfirm,
  onCancel,
}: CreateFixtureDialogProps) {
  const nameId = useId();
  const typeId = useId();
  const dmxId = useId();
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<string>(FIXTURE_TYPE_OPTIONS[0]!.value);

  // Re-suggest the DMX start address whenever the user picks a different type
  // — channel widths differ, so the safe slot can shift.
  const suggestedDmx = useMemo(
    () =>
      findNextLightingFixtureStartAddress(
        fixtures.map((fixture) => ({
          dmxStartAddress: fixture.dmxStartAddress,
          type: fixture.type,
        })),
        type
      ),
    [fixtures, type]
  );

  const [dmxDraft, setDmxDraft] = useState<string>(String(suggestedDmx));

  // Keep the dmx draft in sync with the suggestion *only when* the user
  // hasn't manually typed yet (i.e. when the draft still matches the
  // previous suggestion). Tracked via a separate ref-style flag would be
  // overkill — instead, only auto-update on type change so a manual address
  // is never silently overwritten by a power-state update.
  useEffect(() => {
    setDmxDraft(String(suggestedDmx));
  }, [suggestedDmx]);

  const trimmedName = name.trim();
  const channelCount = lightingFixtureChannelCount(type);
  const maxStart = lightingFixtureMaxStartAddress(type);
  const dmxValue = Number.parseInt(dmxDraft, 10);
  const dmxValid = Number.isFinite(dmxValue) && dmxValue >= 1 && dmxValue <= maxStart;
  const canSubmit = trimmedName.length > 0 && dmxValid && !busy;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm({ name: trimmedName, type, dmxStartAddress: dmxValue });
  };

  return (
    <Dialog
      title="Add fixture"
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy} variant="ghost" size="compact">
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ name: trimmedName, type, dmxStartAddress: dmxValue })}
            disabled={!canSubmit}
            loading={busy}
            variant="primary"
            size="compact"
          >
            Add fixture
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor={nameId} className={styles.label}>
          Name
        </label>
        <input
          id={nameId}
          className={styles.input}
          type="text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
        />

        <label htmlFor={typeId} className={styles.label}>
          Type
        </label>
        <select
          id={typeId}
          className={styles.select}
          value={type}
          onChange={(event) => setType(event.currentTarget.value)}
        >
          {FIXTURE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} — {option.description}
            </option>
          ))}
        </select>

        <label htmlFor={dmxId} className={styles.label}>
          DMX start address
        </label>
        <input
          id={dmxId}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={1}
          max={maxStart}
          value={dmxDraft}
          onChange={(event) => setDmxDraft(event.currentTarget.value)}
        />
        <p className={styles.hint}>
          {channelCount} channels · range {dmxValid ? `${dmxValue}–${dmxValue + channelCount - 1}` : "—"} of 512.
          Suggested next slot: {suggestedDmx}.
        </p>
      </form>
    </Dialog>
  );
}
