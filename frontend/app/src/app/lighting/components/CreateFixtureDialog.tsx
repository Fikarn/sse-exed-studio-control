import { useEffect, useId, useMemo, useState, type FormEvent } from "react";

import { Button, Dialog } from "@sse/design-system";
import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureDefinitionSnapshot,
  LightingFixtureSnapshot,
} from "@sse/engine-client";

import { fixtureDefinitionLabel, getFixtureMode, normalizeCatalogAlias } from "../fixtureCatalog";
import {
  findNextLightingFixtureStartAddress,
  lightingFixtureChannelCount,
  lightingFixtureMaxStartAddress,
} from "../lightingPatch";

import styles from "./RenameDialog.module.css";

export interface CreateFixtureDialogProps {
  catalog: LightingFixtureCatalogSnapshot | null;
  /** Live fixtures used to suggest the next safe DMX start address. */
  fixtures: readonly LightingFixtureSnapshot[];
  /** Default fixture name (e.g. "Fixture 4"). User can edit before save. */
  defaultName: string;
  busy?: boolean;
  onConfirm: (request: {
    name: string;
    type: string;
    definitionId: string;
    modeId: string;
    universe: number;
    dmxStartAddress: number;
  }) => void;
  onCancel: () => void;
}

function isSelectable(definition: LightingFixtureDefinitionSnapshot) {
  return definition.status === "verified" && definition.kind !== "control-node";
}

function fixtureTypeForDefinition(definitionId: string) {
  switch (definitionId) {
    case "litepanels-astra-bicolor":
      return "astra-bicolor";
    case "aputure-infinimat-generic":
      return "infinimat";
    case "aputure-infinibar-pb12":
      return "infinibar-pb12";
    case "litepanels-apollo-bridge":
      return "Apollo Bridge";
    default:
      return definitionId;
  }
}

