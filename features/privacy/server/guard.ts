import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbOrTx, Tx } from "@/db/client";
import { calendarGuard, eventType, eventTypeHost, membership, team, teamInvitation, user } from "@/db/schema";

/**
 * Private calendars ("calendar guard"). A guard row for G's account email means only G and G's
 * delegates ("allowed for G") may see G's free/busy time, schedule for G, or see and manage G's
 * meetings. Invariant kept by saveGuard and the team invitation choke points: a person with a
 * private calendar never shares a team with someone who is not allowed for them. The read and
 * write paths also filter on use (defense in depth), in case old data breaks the invariant.
 * Emails are compared lower-cased everywhere (`user.email` is not guaranteed lower-case).
 */

export type GuardView = { email: string; delegates: string[]; calendarAddresses: string[]; hasAccount: boolean; updatedAt: string };
/** A team the person shares with people who are not allowed. */
export type GuardBlocker = { team: string; people: string[] };
export type GuardResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: { email?: string; delegates?: string; calendarAddresses?: string }; blockers?: GuardBlocker[] };

export const MAX_GUARD_DELEGATES = 10;
export const MAX_GUARD_ADDRESSES = 10;
const MAX_ADDRESS_LENGTH = 512;

export type Guard = { email: string; delegates: string[]; calendarAddresses: string[] };

export const normEmail = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

/** "Allowed for G": G's own email or one of G's delegates. A missing viewer email is never allowed. */
export function isAllowedFor(guard: Pick<Guard, "email" | "delegates">, viewerEmail: string | null | undefined): boolean {
  const viewer = normEmail(viewerEmail);
  if (!viewer) return false;
  return viewer === guard.email || guard.delegates.includes(viewer);
}

/** Every guard (the table is tiny: one read per request path). */
export async function loadGuards(db: DbOrTx): Promise<Guard[]> {
  const rows = await db
    .select({ email: calendarGuard.email, delegates: calendarGuard.delegates, calendarAddresses: calendarGuard.calendarAddresses })
    .from(calendarGuard);
  // Stored lower-case already; normalized again so a hand-edited row can't widen access by case.
  return rows.map((r) => ({
    email: normEmail(r.email),
    delegates: (r.delegates ?? []).map(normEmail).filter(Boolean),
    calendarAddresses: (r.calendarAddresses ?? []).map(normEmail).filter(Boolean),
  }));
}

export const indexGuards = (guards: readonly Guard[]): Map<string, Guard> => new Map(guards.map((g) => [g.email, g]));

/**
 * Calendar ids/addresses the viewer may not use: for every guard the viewer is not allowed for,
 * the protected person's email and their extra calendar addresses (all lower-cased).
 */
export function blockedAddresses(guards: readonly Guard[], viewerEmail: string | null | undefined): Set<string> {
  const blocked = new Set<string>();
  for (const g of guards) {
    if (isAllowedFor(g, viewerEmail)) continue;
    blocked.add(g.email);
    for (const a of g.calendarAddresses) blocked.add(a);
  }
  return blocked;
}

/** True when a connected calendar (by provider id, e.g. a Google calendar's email) is blocked. */
export const isBlockedCalendar = (blocked: ReadonlySet<string>, externalId: string | null | undefined): boolean =>
  blocked.size > 0 && blocked.has(normEmail(externalId));

async function emailsOf(db: DbOrTx, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, normEmail(r.email)]));
}

/**
 * The calendar addresses one user may not use, keyed by nothing else: loads all guards and the
 * user's email once. Empty when there are no guards (one tiny query).
 */
export async function blockedCalendarAddressesFor(db: DbOrTx, userId: string): Promise<Set<string>> {
  const guards = await loadGuards(db);
  if (!guards.length) return new Set();
  const email = (await emailsOf(db, [userId])).get(userId);
  // Unknown user: fail closed (every protected address is blocked).
  return blockedAddresses(guards, email ?? "");
}

/** Per user id: the addresses that user may not use (batched for several calendar owners). */
export async function blockedCalendarAddressesByUser(db: DbOrTx, userIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const guards = await loadGuards(db);
  if (!guards.length) return result;
  const emails = await emailsOf(db, userIds);
  for (const id of new Set(userIds)) result.set(id, blockedAddresses(guards, emails.get(id) ?? ""));
  return result;
}

