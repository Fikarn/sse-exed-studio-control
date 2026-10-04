import { useRef, useState } from "react";
import { Key, MenuButton, Popover, Section, Tooltip, type MenuEntry, type UseArmResult } from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { AudioKnob } from "../AudioKnob";
import type { AudioDynamicsUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";
import type { PlateValueEntry } from "./usePlateValueEntry";

// The plate's dynamics (visual overhaul, the Console; Atrium): a two-row
// table, the compressor and the gate, each row's key switching it and its
// values readable at once. A press on a row's values opens its popover with
// the five knobs; the section's ⋯ switches each and opens each too.

type DynamicsSectionId = "compressor" | "gate";

interface DynamicsField {
  field: "thresholdDb" | "ratio" | "attackMs" | "releaseMs" | "makeupDb";
  name: string;
  caption: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
  bipolar?: boolean;
  format: (value: number) => string;
  defaultValue?: (section: DynamicsSectionId) => number;
  defaultLabel?: (section: DynamicsSectionId) => string;
}

const FIELDS: readonly DynamicsField[] = [
  {
    field: "thresholdDb",
    name: "threshold",
    caption: "Threshold",
    min: -80,
    max: 0,
    step: 1,
    suffix: "dB",
    format: (value) => `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(0)} dB`,
    defaultValue: (section) => (section === "compressor" ? -20 : -45),
  },
  {
    field: "ratio",
    name: "ratio",
    caption: "Ratio",
    min: 1,
    max: 20,
    step: 0.5,
    suffix: ":1",
    format: (value) => `${value.toFixed(1)}:1`,
    defaultValue: (section) => (section === "compressor" ? 3 : 2),
    defaultLabel: (section) => (section === "compressor" ? "3:1" : "2:1"),
  },
  {
    field: "attackMs",
    name: "attack",
    caption: "Attack",
    min: 0.1,
    max: 200,
    step: 0.1,
    suffix: "ms",
    format: (value) => `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`,
  },
  {
    field: "releaseMs",
    name: "release",
    caption: "Release",
    min: 10,
    max: 1000,
    step: 5,
    suffix: "ms",
    format: (value) => `${value.toFixed(0)} ms`,
  },
  {
    field: "makeupDb",
    name: "makeup",
    caption: "Makeup",
    min: -24,
    max: 24,
    step: 0.5,
    suffix: "dB",
    bipolar: true,
    format: (value) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} dB`,
    defaultValue: () => 0,
  },
];

const SECTIONS: readonly { id: DynamicsSectionId; key: string; title: string }[] = [
  { id: "compressor", key: "Comp", title: "Compressor" },
  { id: "gate", key: "Gate", title: "Gate" },
];

export function AudioPlateDynamics({
  arm,
  ask,
  canEdit,
  channel,
  clearDraftValueLater,
  getDraftValue,
  menuLock,
  onUpdateChannelDynamics,
  setDraftValue,
}: {
  arm: UseArmResult;
  ask: (entry: PlateValueEntry) => void;
  canEdit: boolean;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  getDraftValue: (key: string, fallback: number) => number;
  menuLock: string | null;
  onUpdateChannelDynamics: (request: AudioDynamicsUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<DynamicsSectionId | null>(null);
  const lock = menuLock ?? (canEdit ? null : "TotalMix FX cannot be changed now");
  const dynamics = channel.dynamics;
  const draftKey = (section: DynamicsSectionId, field: DynamicsField) =>
    `channel:${channel.id}:dynamics:${section}:${field.name}`;
  const valueOf = (section: DynamicsSectionId, field: DynamicsField) =>
    getDraftValue(draftKey(section, field), dynamics[section][field.field]);
  const send = (section: DynamicsSectionId, field: DynamicsField, value: number) =>
    onUpdateChannelDynamics({ channelId: channel.id, section, [field.field]: value } as AudioDynamicsUpdate);

  const menuItems: MenuEntry[] = [
    ...SECTIONS.map(
      (section) =>
        ({
          kind: "check",
          id: section.id,
          label: section.title,
          checked: dynamics[section.id].enabled,
          onCheckedChange: (enabled: boolean) =>
            onUpdateChannelDynamics({ channelId: channel.id, enabled, section: section.id }),
          disabledReason: lock,
          testId: `audio-dynamics-menu-${section.id}`,
        }) satisfies MenuEntry
    ),
    { kind: "divider", id: "edit" },
    ...SECTIONS.map(
      (section) =>
        ({
          id: `edit-${section.id}`,
          label: `Edit ${section.title.toLowerCase()}…`,
          onSelect: () => setOpen(section.id),
          testId: `audio-dynamics-menu-edit-${section.id}`,
        }) satisfies MenuEntry
    ),
  ];

  const openSection = SECTIONS.find((section) => section.id === open) ?? null;

  return (
    <Section
      title={
        <Tooltip content="TotalMix FX's compressor and gate" placement="left">
          <span>Dynamics</span>
        </Tooltip>
      }
      detail={
        [dynamics.compressor.enabled ? "comp on" : null, dynamics.gate.enabled ? "gate on" : null]
          .filter(Boolean)
          .join(" · ") || "off"
      }
      actions={
        <MenuButton
          buttonLabel="Dynamics menu"
          buttonTestId="audio-dynamics-menu"
          size="sm"
          menu={{ head: { title: "Dynamics", detail: channel.name }, items: menuItems, arm }}
        />
      }
      className={styles.section}
      data-plate-section="dynamics"
      testId="audio-inspector-dynamics"
    >
      <div
        ref={tableRef}
        className={styles.dynTable}
        // A row's key or values keep the focus while the popover is open: an
        // Esc there closes the popover first, as one in the popover does.
        onKeyDown={(event) => {
          if (event.key !== "Escape" || open === null) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(null);
        }}
      >
        <div className={styles.dynRow}>
          <span className={styles.dynHeadCell} />
          {FIELDS.map((field) => (
            <span key={field.field} className={styles.dynHeadCell}>
              {field.caption}
            </span>
          ))}
        </div>
        {SECTIONS.map((section) => {
          const processor = dynamics[section.id];
          return (
            <div key={section.id} className={styles.dynRow} data-active={processor.enabled}>
              <span className={styles.dynKeyCell}>
                <Key
                  mode="toggle"
                  size="small"
                  engaged={processor.enabled}
                  locked={!canEdit}
                  reason={lock ?? undefined}
                  data-active={processor.enabled}
                  aria-label={section.key}
                  onClick={() =>
                    onUpdateChannelDynamics({ channelId: channel.id, enabled: !processor.enabled, section: section.id })
                  }
                >
                  {section.key}
                </Key>
              </span>
              <button
                type="button"
                className={styles.dynValues}
                data-off={processor.enabled ? undefined : ""}
                data-testid={`audio-dynamics-row-${section.id}`}
                aria-label={`Edit ${section.title.toLowerCase()}`}
                aria-expanded={open === section.id}
                onClick={() => setOpen(open === section.id ? null : section.id)}
              >
                {FIELDS.map((field) => (
                  <span key={field.field} className={styles.dynCell}>
                    {field.format(valueOf(section.id, field))}
                  </span>
                ))}
              </button>
            </div>
          );
        })}
      </div>

      <Popover
        open={openSection !== null}
        anchor={tableRef.current}
        onClose={() => setOpen(null)}
        title={openSection?.title}
        placement="top-start"
        width={407}
        ignoreOutside={[tableRef]}
        testId={openSection ? `audio-dynamics-popover-${openSection.id}` : undefined}
      >
        {openSection ? (
          <div className={styles.popoverBody}>
            <div className={styles.popoverKnobs}>
              {FIELDS.map((field) => {
                const key = draftKey(openSection.id, field);
                const value = valueOf(openSection.id, field);
                return (
                  <AudioKnob
                    key={field.field}
                    ariaLabel={`${channel.name} ${openSection.id} ${field.name}`}
                    bipolar={field.bipolar}
                    caption={field.caption}
                    defaultLabel={field.defaultLabel?.(openSection.id)}
                    defaultValue={field.defaultValue?.(openSection.id)}
                    disabled={!canEdit}
                    format={field.format}
                    max={field.max}
                    min={field.min}
                    numericFieldLabel={field.caption}
                    numericSuffix={field.suffix}
                    onCommit={(next) => {
                      setDraftValue(key, next);
                      send(openSection.id, field, next);
                      clearDraftValueLater(key);
                    }}
                    onPreview={(next) => setDraftValue(key, next)}
                    onRequestTypedEntry={() => {
                      setOpen(null);
                      ask({
                        title: `Set ${channel.name} ${openSection.id} ${field.name}`,
                        fieldLabel: field.caption,
                        value,
                        min: field.min,
                        max: field.max,
                        step: field.step,
                        suffix: field.suffix,
                        resetValue: field.defaultValue?.(openSection.id),
                        resetLabel: field.defaultLabel?.(openSection.id),
                        onConfirm: (next) => send(openSection.id, field, next),
                      });
                    }}
                    size={52}
                    step={field.step}
                    value={value}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </Popover>
    </Section>
  );
}
