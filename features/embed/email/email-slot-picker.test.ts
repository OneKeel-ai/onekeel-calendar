import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EmailSlotPicker } from "./email-slot-picker";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

const hand = "2026-11-10T13:00:00.000Z"; // 7:00 AM Chicago, Tuesday
function setup(overrides: Partial<Parameters<typeof EmailSlotPicker>[0]> = {}) {
  const props: Parameters<typeof EmailSlotPicker>[0] = {
    days: [{ year: 2026, month: 11, day: 9 }, { year: 2026, month: 11, day: 10 }],
    canGoBack: false,
    onWeek: vi.fn(),
    activeDay: "2026-11-10",
    onActiveDay: vi.fn(),
    slotsByDay: new Map([["2026-11-09", ["2026-11-09T15:00:00.000Z"]]]),
    selected: [],
    limit: 10,
    onToggle: vi.fn(),
    week: { status: "ready", slots: ["2026-11-09T15:00:00.000Z"], retry: vi.fn() },
    prefs: { locale: "en-US", timeZone: "America/Chicago", hour12: true },
    manual: { choices: new Map([["2026-11-10", [hand]]]), onToggle: vi.fn() },
    ...overrides,
  };
  return { props, rendered: nodes(EmailSlotPicker(props)) };
}

describe("day and time picker with times added by hand", () => {
  it("opens a day with no free times when it has hand-addable times", () => {
    const { rendered } = setup();
    expect(rendered.find((p) => p["data-day"] === "2026-11-10")?.disabled).toBe(false);
    expect(setup({ manual: undefined }).rendered.find((p) => p["data-day"] === "2026-11-10")?.disabled).toBe(true);
  });

  it("lists them as separate 'by hand' toggles that call the hand-added handler", () => {
    const { props, rendered } = setup({ selected: [hand] });
    const chip = rendered.find((p) => p["data-manual-start"] === hand)!;
    expect(chip["aria-label"]).toBe("7:00 AM, by hand");
    expect(chip.pressed).toBe(true);
    (chip.onPressedChange as () => void)();
    expect(props.manual!.onToggle).toHaveBeenCalledWith(hand);
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(rendered.find((p) => p.id === "email-embed-hand-label")?.children).toBe("Add by hand");
  });
});
