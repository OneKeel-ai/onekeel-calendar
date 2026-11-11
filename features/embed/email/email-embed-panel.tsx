"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, timeZoneOptions } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addDays, formatDate, isValidTimeZone, type LocalDate, localDateOf } from "@/lib/availability/tz";
import { formatDuration, prefers12Hour } from "@/lib/format";
import { useTimeZones } from "@/lib/use-time-zones";
import type { EmbedTarget } from "../target";
import { EmailCopyActions } from "./email-copy-actions";
import { EmailEmbedError, emailPreviewDocument, MAX_EMAIL_SLOTS, renderEmailEmbed } from "./email-html";
import { CalendarOverlay } from "./calendar-overlay";
import { MANUAL_HOURS, manualChoices, manualPicks, manualSlotsInput, NO_PICKS, type PickState, slotGrid, togglePick } from "./manual-times";
import { ManualTimesNotice, ManualTimesSwitch } from "./manual-times-fields";
import { EmailSlotPicker } from "./email-slot-picker";
import { type CopyGate, copyGate, type MeetingDetailsValue } from "./meeting-details";
import { MeetingDetails, OfferSaveStatus } from "./meeting-details-fields";
import { busyDuring, displayHours, type LoadBusy, shownPeople, toggleViewed, weekWindow } from "./planner";
import { dayKey, groupByDay } from "./selection";
import { useOfferSave } from "./use-offer-save";
import { useViewedCalendars } from "./use-viewed-calendars";
import { useWeekSlots } from "./use-week-slots";

const NOTE_MAX = 500;
const EMPTY_SLOTS: readonly string[] = [];

/**
 * Optional planning view (used by Email times): lets the sender view teammates' busy time next to
 * the host's free times. Display only; it never changes the target, host or offered times.
 */
export type EmailPlannerOptions = {
  /** Who the meeting is booked with, e.g. "You" or the executive's name. */
  hostLabel: string;
  /** Reads viewed calendars for a window; must be stable between renders. */
  loadBusy?: LoadBusy;
};

/**
 * Optional "Meeting details" (used by Email times): a custom title and people invited when the
 * client books. The values live with the caller so they survive a change of host or meeting type.
 */
export type EmailOfferOptions = {
  /** Event type the times are offered for; the details are saved for it. */
  eventTypeId: string;
  value: MeetingDetailsValue;
  onChange: (next: MeetingDetailsValue) => void;
  /**
   * Offer "Add times by hand": times the calendar shows as busy or outside working hours, saved
   * in the offer so its links can book them. Only for single-host, non-seated meeting types.
   */
  manualTimes?: boolean;
};

type Env = { appUrl: string; timeZone: string; locale: string; hour12: boolean; now: number };

/** Browser-only values, read once after mount so the first render matches the server's. */
function readEnv(appUrl: string | undefined): Env {
  let timeZone = "UTC";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidTimeZone(tz)) timeZone = tz;
  } catch {
    // keep UTC
  }
  const locale = navigator.language || "en";
  return { appUrl: appUrl ?? window.location.origin, timeZone, locale, hour12: prefers12Hour(locale), now: Date.now() };
}

/**
 * Email embed (Cal.com-style): the sender picks free slots and copies a snapshot of them into an
 * email; each time links to the booking page on that start. Rendered as the "Email" tab of the
 * embed dialog.
 */
export function EmailEmbedPanel({
  target,
  appUrl,
  planner,
  offer,
}: {
  target: EmbedTarget;
  /** The instance's canonical URL (APP_URL); links must not depend on how the dashboard was reached. */ appUrl?: string;
  /** Adds the optional calendar view. Without it the panel behaves exactly as in the embed dialog. */
  planner?: EmailPlannerOptions;
  /** Adds the meeting title and invitees. Without it links carry no offer, as in the embed dialog. */
  offer?: EmailOfferOptions;
}) {
  if (!target.booking || target.booking.durations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The email embed lists free times of a single event type. Open it from an event type to pick times to paste into
        an email.
      </p>
    );
  }
  return <EmailEmbedEditor target={target} booking={target.booking} appUrl={appUrl} planner={planner} offer={offer} />;
}

