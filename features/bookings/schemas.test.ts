import { describe, expect, it } from "vitest";
import { bookerSchema, createBookingSchema, slotsQuerySchema } from "./schemas";

describe("booking schemas", () => {
  it("canonicalizes locales and falls back to en for invalid tags", () => {
    const base = { name: "A", email: "A@Example.com", timeZone: "UTC" };
    expect(bookerSchema.parse({ ...base, locale: "en-us" })).toMatchObject({ locale: "en-US", email: "a@example.com" });
    expect(bookerSchema.parse({ ...base, locale: "x_y" }).locale).toBe("en");
    expect(bookerSchema.safeParse({ ...base, timeZone: "Mars/Base" }).success).toBe(false);
  });

  it("limits the slots window to 45 days", () => {
    const q = { username: "a", slug: "b", duration: "30", start: "0" };
    expect(slotsQuerySchema.safeParse({ ...q, end: String(45 * 86_400_000) }).success).toBe(true);
    expect(slotsQuerySchema.safeParse({ ...q, end: String(46 * 86_400_000) }).success).toBe(false);
    expect(slotsQuerySchema.safeParse({ ...q, end: "0" }).success).toBe(false);
  });

  it("accepts only a url-safe scheduling offer id of up to 64 characters", () => {
    const payload = {
      username: "ada",
      slug: "intro",
      start: 0,
      duration: 30,
      booker: { name: "Grace", email: "grace@example.com", timeZone: "UTC" },
      idempotencyKey: "6f1c1f9e-3c1a-4c3b-9a55-2d1d1c7b8e01",
    };
    expect(createBookingSchema.parse(payload).offer).toBeUndefined();
    expect(createBookingSchema.parse({ ...payload, offer: "Ab_-9".repeat(12) }).offer).toBe("Ab_-9".repeat(12));
    expect(createBookingSchema.safeParse({ ...payload, offer: "a".repeat(65) }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...payload, offer: "has space" }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...payload, offer: "a/b" }).success).toBe(false);
  });
});