export function CreateFixtureDialog({
  catalog,
  fixtures,
  defaultName,
  busy = false,
  onConfirm,
  onCancel,
}: CreateFixtureDialogProps) {
  const nameId = useId();
  const typeId = useId();
  const modeId = useId();
  const universeId = useId();
  const dmxId = useId();
  const [name, setName] = useState(defaultName);
  const definitions = useMemo(() => catalog?.definitions ?? [], [catalog]);
  const selectableDefinitions = useMemo(() => definitions.filter(isSelectable), [definitions]);
  const [definitionId, setDefinitionId] = useState<string>(selectableDefinitions[0]?.id ?? "litepanels-astra-bicolor");
  const selectedDefinition =
    definitions.find((definition) => definition.id === definitionId) ??
    definitions.find((definition) => normalizeCatalogAlias(definition.id) === normalizeCatalogAlias(definitionId)) ??
    selectableDefinitions[0] ??
    null;
  const [selectedModeId, setSelectedModeId] = useState<string>(
    selectedDefinition?.defaultModeId ?? selectedDefinition?.modes[0]?.id ?? "default"
  );
  const selectedMode = getFixtureMode(selectedDefinition, selectedModeId);
  const [universeDraft, setUniverseDraft] = useState("1");
  const universeValue = Math.max(1, Math.round(Number.parseInt(universeDraft, 10) || 1));
  const selectedIdentity = useMemo(
    () => ({
      definitionId: selectedDefinition?.id ?? definitionId,
      modeId: selectedMode?.id ?? selectedModeId,
      type: fixtureTypeForDefinition(selectedDefinition?.id ?? definitionId),
      kind: selectedDefinition?.kind ?? "profile",
      universe: universeValue,
      dmxStartAddress: 1,
    }),
    [definitionId, selectedDefinition?.id, selectedDefinition?.kind, selectedMode?.id, selectedModeId, universeValue]
  );

  useEffect(() => {
    if (!selectedDefinition) return;
    setSelectedModeId(selectedDefinition.defaultModeId || selectedDefinition.modes[0]?.id || "default");
  }, [selectedDefinition]);

  const suggestedDmx = useMemo(
    () => findNextLightingFixtureStartAddress([...fixtures], selectedIdentity, universeValue, catalog),
    [catalog, fixtures, selectedIdentity, universeValue]
  );

  const [dmxDraft, setDmxDraft] = useState<string>(String(suggestedDmx));

  useEffect(() => {
    setDmxDraft(String(suggestedDmx));
  }, [suggestedDmx]);

  const trimmedName = name.trim();
  const channelCount = lightingFixtureChannelCount(selectedIdentity, catalog);
  const maxStart = lightingFixtureMaxStartAddress(selectedIdentity, catalog);
  const dmxValue = Number.parseInt(dmxDraft, 10);
  const dmxValid =
    channelCount <= 0 ? dmxValue === 0 : Number.isFinite(dmxValue) && dmxValue >= 1 && dmxValue <= maxStart;
  const canSubmit = Boolean(selectedDefinition && selectedMode && trimmedName.length > 0 && dmxValid && !busy);
  const largeFootprint = channelCount >= 64;

  const groupedDefinitions = useMemo(() => {
    const groups = new Map<string, LightingFixtureDefinitionSnapshot[]>();
    for (const definition of definitions) {
      const key = `${definition.manufacturer} · ${definition.family}`;
      groups.set(key, [...(groups.get(key) ?? []), definition]);
    }
    return [...groups.entries()];
  }, [definitions]);

  const submit = () => {
    if (!canSubmit || !selectedDefinition || !selectedMode) return;
    onConfirm({
      name: trimmedName,
      type: fixtureTypeForDefinition(selectedDefinition.id),
      definitionId: selectedDefinition.id,
      modeId: selectedMode.id,
      universe: universeValue,
      dmxStartAddress: dmxValue,
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
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
          <Button onClick={submit} disabled={!canSubmit} loading={busy} variant="primary" size="compact">
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
          Fixture
        </label>
        <select
          id={typeId}
          className={styles.select}
          value={definitionId}
          onChange={(event) => setDefinitionId(event.currentTarget.value)}
        >
          {groupedDefinitions.map(([group, entries]) => (
            <optgroup key={group} label={group}>
              {entries.map((definition) => (
                <option key={definition.id} value={definition.id} disabled={!isSelectable(definition)}>
                  {fixtureDefinitionLabel(definition)}
                  {isSelectable(definition) ? "" : " · verification pending"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label htmlFor={modeId} className={styles.label}>
          Mode
        </label>
        <select
          id={modeId}
          className={styles.select}
          value={selectedModeId}
          onChange={(event) => setSelectedModeId(event.currentTarget.value)}
        >
          {(selectedDefinition?.modes ?? []).map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.displayName} · {mode.channelCount} ch · {mode.capabilities.join(", ") || "metadata"}
            </option>
          ))}
        </select>

        <label htmlFor={universeId} className={styles.label}>
          Universe
        </label>
        <input
          id={universeId}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={1}
          value={universeDraft}
          onChange={(event) => setUniverseDraft(event.currentTarget.value)}
        />

        <label htmlFor={dmxId} className={styles.label}>
          DMX start address
        </label>
        <input
          id={dmxId}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={channelCount <= 0 ? 0 : 1}
          max={maxStart}
          value={dmxDraft}
          onChange={(event) => setDmxDraft(event.currentTarget.value)}
        />
        <p className={styles.hint}>
          {selectedMode?.displayName ?? "No mode"} · {channelCount} channels ·{" "}
          {dmxValid && channelCount > 0 ? `U${universeValue} ${dmxValue}-${dmxValue + channelCount - 1}` : "unpatched"}.
          Suggested next slot: {suggestedDmx}. {largeFootprint ? "Large footprint." : ""}
        </p>
      </form>
    </Dialog>
  );
}
