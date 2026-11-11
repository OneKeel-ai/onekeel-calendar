"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { offerContacts, saveOffer } from "./service";

/**
 * Scheduling offers for the email embed. Authentication here; who may schedule for the event
 * type is checked in the service, from the server's own records (never from the client).
 */

export type SaveOfferResult =
  | { ok: true; offerId: string | null } // null when title is blank AND guests is empty AND manualSlots is empty
  | { ok: false; message: string; fieldErrors?: { title?: string; guests?: string; manualSlots?: string } };

const eventTypeId = z.string().min(1).max(64);

const saveSchema = z.object({
  eventTypeId,
  // Generous raw limits: the service normalizes and applies the real caps with field errors.
  title: z.string().max(2000),
  guests: z.array(z.string().max(320)).max(100),
  manualSlots: z.array(z.object({ start: z.string().max(64), duration: z.number().int().positive().max(1440) })).max(50).optional(),
});

export async function saveOfferAction(input: {
  eventTypeId: string;
  title: string;
  guests: string[];
  manualSlots?: { start: string; duration: number }[];
}): Promise<SaveOfferResult> {
  const user = await requireUser();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: {
        ...(fields.has("title") && { title: "This title is too long" }),
        ...(fields.has("guests") && { guests: "Too many attendees" }),
        ...(fields.has("manualSlots") && { manualSlots: "Some of the times added by hand can't be used" }),
      },
    };
  }
  return saveOffer(getDb(), user.id, parsed.data);
}

export async function offerContactsAction(input: { eventTypeId: string }): Promise<{ name: string; email: string }[]> {
  const user = await requireUser();
  const parsed = z.object({ eventTypeId }).safeParse(input);
  if (!parsed.success) return [];
  return offerContacts(getDb(), user.id, parsed.data.eventTypeId);
}
