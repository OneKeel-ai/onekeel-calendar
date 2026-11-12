import type { Database } from "@/db/client";
import { hiddenFromViewer } from "@/features/privacy/server/guard";
import { atLeast } from "../roles";
import { listTeamEventTypes, type TeamEventTypeView } from "./event-types";
import { listMyTeams } from "./service";

/**
 * AVL-008 for teams: the collective and round-robin event types a user may troubleshoot — those
 * of teams where they are admin or owner — with each type's hosts.
 */
export async function troubleshootableTeamEventTypes(db: Database, userId: string): Promise<(TeamEventTypeView & { teamName: string })[]> {
  const teams = (await listMyTeams(db, userId)).filter((t) => atLeast(t.role, "admin"));
  const perTeam = await Promise.all(
    teams.map(async (t) => (await listTeamEventTypes(db, userId, t.id)).filter((et) => et.schedulingType !== "managed").map((et) => ({ ...et, teamName: t.name }))),
  );
  // Private calendars: hosts the user isn't allowed for are not offered (their day would show their free time).
  const all = perTeam.flat();
  const hidden = await hiddenFromViewer(db, userId, all.flatMap((et) => et.hosts.map((h) => h.userId)));
  if (!hidden.size) return all;
  return all.map((et) => ({ ...et, hosts: et.hosts.filter((h) => !hidden.has(h.userId)) })).filter((et) => et.hosts.length > 0);
}
