import { getDb } from "@/db/client";
import { slotsQuerySchema } from "@/features/bookings/schemas";
import { BookingFailure, findBookingForManage, getAvailableSlots, getManualOfferSlots, getTeamSlots, isMovableBooking, withManualSlots } from "@/features/bookings/server/service";
import { cachedExternalBusyFor, calendarWritableFor } from "@/features/calendars/server/runtime";
import { publicBookingContext } from "@/features/bookings/server/public-context";
import { isUsablePrivateLink } from "@/features/event-types/server/private-links";
import { loadOffer, offerAllows } from "@/features/offers/server/service";
import { allowedForEventTypeHosts, anyPrivate, bookingNeedsOffer } from "@/features/privacy/server/guard";
import { slotLatency } from "@/lib/metrics";
import { clientIp, overLocalLimit } from "@/lib/security/public-limits";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Slots for one visible month of the public booking page (BKG-002). No explanations leak here.
 * GET takes plain query params; the booking widget uses POST so a reschedule's manage token
 * travels in the body, never in URLs or access logs.
 */
async function handle(request: Request, input: unknown) {
  const started = performance.now();
  try {
    return await compute(request, input);
  } finally {
    slotLatency().observe((performance.now() - started) / 1000);
  }
}

/** The signed-in user, if any. Loaded lazily: the public route needs no session otherwise. Any failure means nobody. */
async function signedInUserId(): Promise<string | null> {
  try {
    const { getSession } = await import("@/lib/auth/session");
    return (await getSession())?.user.id ?? null;
  } catch {
    return null;
  }
}

async function compute(request: Request, input: unknown) {
  if (overLocalLimit("slots", clientIp(request.headers))) return json({ error: "Too many requests" }, 429);
  const parsed = slotsQuerySchema.safeParse(input);
  if (!parsed.success) return json({ error: "Invalid query" }, 400);
  const q = parsed.data;
  const db = getDb();
  const context = await publicBookingContext({ username: q.username, team: q.team, slug: q.slug });
  if (!context) return json({ error: "Not found" }, 404);
  const { target, host, eventType, schedule } = context;
  // Group links with someone who keeps their calendar private don't exist (read live: the context is cached).
  if (target.kind === "group" && (await anyPrivate(db, (target.hosts ?? []).map((h) => h.host.id)))) return json({ error: "Not found" }, 404);
  // The booking being moved only stops counting as busy for someone holding its manage token.
  let rescheduleUid: string | undefined;
  let offerId = q.offer;
  if (q.reschedule && q.token) {
    const manage = await findBookingForManage(db, q.reschedule, q.token);
    // Only a booking that can still be moved: a cancelled, rejected or past booking's link opens nothing.
    if (manage?.canManage && manage.booking.eventTypeId === eventType.id && isMovableBooking(manage.booking, Date.now())) {
      rescheduleUid = q.reschedule;
      // Moving a booking made from an offer: that offer's times added by hand (never the URL's).
      offerId = manage.booking.offerId ?? undefined;
    }
  }
  // Link-only event types answer only for holders of a usable single-use link (EVT-015) or of
  // a booking they are moving.
  if (eventType.linkOnly && !rescheduleUid && !(await isUsablePrivateLink(db, eventType.id, q.link, Date.now()))) {
    return json({ error: "Not found" }, 404);
  }
  const offer = offerId ? await loadOffer(db, offerId, eventType.id) : null;
  // Private calendar: by invitation only. Without a valid offer for this event type no free time is
  // computed or shown, also when moving a booking. The one exception is the signed-in host or one of
  // the people they named, picking times on Email times. Checked live, not cached.
  if (!offer && (await bookingNeedsOffer(db, eventType.id))) {
    const viewerId = await signedInUserId();
    if (!viewerId || !(await allowedForEventTypeHosts(db, viewerId, eventType.id))) {
      return json({ slots: [], unavailable: "invitation_only", message: "This meeting is by invitation. Ask your contact for times." });
    }
  }
  // A restricted offer: only the times on the card (that are still available) are listed.
  const offered = <T extends { start: number }>(list: readonly T[]): T[] => (offer?.restricted ? list.filter((s) => offerAllows(offer, s.start, q.duration)) : [...list]);
  const slotRequest = { eventType, durationMin: q.duration, window: { start: q.start, end: q.end }, now: Date.now(), rescheduleUid, ownHoldToken: q.hold, displayCache: true };
  // Times added by hand to a valid offer for this event type with one host. They don't need the
  // host's calendars read, so they stay listed when a required calendar can't be checked.
  let manual: Awaited<ReturnType<typeof getManualOfferSlots>> = [];
  const singleHost = target.hosts ? (target.hosts.length === 1 ? target.hosts[0].host : null) : host;
  // Only for the host they were saved for: a later change of host doesn't carry them over.
  if (offer && singleHost && offer.manualSlots.length && offer.manualHostId === singleHost.id) {
    manual = offered(await getManualOfferSlots(db, { ...slotRequest, host: singleHost, manualSlots: offer.manualSlots }));
  }
  // A restricted offer whose times are all past or unreadable lists nothing, without reading any calendar.
  if (offer?.restricted && !offer.offeredSlots.some((s) => s.duration === q.duration && s.start > Date.now())) return json({ slots: [] });
  try {
    const slots = target.hosts
      ? await getTeamSlots(db, { ...slotRequest, hosts: target.hosts, externalBusyFor: (hostId) => cachedExternalBusyFor(target.hosts!.find((h) => h.host.id === hostId)!.host, eventType.id) })
      : await getAvailableSlots(db, { ...slotRequest, host, externalBusy: cachedExternalBusyFor(host, eventType.id), schedule });
    return json({ slots: offered(withManualSlots(slots, manual)).map((s) => ({ start: s.start, end: s.end, ...(s.seatsRemaining !== undefined && { seats: s.seatsRemaining }) })) });
  } catch (error) {
    // A required calendar can't be checked: no slots (times added by hand excepted), with a reason the page can show.
    if (error instanceof BookingFailure && error.code === "CALENDAR_UNAVAILABLE") {
      // ...unless the booking itself has nowhere to be written: then nothing can be booked at all.
      const writable = manual.length > 0 && singleHost ? await calendarWritableFor(singleHost, eventType.id).then(() => true, () => false) : false;
      return json({ slots: (writable ? manual : []).map((s) => ({ start: s.start, end: s.end })), unavailable: "calendar_unavailable", message: "Online booking is temporarily unavailable. Please contact the host directly." });
    }
    if (error instanceof BookingFailure) return json({ error: error.code }, 400);
    throw error;
  }
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { token: _token, ...withoutToken } = params; // tokens in URLs are not accepted
  return handle(request, withoutToken);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  return handle(request, body);
}
