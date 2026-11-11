import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ManualTimesNotice, ManualTimesSwitch } from "./manual-times-fields";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

describe("Add times by hand switch", () => {
  it("is labelled, off by default for the caller, and explains itself", () => {
    const onChange = vi.fn();
    const rendered = nodes(ManualTimesSwitch({ on: false, onChange }));
    const toggle = rendered.find((p) => p.id === "email-manual-times")!;
    expect(toggle.checked).toBe(false);
    expect(toggle["aria-describedby"]).toBe("email-manual-times-help");
    expect(rendered.find((p) => p.htmlFor === "email-manual-times")?.children).toBe("Add times by hand");
    expect(rendered.find((p) => p.id === "email-manual-times-help")?.children).toBe(
      "Offer a time even if the calendar shows it as busy or outside working hours. Use it when you know the time is fine.",
    );
    (toggle.onCheckedChange as (v: boolean) => void)(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows the server's error for hand-added times next to the switch", () => {
    const rendered = nodes(ManualTimesSwitch({ on: true, onChange: vi.fn(), error: "A time added by hand is in the past" }));
    expect(rendered.find((p) => p.role === "alert")?.children).toBe("A time added by hand is in the past");
    expect(rendered.find((p) => p.id === "email-manual-times")?.["aria-invalid"]).toBe(true);
  });

  it("shows the notice line only when times were added by hand", () => {
    expect(ManualTimesNotice({ count: 0 })).toBeNull();
    const rendered = nodes(ManualTimesNotice({ count: 2 }));
    expect(rendered[0]?.children).toContain("2 times added by hand. The client can book them even though the calendar shows them as busy or outside working hours.");
  });
});
