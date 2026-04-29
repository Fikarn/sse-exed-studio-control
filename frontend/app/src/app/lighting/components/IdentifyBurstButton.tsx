import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";

import { Button, Tooltip } from "@sse/design-system";

const BURST_DURATION_MS = 1200;

export interface IdentifyBurstButtonProps {
  fixtureId: string;
  fixtureName: string;
  onTrigger: (fixtureId: string, fixtureName: string) => void;
  disabled?: boolean;
  /**
   * When false, the button disables with an explanatory tooltip — the burst
   * IPC depends on the bridge being live, so firing it offline is misleading
   * (it would set the active state but no light would change).
   */
  bridgeReachable?: boolean;
}

export function IdentifyBurstButton({
  fixtureId,
  fixtureName,
  onTrigger,
  disabled = false,
  bridgeReachable = true,
}: IdentifyBurstButtonProps) {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActive(false);
  }, [fixtureId]);

  const effectiveDisabled = disabled || !bridgeReachable;

  const handleClick = () => {
    if (active || effectiveDisabled) {
      return;
    }
    onTrigger(fixtureId, fixtureName);
    setActive(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setActive(false);
      timerRef.current = null;
    }, BURST_DURATION_MS);
  };

  const button = (
    <Button
      onClick={handleClick}
      disabled={effectiveDisabled}
      loading={active}
      variant={active ? "primary" : "secondary"}
      size="compact"
      leadingVisual={<Zap aria-hidden="true" size={13} strokeWidth={1.75} />}
      aria-pressed={active}
    >
      {active ? "Identifying…" : "Identify"}
    </Button>
  );

  if (!bridgeReachable) {
    return <Tooltip content="Identify needs the DMX bridge — bridge unreachable">{button}</Tooltip>;
  }
  return button;
}
