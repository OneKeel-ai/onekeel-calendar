import { createElement, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CalendarOverlay } from "./calendar-overlay";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

const slot = "2026-11-09T15:00:00.000Z";
function setup(overrides: Partial<Parameters<typeof CalendarOverlay>[0]> = {}) {
  const props: Parameters<typeof CalendarOverlay>[0] = {
    open: true,
    onOpen: vi.fn(),
    hostLabel: "Charlie",
    calendars: { status: "ready", members: [{ userId: "andrew", name: "Andrew", timeZone: "America/Chicago", busy: [{ start: Date.parse(slot), end: Date.parse(slot) + 30 * 60_000 }] }], retry: vi.fn() },
    viewed: ["andrew"],
    onToggleViewed: vi.fn(),
    days: [{ year: 2026, month: 11, day: 9 }],
    timeZone: "America/Chicago",
    prefs: { locale: "en-US", timeZone: "America/Chicago", hour12: true },
    duration: 30,
    offered: [slot],
    selected: [],
    limit: 10,
    onToggleSlot: vi.fn(),
    onWeek: vi.fn(),
    canGoBack: false,
    ...overrides,
  };
  return { props, rendered: nodes(CalendarOverlay(props)) };
}
const offers = (rendered: Record<string, unknown>[]) => rendered.filter((p) => String(p["aria-label"] ?? "").startsWith("Offer "));

describe("interactive calendar planning", () => {
  it("offers the host's times even when a viewed person is busy, and only changes the chosen slots", () => {
    const { props, rendered } = setup();
    const buttons = offers(rendered);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(false);
    (buttons[0].onClick as () => void)();
    expect(props.onToggleSlot).toHaveBeenCalledWith(slot);
    expect(props.onToggleViewed).not.toHaveBeenCalled();
    expect(props.viewed).toEqual(["andrew"]);
    expect(props.hostLabel).toBe("Charlie");
  });

  it("does not create offers for a viewed person's calendar", () => {
    const { rendered } = setup({ offered: [] });
    expect(offers(rendered)).toHaveLength(0);
  });

  it("shows when selected times belong to another week", () => {
    const { rendered } = setup({ selected: [slot, "2026-11-16T15:00:00.000Z"] });
    expect(rendered.find((p) => p.role === "status")?.children).toBe("2 of 10 times selected. 1 in other weeks.");
  });

  it("enforces the offer limit but lets an existing pick be removed", () => {
    const selected = Array.from({ length: 10 }, (_, i) => new Date(Date.parse(slot) + i * 30 * 60_000).toISOString());
    const next = new Date(Date.parse(slot) + 10 * 30 * 60_000).toISOString();
    const { rendered } = setup({ selected, offered: [slot, next] });
    expect(offers(rendered).map((p) => [p["aria-pressed"], p.disabled])).toEqual([[true, false], [false, true]]);
  });

  it("does not duplicate an overnight offer on its second day", () => {
    const { rendered } = setup({
      offered: ["2026-11-09T04:45:00.000Z"],
      days: [{ year: 2026, month: 11, day: 8 }, { year: 2026, month: 11, day: 9 }],
      timeZone: "America/New_York",
      prefs: { locale: "en-US", timeZone: "America/New_York", hour12: true },
    });
    expect(offers(rendered)).toHaveLength(1);
  });

  it("keeps week navigation in the planning window", () => {
    const { props, rendered } = setup();
    const previous = rendered.find((p) => p["aria-label"] === "Previous calendar week")!;
    const next = rendered.find((p) => p["aria-label"] === "Next calendar week")!;
    expect(previous.disabled).toBe(true);
    (next.onClick as () => void)();
    expect(props.onWeek).toHaveBeenCalledWith(1);
  });
});

describe("adding times by hand in the planner", () => {
  const free = "2026-11-09T15:00:00.000Z"; // 9:00 AM Chicago
  const busyCell = "2026-11-09T13:00:00.000Z"; // 7:00 AM Chicago
  const choices = new Map([["2026-11-09", [busyCell, "2026-11-09T13:30:00.000Z"]]]);
  const manual = (over: Partial<NonNullable<Parameters<typeof CalendarOverlay>[0]["manual"]>> = {}) => ({
    on: true,
    control: createElement("span", { "data-testid": "manual-switch" }),
    choices,
    picks: [] as string[],
    step: 30,
    ...over,
  });

  it("offers non-free cells as 'by hand' buttons and keeps free times as they are", () => {
    const { props, rendered } = setup({ offered: [free], manual: manual() });
    const labels = offers(rendered).map((p) => p["aria-label"]);
    expect(labels).toEqual(["Offer Mon, Nov 9 at 7:00 AM by hand", "Offer Mon, Nov 9 at 7:30 AM by hand", "Offer Mon, Nov 9 at 9:00 AM"]);
    (offers(rendered)[0]!.onClick as () => void)();
    expect(props.onToggleSlot).toHaveBeenCalledWith(busyCell, true);
    (offers(rendered)[2]!.onClick as () => void)();
    expect(props.onToggleSlot).toHaveBeenLastCalledWith(free);
    expect(rendered.some((p) => p["data-testid"] === "manual-switch")).toBe(true);
    expect(rendered.some((p) => Array.isArray(p.children) && p.children.includes(" Added by hand"))).toBe(true);
  });

  it("shows hand-added picks as pressed, counted and announced per day, and respects the limit", () => {
    const { rendered } = setup({ offered: [free], selected: [busyCell], manual: manual({ picks: [busyCell] }) });
    const [picked, other] = offers(rendered);
    expect([picked!["aria-pressed"], picked!.disabled]).toEqual([true, false]);
    expect(other!["aria-pressed"]).toBe(false);
    expect(rendered.find((p) => p.role === "group" && String(p["aria-label"]).startsWith("Mon"))?.["aria-label"]).toBe("Mon, Nov 9: 1 pick, 1 added by hand, busy: Andrew");
    const selected = Array.from({ length: 10 }, (_, i) => new Date(Date.parse(free) + (i + 1) * 30 * 60_000).toISOString());
    const full = setup({ offered: [free], selected, manual: manual() }).rendered;
    expect(offers(full)[0]!.disabled).toBe(true);
  });

  it("starts the grid at 7:00 AM while the switch is on, and adds nothing when it is absent", () => {
    const on = setup({ manual: manual() }).rendered;
    const off = setup().rendered;
    expect(offers(off).every((p) => !String(p["aria-label"]).endsWith("by hand"))).toBe(true);
    const height = (r: Record<string, unknown>[]) => (r.find((p) => p.role === "group" && String(p["aria-label"]).startsWith("Mon"))?.style as { height: number }).height;
    expect(height(on)).toBe(12 * 44);
    expect(height(off)).toBe(10 * 44);
  });
});
