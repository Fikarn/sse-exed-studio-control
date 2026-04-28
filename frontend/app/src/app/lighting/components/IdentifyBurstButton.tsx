import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";

import { Button } from "@sse/design-system";

const BURST_DURATION_MS = 1200;

export interface IdentifyBurstButtonProps {
  fixtureId: string;
  fixtureName: string;
  onTrigger: (fixtureId: string, fixtureName: string) => void;
  disabled?: boolean;
}

export function IdentifyBurstButton({ fixtureId, fixtureName, onTrigger, disabled = false }: IdentifyBurstButtonProps) {
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
    if (active || disabled) {
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

  return (
    <Button
      onClick={handleClick}
      disabled={disabled}
      loading={active}
      variant={active ? "primary" : "secondary"}
      size="compact"
      leadingVisual={<Zap aria-hidden="true" size={13} strokeWidth={1.75} />}
      aria-pressed={active}
    >
      {active ? "Identifying…" : "Identify"}
    </Button>
  );
}
