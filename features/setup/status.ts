/** Setup checklist rules, kept free of the database so they are easy to test. */

export type StepState = "done" | "todo" | "attention";

export type SetupStep = {
  id: "profile" | "calendar" | "meetings" | "email";
  title: string;
  state: StepState;
  detail: string;
  href: string;
  action: string;
};

export type CalendarFacts = {
  invalid: boolean;
  calendars: { name: string; checkConflicts: boolean; isDestination: boolean }[];
};

export type SetupFacts = {
  username: string | null;
  timeZone: string;
  connections: CalendarFacts[];
  /** Event types that are switched on. */
  enabledEventTypes: number;
  /** Hours rows in the default weekly schedule. */
  workingHourRanges: number;
};

export type CalendarStatus = {
  state: StepState;
  /** True only when bookings can safely be offered: every connection works and one is checked. */
  healthy: boolean;
  checked: number;
  destination: string | null;
  detail: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function calendarStatus(connections: readonly CalendarFacts[]): CalendarStatus {
  const all = connections.flatMap((c) => c.calendars);
  const checked = all.filter((c) => c.checkConflicts).length;
  const destination = all.find((c) => c.isDestination)?.name ?? null;
  if (connections.length === 0)
    return { state: "todo", healthy: false, checked: 0, destination, detail: "No calendar connected. Booking for meetings you host stays off until you connect one." };
  if (connections.some((c) => c.invalid))
    return { state: "attention", healthy: false, checked, destination, detail: "A calendar needs to be reconnected. Booking for meetings you host is paused until it is." };
  if (checked === 0)
    return { state: "attention", healthy: false, checked, destination, detail: "Connected, but no calendar is checked for conflicts. Turn at least one on." };
  if (!destination)
    return { state: "attention", healthy: false, checked, destination, detail: "Choose a writable destination calendar for new bookings. Booking for meetings you host stays paused until one is selected." };
  return {
    state: "done",
    healthy: true,
    checked,
    destination,
    detail: `Checking ${plural(checked, "calendar")} for conflicts.${destination ? ` New bookings go to ${destination}.` : ""}`,
  };
}

export function buildSteps(facts: SetupFacts): SetupStep[] {
  const calendar = calendarStatus(facts.connections);
  const profileDone = Boolean(facts.username) && facts.timeZone !== "UTC";
  const meetingsDone = facts.enabledEventTypes > 0 && facts.workingHourRanges > 0;
  const emailReady = Boolean(facts.username) && meetingsDone && calendar.healthy;

  const profileDetail = !facts.username
    ? "Pick a username. It is part of the link to your own booking page."
    : facts.timeZone === "UTC"
      ? "Your time zone is still UTC. Set your own so hours and emails read correctly."
      : `Booking link name: ${facts.username}. Time zone: ${facts.timeZone.replaceAll("_", " ")}.`;

  const meetingsDetail =
    facts.enabledEventTypes === 0
      ? "You have no meeting type of your own switched on yet."
      : facts.workingHourRanges === 0
        ? `${plural(facts.enabledEventTypes, "meeting type")} on, but your weekly hours are empty, so no times can be offered.`
        : `${plural(facts.enabledEventTypes, "meeting type")} on, with weekly hours set.`;

  return [
    { id: "profile", title: "Profile and time zone", state: profileDone ? "done" : "todo", detail: profileDetail, href: "/settings/profile", action: profileDone ? "Edit profile" : "Finish profile" },
    { id: "calendar", title: "Calendar", state: calendar.state, detail: calendar.detail, href: "/settings/calendars", action: calendar.healthy ? "Manage calendars" : "Connect or fix calendar" },
    {
      id: "meetings",
      title: "Meeting types and hours",
      state: meetingsDone ? "done" : "todo",
      detail: meetingsDetail,
      href: facts.enabledEventTypes === 0 ? "/event-types/new" : facts.workingHourRanges === 0 ? "/availability" : "/event-types",
      action: facts.enabledEventTypes === 0 ? "Add meeting type" : facts.workingHourRanges === 0 ? "Set hours" : "Edit meeting types",
    },
    {
      id: "email",
      title: "Times in email",
      state: emailReady ? "done" : "todo",
      detail: emailReady
        ? "Ready. Pick free times and paste them into an email."
        : "For meetings you host, this needs a username, meeting type, weekly hours, and a working calendar. Scheduling for a connected team host doesn't need any of these.",
      href: "/schedule",
      action: "Open email times",
    },
  ];
}
