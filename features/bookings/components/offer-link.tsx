import { CalendarX } from "lucide-react";

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
