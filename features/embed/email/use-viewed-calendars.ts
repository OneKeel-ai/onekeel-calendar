"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BusyPerson, LoadBusy } from "./planner";

export type ViewedCalendarsState =
  | { status: "idle" | "loading" | "ready"; members: readonly BusyPerson[] }
  | { status: "error"; members: readonly BusyPerson[]; message: string };

const EMPTY: readonly BusyPerson[] = [];

/**
 * Busy blocks of the people the sender may view, for one window. Loads only while the calendar
 * view is open; a newer window wins over a response still in flight. Read-only by design.
 */
export function useViewedCalendars(
  load: LoadBusy | undefined,
  start: number | null,
  end: number | null,
  enabled: boolean,
): ViewedCalendarsState & { retry: () => void } {
  const [state, setState] = useState<ViewedCalendarsState>({ status: "idle", members: EMPTY });
  const seq = useRef(0);

  const run = useCallback(async () => {
    if (!load || !enabled || start === null || end === null || end <= start) return;
    const id = ++seq.current;
    setState((prev) => ({ status: "loading", members: prev.members }));
    try {
      const res = await load(start, end);
      if (id !== seq.current) return;
      const members = res.members ?? EMPTY;
      setState(res.error ? { status: "error", members, message: res.error } : { status: "ready", members });
    } catch {
      if (id === seq.current) setState({ status: "error", members: EMPTY, message: "Couldn't load calendars. Please try again." });
    }
  }, [load, enabled, start, end]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching is the effect's purpose
    void run();
  }, [run]);

  return { ...state, retry: run };
}
