import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { BookingPageView } from "@/features/bookings/components/booking-page";
import { offerTitleFromQuery } from "@/features/offers/server/service";
import { bookingNeedsOffer } from "@/features/privacy/server/guard";
import { resolveBookingTarget, safeDecode } from "@/features/bookings/server/targets";

async function load(params: PageProps<"/[username]/[slug]">["params"]) {
  const { username, slug } = await params;
  return resolveBookingTarget(getDb(), { username: safeDecode(username), slug });
}

export async function generateMetadata({ params, searchParams }: PageProps<"/[username]/[slug]">): Promise<Metadata> {
  const target = await load(params);
  // A title the sender wrote in Email times replaces the meeting type name the client would see.
  const offerTitle = target ? await offerTitleFromQuery(getDb(), await searchParams, target.eventType.id) : null;
  // A private host: the tab shows nothing about them unless the link names its own title.
  const byInvitation = target ? await bookingNeedsOffer(getDb(), target.eventType.id) : false;
  // Reschedule and private links carry tokens in the URL: no referrer.
  return { title: !target ? "Not found" : byInvitation ? offerTitle || "Meeting invitation" : `${offerTitle || target.eventType.title} · ${target.displayName}`, referrer: "no-referrer" };
}

/** Personal booking page, or a dynamic group's (`/ada+bob/intro`, TEAM-009). */
export default async function BookingPage({ params, searchParams }: PageProps<"/[username]/[slug]">) {
  const target = await load(params);
  if (!target) notFound();
  return <BookingPageView target={target} query={await searchParams} />;
}
