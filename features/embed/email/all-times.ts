/**
 * "Let the client see all available times" on Email times, kept free of React so it is unit
 * tested directly. Off (the default), the email has no "See all available times" link and the
 * offer only lets the client book the picked times. The choice is remembered per browser.
 */

export const SHOW_ALL_TIMES_KEY = "keel-calendar:show-all-times";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null on the server and when the browser blocks storage. */
export function flagStorage(): FlagStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Off unless this browser explicitly remembered "on". */
export function readShowAllTimes(storage: FlagStorage | null): boolean {
  try {
    return storage?.getItem(SHOW_ALL_TIMES_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeShowAllTimes(storage: FlagStorage | null, on: boolean): void {
  try {
    storage?.setItem(SHOW_ALL_TIMES_KEY, on ? "on" : "off");
  } catch {
    // Private mode or a full quota: remembering is a convenience only.
  }
}

/** "your" for the signed-in user ("you"), else "Tré's". */
export function possessive(hostLabel: string): string {
  const label = hostLabel.trim();
  if (!label) return "the host's";
  return label.toLowerCase() === "you" ? "your" : `${label}'s`;
}

/** Helper text under the switch, and a warning when it exposes a private host's open times. */
export function allTimesHelp(on: boolean, hostLabel: string, privateHost: boolean): { help: string; warning: string | null } {
  if (!on) return { help: "The client can only book the times you picked.", warning: null };
  const help = `Adds a See all available times link. The client can pick any open time on ${possessive(hostLabel)} calendar.`;
  if (!privateHost) return { help, warning: null };
  const self = hostLabel.trim().toLowerCase() === "you";
  const warning = self
    ? "You keep your calendar private. Turning this on shows this client all of your open times."
    : `${hostLabel.trim() || "This host"} keeps their calendar private. Turning this on shows this client all of their open times.`;
  return { help, warning };
}
