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

/**
 * Who may book from the links. `onlyOffered`: the client can book only `slots` (every time on the
 * card, free or added by hand). Off, the links also offer "See all available times".
 * `privateHost`: the host keeps their calendar private, so every link needs a saved offer.
 */
export type OfferRules = { onlyOffered: boolean; slots: readonly OfferManualSlot[]; privateHost?: boolean };

/** Links offer every open time, as before this switch existed. */
export const OPEN_RULES: OfferRules = { onlyOffered: false, slots: [] };

/** Identifies what has to be saved: the same key means the same saved offer can be used. */
export function offerKey(
  eventTypeId: string,
  value: Pick<MeetingDetailsValue, "title" | "guests">,
  manualSlots: readonly OfferManualSlot[] = [],
  rules: OfferRules = OPEN_RULES,
): string {
  const base: unknown[] = [eventTypeId, value.title.trim(), value.guests];
  if (manualSlots.length || rules.onlyOffered) base.push(manualSlots.map((m) => [m.start, m.duration]));
  if (rules.onlyOffered) base.push("only", rules.slots.map((m) => [m.start, m.duration]));
  return JSON.stringify(base);
}

/** What the offer saves (the server action's input). `slots` only when the client is limited to them. */
export type OfferSaveInput = {
  eventTypeId: string;
  title: string;
  guests: string[];
  manualSlots: OfferManualSlot[];
  onlyOffered: boolean;
  slots?: OfferManualSlot[];
};

export type OfferPlan =
  /** Nothing to save: links carry no offer, as before. */
  | { kind: "none" }
  /** The client may only book the picked times, and none are picked: nothing to save or copy. */
  | { kind: "empty" }
  | { kind: "save"; key: string; input: OfferSaveInput };

/** Whether (and what) to save for what is on screen. */
export function offerPlan(
  eventTypeId: string,
  value: Pick<MeetingDetailsValue, "title" | "guests">,
  manualSlots: readonly OfferManualSlot[] = [],
  rules: OfferRules = OPEN_RULES,
): OfferPlan {
  if (rules.onlyOffered && rules.slots.length === 0) return { kind: "empty" };
  if (!rules.onlyOffered && !rules.privateHost && isEmptyOffer(value, manualSlots)) return { kind: "none" };
  return {
    kind: "save",
    key: offerKey(eventTypeId, value, manualSlots, rules),
    input: {
      eventTypeId,
      title: value.title.trim(),
      guests: [...value.guests],
      manualSlots: manualSlots.map((m) => ({ ...m })),
      onlyOffered: rules.onlyOffered,
      ...(rules.onlyOffered && { slots: rules.slots.map((m) => ({ ...m })) }),
    },
  };
}

/** Every time on the card, for `slots`: the picks (free or by hand) with the current meeting length, in time order. */
export function offeredSlotsInput(picks: readonly string[], duration: number): OfferManualSlot[] {
  return [...picks].sort((a, b) => Date.parse(a) - Date.parse(b)).map((start) => ({ start, duration }));
}

export type OfferSaveState =
  | { status: "idle" }
  | { status: "saving"; key: string }
  | { status: "saved"; key: string; offerId: string | null }
  | { status: "error"; key: string; message: string; fieldErrors?: OfferFieldErrors };

export type OfferFieldErrors = { title?: string; guests?: string; manualSlots?: string; slots?: string };

export type CopyGate =
  | { canCopy: true; offerId?: string }
  | { canCopy: false; status: "saving" | "error" | "draft" | "empty"; message: string };

export const SAVING_MESSAGE = "Saving meeting details…";
export const DRAFT_MESSAGE = "Finish or remove the address typed in Also invite.";
export const EMPTY_MESSAGE = "Pick at least one time to send.";

export const MANUAL_SAVE_FAILED = "Couldn't save the times added by hand. Try again.";
export const DETAILS_SAVE_FAILED = "Couldn't save meeting details. Try again.";
export const TIMES_SAVE_FAILED = "Couldn't save the picked times. Try again.";

/**
 * Whether the times may be copied. Links must carry the title, people, hand-added times and who
 * may book shown on screen, so copy is only allowed when nothing needs saving (no offer, links as
 * before) or when exactly what is on screen has been saved for this meeting type. A saved offer
 * id always goes into the links.
 */
export function copyGate(
  eventTypeId: string,
  value: MeetingDetailsValue,
  save: OfferSaveState,
  manualSlots: readonly OfferManualSlot[] = [],
  rules: OfferRules = OPEN_RULES,
): CopyGate {
  if (value.draft.trim() !== "") return { canCopy: false, status: "draft", message: DRAFT_MESSAGE };
  const plan = offerPlan(eventTypeId, value, manualSlots, rules);
  if (plan.kind === "none") return { canCopy: true };
  if (plan.kind === "empty") return { canCopy: false, status: "empty", message: EMPTY_MESSAGE };
  if (save.status === "saved" && save.key === plan.key) {
    if (save.offerId) return { canCopy: true, offerId: save.offerId };
    if (value.guests.length > 0) return { canCopy: false, status: "error", message: "The host is already in the meeting. Remove them from Also invite." };
    if (manualSlots.length > 0) return { canCopy: false, status: "error", message: MANUAL_SAVE_FAILED };
    if (rules.onlyOffered) return { canCopy: false, status: "error", message: TIMES_SAVE_FAILED };
    if (!isEmptyDetails(value)) return { canCopy: false, status: "error", message: DETAILS_SAVE_FAILED };
    // Saved only because the host is private, and the server needs no offer: plain links work.
    return { canCopy: true };
  }
  if (save.status === "error" && save.key === plan.key) return { canCopy: false, status: "error", message: save.message };
  return { canCopy: false, status: "saving", message: SAVING_MESSAGE };
}
