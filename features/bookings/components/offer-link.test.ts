import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { alsoAttendingLine, isInvalidOfferError, OFFER_INVALID_MESSAGE, OfferLinkInvalid } from "./offer-link";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

describe("Email times links on the booking page", () => {
  it("fails closed with one clear message and no form", () => {
    const rendered = nodes(OfferLinkInvalid());
    expect(rendered.find((p) => p.role === "alert")?.children).toBe("This scheduling link is no longer valid. Ask the sender for new times.");
    expect(rendered.some((p) => "onSubmit" in p || "onClick" in p)).toBe(false);
  });

  it("recognises the server's invalid-offer answer", () => {
    expect(isInvalidOfferError({ message: OFFER_INVALID_MESSAGE })).toBe(true);
    expect(isInvalidOfferError({ message: "Please check the form.", fieldErrors: { offer: "Invalid" } })).toBe(true);
    expect(isInvalidOfferError({ message: "That time was just taken." })).toBe(false);
    expect(isInvalidOfferError({ message: "Please check the form.", fieldErrors: { "booker.email": "Invalid" } })).toBe(false);
  });

  it("lists the other attendees read-only", () => {
    expect(alsoAttendingLine(["a@x.com", "b@y.com"])).toBe("Also attending: a@x.com, b@y.com");
    expect(alsoAttendingLine([])).toBeNull();
    expect(alsoAttendingLine(undefined)).toBeNull();
  });
});