/**
 * Of `userIds`, the people who keep their calendar private and for whom the viewer is NOT allowed.
 * The viewer is always allowed for themself.
 */
export async function hiddenFromViewer(db: DbOrTx, viewerId: string, userIds: readonly string[]): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (!userIds.length) return hidden;
  const guards = indexGuards(await loadGuards(db));
  if (!guards.size) return hidden;
  const emails = await emailsOf(db, [viewerId, ...userIds]);
  const viewerEmail = emails.get(viewerId) ?? "";
  for (const id of new Set(userIds)) {
    if (id === viewerId) continue;
    const g = guards.get(emails.get(id) ?? "");
    if (g && !isAllowedFor(g, viewerEmail)) hidden.add(id);
  }
  return hidden;
}

/** The guard on this user's account email, if any. */
export async function guardOfUser(db: DbOrTx, userId: string): Promise<Guard | null> {
  const email = (await emailsOf(db, [userId])).get(userId);
  if (!email) return null;
  return (await loadGuards(db)).find((g) => g.email === email) ?? null;
}

/** Guards by user id, for the given users (only those who have one). */
export async function guardsOfUsers(db: DbOrTx, userIds: readonly string[]): Promise<Map<string, Guard>> {
  const out = new Map<string, Guard>();
  if (!userIds.length) return out;
  const guards = indexGuards(await loadGuards(db));
  if (!guards.size) return out;
  const emails = await emailsOf(db, userIds);
  for (const [id, email] of emails) {
    const g = guards.get(email);
    if (g) out.set(id, g);
  }
  return out;
}

/**
 * Event types (of `ids`) that need a valid scheduling offer to be booked publicly: a host has a
 * private calendar. Hosts: the owner of a personal event type (managed copies included) and every
 * host row of the type.
 */
