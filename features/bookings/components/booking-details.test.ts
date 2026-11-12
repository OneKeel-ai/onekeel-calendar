import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BookingDetails } from "./booking-details";
import { RESTRICTED_OFFER_LINE } from "./offer-link";

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...nodes(props.children as ReactNode)];
}

const base: Parameters<typeof BookingDetails>[0] = {
  title: "Intro",
  hostName: "Tré",
  description: null,
  durations: [30],
  duration: 30,
  seated: false,
  stacked: false,
  form: { username: "tre", slug: "intro", locations: [], maxGuests: 0, questions: [], recurring: null, requiresConfirmation: false, utm: {}, embed: false, captcha: false, prefill: {} } as never,
  prefs: { locale: "en-US", timeZone: "UTC", hour12: true },
  ready: true,
  onDuration: vi.fn(),
};

describe("booking details for a link limited to the sent times", () => {
  it("says the client can book one of the sent times", () => {
    const line = nodes(BookingDetails({ ...base, restricted: true })).find((p) => p["data-testid"] === "restricted-offer");
    expect((line?.children as ReactNode[]).includes(RESTRICTED_OFFER_LINE)).toBe(true);
  });

  it("says nothing on an ordinary link", () => {
    expect(nodes(BookingDetails(base)).some((p) => p["data-testid"] === "restricted-offer")).toBe(false);
  });
});
