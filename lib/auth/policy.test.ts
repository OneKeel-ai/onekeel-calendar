import { describe, expect, it } from "vitest";
import { parseAccessConfig } from "./access";
import { ADMIN_USER_ACTIONS, type AdminUserAction, checkAdminAction, type UserRole, decideSignup, evaluateLockout, LOCKOUT_MAX_FAILURES, LOCKOUT_WINDOW_MS } from "./policy";

describe("decideSignup", () => {
  it("always allows the first user and makes them admin", () => {
    for (const mode of ["open", "invite_only", "disabled"] as const) {
      expect(decideSignup({ mode, existingUserCount: 0 })).toEqual({ allowed: true, role: "admin" });
    }
  });

  it("allows later users as regular users in open mode", () => {
    expect(decideSignup({ mode: "open", existingUserCount: 3 })).toEqual({
      allowed: true,
      role: "user",
    });
  });

  it("rejects later users when signup is disabled", () => {
    expect(decideSignup({ mode: "disabled", existingUserCount: 1 })).toEqual({
      allowed: false,
      reason: "SIGNUP_DISABLED",
    });
  });

  it("rejects uninvited users in invite-only mode", () => {
    expect(decideSignup({ mode: "invite_only", existingUserCount: 1 })).toEqual({
      allowed: false,
      reason: "INVITE_REQUIRED",
    });
    expect(decideSignup({ mode: "invite_only", existingUserCount: 1, invited: true })).toEqual({ allowed: true, role: "user" });
    expect(decideSignup({ mode: "disabled", existingUserCount: 1, invited: true })).toMatchObject({ allowed: false });
  });
});

describe("decideSignup with the internal allowlist", () => {
  const access = parseAccessConfig({
    ALLOWED_EMAIL_DOMAINS: "onekeel.ai",
    ALLOWED_EMAILS: "julie@partner.com",
    ADMIN_EMAIL: "josh.copp@onekeel.ai",
  });
  const notAllowed = { allowed: false, reason: "NOT_ALLOWED" };

  it("blocks outsiders even for the very first account (no public takeover)", () => {
    for (const mode of ["open", "invite_only", "disabled"] as const) {
      expect(decideSignup({ mode, existingUserCount: 0, adminExists: false, email: "attacker@evil.com", access })).toEqual(notAllowed);
    }
    const noAdminEmail = parseAccessConfig({ ALLOWED_EMAIL_DOMAINS: "onekeel.ai" });
    expect(decideSignup({ mode: "open", existingUserCount: 0, email: "attacker@evil.com", access: noAdminEmail })).toEqual(notAllowed);
  });

  it("fails closed when the address is missing", () => {
    expect(decideSignup({ mode: "open", existingUserCount: 0, access })).toEqual(notAllowed);
  });

  it("makes ADMIN_EMAIL the first admin, even when signups are otherwise disabled", () => {
    expect(decideSignup({ mode: "disabled", existingUserCount: 0, adminExists: false, email: "josh.copp@onekeel.ai", access })).toEqual({ allowed: true, role: "admin" });
  });

  it("lets other allowlisted people join as plain users before the admin exists", () => {
    expect(decideSignup({ mode: "open", existingUserCount: 0, adminExists: false, email: "chelsea@onekeel.ai", access })).toEqual({ allowed: true, role: "user" });
    expect(decideSignup({ mode: "open", existingUserCount: 1, adminExists: false, email: "julie@partner.com", access })).toEqual({ allowed: true, role: "user" });
  });

  it("still lets Josh become admin after others joined first, but only once", () => {
    expect(decideSignup({ mode: "disabled", existingUserCount: 2, adminExists: false, email: "josh.copp@onekeel.ai", access })).toEqual({ allowed: true, role: "admin" });
    expect(decideSignup({ mode: "open", existingUserCount: 3, adminExists: true, email: "josh.copp@onekeel.ai", access })).toEqual({ allowed: true, role: "user" });
  });

  it("applies the signup mode to allowlisted people after bootstrap", () => {
    expect(decideSignup({ mode: "disabled", existingUserCount: 1, adminExists: true, email: "chelsea@onekeel.ai", access })).toMatchObject({ reason: "SIGNUP_DISABLED" });
  });

  it("without an allowlist behaves exactly as before", () => {
    expect(decideSignup({ mode: "open", existingUserCount: 0, email: "anyone@y.com" })).toEqual({ allowed: true, role: "admin" });
  });
});

describe("evaluateLockout", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is not locked below the threshold", () => {
    const failures = Array.from({ length: LOCKOUT_MAX_FAILURES - 1 }, (_, i) => ago(i * 1000));
    expect(evaluateLockout(failures, now)).toEqual({ locked: false });
  });

  it("locks at the threshold and reports when it ends", () => {
    const failures = Array.from({ length: LOCKOUT_MAX_FAILURES }, (_, i) => ago(i * 60_000));
    const result = evaluateLockout(failures, now);
    expect(result.locked).toBe(true);
    // Lock lifts once the oldest failure that counts toward the threshold leaves the window.
    const oldestCounted = ago((LOCKOUT_MAX_FAILURES - 1) * 60_000);
    expect(result.locked && result.until.getTime()).toBe(oldestCounted.getTime() + LOCKOUT_WINDOW_MS);
  });

  it("ignores failures outside the window", () => {
    const failures = Array.from({ length: 20 }, () => ago(LOCKOUT_WINDOW_MS + 1));
    expect(evaluateLockout(failures, now)).toEqual({ locked: false });
  });

  it("does not depend on input order and does not mutate it", () => {
    const failures = Array.from({ length: LOCKOUT_MAX_FAILURES }, (_, i) => ago(i * 1000)).reverse();
    const copy = [...failures];
    expect(evaluateLockout(failures, now).locked).toBe(true);
    expect(failures).toEqual(copy);
  });
});

describe("checkAdminAction (ADM-009)", () => {
  const admin = { id: "a2", role: "admin" as const, disabled: false };
  const member = { id: "u1", role: "user" as const, disabled: false };
  type Target = { id: string; role: UserRole; disabled: boolean };
  const check = (action: AdminUserAction, target: Target = member, activeAdminCount = 2, actorId = "a1") =>
    checkAdminAction({ actorId, target, action, activeAdminCount });

  it("lets an admin manage other accounts", () => {
    for (const action of ADMIN_USER_ACTIONS) expect(check(action)).toEqual({ allowed: true });
    expect(check("demote", admin)).toEqual({ allowed: true });
  });

  it("never lets admins remove their own access", () => {
    const self = { id: "a1", role: "admin" as const, disabled: false };
    for (const action of ["demote", "disable", "delete"] as const) {
      expect(check(action, self, 5)).toEqual({ allowed: false, reason: "SELF" });
    }
    expect(check("enable", self, 1)).toEqual({ allowed: true });
  });

  it("keeps the last active admin", () => {
    for (const action of ["demote", "disable", "delete"] as const) {
      expect(check(action, admin, 1)).toEqual({ allowed: false, reason: "LAST_ADMIN" });
    }
  });

  it("does not count a disabled admin as the last one", () => {
    expect(check("delete", { ...admin, disabled: true }, 1)).toEqual({ allowed: true });
  });

  it("always allows promoting and enabling", () => {
    expect(check("promote", member, 0)).toEqual({ allowed: true });
    expect(check("enable", { ...admin, disabled: true }, 0)).toEqual({ allowed: true });
  });
});
