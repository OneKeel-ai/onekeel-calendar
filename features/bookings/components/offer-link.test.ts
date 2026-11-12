import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  alsoAttendingLine,
  INVITATION_ONLY_MESSAGE,
  InvitationOnly,
  isInvalidOfferError,
  isInvitationOnlyError,
  OFFER_INVALID_MESSAGE,
  OfferLinkInvalid,
  RESTRICTED_GONE_MESSAGE,
  RESTRICTED_OFFER_LINE,
  sentTimesGone,
} from "./offer-link";

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

describe("private hosts' booking pages", () => {
  it("shows only the invitation message, with no form", () => {
    const rendered = nodes(InvitationOnly());
    expect(rendered.find((p) => p.role === "status")?.children).toBe("This meeting is by invitation. Ask your contact for times.");
    expect(rendered.some((p) => "onSubmit" in p || "onClick" in p)).toBe(false);
    expect(INVITATION_ONLY_MESSAGE).toBe("This meeting is by invitation. Ask your contact for times.");
  });

  it("recognises the server's invitation-only answer", () => {
    expect(isInvitationOnlyError({ message: INVITATION_ONLY_MESSAGE })).toBe(true);
    expect(isInvitationOnlyError({ message: "That time was just taken." })).toBe(false);
  });

  it("says the sent times are gone only when none can still be booked", () => {
    const range = { start: 1_000, end: 2_000 };
    expect(sentTimesGone({ restricted: true, offered: [1_500], shown: 0, range, now: 500 })).toBe(true);
    expect(sentTimesGone({ restricted: true, offered: [], shown: 0, range, now: 500 })).toBe(true);
    // A sent time in a later month: the booker only needs to move on.
    expect(sentTimesGone({ restricted: true, offered: [1_500, 3_000], shown: 0, range, now: 500 })).toBe(false);
    // A sent time in the past outside the range doesn't count.
    expect(sentTimesGone({ restricted: true, offered: [100], shown: 0, range, now: 500 })).toBe(true);
    expect(sentTimesGone({ restricted: true, offered: [1_500], shown: 1, range, now: 500 })).toBe(false);
    expect(sentTimesGone({ restricted: false, offered: [], shown: 0, range, now: 500 })).toBe(false);
  });

  it("uses plain wording for restricted links", () => {
    expect(RESTRICTED_OFFER_LINE).toBe("You can book one of the times that were sent to you. Need a different time? Reply to the email.");
    expect(RESTRICTED_GONE_MESSAGE).toBe("The times that were sent are no longer open. Reply to the email to ask for new ones.");
  });
});
