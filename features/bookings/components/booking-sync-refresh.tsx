"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 2000;
const MAX_TICKS = 10;

/** While a booking waits for its calendar event, re-reads the page every 2 seconds for up to 20. */
export function BookingSyncRefresh() {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (ticks >= MAX_TICKS) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTicks((n) => n + 1);
    }, EVERY_MS);
    return () => clearTimeout(timer);
  }, [ticks, router]);
  return ticks >= MAX_TICKS ? (
    <p className="text-sm text-muted-foreground" role="status">
      This is taking longer than expected. Reload in a minute, or contact the host if it doesn’t change.
    </p>
  ) : (
    <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
      Checking the host’s calendar. This usually takes a few seconds.
    </p>
  );
}
