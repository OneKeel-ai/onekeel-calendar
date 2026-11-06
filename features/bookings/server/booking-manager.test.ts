import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { isBookingManager, isHostOf } from "./core";

const dialect = new PgDialect();
const render = (q: ReturnType<typeof isHostOf>) => dialect.sqlToQuery(q);
const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("isBookingManager (assistant booking management)", () => {
  it("is the host check OR a current owner/admin membership of the booking's event-type team", () => {
    const q = render(isBookingManager("julie"));
    expect(q.sql).toContain("FROM booking_host bh WHERE bh.booking_id = \"booking\".\"id\"");
    expect(q.sql).toContain("INNER JOIN membership m ON m.team_id = et.team_id");
    expect(q.sql).toContain("et.id = \"booking\".\"event_type_id\"");
    expect(q.sql).toContain("m.role IN ('owner', 'admin')");
    expect(q.sql).toMatch(/^\(EXISTS [\s\S]* OR EXISTS [\s\S]*\)$/);
    // Plain members and personal event types (team_id NULL) never qualify via the team branch.
    expect(q.sql).toContain("et.team_id IS NOT NULL");
    expect(q.sql).not.toContain("'member'");
    expect(q.params).toEqual(["julie", "julie"]);
  });

  it("leaves isHostOf narrow (busy time and own-event matching stay per actual host)", () => {
    const q = render(isHostOf("julie"));
    expect(q.sql).not.toContain("membership");
    expect(q.params).toEqual(["julie"]);
  });

  it("is used only for dashboard list, decisions, cancel and reschedule requests", () => {
    const service = source("service.ts");
    expect(service).toMatch(/cancel\(db, and\(eq\(booking\.id, input\.bookingId\), isBookingManager\(input\.hostId\)\)/);
    expect(service).toMatch(/function filterWhere[\s\S]*?isBookingManager\(hostId\)/);
    expect(source("decisions.ts")).toMatch(/async function decide[\s\S]*?isBookingManager\(input\.hostId\)/);
    expect(source("reschedule-request.ts")).toContain("isBookingManager(input.hostId)");
    // Busy computation must not treat an assistant's managed bookings as their own events.
    const busy = readFileSync(join(__dirname, "../../calendars/server/busy.ts"), "utf8");
    expect(busy).toContain("isHostOf(userId)");
    expect(busy).not.toContain("isBookingManager");
  });
});
