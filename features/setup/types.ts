import type { EmbedTarget } from "@/features/embed/target";

/** Shared /schedule contract between the server loader/actions and the UI. */

/** One bookable event type the user can send times for. */
export type ScheduleType = { id: string; title: string; hidden: boolean; target: EmbedTarget };

/**
 * Who the times are for. Personal group: id "self", label "You", teamId null. Team groups: an
 * opaque stable id per team + actual host, labelled with the host's name, teamId = the team the
 * user is an authorized member of. Booking always goes to that host's own event type.
 */
export type SchedulingPrincipal = { id: string; label: string; teamId: string | null; types: ScheduleType[] };

/** One member's day(s) for the busy view: working hours and busy blocks only (no titles). */
export type MemberAvailability = {
  userId: string;
  name: string;
  timeZone: string | null;
  working: { start: number; end: number }[];
  busy: { start: number; end: number }[];
  calendarUnavailable?: boolean;
};

export type ScheduleAvailabilityResult = { members: MemberAvailability[]; error?: string };
