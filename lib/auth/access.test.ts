import { describe, expect, it } from "vitest";
import { isEmailAllowed, mayBecomeAdmin, normalizeEmail, OPEN_ACCESS, parseAccessConfig } from "./access";

const team = parseAccessConfig({
  ALLOWED_EMAIL_DOMAINS: "onekeel.ai, @Example.org",
  ALLOWED_EMAILS: "Julie@Partner.com,josh.copp@onekeel.ai",
  ADMIN_EMAIL: "Josh.Copp@onekeel.ai",
});

describe("parseAccessConfig", () => {
  it("is unrestricted when nothing is configured", () => {
    expect(parseAccessConfig({})).toMatchObject({ restricted: false, adminEmail: null });
    expect(parseAccessConfig({ ALLOWED_EMAILS: "  ", ALLOWED_EMAIL_DOMAINS: "" }).restricted).toBe(false);
  });

  it("normalizes case, spaces and a leading @ on domains", () => {
    expect(team.restricted).toBe(true);
    expect([...team.domains]).toEqual(["onekeel.ai", "example.org"]);
    expect([...team.emails]).toEqual(["julie@partner.com", "josh.copp@onekeel.ai"]);
    expect(team.adminEmail).toBe("josh.copp@onekeel.ai");
  });

  it("stays restricted when every entry is malformed (typos only shrink access)", () => {
    const bad = parseAccessConfig({ ALLOWED_EMAIL_DOMAINS: "*.com, onekeel", ALLOWED_EMAILS: "not-an-email" });
    expect(bad.restricted).toBe(true);
    expect(isEmailAllowed(bad, "anyone@onekeel.ai")).toBe(false);
  });
});

describe("isEmailAllowed", () => {
  it("allows everyone when unrestricted", () => {
    expect(isEmailAllowed(OPEN_ACCESS, "x@y.com")).toBe(true);
    expect(isEmailAllowed(OPEN_ACCESS, undefined)).toBe(true);
  });

  it("allows listed domains and addresses, case-insensitively", () => {
    expect(isEmailAllowed(team, "Chelsea@OneKeel.AI")).toBe(true);
    expect(isEmailAllowed(team, "julie@partner.com")).toBe(true);
    expect(isEmailAllowed(team, "josh.copp@onekeel.ai")).toBe(true);
  });

  it("rejects look-alikes, subdomains and other addresses on a listed domain's cousins", () => {
    for (const email of ["a@evil-onekeel.ai", "a@onekeel.ai.evil.com", "a@mail.onekeel.ai", "a@onekeel.ai@evil.com", "other@partner.com", "a b@onekeel.ai", "", undefined, null]) {
      expect(isEmailAllowed(team, email)).toBe(false);
    }
  });

  it("always admits ADMIN_EMAIL when restricted", () => {
    const only = parseAccessConfig({ ALLOWED_EMAIL_DOMAINS: "onekeel.ai", ADMIN_EMAIL: "boss@elsewhere.com" });
    expect(isEmailAllowed(only, "boss@elsewhere.com")).toBe(true);
  });
});

describe("mayBecomeAdmin / normalizeEmail", () => {
  it("is open to anyone without ADMIN_EMAIL, otherwise only that address", () => {
    expect(mayBecomeAdmin(OPEN_ACCESS, "x@y.com")).toBe(true);
    expect(mayBecomeAdmin(team, "JOSH.COPP@onekeel.ai")).toBe(true);
    expect(mayBecomeAdmin(team, "julie@partner.com")).toBe(false);
    expect(mayBecomeAdmin(team, undefined)).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(normalizeEmail("a@b@c")).toBeNull();
    expect(normalizeEmail("@b.com")).toBeNull();
    expect(normalizeEmail(" A@B.com ")).toBe("a@b.com");
  });
});
