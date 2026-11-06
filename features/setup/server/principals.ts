import { createHash } from "node:crypto";
import type { Database } from "@/db/client";
import { teamEventTypeTarget } from "@/features/embed/targets";
import { durationsOf } from "@/features/event-types/server/service";
import { listTeamEventTypes, type TeamEventTypeView } from "@/features/teams/server/event-types";
import { TeamError } from "@/features/teams/server/access";
import { memberLabel } from "@/features/teams/server/availability";
import { listMyTeams, membersOf } from "@/features/teams/server/service";
import type { ScheduleType, SchedulingPrincipal } from "../types";

/**
 * Team groups for /schedule: the user's teams' enabled, single-host collective/round-robin event
 * types, grouped by team + host. Managed and multi-host types are left out (their host is not one
 * known person). Uses only the user's own memberships; host emails never leave the server.
 */

export const SELF_PRINCIPAL_ID = "self";

/** Opaque, stable group id for one team + host (doesn't expose either id). */
export const principalId = (teamId: string, hostId: string) => `t_${createHash("sha256").update(`${teamId}\u0000${hostId}`).digest("hex").slice(0, 24)}`;

type TeamInfo = { id: string; name: string; slug: string };
type Member = { userId: string; name: string };

/** Pure grouping step (tested): which team event types become which principals. */
export function groupTeamTypes(teams: readonly { team: TeamInfo; members: readonly Member[]; types: readonly TeamEventTypeView[] }[]): SchedulingPrincipal[] {
  const groups = new Map<string, SchedulingPrincipal & { hostName: string; teamName: string }>();
  for (const { team, members, types } of teams) {
    const memberNames = new Map(members.map((m) => [m.userId, m.name]));
    for (const et of types) {
      if (!et.enabled || et.linkOnly || et.parentId || (et.schedulingType !== "collective" && et.schedulingType !== "round_robin")) continue;
      if (et.hosts.length !== 1) continue;
      const host = et.hosts[0];
      // A host who left the team can't be booked through it.
      const memberName = memberNames.get(host.userId);
      if (memberName === undefined) continue;
      const target = teamEventTypeTarget(team.slug, { slug: et.slug, title: et.title, durations: durationsOf(et), schedulingType: et.schedulingType });
      if (!target) continue;
      const id = principalId(team.id, host.userId);
      const hostName = host.name?.trim() || memberName;
      const group = groups.get(id) ?? { id, label: hostName, teamId: team.id, types: [], hostName, teamName: team.name };
      group.types.push({ id: et.id, title: et.title, hidden: et.hidden, target } satisfies ScheduleType);
      groups.set(id, group);
    }
  }
  const list = [...groups.values()];
  // Same host name in two teams (or two hosts with one name): add the team so labels stay distinct.
  const counts = new Map<string, number>();
  for (const g of list) counts.set(g.hostName, (counts.get(g.hostName) ?? 0) + 1);
  return list
    .map(({ hostName, teamName, ...g }) => ({ ...g, label: (counts.get(hostName) ?? 0) > 1 ? `${hostName} (${teamName})` : hostName }))
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export async function loadTeamPrincipals(db: Database, userId: string): Promise<SchedulingPrincipal[]> {
  const teams = await listMyTeams(db, userId);
  const loaded = await Promise.all(
    teams.map(async (t) => ({
      team: { id: t.id, name: t.name, slug: t.slug },
      members: (await membersOf(db, t.id)).map((m) => ({ userId: m.userId, name: memberLabel(m.name, m.email) })),
      // Membership-checked by the service itself; a membership removed mid-load just drops the team.
      types: await listTeamEventTypes(db, userId, t.id).catch((error: unknown) => {
        if (error instanceof TeamError) return [];
        throw error;
      }),
    })),
  );
  return groupTeamTypes(loaded);
}
