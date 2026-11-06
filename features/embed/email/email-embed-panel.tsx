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
import { EmailSlotPicker } from "./email-slot-picker";
import { busyDuring, type LoadBusy, type ScopedSelection, selectionIn, shownPeople, toggleViewed, weekWindow } from "./planner";
import { dayKey, groupByDay, toggleSlot } from "./selection";
import { useViewedCalendars } from "./use-viewed-calendars";
import { useWeekSlots } from "./use-week-slots";

const NOTE_MAX = 500;

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
}: {
  target: EmbedTarget;
  /** The instance's canonical URL (APP_URL); links must not depend on how the dashboard was reached. */ appUrl?: string;
  /** Adds the optional calendar view. Without it the panel behaves exactly as in the embed dialog. */
  planner?: EmailPlannerOptions;
}) {
  if (!target.booking || target.booking.durations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The email embed lists free times of a single event type. Open it from an event type to pick times to paste into
        an email.
      </p>
    );
  }
  return <EmailEmbedEditor target={target} booking={target.booking} appUrl={appUrl} planner={planner} />;
}

type Booking = NonNullable<EmbedTarget["booking"]>;

function EmailEmbedEditor({
  target,
  booking,
  appUrl,
  planner,
}: {
  target: EmbedTarget;
  booking: Booking;
  appUrl?: string;
  planner?: EmailPlannerOptions;
}) {
  const [env, setEnv] = useState<Env | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [hour12, setHour12] = useState(false);
  const [duration, setDuration] = useState(booking.durations[0] ?? 0);
  const [weekStart, setWeekStart] = useState<LocalDate | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  // Picks are tied to this booking page: if the target ever changes in place, old picks are dropped
  // instead of being offered on another host's calendar.
  const scope = target.calLink;
  const [picked, setPicked] = useState<ScopedSelection>({ scope, slots: [] });
  const selected = selectionIn(picked, scope);
  const setSelected = useCallback(
    (next: readonly string[] | ((prev: readonly string[]) => readonly string[])) =>
      setPicked((prev) => ({ scope, slots: typeof next === "function" ? next(selectionIn(prev, scope)) : next })),
    [scope],
  );
  const [plannerOpen, setPlannerOpen] = useState(Boolean(planner?.loadBusy));
  const [viewed, setViewed] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const timeZones = useTimeZones();

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

  // Keep the active day inside the shown week, preferring the first day with free times.
  const dayKeys = days.map(formatDate);
  const shownDay =
    activeDay && dayKeys.includes(activeDay) && (week.status !== "ready" || slotsByDay.has(activeDay))
      ? activeDay
      : (dayKeys.find((d) => slotsByDay.has(d)) ?? dayKeys[0] ?? null);

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
      });
    } catch (error) {
      if (error instanceof EmailEmbedError) return { error: error.message };
      throw error;
    }
  }, [env, target, duration, timeZone, hour12, selected, note]);

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
    setSelected([]); // slots of another duration differ
  };

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

        <EmailSlotPicker
          days={days}
          canGoBack={formatDate(weekStart) > today}
          onWeek={changeWeek}
          activeDay={shownDay}
          onActiveDay={setActiveDay}
          slotsByDay={slotsByDay}
          selected={selected}
          limit={MAX_EMAIL_SLOTS}
          onToggle={(slot) => setSelected((prev) => toggleSlot(prev, slot, MAX_EMAIL_SLOTS))}
          week={week}
          prefs={prefs}
          busyNames={viewedPeople.length > 0 ? busyNames : undefined}
        />

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
            onClick={() => setSelected([])}
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
        <EmailCopyActions html={html} text={text} disabled={!html || selected.length === 0} />
        {/* Manual fallback when the browser refuses clipboard access (and a way to inspect the source). */}
        {html && selected.length > 0 && (
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

  if (!planner) return editor;
  return (
    <div className="flex flex-col gap-6">
      {planner.loadBusy && (
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
          offered={week.status === "ready" ? week.slots : []}
          selected={selected}
          limit={MAX_EMAIL_SLOTS}
          onToggleSlot={(slot) => setSelected((prev) => toggleSlot(prev, slot, MAX_EMAIL_SLOTS))}
          onWeek={changeWeek}
          canGoBack={formatDate(weekStart) > today}
        />
      )}
      {editor}
    </div>
  );
}
