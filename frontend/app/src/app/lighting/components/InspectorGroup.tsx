import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  ColorPicker,
  InlineRename,
  Key,
  MenuButton,
  PlateHead,
  Readouts,
  Section,
  type InlineRenameHandle,
  type MenuContent,
} from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { formatLightingValueRange, lightingFixtureColor } from "../lightingHelpers";
import { LIGHTING_COLOR_TAG_PALETTE } from "../lightingColorTags";
import type { LightingMenu } from "../lightingMenus";

import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): a group on the plate. Its
// title plate (its name, how many of its fixtures are on, its ⋯: the same
// menu as its key in the cluster, Delete group… last, arming in place); Turn
// on or off; and its fixtures, each a row that opens the fixture, with a ⋯
// that takes it out of the group (not a delete: the fixture stays in the rig).

const MEMBER_ROWS = 14;

export interface InspectorGroupProps {
  groupId: string;
  groupName: string;
  colorIndex?: number | null;
  fixtures: readonly LightingFixtureSnapshot[];
  menu: LightingMenu;
  arm: MenuContent["arm"];
  onTogglePower: (groupId: string, on: boolean) => void;
  onSelectFixture: (fixtureId: string) => void;
  onIdentifyFixture?: (fixtureId: string, name: string) => void;
  onRenameGroup?: (groupId: string, newName: string) => void | Promise<void>;
  onRemoveFixtureFromGroup?: (fixtureId: string) => void | Promise<void>;
  busy?: boolean;
  renameBusy?: boolean;
  pendingInlineRenameNonce?: number | null;
  /** The menu's Colour…, as a nonce. */
  colourRequest?: number;
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;
}

export function InspectorGroup({
  groupId,
  groupName,
  colorIndex = null,
  fixtures,
  menu,
  arm,
  onTogglePower,
  onSelectFixture,
  onIdentifyFixture,
  onRenameGroup,
  onRemoveFixtureFromGroup,
  busy = false,
  renameBusy = false,
  pendingInlineRenameNonce = null,
  colourRequest = 0,
  onSetGroupColor,
}: InspectorGroupProps) {
  const headRef = useRef<HTMLDivElement | null>(null);
  const [colourAt, setColourAt] = useState<{ x: number; y: number } | null>(null);
  const seenColour = useRef(colourRequest);
  useEffect(() => {
    if (colourRequest === seenColour.current) return;
    seenColour.current = colourRequest;
    const box = headRef.current?.getBoundingClientRect();
    if (box) setColourAt({ x: box.left + 16, y: box.bottom });
  }, [colourRequest]);
  const onCount = fixtures.filter((fixture) => fixture.on).length;
  const allOn = fixtures.length > 0 && onCount === fixtures.length;
  const renameRef = useRef<InlineRenameHandle | null>(null);
  useEffect(() => {
    if (pendingInlineRenameNonce === null) return;
    renameRef.current?.beginEdit();
  }, [pendingInlineRenameNonce]);

  const lit = fixtures.filter((fixture) => fixture.on);
  const intensities = lit.map((fixture) => fixture.intensity);
  const ccts = lit.map((fixture) => fixture.cct);
  const shown = fixtures.slice(0, MEMBER_ROWS);

  return (
    <>
      <div ref={headRef}>
        <PlateHead
          title={
            onRenameGroup ? (
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
            )
          }
          sub={`Group · ${onCount} of ${fixtures.length} on`}
          action={
            <MenuButton buttonLabel={`${groupName} menu`} buttonTestId="lighting-plate-menu" menu={{ ...menu, arm }} />
          }
          testId="lighting-plate-head"
        />
      </div>

      <div className={styles.keyRow}>
        <Key
          mode="toggle"
          size="large"
          live={allOn}
          aria-pressed={allOn}
          disabled={busy || fixtures.length === 0}
          onClick={() => onTogglePower(groupId, !allOn)}
        >
          {allOn ? "Turn group off" : "Turn group on"}
        </Key>
      </div>

      <Readouts
        rows={[
          {
            id: "intensity",
            label: "Levels",
            value:
              intensities.length > 0
                ? formatLightingValueRange(Math.min(...intensities), Math.max(...intensities), "%")
                : "all off",
          },
          {
            id: "cct",
            label: "Colour",
            value: ccts.length > 0 ? formatLightingValueRange(Math.min(...ccts), Math.max(...ccts), "K") : "—",
          },
        ]}
      />

      <Section title="Fixtures" detail={`${fixtures.length} in the group`}>
        {fixtures.length === 0 ? (
          <p className={styles.empty}>This group has no fixtures yet. Put one in it from the fixture's menu.</p>
        ) : (
          <ul className={styles.memberList} aria-label={`Fixtures in ${groupName}`}>
            {shown.map((fixture) => (
              <li key={fixture.id} className={styles.memberItem}>
                <button
                  type="button"
                  className={styles.memberRow}
                  aria-label={`Show ${fixture.name} on the plate`}
                  onClick={() => onSelectFixture(fixture.id)}
                >
                  <span
                    aria-hidden="true"
                    className={styles.memberLamp}
                    style={{ background: lightingFixtureColor(fixture.cct, fixture.on) } as CSSProperties}
                  />
                  <span className={styles.memberName}>{fixture.name}</span>
                  <span className={styles.memberValue}>
                    {fixture.on ? `${Math.round(fixture.intensity)} % · ${Math.round(fixture.cct)} K` : "off"}
                  </span>
                </button>
                <MenuButton
                  buttonLabel={`${fixture.name} in ${groupName} menu`}
                  size="sm"
                  menu={{
                    head: { title: fixture.name, detail: `in ${groupName}` },
                    items: [
                      { id: "show", label: "Show on the plate", onSelect: () => onSelectFixture(fixture.id) },
                      ...(onIdentifyFixture
                        ? [
                            {
                              id: "identify",
                              label: "Identify",
                              onSelect: () => onIdentifyFixture(fixture.id, fixture.name),
                            },
                          ]
                        : []),
                      ...(onRemoveFixtureFromGroup
                        ? [
                            { kind: "divider" as const, id: "out" },
                            {
                              id: "take-out",
                              label: `Take it out of ${groupName}`,
                              onSelect: () => void onRemoveFixtureFromGroup(fixture.id),
                            },
                          ]
                        : []),
                    ],
                    arm,
                  }}
                />
              </li>
            ))}
            {fixtures.length > shown.length ? (
              <li className={styles.memberMore}>and {fixtures.length - shown.length} more</li>
            ) : null}
          </ul>
        )}
      </Section>
      {colourAt && onSetGroupColor ? (
        <ColorPicker
          x={colourAt.x}
          y={colourAt.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colorIndex}
          onSelect={(next) => onSetGroupColor(groupId, next)}
          onClose={() => setColourAt(null)}
          ariaLabel={`Pick a colour for group ${groupName}`}
        />
      ) : null}
    </>
  );
}
