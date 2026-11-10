/**
 * Remembers the last "Scheduling for" and "Meeting type" on /schedule per browser, so an
 * assistant who works for one executive lands on them. Stored values are untrusted: they are only
 * used when that person and meeting type are still available to this user.
 */

export const SCHEDULE_CHOICE_KEY = "keel-calendar:schedule-choice";

export type ScheduleChoice = { principalId: string; typeId: string | null };

type Principal = { id: string; types: readonly { id: string }[] };

/** The remembered choice if it is still available, the person alone if only their type is gone, else null. */
export function restoreChoice(raw: string | null, principals: readonly Principal[]): ScheduleChoice | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { principalId, typeId } = parsed as Record<string, unknown>;
  if (typeof principalId !== "string") return null;
  const principal = principals.find((p) => p.id === principalId && p.types.length > 0);
  if (!principal) return null;
  const type = typeof typeId === "string" ? principal.types.find((t) => t.id === typeId) : undefined;
  return { principalId, typeId: type ? type.id : null };
}

export const serializeChoice = (choice: ScheduleChoice) => JSON.stringify(choice);

type ChoiceStorage = Pick<Storage, "getItem" | "setItem">;

/** localStorage, or null on the server and when the browser blocks storage. */
export function choiceStorage(): ChoiceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChoice(storage: ChoiceStorage | null, principals: readonly Principal[]): ScheduleChoice | null {
  try {
    return restoreChoice(storage?.getItem(SCHEDULE_CHOICE_KEY) ?? null, principals);
  } catch {
    return null;
  }
}

export function writeChoice(storage: ChoiceStorage | null, choice: ScheduleChoice): void {
  try {
    storage?.setItem(SCHEDULE_CHOICE_KEY, serializeChoice(choice));
  } catch {
    // Private mode or a full quota: remembering is a convenience only.
  }
}
