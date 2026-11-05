import type { Database } from "@/db/client";
import { listConnections } from "@/features/calendars/server/connections";
import { durationsOf, listEventTypes } from "@/features/event-types/server/service";
import { getSchedule, listSchedules } from "@/features/schedules/server/service";
import { getProfile } from "@/features/settings/server/service";
import { eventTypeTarget } from "@/features/embed/targets";
import { type SetupFacts, buildSteps, calendarStatus } from "../status";

/** Everything /setup and /schedule need, read live from the same tables the settings pages write. */
export async function loadSetup(db: Database, user: { id: string; name: string; username?: string | null }) {
  const [profile, connections, eventTypes, schedules] = await Promise.all([
    getProfile(db, user.id),
    listConnections(db, user.id),
    listEventTypes(db, user.id),
    listSchedules(db, user.id),
  ]);
  const defaultSchedule = schedules.find((s) => s.isDefault) ?? schedules[0];
  const schedule = defaultSchedule ? await getSchedule(db, user.id, defaultSchedule.id) : null;
  const username = profile?.username ?? user.username ?? null;
  const timeZone = profile?.timeZone ?? "UTC";

  const enabled = eventTypes.filter((et) => et.enabled);
  const facts: SetupFacts = {
    username,
    timeZone,
    connections,
    enabledEventTypes: enabled.length,
    workingHourRanges: schedule?.rules.length ?? 0,
  };
  const emailTypes = enabled.flatMap((et) => {
    const target = eventTypeTarget(username, { slug: et.slug, title: et.title, durations: durationsOf(et) });
    return target ? [{ id: et.id, title: et.title, slug: et.slug, hidden: et.hidden, target }] : [];
  });
  return { facts, steps: buildSteps(facts), calendar: calendarStatus(connections), emailTypes, username };
}
