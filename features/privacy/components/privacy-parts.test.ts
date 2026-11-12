import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EmailChipsView } from "./email-chips-field";
import { GuardErrors, WhatPrivacyDoes } from "./privacy-parts";
import { WHAT_PRIVACY_DOES } from "./wording";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

describe("privacy settings parts", () => {
  it("shows the server's message and each blocking team", () => {
    const rendered = nodes(GuardErrors({ result: { message: "You share a team with people you haven't named.", blockers: [{ team: "Sales", people: ["Andrew"] }] } }));
    const lines = rendered.map((p) => p.children).filter((c) => typeof c === "string");
    expect(lines).toContain("You share a team with people you haven't named.");
    expect(lines).toContain("You share the team Sales with Andrew. Leave that team, or add them above, then save again.");
  });

  it("lists what privacy does under a heading", () => {
    const rendered = nodes(WhatPrivacyDoes({}));
    expect(rendered.find((p) => p.id === "privacy-what")?.children).toBe("What this does");
    expect(rendered.filter((p) => typeof p.children === "string" && WHAT_PRIVACY_DOES.includes(p.children as string))).toHaveLength(6);
  });
});

describe("email chips", () => {
  const base = {
    id: "privacy-delegates",
    label: "People who can schedule for me",
    helper: "Up to 10.",
    value: { items: ["chelsea@x.com"], draft: "" },
    max: 10,
    listLabel: "People who can schedule for me",
    onDraft: vi.fn(),
    onRemove: vi.fn(),
    onKeyDown: vi.fn(),
    onPaste: vi.fn(),
    onBlur: vi.fn(),
  };

  it("labels the field and each remove button", () => {
    const rendered = nodes(EmailChipsView(base));
    expect(rendered.find((p) => p.htmlFor === "privacy-delegates")?.children).toBe("People who can schedule for me");
    const remove = rendered.find((p) => p["aria-label"] === "Remove chelsea@x.com");
    (remove?.onClick as () => void)();
    expect(base.onRemove).toHaveBeenCalledWith("chelsea@x.com");
    expect(rendered.find((p) => p.id === "privacy-delegates")?.["aria-describedby"]).toBe("privacy-delegates-hint");
  });

  it("shows an error in place of the helper", () => {
    const rendered = nodes(EmailChipsView({ ...base, error: "Too many people" }));
    expect(rendered.find((p) => p.id === "privacy-delegates")?.["aria-invalid"]).toBe(true);
    expect(rendered.find((p) => p.id === "privacy-delegates-hint")?.children).toBe("Too many people");
  });
});