export async function eventTypesNeedingOffer(db: DbOrTx, ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const rows = await db
    .select({ id: eventType.id })
    .from(eventType)
    .where(
      and(
        inArray(eventType.id, unique),
        sql`EXISTS (SELECT 1 FROM "user" hu INNER JOIN calendar_guard g ON g.email = lower(hu.email)
          WHERE (hu.id = ${eventType.ownerUserId} AND ${eventType.teamId} IS NULL)
             OR hu.id IN (SELECT eth.user_id FROM event_type_host eth WHERE eth.event_type_id = ${eventType.id}))`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** True when any host of this event type has a private calendar. */
export async function bookingNeedsOffer(db: Database | DbOrTx, eventTypeId: string): Promise<boolean> {
  return (await eventTypesNeedingOffer(db, [eventTypeId])).has(eventTypeId);
}

/**
 * May this user see and schedule every host of the event type? True when no host keeps their
 * calendar private. With a private host: only that person and their delegates, checked live, so
 * someone who is taken off the list loses access at once. No user (null): never.
 */
export async function allowedForEventTypeHosts(db: DbOrTx, viewerId: string | null | undefined, eventTypeId: string): Promise<boolean> {
  const [et] = await db.select({ ownerUserId: eventType.ownerUserId, teamId: eventType.teamId }).from(eventType).where(eq(eventType.id, eventTypeId));
  if (!et) return false;
  const hostIds = et.teamId
    ? (await db.select({ userId: eventTypeHost.userId }).from(eventTypeHost).where(eq(eventTypeHost.eventTypeId, eventTypeId))).map((h) => h.userId)
    : [et.ownerUserId];
  if (!(await guardsOfUsers(db, hostIds)).size) return true;
  if (!viewerId) return false;
  return (await hiddenFromViewer(db, viewerId, hostIds)).size === 0;
}

/** True when any of these users keeps their calendar private (dynamic group links refuse them). */
export async function anyPrivate(db: DbOrTx, userIds: readonly string[]): Promise<boolean> {
  return (await guardsOfUsers(db, userIds)).size > 0;
}

// ---------------------------------------------------------------------------- team invariant

/** Serializes guard saves with team joins, so neither can slip past the other's check. */
export async function lockGuards(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('calendar_guard'))`);
}

/**
 * Would adding `inviteeEmail` to this team break the invariant?
 * - "invitee": the invitee keeps their calendar private and the team has someone not allowed for them;
 * - "member": someone in the team keeps their calendar private and the invitee is not allowed for them.
 * `includePending`: also count the team's other open invitations (at invite time).
 */
export async function teamPrivacyConflict(
  db: DbOrTx,
  teamId: string,
  inviteeEmail: string,
  opts: { includePending?: boolean; now?: number } = {},
): Promise<"invitee" | "member" | null> {
  const guards = indexGuards(await loadGuards(db));
  if (!guards.size) return null;
  const invitee = normEmail(inviteeEmail);
  const members = await db.select({ email: user.email }).from(membership).innerJoin(user, eq(user.id, membership.userId)).where(eq(membership.teamId, teamId));
  const others = new Set(members.map((m) => normEmail(m.email)));
  if (opts.includePending) {
    const pending = await db
      .select({ email: teamInvitation.email })
      .from(teamInvitation)
      .where(and(eq(teamInvitation.teamId, teamId), gt(teamInvitation.expiresAt, new Date(opts.now ?? Date.now()))));
    for (const p of pending) others.add(normEmail(p.email));
  }
  others.delete(invitee);
  const own = guards.get(invitee);
  if (own && [...others].some((e) => !isAllowedFor(own, e))) return "invitee";
  for (const e of others) {
    const g = guards.get(e);
    if (g && !isAllowedFor(g, invitee)) return "member";
  }
  return null;
}

// ---------------------------------------------------------------------------- validation

const emailSchema = z.string().max(254).email();
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f-\u009f]/;

/** Lower-cased, valid, de-duplicated input, or the first problem per field. Pure. */
export function normalizeGuardInput(input: { email: string; delegates: readonly string[]; calendarAddresses: readonly string[] }):
  | { ok: true; guard: Guard }
  | { ok: false; fieldErrors: NonNullable<Extract<GuardResult, { ok: false }>["fieldErrors"]> } {
  const fieldErrors: NonNullable<Extract<GuardResult, { ok: false }>["fieldErrors"]> = {};
  const email = normEmail(input.email);
  if (!emailSchema.safeParse(email).success) fieldErrors.email = "Enter a valid email address";
  const delegates: string[] = [];
  for (const raw of input.delegates) {
    const d = normEmail(raw);
    if (!d) continue;
    if (!emailSchema.safeParse(d).success) {
      fieldErrors.delegates ??= `“${d.slice(0, 80)}” isn't a valid email address`;
      continue;
    }
    if (d === email) {
      fieldErrors.delegates ??= "The person themself is always allowed; don't add them as a delegate";
      continue;
    }
    if (!delegates.includes(d)) delegates.push(d);
  }
  if (delegates.length > MAX_GUARD_DELEGATES) fieldErrors.delegates ??= `Add at most ${MAX_GUARD_DELEGATES} people`;
  const calendarAddresses: string[] = [];
  for (const raw of input.calendarAddresses) {
    const a = normEmail(raw);
    if (!a) continue;
    if (a.length > MAX_ADDRESS_LENGTH || CONTROL_OR_SPACE.test(a)) {
      fieldErrors.calendarAddresses ??= "One of the calendar addresses isn't valid";
      continue;
    }
    // The account email is always protected: no need to list it.
    if (a !== email && !calendarAddresses.includes(a)) calendarAddresses.push(a);
  }
  if (calendarAddresses.length > MAX_GUARD_ADDRESSES) fieldErrors.calendarAddresses ??= `Add at most ${MAX_GUARD_ADDRESSES} calendar addresses`;
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, guard: { email, delegates: delegates.toSorted(), calendarAddresses: calendarAddresses.toSorted() } };
}

// ---------------------------------------------------------------------------- read / save

