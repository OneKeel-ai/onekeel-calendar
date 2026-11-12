import { CalendarX, Lock } from "lucide-react";

/**
 * Links sent from Email times can carry `?offer=<id>`: a saved meeting title and people to invite.
 * When that offer is missing, unknown or for another meeting type the page fails closed: it shows
 * this message and no booking form, never a plain booking page that would drop those people.
 */
export const OFFER_INVALID_MESSAGE = "This scheduling link is no longer valid. Ask the sender for new times.";

/** True when a booking submission was refused because of the offer in the link. */
export function isInvalidOfferError(result: { message?: string; fieldErrors?: Record<string, string> }): boolean {
  if (result.fieldErrors?.offer) return true;
  const message = result.message ?? "";
  return message === OFFER_INVALID_MESSAGE || /scheduling link is no longer valid/i.test(message);
}

/** "Also attending: a@x.com, b@y.com", or null when nobody else is invited. */
export function alsoAttendingLine(guests: readonly string[] | undefined): string | null {
  return guests && guests.length > 0 ? `Also attending: ${guests.join(", ")}` : null;
}

/** A private host's booking page opened without a link from Email times. */
export const INVITATION_ONLY_MESSAGE = "This meeting is by invitation. Ask your contact for times.";

/** Shown beside the calendar when the link only lets the client book the times that were sent. */
export const RESTRICTED_OFFER_LINE = "You can book one of the times that were sent to you. Need a different time? Reply to the email.";

/** Shown when none of the times that were sent can be booked any more. */
export const RESTRICTED_GONE_MESSAGE = "The times that were sent are no longer open. Reply to the email to ask for new ones.";

/** True when the server refused because the page is by invitation only (no usable link). */
export function isInvitationOnlyError(result: { message?: string; fieldErrors?: Record<string, string> }): boolean {
  const message = result.message ?? "";
  return message === INVITATION_ONLY_MESSAGE || /by invitation/i.test(message);
}

/**
 * Whether to say that the sent times are gone: the link is restricted to the times that were
 * sent, the shown range has none, and no sent time still to come lies outside that range (then
 * the booker only needs to move to another week or month).
 */
export function sentTimesGone(input: { restricted: boolean; offered: readonly number[]; shown: number; range: { start: number; end: number } | null; now: number }): boolean {
  if (!input.restricted || input.shown > 0) return false;
  const { range } = input;
  return !input.offered.some((t) => t > input.now && (!range || t < range.start || t >= range.end));
}

/** Replaces the whole booking page: no calendar, no form. */
export function InvitationOnly() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="booking-invitation-only">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Lock className="size-5" />
      </span>
      <p role="status" className="max-w-sm text-base font-medium">
        {INVITATION_ONLY_MESSAGE}
      </p>
    </div>
  );
}

/** Replaces the whole booking view when the link's offer can't be used. */
export function OfferLinkInvalid() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid="offer-link-invalid">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <CalendarX className="size-5" />
      </span>
      <p role="alert" className="max-w-sm text-base font-medium">
        {OFFER_INVALID_MESSAGE}
      </p>
    </div>
  );
}
