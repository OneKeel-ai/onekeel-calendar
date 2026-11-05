import { afterEach, describe, expect, it, vi } from "vitest";
import { locationSchema } from "./schemas";
afterEach(() => { vi.unstubAllEnvs(); });
describe("Google Meet instance capability", () => {
  it("rejects unsupported automatic Meet but still allows custom meeting links", () => {
    vi.stubEnv("GOOGLE_MEET_ENABLED", "false");
    expect(locationSchema.safeParse({ kind: "google_meet", value: null }).success).toBe(false);
    expect(locationSchema.safeParse({ kind: "link", value: "https://meet.example.com/team" }).success).toBe(true);
  });
  it("keeps upstream Meet behavior when enabled", () => {
    vi.stubEnv("GOOGLE_MEET_ENABLED", "true");
    expect(locationSchema.safeParse({ kind: "google_meet", value: null }).success).toBe(true);
  });
});
