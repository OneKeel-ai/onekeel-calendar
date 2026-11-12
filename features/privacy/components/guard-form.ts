/**
 * Form state behind "Calendar privacy" (Settings) and "Private calendars" (Administration), kept
 * free of React so it is unit tested directly. The limits mirror MAX_GUARD_DELEGATES and
 * MAX_GUARD_ADDRESSES in features/privacy/server/guard.ts (server-only, so not imported here).
 */

import { addGuest, type CommitResult, commitDraft, isValidEmail, normalizeEmail, removeGuest } from "@/features/embed/email/meeting-details";

export const GUARD_DELEGATES_MAX = 10;
export const GUARD_ADDRESSES_MAX = 10;

/** One list of addresses as chips, plus the text not yet turned into a chip. */
export type ChipList = { items: readonly string[]; draft: string };

export const EMPTY_CHIPS: ChipList = { items: [], draft: "" };

export type GuardFormValue = { delegates: ChipList; addresses: ChipList };

type SavedGuard = { delegates: readonly string[]; calendarAddresses: readonly string[] };

export function guardForm(saved: SavedGuard | null | undefined): GuardFormValue {
  return {
    delegates: { items: [...(saved?.delegates ?? [])], draft: "" },
    addresses: { items: [...(saved?.calendarAddresses ?? [])], draft: "" },
  };
}

/** Typed text into chips (valid, new, lower-case, at most `max`); anything else stays typed with an error. */
export function commitChips(list: ChipList, text: string, max: number, noun: string): { list: ChipList; error: string | null } {
  if (text.trim() === "") return { list: { ...list, draft: "" }, error: null };
  return toResult(commitDraft(list.items, text, max), max, noun);
}

export function addChip(list: ChipList, email: string, max: number, noun: string): { list: ChipList; error: string | null } {
  return toResult(addGuest(list.items, email, max), max, noun);
}

export function removeChip(list: ChipList, email: string): ChipList {
  return { ...list, items: removeGuest(list.items, email) };
}

function toResult(result: CommitResult, max: number, noun: string): { list: ChipList; error: string | null } {
  const error = result.error?.startsWith("You can invite") ? `You can add up to ${max} ${noun}.` : result.error;
  return { list: { items: result.guests, draft: result.draft }, error };
}

export const DRAFT_LEFT = "Finish or remove the address you started typing.";

/** What to send, or why it can't be sent yet. */
export function guardInput(value: GuardFormValue): { ok: true; input: { delegates: string[]; calendarAddresses: string[] } } | { ok: false; field: "delegates" | "calendarAddresses"; message: string } {
  if (value.delegates.draft.trim()) return { ok: false, field: "delegates", message: DRAFT_LEFT };
  if (value.addresses.draft.trim()) return { ok: false, field: "calendarAddresses", message: DRAFT_LEFT };
  return { ok: true, input: { delegates: [...value.delegates.items], calendarAddresses: [...value.addresses.items] } };
}

/** True when the chips differ from what is saved (order ignored). */
export function guardChanged(value: GuardFormValue, saved: SavedGuard | null | undefined): boolean {
  if (!saved) return true;
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  return !same(value.delegates.items, saved.delegates) || !same(value.addresses.items, saved.calendarAddresses) || value.delegates.draft.trim() !== "" || value.addresses.draft.trim() !== "";
}

/** The admin form's email, trimmed and lower-cased, or an error. */
export function guardEmail(text: string): { ok: true; email: string } | { ok: false; message: string } {
  const email = normalizeEmail(text);
  if (!email) return { ok: false, message: "Enter the person's email address." };
  if (!isValidEmail(email)) return { ok: false, message: `"${text.trim()}" is not a valid email address.` };
  return { ok: true, email };
}
