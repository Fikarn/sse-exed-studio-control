import type { ReactNode } from "react";
import type { ShellStore } from "@sse/engine-client";
import { MenuButton, Section, Tooltip, type MenuEntry, type UseArmResult } from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { AudioStableMeterDbPair } from "../AudioLiveMeterReadout";
import { AudioStereoMeter } from "../AudioStereoMeter";

// The plate's meter (visual overhaul, the Console): the selection's stereo
// meter beside its live level and held peak, the meter's menu in the head.
// The reference marks live in the tooltip; the meter draws them.

export interface AudioPlateMeterProps {
  arm: UseArmResult;
  /** The meter's menu items besides Peak hold and Reset peaks (a channel's Clear clip). */
  extraItems?: MenuEntry[];
  /** What the section shows above the meter (an output's facts). */
  facts?: ReactNode;
  kind: "channel" | "mixTarget";
  meterId: string;
  name: string;
  left: number;
  right: number;
  peakLeft: number;
  peakRight: number;
  mirrorRight: boolean;
  clip?: boolean;
  onResetPeakHolds: () => void;
  onTogglePeakHold: () => void;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  plateSection: "meter" | "output";
  sectionTestId: string;
  meteringTestId: string;
  levelTestId: string;
  peakHoldTestId: string;
  store: ShellStore;
  title?: string;
}

export function AudioPlateMeter({
  arm,
  extraItems = [],
  facts,
  kind,
  meterId,
  name,
  left,
  right,
  peakLeft,
  peakRight,
  mirrorRight,
  clip,
  onResetPeakHolds,
  onTogglePeakHold,
  peakHoldEnabled,
  peakHoldResetToken,
  plateSection,
  sectionTestId,
  meteringTestId,
  levelTestId,
  peakHoldTestId,
  store,
  title = "Meter",
}: AudioPlateMeterProps) {
  const items: MenuEntry[] = [
    {
      kind: "check",
      id: "peak-hold",
      label: "Peak hold",
      checked: peakHoldEnabled,
      onCheckedChange: () => onTogglePeakHold(),
      testId: `${sectionTestId}-menu-peak-hold`,
    },
    {
      id: "reset-peaks",
      label: "Reset peaks",
      onSelect: onResetPeakHolds,
      testId: `${sectionTestId}-menu-reset-peaks`,
    },
    ...extraItems,
  ];
  return (
    <Section
      title={
        <Tooltip content="Post-fader, in dBFS: the reference at −18 dBFS, the warning from −3 dBFS" placement="left">
          <span>{title}</span>
        </Tooltip>
      }
      detail="post-fader"
      actions={
        <MenuButton
          buttonLabel={`${title} menu`}
          buttonTestId={`${sectionTestId}-menu`}
          size="sm"
          menu={{ head: { title: `${name} meter` }, items, arm }}
        />
      }
      className={styles.section}
      data-plate-section={plateSection}
      testId={sectionTestId}
    >
      {facts}
      <div className={styles.meterCard} data-testid={meteringTestId}>
        <AudioStereoMeter
          clip={clip}
          left={left}
          meterId={meterId}
          meterKind={kind}
          mirrorRight={mirrorRight}
          peakLeft={peakLeft}
          peakRight={peakRight}
          right={right}
          showReadout={false}
          showScale
        />
        <dl className={styles.meterReadouts}>
          <div className={styles.meterReadout}>
            <dt>Level L / R</dt>
            <dd>
              <AudioStableMeterDbPair
                fallbackLeft={left}
                fallbackRight={mirrorRight ? left : right}
                kind={kind}
                mirrorRight={mirrorRight}
                meterId={meterId}
                mode="level"
                peakHoldEnabled={peakHoldEnabled}
                peakHoldResetToken={peakHoldResetToken}
                store={store}
                testId={levelTestId}
              />
              <span className={styles.unit}> dBFS</span>
            </dd>
          </div>
          <div className={styles.meterReadout}>
            <dt>Peak hold</dt>
            <dd data-tone={clip ? "clip" : undefined}>
              <AudioStableMeterDbPair
                fallbackLeft={left}
                fallbackRight={mirrorRight ? left : right}
                kind={kind}
                mirrorRight={mirrorRight}
                meterId={meterId}
                mode="peakHold"
                peakHoldEnabled={peakHoldEnabled}
                peakHoldResetToken={peakHoldResetToken}
                store={store}
                testId={peakHoldTestId}
              />
              <span className={styles.unit}> dBFS</span>
            </dd>
          </div>
        </dl>
      </div>
    </Section>
  );
}
