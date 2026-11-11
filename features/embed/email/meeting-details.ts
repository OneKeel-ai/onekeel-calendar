/**
 * Pure logic behind the "Meeting details" block of Email times: the custom title and the people
 * invited automatically when the client picks a time. No React here, so it is unit tested directly.
 *
 * The limits mirror MAX_OFFER_TITLE / MAX_OFFER_GUESTS in features/offers/server/service.ts (that
 * module is server-only, so it is not imported into the browser bundle).
 */

export const OFFER_TITLE_MAX = 150;
export const OFFER_GUESTS_MAX = 10;

/** What the sender typed. `draft` is the text in "Also invite" that is not a chip yet. */
export type MeetingDetailsValue = { title: string; guests: readonly string[]; draft: string };

export const EMPTY_MEETING_DETAILS: MeetingDetailsValue = { title: "", guests: [], draft: "" };

export type OfferContact = { name: string; email: string };

// Pragmatic address check: one "@", no spaces or list separators, a dotted domain with a 2+ letter TLD.
const EMAIL_RE = /^[^\s@,;<>()[\]"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/**
 * Splits typed or pasted text into address candidates. Understands commas, semicolons, spaces and
 * new lines, and Gmail-style "Jane Doe <jane@x.com>" entries (only the address is kept).
 */
export function splitAddresses(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\n\r]+/)) {
    const angled = [...part.matchAll(/<([^<>]*)>/g)].map((m) => m[1] ?? "");
    const pieces = angled.length > 0 ? angled : part.split(/\s+/);
    for (const piece of pieces) {
      const trimmed = piece.trim().replace(/^mailto:/i, "");
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

export type CommitResult = { guests: string[]; draft: string; error: string | null };

/**
 * Turns the typed text into chips. Valid, new addresses become chips (lower-cased, no duplicates,
 * at most `max`). Anything invalid, or over the limit, stays in the text with an error; it never
 * becomes a chip.
 */
export function commitDraft(guests: readonly string[], draft: string, max = OFFER_GUESTS_MAX): CommitResult {
  const next = [...guests];
  const kept: string[] = [];
  let invalid: string | null = null;
  let full = false;
  for (const candidate of splitAddresses(draft)) {
    const email = normalizeEmail(candidate);
    if (!isValidEmail(email)) {
      invalid ??= candidate;
      kept.push(candidate);
    } else if (next.includes(email)) {
      // Already invited: nothing to add.
    } else if (next.length >= max) {
      full = true;
      kept.push(candidate);
    } else {
      next.push(email);
    }
  }
  const error = invalid ? `"${invalid}" is not a valid email address.` : full ? `You can invite up to ${max} people.` : null;
  return { guests: next, draft: kept.join(", "), error };
}

/** Adds one known address (a picked suggestion). */
export function addGuest(guests: readonly string[], email: string, max = OFFER_GUESTS_MAX): CommitResult {
  const value = normalizeEmail(email);
  if (!isValidEmail(value)) return { guests: [...guests], draft: "", error: `"${email}" is not a valid email address.` };
  if (guests.includes(value)) return { guests: [...guests], draft: "", error: null };
  if (guests.length >= max) return { guests: [...guests], draft: "", error: `You can invite up to ${max} people.` };
  return { guests: [...guests, value], draft: "", error: null };
}

export function removeGuest(guests: readonly string[], email: string): string[] {
  return guests.filter((g) => g !== email);
}

/** Team contacts matching the typed text by name or email, minus people already invited. */
export function filterSuggestions(contacts: readonly OfferContact[], query: string, guests: readonly string[], limit = 6): OfferContact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return contacts
    .filter((c) => !guests.includes(normalizeEmail(c.email)))
    .filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
    .slice(0, limit);
}

export const isEmptyDetails = (value: Pick<MeetingDetailsValue, "title" | "guests">) => value.title.trim() === "" && value.guests.length === 0;

/** A time added by hand, as saved in the offer (start ISO 8601 UTC, duration in minutes). */
export type OfferManualSlot = { start: string; duration: number };

/** Nothing to save: no title, no people and no hand-added times (links then carry no offer). */
export const isEmptyOffer = (value: Pick<MeetingDetailsValue, "title" | "guests">, manualSlots: readonly OfferManualSlot[] = []) =>
  isEmptyDetails(value) && manualSlots.length === 0;

/** Identifies what has to be saved: the same key means the same saved offer can be used. */
export function offerKey(eventTypeId: string, value: Pick<MeetingDetailsValue, "title" | "guests">, manualSlots: readonly OfferManualSlot[] = []): string {
  const base = [eventTypeId, value.title.trim(), value.guests];
  return JSON.stringify(manualSlots.length ? [...base, manualSlots.map((m) => [m.start, m.duration])] : base);
}

export type OfferSaveState =
  | { status: "idle" }
  | { status: "saving"; key: string }
  | { status: "saved"; key: string; offerId: string | null }
  | { status: "error"; key: string; message: string; fieldErrors?: OfferFieldErrors };

export type OfferFieldErrors = { title?: string; guests?: string; manualSlots?: string };

export type CopyGate =
  | { canCopy: true; offerId?: string }
  | { canCopy: false; status: "saving" | "error" | "draft"; message: string };

export const SAVING_MESSAGE = "Saving meeting details…";
export const DRAFT_MESSAGE = "Finish or remove the address typed in Also invite.";

export const MANUAL_SAVE_FAILED = "Couldn't save the times added by hand. Try again.";

/**
 * Whether the times may be copied. Links must carry the title, people and hand-added times shown
 * on screen, so copy is only allowed when all are empty (no offer, links as before) or when
 * exactly what is on screen has been saved for this meeting type.
 */
export function copyGate(eventTypeId: string, value: MeetingDetailsValue, save: OfferSaveState, manualSlots: readonly OfferManualSlot[] = []): CopyGate {
  if (value.draft.trim() !== "") return { canCopy: false, status: "draft", message: DRAFT_MESSAGE };
  if (isEmptyOffer(value, manualSlots)) return { canCopy: true };
  const key = offerKey(eventTypeId, value, manualSlots);
  if (save.status === "saved" && save.key === key) {
    if (save.offerId) return { canCopy: true, offerId: save.offerId };
    const message = value.guests.length > 0 ? "The host is already in the meeting. Remove them from Also invite." : MANUAL_SAVE_FAILED;
    return { canCopy: false, status: "error", message };
  }
  if (save.status === "error" && save.key === key) return { canCopy: false, status: "error", message: save.message };
  return { canCopy: false, status: "saving", message: SAVING_MESSAGE };
}
