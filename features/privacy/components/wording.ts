/**
 * Plain wording for private calendars, kept free of React so it is unit tested directly. The
 * sentences describe exactly what the server enforces (features/privacy/server); keep them in
 * step with it and never promise more.
 */

/** "A", "A and B", "A, B and C". Blank names are skipped and repeats shown once. */
export function joinNames(names: readonly string[]): string {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The notice under "Host: ..." on Email times. `hostLabel` is "you" when the signed-in user is the host. */
export function privateHostNotice(hostLabel: string, allowed: readonly string[]): string {
  const who = joinNames(allowed);
  const host = hostLabel.trim() || "this host";
  const start = who ? `Private calendar. Only ${who} can see or schedule ${host}.` : "Private calendar.";
  return `${start} Clients can only book through links you send.`;
}

/** What turning on Calendar privacy does, in the order shown on the settings page. */
export const WHAT_PRIVACY_DOES: readonly string[] = [
  "Only you and the people you name can see your free and busy time, schedule for you, or see and manage meetings booked for you in Keel Calendar. Other team admins and the instance admin cannot.",
  "You can only be in a team with those people. Inviting anyone else to such a team, or inviting you into another team, is refused.",
  "Nobody else can add your calendar to their own Keel Calendar account, even if Google shares it with them.",
  "Your booking pages are by invitation: a client needs a link sent from Email times.",
  "Keel Calendar only ever reads busy and free times from Google, never meeting titles, descriptions or guest lists. Meetings booked through Keel Calendar are stored here (title, client name and email). You, the people you named and the people invited to that meeting can see them.",
  "The instance admin can set this up for someone before they first sign in. After that, only that person can change it.",
];

export const WHAT_PRIVACY_DOES_NOT = "What it does not do: it does not change who can see your calendar in Google itself.";

/** One line per team that still blocks turning privacy on. */
export function blockerMessage(blocker: { team: string; people: readonly string[] }): string {
  const people = joinNames(blocker.people) || "other people";
  return `You share the team ${blocker.team} with ${people}. Leave that team, or add them above, then save again.`;
}

/** Who set a private calendar up, for the admin list. */
export function guardOrigin(hasAccount: boolean): string {
  return hasAccount ? "Set by the person" : "Set up in advance";
}

/** One admin row in plain words. */
export function guardRowSummary(guard: { delegates: readonly string[]; calendarAddresses: readonly string[] }): { delegates: string; addresses: string } {
  return {
    delegates: guard.delegates.length ? guard.delegates.join(", ") : "Only them",
    addresses: guard.calendarAddresses.length ? guard.calendarAddresses.join(", ") : "None",
  };
}
