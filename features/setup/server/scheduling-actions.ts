"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { cachedExternalBusyFor } from "@/features/calendars/server/runtime";
import { TeamError } from "@/features/teams/server/access";
import { MAX_VIEW_DAYS, teamAvailability } from "@/features/teams/server/availability";
import { requireUser } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/availability/tz";
import { errorSummary, logger } from "@/lib/logger";
import type { ScheduleAvailabilityResult } from "../types";

const DAY = 86_400_000;
const input = z
  .object({
    teamId: z.string().min(1).max(64),
    start: z.number().int(),
    end: z.number().int(),
  })
  .refine((v) => v.end > v.start && v.end - v.start <= MAX_VIEW_DAYS * DAY, { message: "window" });

/**
 * Busy view for /schedule: working hours and busy blocks of the members of ONE team the caller
 * belongs to, for at most 7 days. Only team members come back (never arbitrary user ids), busy
 * blocks carry no titles, and failures return a generic message. Display only: choosing which
 * members to show never changes who a booking goes to.
 */
export async function loadScheduleAvailability(teamId: string, start: number, end: number): Promise<ScheduleAvailabilityResult> {
  const user = await requireUser();
  const parsed = input.safeParse({ teamId, start, end });
  if (!parsed.success) return { members: [], error: "Pick a window of up to 7 days." };
  const timeZone = user.timeZone && isValidTimeZone(user.timeZone) ? user.timeZone : "UTC";
  try {
    const members = await teamAvailability(getDb(), user.id, parsed.data.teamId, { start: parsed.data.start, end: parsed.data.end }, (userId) =>
      cachedExternalBusyFor({ id: userId, timeZone }, ""),
    );
    return {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        timeZone: m.timeZone,
        working: m.working.map((i) => ({ start: i.start, end: i.end })),
        busy: m.busy.map((i) => ({ start: i.start, end: i.end })),
        ...(m.calendarUnavailable ? { calendarUnavailable: true } : {}),
      })),
    };
  } catch (error) {
    if (error instanceof TeamError) return { members: [], error: "This team isn't available." };
    logger.error("schedule.availability_failed", errorSummary(error));
    return { members: [], error: "Availability couldn't be loaded. Please try again." };
  }
}
