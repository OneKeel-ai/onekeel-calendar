import { describe, expect, it } from "vitest";
import { groupTeamTypes, principalId } from "./server/principals";

const team = { id: "team1", name: "Ekko", slug: "ekko" };
const members = [
  { userId: "julie", name: "Julie" },
  { userId: "charlie", name: "Charlie" },
  { userId: "andrew", name: "Andrew" },
];
const host = (userId: string, name: string) => ({ userId, name, email: `${userId}@example.com`, isFixed: true, weight: 100, priority: 2, scheduleId: null, eventTypeId: "x", position: 0 });
const et = (over: Record<string, unknown>) =>
  ({ id: "et", slug: "intro", title: "Intro", enabled: true, hidden: false, parentId: null, schedulingType: "collective", durationMinutes: 30, extraDurations: [], hosts: [host("charlie", "Charlie")], ...over }) as never;

describe("groupTeamTypes", () => {
  it("groups enabled single-host collective/round-robin types by team + host", () => {
    const groups = groupTeamTypes([
      {
        team,
        members,
        types: [
          et({ id: "c1", slug: "intro", title: "Intro" }),
          et({ id: "c2", slug: "deep-dive", title: "Deep dive", schedulingType: "round_robin", hidden: true }),
          et({ id: "a1", slug: "andrew-intro", title: "Andrew intro", hosts: [host("andrew", "Andrew")] }),
        ],
      },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Andrew", "Charlie"]);
    const charlie = groups.find((g) => g.label === "Charlie")!;
    expect(charlie).toMatchObject({ id: principalId("team1", "charlie"), teamId: "team1" });
    expect(charlie.types.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(charlie.types[1]).toMatchObject({ hidden: true, target: { kind: "teamEventType", calLink: "team/ekko/deep-dive" } });
  });

  it("leaves out managed, multi-host, disabled, managed copies and ex-member hosts", () => {
    const groups = groupTeamTypes([
      {
        team,
        members,
        types: [
          et({ id: "m", schedulingType: "managed" }),
          et({ id: "multi", hosts: [host("charlie", "Charlie"), host("andrew", "Andrew")] }),
          et({ id: "off", enabled: false }),
          et({ id: "private", linkOnly: true }),
          et({ id: "copy", parentId: "tmpl" }),
          et({ id: "gone", hosts: [host("ex", "Ex")] }),
          et({ id: "none", hosts: [] }),
        ],
      },
    ]);
    expect(groups).toEqual([]);
  });

  it("uses opaque stable ids and never ships host emails", () => {
    expect(principalId("team1", "charlie")).toBe(principalId("team1", "charlie"));
    expect(principalId("team1", "charlie")).not.toBe(principalId("team2", "charlie"));
    expect(principalId("team1", "charlie")).not.toMatch(/team1|charlie/);
    const json = JSON.stringify(groupTeamTypes([{ team, members, types: [et({ id: "c1" })] }]));
    expect(json).not.toContain("@example.com");
  });

  it("adds the team to the label only when host names collide", () => {
    const other = { id: "team2", name: "Keel", slug: "keel" };
    const groups = groupTeamTypes([
      { team, members, types: [et({ id: "c1" })] },
      { team: other, members, types: [et({ id: "c2" })] },
    ]);
    expect(groups.map((g) => g.label).toSorted()).toEqual(["Charlie (Ekko)", "Charlie (Keel)"]);
  });
});
