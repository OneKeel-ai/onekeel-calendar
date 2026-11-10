import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/offers/server/actions", () => ({ saveOfferAction: vi.fn(), offerContactsAction: vi.fn(async () => []) }));

const { MeetingDetailsView, OfferSaveStatus } = await import("./meeting-details-fields");

/** Expands function components (the field parts are plain functions) and collects element props. */
function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

function setup(overrides: Partial<Parameters<typeof MeetingDetailsView>[0]> = {}) {
  const props: Parameters<typeof MeetingDetailsView>[0] = {
    value: { title: "", guests: ["andrew@onekeel.ai", "client@autogroup.com"], draft: "" },
    guestError: null,
    suggestions: [],
    active: 0,
    onTitle: vi.fn(),
    onDraft: vi.fn(),
    onRemove: vi.fn(),
    onPick: vi.fn(),
    onKeyDown: vi.fn(),
    onPaste: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
  };
  return { props, rendered: nodes(MeetingDetailsView(props)) };
}

describe("meeting details fields", () => {
  it("offers an optional title capped at 150 characters with the example as placeholder", () => {
    const { rendered } = setup();
    const title = rendered.find((p) => p.id === "email-offer-title");
    expect(title?.maxLength).toBe(150);
    expect(title?.placeholder).toBe("Auto Group x OneKeel.ai: Demo");
    expect(rendered.find((p) => p.htmlFor === "email-offer-title")?.children).toBe("Meeting title");
    expect(rendered.find((p) => p.id === "email-offer-title-hint")?.children).toBe(
      "The client sees this, and it becomes the calendar event name. Leave blank to use the standard name.",
    );
  });

  it("shows each invited person as a chip with its own remove button", () => {
    const { props, rendered } = setup();
    const remove = rendered.filter((p) => String(p["aria-label"] ?? "").startsWith("Remove "));
    expect(remove.map((p) => p["aria-label"])).toEqual(["Remove andrew@onekeel.ai", "Remove client@autogroup.com"]);
    (remove[1].onClick as () => void)();
    expect(props.onRemove).toHaveBeenCalledWith("client@autogroup.com");
  });

  it("is a keyboard combobox whose suggestions add that person's email", () => {
    const contact = { name: "Julie Stone", email: "julie@onekeel.ai" };
    const { props, rendered } = setup({ value: { title: "", guests: [], draft: "jul" }, suggestions: [contact] });
    const input = rendered.find((p) => p.role === "combobox");
    expect(input?.["aria-expanded"]).toBe(true);
    expect(input?.["aria-activedescendant"]).toBe("email-offer-guest-option-0");
    const option = rendered.find((p) => p.role === "option");
    expect(option?.["aria-selected"]).toBe(true);
    (option?.onClick as () => void)();
    expect(props.onPick).toHaveBeenCalledWith(contact);
  });

  it("closes the list when there is nothing to suggest", () => {
    const { rendered } = setup();
    expect(rendered.find((p) => p.role === "combobox")?.["aria-expanded"]).toBe(false);
    expect(rendered.find((p) => p.role === "listbox")?.hidden).toBe(true);
  });

  it("shows an invalid address as an inline error instead of the helper text", () => {
    const { rendered } = setup({ value: { title: "", guests: [], draft: "nope" }, guestError: '"nope" is not a valid email address.' });
    expect(rendered.find((p) => p.role === "combobox")?.["aria-invalid"]).toBe(true);
    expect(rendered.find((p) => p.id === "email-offer-guests-hint")?.children).toBe('"nope" is not a valid email address.');
  });

  it("shows server field errors", () => {
    const { rendered } = setup({ fieldErrors: { title: "Title is too long" } });
    expect(rendered.find((p) => p.id === "email-offer-title")?.["aria-invalid"]).toBe(true);
    expect(rendered.find((p) => p.id === "email-offer-title-hint")?.children).toBe("Title is too long");
  });
});

describe("copy status", () => {
  it("says nothing when copying is allowed", () => {
    expect(OfferSaveStatus({ gate: { canCopy: true }, onRetry: vi.fn() })).toBeNull();
  });

  it("says it is saving, without a retry", () => {
    const rendered = nodes(OfferSaveStatus({ gate: { canCopy: false, status: "saving", message: "Saving meeting details…" }, onRetry: vi.fn() }));
    expect(rendered.find((p) => p.role === "status")?.children).toBe("Saving meeting details…");
    expect(rendered.some((p) => p.children === "Retry")).toBe(false);
  });

  it("shows a failed save with a retry", () => {
    const onRetry = vi.fn();
    const rendered = nodes(OfferSaveStatus({ gate: { canCopy: false, status: "error", message: "Couldn't save meeting details." }, onRetry }));
    expect(rendered.find((p) => p.role === "status")?.children).toBe("Couldn't save meeting details.");
    (rendered.find((p) => p.children === "Retry")?.onClick as () => void)();
    expect(onRetry).toHaveBeenCalled();
  });
});
