"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offerContactsAction, saveOfferAction } from "@/features/offers/server/actions";
import { type MeetingDetailsValue, type OfferContact, type OfferManualSlot, offerPlan, type OfferRules, type OfferSaveInput, type OfferSaveState, OPEN_RULES } from "./meeting-details";

const SAVE_DELAY_MS = 500;
const SAVE_FAILED = "Couldn't save meeting details. Check your connection and try again.";

const NO_MANUAL: readonly OfferManualSlot[] = [];

/**
 * Saves the title, invited people, hand-added times and who may book (the picked times only, or
 * any open time) for this meeting type about 500 ms after the last change. Only the latest
 * request counts: an older answer arriving late is ignored. Nothing is saved while there is
 * nothing to save (see `offerPlan`).
 */
export function useOfferSave(
  eventTypeId: string,
  value: Pick<MeetingDetailsValue, "title" | "guests">,
  manualSlots: readonly OfferManualSlot[] = NO_MANUAL,
  rules: OfferRules = OPEN_RULES,
) {
  const [save, setSave] = useState<OfferSaveState>({ status: "idle" });
  const seq = useRef(0);
  const saved = useRef<{ key: string; offerId: string | null } | null>(null);
  const plan = offerPlan(eventTypeId, value, manualSlots, rules);
  const key = plan.kind === "save" ? plan.key : null;
  const input = plan.kind === "save" ? plan.input : null;

  const run = useCallback(
    async (requestKey: string, request: OfferSaveInput) => {
      const id = ++seq.current;
      setSave({ status: "saving", key: requestKey });
      let next: OfferSaveState;
      try {
        const result = await saveOfferAction(request);
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
    if (key === null) {
      seq.current++; // drop any answer still on its way
      return;
    }
    if (saved.current?.key === key) {
      const known = saved.current;
      seq.current++;
      setSave({ status: "saved", key: known.key, offerId: known.offerId });
      return;
    }
    const request = input;
    const timer = setTimeout(() => {
      if (request) void run(key, request);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `key` covers every field of `input`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  useEffect(
    () => () => {
      seq.current++; // unmounted (another host or meeting type): ignore late answers
    },
    [],
  );

  const retry = () => {
    if (key !== null && input) void run(key, input);
  };

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