type Booking = NonNullable<EmbedTarget["booking"]>;

function EmailEmbedEditor({
  target,
  booking,
  appUrl,
  planner,
  offer,
}: {
  target: EmbedTarget;
  booking: Booking;
  appUrl?: string;
  planner?: EmailPlannerOptions;
  offer?: EmailOfferOptions;
}) {
  const [env, setEnv] = useState<Env | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [hour12, setHour12] = useState(false);
  const [duration, setDuration] = useState(booking.durations[0] ?? 0);
  const [weekStart, setWeekStart] = useState<LocalDate | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  // Picks are tied to this booking page: if the target ever changes in place, old picks are dropped
  // instead of being offered on another host's calendar. Hand-added picks go with them.
  const scope = target.calLink;
  const [picked, setPicked] = useState<PickState & { scope: string }>({ scope, ...NO_PICKS });
  const picks: PickState = picked.scope === scope ? picked : NO_PICKS;
  const selected = picks.slots;
  const setPicks = useCallback(
    (next: (prev: PickState) => PickState) => setPicked((prev) => ({ scope, ...next(prev.scope === scope ? prev : NO_PICKS) })),
    [scope],
  );
  const manualAvailable = Boolean(offer?.manualTimes);
  const [manualOn, setManualOn] = useState(false);
  // When hand-addable cells start (refreshed on each switch or week change; the server refuses past times anyway).
  const [clock, setClock] = useState(0);
  const handPicks = useMemo(() => manualPicks(picks), [picks]);
  const manualSlots = useMemo(() => manualSlotsInput({ slots: selected, manual: handPicks }, duration), [selected, handPicks, duration]);
  const [plannerOpen, setPlannerOpen] = useState(Boolean(planner?.loadBusy));
  const [viewed, setViewed] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const timeZones = useTimeZones();
  const details = offer?.value;
  const offerSave = useOfferSave(offer?.eventTypeId ?? "", details ?? { title: "", guests: [] }, manualSlots);
  // Links must carry exactly the title, people and hand-added times on screen: no copying until those are saved.
  const gate: CopyGate = offer && details ? copyGate(offer.eventTypeId, details, offerSave.save, manualSlots) : { canCopy: true };
  const fieldErrors = !gate.canCopy && gate.status === "error" && offerSave.save.status === "error" ? offerSave.save.fieldErrors : undefined;
  const offerId = gate.canCopy ? gate.offerId : undefined;
  const customTitle = details?.title.trim() || undefined;

  useEffect(() => {
    const next = readEnv(appUrl);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time sync from browser APIs */
    setEnv(next);
    setTimeZone(next.timeZone);
    setHour12(next.hour12);
    setWeekStart(localDateOf(next.now, next.timeZone));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [appUrl]);

  const week = useWeekSlots({ booking, duration, timeZone, weekStart });
  const viewWindow = useMemo(() => (weekStart && timeZone ? weekWindow(weekStart, timeZone) : null), [weekStart, timeZone]);
  const calendars = useViewedCalendars(
    planner?.loadBusy,
    viewWindow?.start ?? null,
    viewWindow?.end ?? null,
    Boolean(planner?.loadBusy) && plannerOpen,
  );
  const viewedPeople = useMemo(
    () => (plannerOpen ? shownPeople(calendars.members, viewed) : []),
    [plannerOpen, calendars.members, viewed],
  );

  const days = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : []),
    [weekStart],
  );
  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!timeZone) return map;
    for (const slot of week.slots) {
      const key = dayKey(Date.parse(slot), timeZone);
      map.set(key, [...(map.get(key) ?? []), slot]);
    }
    return map;
  }, [week.slots, timeZone]);

  const offered = week.status === "ready" ? week.slots : EMPTY_SLOTS;
  const grid = useMemo(() => (timeZone ? slotGrid(offered, duration, timeZone) : { step: duration, phase: 0 }), [offered, duration, timeZone]);
  // Same hours as the planner grid, so the picker below offers exactly the grid's cells.
  const choices = useMemo(() => {
    if (!manualAvailable || !timeZone) return new Map<string, string[]>();
    const hours = displayHours([...offered, ...selected], duration, days, timeZone, manualOn ? MANUAL_HOURS : undefined);
    return manualChoices({ days, timeZone, hours, step: grid.step, phase: grid.phase, free: new Set(offered), now: Math.max(clock, env?.now ?? 0), on: manualOn && week.status === "ready", picked: handPicks });
  }, [manualAvailable, timeZone, offered, selected, duration, days, manualOn, week.status, grid, handPicks, clock, env]);

  // Keep the active day inside the shown week, preferring the first day with free (or hand-addable) times.
  const dayKeys = days.map(formatDate);
  const hasTimes = (d: string) => slotsByDay.has(d) || (choices.get(d)?.length ?? 0) > 0;
  const shownDay =
    activeDay && dayKeys.includes(activeDay) && (week.status !== "ready" || hasTimes(activeDay))
      ? activeDay
      : (dayKeys.find((d) => slotsByDay.has(d)) ?? dayKeys.find(hasTimes) ?? dayKeys[0] ?? null);

  const prefs = useMemo(
    () => ({ locale: env?.locale ?? "en", timeZone: timeZone ?? "UTC", hour12 }),
    [env, timeZone, hour12],
  );

  const email = useMemo(() => {
    if (!env || !timeZone) return null;
    try {
      return renderEmailEmbed({
        appUrl: env.appUrl,
        target,
        duration,
        timeZone,
        locale: env.locale,
        hour12,
        days: groupByDay(selected, timeZone),
        note,
        maxSlots: MAX_EMAIL_SLOTS,
        title: customTitle,
        offer: offerId,
      });
    } catch (error) {
      if (error instanceof EmailEmbedError) return { error: error.message };
      throw error;
    }
  }, [env, target, duration, timeZone, hour12, selected, note, customTitle, offerId]);

  const busyNames = useCallback((slot: string) => busyDuring(slot, duration, viewedPeople), [duration, viewedPeople]);

  if (!env || !timeZone || !weekStart) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const changeWeek = (delta: -1 | 1) => {
    const next = addDays(weekStart, delta * 7);
    const today = localDateOf(Date.now(), timeZone);
    setWeekStart(formatDate(next) < formatDate(today) ? today : next);
    setActiveDay(null);
    setClock(Date.now());
  };

  const changeTimeZone = (tz: string) => {
    if (!isValidTimeZone(tz)) return;
    setTimeZone(tz);
    setWeekStart(localDateOf(Date.now(), tz));
    setActiveDay(null);
  };

  const changeDuration = (value: string) => {
    const next = Number(value);
    if (!booking.durations.includes(next)) return;
    setDuration(next);
    setPicks(() => NO_PICKS); // slots of another duration differ, and hand-added times belong to one duration
  };

  const changeManual = (on: boolean) => {
    setManualOn(on);
    setClock(Date.now());
  };
  const toggleFree = (slot: string) => setPicks((prev) => togglePick(prev, slot, MAX_EMAIL_SLOTS));
  const toggleHand = (slot: string) => setPicks((prev) => togglePick(prev, slot, MAX_EMAIL_SLOTS, true));
  const manualSwitch = manualAvailable && <ManualTimesSwitch on={manualOn} onChange={changeManual} error={fieldErrors?.manualSlots} />;
  const manualNotice = manualAvailable && <ManualTimesNotice count={handPicks.length} />;
  // Without the planner (no calendars to view), the switch sits above the day picker instead.
  const inlineManual = manualAvailable && !planner?.loadBusy;

  const today = formatDate(localDateOf(env.now, timeZone));
  const html = email && "html" in email ? email.html : "";
  const text = email && "text" in email ? email.text : "";

  const editor = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {booking.durations.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-embed-duration">Duration</Label>
              <Select value={String(duration)} onValueChange={changeDuration}>
                <SelectTrigger id="email-embed-duration" className="w-full rounded-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {booking.durations.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {formatDuration(d, env.locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-embed-tz">Time zone</Label>
            <Combobox
              id="email-embed-tz"
              options={timeZoneOptions(timeZones.length ? timeZones : [timeZone])}
              value={timeZone}
              onValueChange={changeTimeZone}
              searchPlaceholder="Search time zones…"
              className="rounded-md"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="email-embed-clock" className="text-sm font-medium">
              Clock
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby="email-embed-clock"
              value={hour12 ? "12" : "24"}
              onValueChange={(v) => v && setHour12(v === "12")}
            >
              <ToggleGroupItem value="12">12h</ToggleGroupItem>
              <ToggleGroupItem value="24">24h</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {inlineManual && manualSwitch}
        <EmailSlotPicker
          days={days}
          canGoBack={formatDate(weekStart) > today}
          onWeek={changeWeek}
          activeDay={shownDay}
          onActiveDay={setActiveDay}
          slotsByDay={slotsByDay}
          selected={selected}
          limit={MAX_EMAIL_SLOTS}
          onToggle={toggleFree}
          week={week}
          prefs={prefs}
          busyNames={viewedPeople.length > 0 ? busyNames : undefined}
          manual={manualAvailable ? { choices, onToggle: toggleHand } : undefined}
        />

        {inlineManual && manualNotice}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground" aria-live="polite" data-testid="email-embed-count">
            {selected.length} of {MAX_EMAIL_SLOTS} times selected
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-md"
            disabled={selected.length === 0}
            onClick={() => setPicks(() => NO_PICKS)}
          >
            Clear
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email-embed-note">Message (optional)</Label>
          <Textarea
            id="email-embed-note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="Here are a few times that work for me."
            className="rounded-md"
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <span id="email-embed-preview-label" className="text-sm font-medium">
          Preview
        </span>
        {email && "error" in email ? (
          <Alert variant="destructive">
            <AlertDescription>This event type can&apos;t be embedded in an email ({email.error}).</AlertDescription>
          </Alert>
        ) : (
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={emailPreviewDocument(html)}
            className="h-96 w-full rounded-md border border-border bg-white"
          />
        )}
        {offer && <OfferSaveStatus gate={gate} onRetry={offerSave.retry} />}
        <EmailCopyActions html={html} text={text} disabled={!html || selected.length === 0 || !gate.canCopy} />
        {/* Manual fallback when the browser refuses clipboard access (and a way to inspect the source). */}
        {html && selected.length > 0 && gate.canCopy && (
          <details className="rounded-md border border-border text-sm">
            <summary className="cursor-pointer px-3 py-2 font-medium">Show HTML</summary>
            <Textarea
              readOnly
              aria-label="Email HTML"
              value={html}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-40 rounded-none border-0 border-t border-border font-mono text-xs"
            />
          </details>
        )}
      </div>
    </div>
  );

  // Filled before picking times, so it sits above the time planner.
  const meetingDetails = offer && details && (
    <MeetingDetails
      eventTypeId={offer.eventTypeId}
      value={details}
      onChange={offer.onChange}
      fieldErrors={fieldErrors}
    />
  );

  if (!planner && !meetingDetails) return editor;
  return (
    <div className="flex flex-col gap-6">
      {meetingDetails}
      {planner?.loadBusy && (
        <CalendarOverlay
          open={plannerOpen}
          onOpen={setPlannerOpen}
          hostLabel={planner.hostLabel}
          calendars={calendars}
          viewed={viewed}
          onToggleViewed={(userId) => setViewed((prev) => toggleViewed(prev, userId))}
          days={days}
          timeZone={timeZone}
          prefs={prefs}
          duration={duration}
          offered={offered}
          selected={selected}
          limit={MAX_EMAIL_SLOTS}
          onToggleSlot={(slot, byHand) => (byHand ? toggleHand(slot) : toggleFree(slot))}
          onWeek={changeWeek}
          canGoBack={formatDate(weekStart) > today}
          manual={manualAvailable ? { on: manualOn, control: manualSwitch, choices, picks: handPicks, step: grid.step } : undefined}
        />
      )}
      {planner?.loadBusy && manualNotice}
      {editor}
    </div>
  );
}
