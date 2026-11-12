import type { Database } from "@/db/client";
import { listConnections } from "@/features/calendars/server/connections";
import { durationsOf, listEventTypes } from "@/features/event-types/server/service";
import { getSchedule, listSchedules } from "@/features/schedules/server/service";
import { getProfile } from "@/features/settings/server/service";
import { eventTypeTarget } from "@/features/embed/targets";
import { type SetupFacts, buildSteps, calendarStatus } from "../status";
import type { SchedulingPrincipal } from "../types";
import { loadConflictNotes } from "./conflict-notes";
import { loadPrivateHosts } from "./private-hosts";
import { loadTeamPrincipalsWithHosts, SELF_PRINCIPAL_ID } from "./principals";

/** Everything /setup and /schedule need, read live from the same tables the settings pages write. */
export async function loadSetup(db: Database, user: { id: string; name: string; username?: string | null }) {
  const [profile, connections, eventTypes, schedules, team] = await Promise.all([
    getProfile(db, user.id),
    listConnections(db, user.id),
    listEventTypes(db, user.id),
    listSchedules(db, user.id),
    loadTeamPrincipalsWithHosts(db, user.id),
  ]);
  const teamPrincipals = team.principals;
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
  // Personal types first, then one group per team host the user may schedule for.
  const listed: SchedulingPrincipal[] = [
    { id: SELF_PRINCIPAL_ID, label: "You", teamId: null, types: emailTypes.map(({ id, title, hidden, target }) => ({ id, title, hidden, target })) },
    ...teamPrincipals,
  ];
  // Which calendars hide each type's free time (one batch for every listed type and its host).
  const items = [
    ...emailTypes.map((t) => ({ eventTypeId: t.id, hostId: user.id })),
    ...teamPrincipals.flatMap((p) => p.types.flatMap((t) => {
      const hostId = team.hostOf.get(t.id);
      return hostId ? [{ eventTypeId: t.id, hostId }] : [];
    })),
  ];
  const hostOfType = new Map(items.map((i) => [i.eventTypeId, i.hostId]));
  const [notes, privateHosts] = await Promise.all([loadConflictNotes(db, user.id, items), loadPrivateHosts(db, items.map((i) => i.hostId))]);
  const principals: SchedulingPrincipal[] = listed.map((p) => ({
    ...p,
    types: p.types.map((t) => {
      const note = notes.get(t.id);
      const privateHost = privateHosts.get(hostOfType.get(t.id) ?? "");
      return { ...t, ...(note && { conflictNote: note }), ...(privateHost && { privateHost }) };
    }),
  }));
  return { facts, steps: buildSteps(facts), calendar: calendarStatus(connections), emailTypes, principals, username };
}
