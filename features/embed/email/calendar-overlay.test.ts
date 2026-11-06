import { isValidElement, type ReactNode } from "react";
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
