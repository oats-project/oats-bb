// The clock, read again every half minute while a view is open: an age must grow while nothing
// else changes in OATS and no new snapshot arrives.
import { useEffect, useState } from "react";

export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