async function accountIdFor(db: DbOrTx, email: string): Promise<string | null> {
  const [row] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${normEmail(email)}`).limit(1);
  return row?.id ?? null;
}

const toView = (row: typeof calendarGuard.$inferSelect, hasAccount: boolean): GuardView => ({
  email: row.email,
  delegates: row.delegates ?? [],
  calendarAddresses: row.calendarAddresses ?? [],
  hasAccount,
  updatedAt: row.updatedAt.toISOString(),
});

export async function getGuardView(db: DbOrTx, email: string): Promise<GuardView | null> {
  const [row] = await db.select().from(calendarGuard).where(eq(calendarGuard.email, normEmail(email)));
  return row ? toView(row, Boolean(await accountIdFor(db, row.email))) : null;
}

export async function listGuardViews(db: DbOrTx): Promise<GuardView[]> {
  const rows = await db.select().from(calendarGuard).orderBy(asc(calendarGuard.email));
  if (!rows.length) return [];
  const accounts = await db
    .select({ email: sql<string>`lower(${user.email})` })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, rows.map((r) => r.email)));
  const have = new Set(accounts.map((a) => a.email));
  return rows.map((r) => toView(r, have.has(r.email)));
}

/**
 * Teams the account shares with people who would not be allowed for `guard` (the invariant's
 * blockers). People are labelled by name, else email.
 */
export async function guardBlockers(db: DbOrTx, userId: string, guard: Pick<Guard, "email" | "delegates">): Promise<GuardBlocker[]> {
  const teams = await db.select({ id: team.id, name: team.name }).from(membership).innerJoin(team, eq(team.id, membership.teamId)).where(eq(membership.userId, userId)).orderBy(asc(team.name));
  if (!teams.length) return [];
  const members = await db
    .select({ teamId: membership.teamId, userId: user.id, name: user.name, email: user.email })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(inArray(membership.teamId, teams.map((t) => t.id)))
    .orderBy(asc(user.name));
  const blockers: GuardBlocker[] = [];
  for (const t of teams) {
    const people = members
      .filter((m) => m.teamId === t.id && m.userId !== userId && !isAllowedFor(guard, m.email))
      .map((m) => m.name?.trim() || m.email);
    if (people.length) blockers.push({ team: t.name, people });
  }
  return blockers;
}

const FIX = "Please fix the highlighted fields.";
const BLOCKED = "You share a team with people who aren't on your list. Add them, or leave those teams first.";

async function writeGuard(tx: Tx, guard: Guard, createdBy: string | null): Promise<void> {
  await tx
    .insert(calendarGuard)
    .values({ email: guard.email, delegates: guard.delegates, calendarAddresses: guard.calendarAddresses, createdBy })
    .onConflictDoUpdate({
      target: calendarGuard.email,
      set: { delegates: guard.delegates, calendarAddresses: guard.calendarAddresses, updatedAt: new Date() },
    });
}

/** The signed-in person turns their own guard on or updates it. Refused (with blockers) when it would break the invariant. */
export async function saveOwnGuard(
  db: Database,
  me: { id: string; email: string },
  input: { delegates: readonly string[]; calendarAddresses: readonly string[] },
): Promise<GuardResult> {
  const checked = normalizeGuardInput({ email: me.email, ...input });
  if (!checked.ok) return { ok: false, message: FIX, fieldErrors: checked.fieldErrors };
  return db.transaction(async (tx) => {
    await lockGuards(tx);
    const blockers = await guardBlockers(tx, me.id, checked.guard);
    if (blockers.length) return { ok: false as const, message: BLOCKED, blockers };
    await writeGuard(tx, checked.guard, me.id);
    return { ok: true as const };
  });
}

/** The signed-in person makes their calendar normal again. */
export async function removeOwnGuard(db: Database, me: { email: string }): Promise<GuardResult> {
  await db.delete(calendarGuard).where(eq(calendarGuard.email, normEmail(me.email)));
  return { ok: true };
}

const ACCOUNT_EXISTS = "This person has signed in already. Only they can change their private calendar settings now.";

/**
 * The instance admin protects someone before their first sign-in. Allowed only while no account
 * exists for that email; afterwards only the person themself can change or remove it.
 */
export async function adminSaveGuard(
  db: Database,
  adminId: string,
  input: { email: string; delegates: readonly string[]; calendarAddresses: readonly string[] },
): Promise<GuardResult> {
  const checked = normalizeGuardInput(input);
  if (!checked.ok) return { ok: false, message: FIX, fieldErrors: checked.fieldErrors };
  return db.transaction(async (tx) => {
    await lockGuards(tx);
    if (await accountIdFor(tx, checked.guard.email)) return { ok: false as const, message: ACCOUNT_EXISTS };
    await writeGuard(tx, checked.guard, adminId);
    return { ok: true as const };
  });
}

export async function adminRemoveGuard(db: Database, input: { email: string }): Promise<GuardResult> {
  const email = normEmail(input.email);
  return db.transaction(async (tx) => {
    await lockGuards(tx);
    if (await accountIdFor(tx, email)) return { ok: false as const, message: ACCOUNT_EXISTS };
    await tx.delete(calendarGuard).where(eq(calendarGuard.email, email));
    return { ok: true as const };
  });
}

