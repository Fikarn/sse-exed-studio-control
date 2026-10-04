import { useEffect, useRef, useState } from "react";

import { Key } from "@sse/design-system";

const BURST_DURATION_MS = 1200;

export interface IdentifyBurstButtonProps {
  fixtureId: string;
  fixtureName: string;
  onTrigger: (fixtureId: string, fixtureName: string) => void;
  disabled?: boolean;
  /** When false, the key is locked and says why: a burst while the bridge has
   *  not passed its probe would light nothing the operator can trust. */
  bridgeReachable?: boolean;
  size?: "default" | "large";
}

// Identify: a 1.2 s burst of the fixture at full, so the operator can find it
// in the room (the hardware link's `identify.rs`). The key is lit for the
// burst and reads "Bursting…".
export function IdentifyBurstButton({
  fixtureId,
  fixtureName,
  onTrigger,
  disabled = false,
  bridgeReachable = true,
  size = "default",
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

  const handleClick = () => {
    if (active || disabled || !bridgeReachable) return;
    onTrigger(fixtureId, fixtureName);
    setActive(true);
    timerRef.current = window.setTimeout(() => {
      setActive(false);
      timerRef.current = null;
    }, BURST_DURATION_MS);
  };

  return (
    <Key
      size={size}
      live={active}
      aria-pressed={active}
      disabled={disabled}
      locked={!bridgeReachable}
      reason="The bridge has not passed its probe, so Identify waits. Open Setup to run the probe."
      onClick={handleClick}
    >
      {active ? "Bursting…" : "Identify"}
    </Key>
  );
}
