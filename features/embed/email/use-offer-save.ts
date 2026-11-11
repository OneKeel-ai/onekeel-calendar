"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offerContactsAction, saveOfferAction } from "@/features/offers/server/actions";
import { isEmptyOffer, type MeetingDetailsValue, type OfferContact, offerKey, type OfferManualSlot, type OfferSaveState } from "./meeting-details";

const SAVE_DELAY_MS = 500;
const SAVE_FAILED = "Couldn't save meeting details. Check your connection and try again.";

type SaveInput = { eventTypeId: string; title: string; guests: string[]; manualSlots: OfferManualSlot[] };

const NO_MANUAL: readonly OfferManualSlot[] = [];

/**
 * Saves the title, invited people and hand-added times for this meeting type about 500 ms after
 * the last change. Only the latest request counts: an older answer arriving late is ignored.
 * Nothing is saved while all are empty (links then carry no offer, as before).
 */
export function useOfferSave(eventTypeId: string, value: Pick<MeetingDetailsValue, "title" | "guests">, manualSlots: readonly OfferManualSlot[] = NO_MANUAL) {
  const [save, setSave] = useState<OfferSaveState>({ status: "idle" });
  const seq = useRef(0);
  const saved = useRef<{ key: string; offerId: string | null } | null>(null);
  const empty = isEmptyOffer(value, manualSlots);
  const key = offerKey(eventTypeId, value, manualSlots);
  const title = value.title.trim();
  const guests = value.guests;

  const run = useCallback(
    async (requestKey: string, input: SaveInput) => {
      const id = ++seq.current;
      setSave({ status: "saving", key: requestKey });
      let next: OfferSaveState;
      try {
        const result = await saveOfferAction(input);
        next = result.ok
          ? { status: "saved", key: requestKey, offerId: result.offerId }
          : { status: "error", key: requestKey, message: result.message || SAVE_FAILED, fieldErrors: result.fieldErrors };
      } catch {
        next = { status: "error", key: requestKey, message: SAVE_FAILED };
      }
      if (id !== seq.current) return; // a newer change was saved meanwhile
      if (next.status === "saved") saved.current = { key: requestKey, offerId: next.offerId };
      setSave(next);
    },
    [],
  );

  useEffect(() => {
    if (empty) {
      seq.current++; // drop any answer still on its way
      return;
    }
    if (saved.current?.key === key) {
      const known = saved.current;
      seq.current++;
      setSave({ status: "saved", key: known.key, offerId: known.offerId });
      return;
    }
    const timer = setTimeout(() => void run(key, { eventTypeId, title, guests: [...guests], manualSlots: [...manualSlots] }), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `key` covers eventTypeId, title, guests and manualSlots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, empty, run]);

  useEffect(
    () => () => {
      seq.current++; // unmounted (another host or meeting type): ignore late answers
    },
    [],
  );

  const retry = useCallback(
    () => void run(key, { eventTypeId, title, guests: [...guests], manualSlots: [...manualSlots] }),
    [run, key, eventTypeId, title, guests, manualSlots],
  );

  return { save, retry };
}

/** Teammates to suggest in "Also invite". Empty while loading or when loading fails; typing any address still works. */
export function useOfferContacts(eventTypeId: string): OfferContact[] {
  const [contacts, setContacts] = useState<OfferContact[]>([]);
  useEffect(() => {
    let live = true;
    offerContactsAction({ eventTypeId }).then(
      (list) => {
        if (live && Array.isArray(list)) setContacts(list.filter((c) => c && typeof c.email === "string" && typeof c.name === "string"));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [eventTypeId]);
  return contacts;
}
