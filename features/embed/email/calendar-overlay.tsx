"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { normalize } from "@/lib/availability/intervals";
import { formatDate, localDateOf, type LocalDate, wallToUtc } from "@/lib/availability/tz";
import { cn } from "@/lib/cn";
import { type FormatPrefs, formatShortDate, formatTime } from "@/lib/format";
import { MANUAL_HOURS } from "./manual-times";
import { MANUAL_PICK_CLASS } from "./manual-times-fields";
import { colorFor, dayBlocks, displayHours, shownPeople, slotIntervals } from "./planner";
import type { ViewedCalendarsState } from "./use-viewed-calendars";

const HOUR_PX = 44;

const dayLabel = (day: LocalDate, prefs: FormatPrefs) => formatShortDate(wallToUtc(day, 12 * 60, "UTC"), { ...prefs, timeZone: "UTC" });

const hourLabel = (day: LocalDate, hour: number, prefs: FormatPrefs) =>
  formatTime(wallToUtc(day, hour * 60, "UTC"), { ...prefs, timeZone: "UTC" });

type CalendarOverlayProps = {
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Host of the meeting, named so it is clear the view does not change it. */
  hostLabel: string;
  calendars: ViewedCalendarsState & { retry: () => void };
  viewed: readonly string[];
  onToggleViewed: (userId: string) => void;
  days: readonly LocalDate[];
  timeZone: string;
  prefs: FormatPrefs;
  duration: number;
  /** The host's free times this week, exactly as offered by the booking page. */
  offered: readonly string[];
  selected: readonly string[];
  limit: number;
  /** `byHand` is true for a time the calendar does not offer, added by hand. */
  onToggleSlot: (slot: string, byHand?: boolean) => void;
  onWeek: (delta: -1 | 1) => void;
  canGoBack: boolean;
  /** "Add times by hand" (Email times only). Without it the grid offers free times only. */
  manual?: PlannerManual;
};

export type PlannerManual = {
  /** The switch is on: other future cells can be added by hand. */
  on: boolean;
  /** The switch and its error, shown in the planner. */
  control: ReactNode;
  /** Hand-addable and hand-added starts per local day (yyyy-MM-dd), from `manualChoices`. */
  choices: ReadonlyMap<string, readonly string[]>;
  /** Picks that were added by hand. */
  picks: readonly string[];
  /** Height of one cell, in minutes (the meeting type's slot step). */
  step: number;
};

/**
 * Optional week view for cross-checking: the host's free times, the picks, and the busy time of
 * any calendars the sender ticks. Display only. Ticking a calendar never invites that person,
 * never changes the host, and never hides an offered time.
 */
export function CalendarOverlay(props: CalendarOverlayProps) {
  const { open, onOpen, hostLabel, calendars, viewed, onToggleViewed, days, timeZone, prefs, duration, offered, selected, limit, onToggleSlot, onWeek, canGoBack, manual } = props;
  const people = calendars.members;
  const shown = shownPeople(people, viewed);
  const hours = displayHours([...offered, ...selected], duration, days, timeZone, manual?.on ? MANUAL_HOURS : undefined);
  const height = (hours.to - hours.from) * HOUR_PX;
  const offeredFree = normalize(slotIntervals(offered, duration));
  const byHand = new Set(manual?.picks ?? []);
  const picks = slotIntervals(selected.filter((s) => !byHand.has(s)), duration);
  const handPicks = slotIntervals(selected.filter((s) => byHand.has(s)), duration);
  const showManualLegend = Boolean(manual && (manual.on || manual.picks.length > 0));
  const first = days[0];
  const visibleDays = new Set(days.map(formatDate));
  const otherWeeks = selected.filter((slot) => !visibleDays.has(formatDate(localDateOf(Date.parse(slot), timeZone)))).length;
  const selectionSummary = `${selected.length} of ${limit} times selected.${otherWeeks ? ` ${otherWeeks} in other weeks.` : ""}`;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border" aria-labelledby="planner-title">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="planner-body"
        onClick={() => onOpen(!open)}
        className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex flex-col">
          <span id="planner-title" className="text-sm font-medium">
            Plan meeting times
          </span>
          <span className="text-xs text-muted-foreground">
            Pick the host&apos;s free times. Optionally compare other calendars without inviting their owners.
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id="planner-body" className="flex flex-col gap-3 px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            View only. Ticking a name shows when that person is busy. It doesn&apos;t invite them, make them a host, or hide
            any time. The host stays {hostLabel}. A calendar that cannot be read is marked unavailable and shown as busy.
          </p>

          {calendars.status === "error" && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                {calendars.message}
                <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={calendars.retry}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {people.length === 0 ? (
            calendars.status === "loading" || calendars.status === "idle" ? (
              <div className="flex gap-2" aria-busy="true" aria-label="Loading calendars">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24" />
              </div>
            ) : calendars.status === "ready" ? (
              <p className="text-xs text-muted-foreground">
                No teammate calendars to view yet. People appear here after they join the team, and their busy time shows
                once they connect their calendar.
              </p>
            ) : null
          ) : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-medium">Show busy time for (view only, not invited)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {people.map((p) => {
                  const id = `planner-view-${p.userId}`;
                  const color = colorFor(people, p.userId);
                  return (
                    <label key={p.userId} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox id={id} aria-label={p.name} checked={viewed.includes(p.userId)} onCheckedChange={() => onToggleViewed(p.userId)} />
                      <span className={cn("inline-block size-2.5 rounded-sm", color.swatch)} aria-hidden />
                      {p.name}
                      {p.calendarUnavailable && <span className="text-xs text-muted-foreground">(calendar can&apos;t be read, shown as busy)</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {manual?.control}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm bg-success/25" aria-hidden /> Host free
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-sm border-2 border-primary" aria-hidden /> Your picks
            </span>
            {showManualLegend && (
              <span className="flex items-center gap-1">
                <span className={cn("inline-block size-3 rounded-sm", MANUAL_PICK_CLASS)} aria-hidden /> Added by hand
              </span>
            )}
            <span>Times in {timeZone.replaceAll("_", " ")}</span>
            {calendars.status === "loading" && people.length > 0 && <span aria-live="polite">Updating…</span>}
          </div>

          <div className="flex items-center justify-between gap-2" role="group" aria-label="Calendar week">
            <div className="flex flex-col gap-0.5 text-xs">
              <p className="text-muted-foreground">
                {first && `${dayLabel(first, prefs)} to ${dayLabel(days[days.length - 1], prefs)}`} · {duration} min. {manual?.on ? "Click a free time to offer it, or any other time to add it by hand." : "Click a free time to offer it."}
              </p>
              <p role="status" className="font-medium">{selectionSummary}</p>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="icon" className="size-8 rounded-md" aria-label="Previous calendar week" disabled={!canGoBack} onClick={() => onWeek(-1)}><ChevronLeft className="size-4" /></Button>
              <Button type="button" variant="outline" size="icon" className="size-8 rounded-md" aria-label="Next calendar week" onClick={() => onWeek(1)}><ChevronRight className="size-4" /></Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="grid min-w-[36rem] grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-x-1">
              <span aria-hidden />
              {days.map((d) => (
                <span key={formatDate(d)} className="pb-1 text-center text-xs font-medium">
                  {dayLabel(d, prefs)}
                </span>
              ))}

              <div className="relative" style={{ height }} aria-hidden>
                {first &&
                  Array.from({ length: hours.to - hours.from }, (_, i) => (
                    <span
                      key={i}
                      className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                      style={{ top: i * HOUR_PX }}
                    >
                      {i === 0 ? "" : hourLabel(first, hours.from + i, prefs)}
                    </span>
                  ))}
              </div>

              {days.map((d) => {
                const busyNames = shown.filter((p) => dayBlocks(p.busy, d, timeZone, hours).length > 0).map((p) => p.name);
                const handCount = dayBlocks(handPicks, d, timeZone, hours).length;
                const pickCount = dayBlocks(picks, d, timeZone, hours).length + handCount;
                const manualCells = manual?.choices.get(formatDate(d)) ?? [];
                return (
                  <div
                    key={formatDate(d)}
                    role="group"
                    aria-label={`${dayLabel(d, prefs)}: ${pickCount} ${pickCount === 1 ? "pick" : "picks"}${handCount ? `, ${handCount} added by hand` : ""}${busyNames.length ? `, busy: ${busyNames.join(", ")}` : ""}`}
                    className="relative overflow-hidden rounded-sm bg-muted/60"
                    style={{ height }}
                  >
                    {Array.from({ length: hours.to - hours.from - 1 }, (_, i) => (
                      <span key={i} className="absolute inset-x-0 border-t border-border/70" style={{ top: (i + 1) * HOUR_PX }} />
                    ))}
                    {dayBlocks(offeredFree, d, timeZone, hours).map((b, i) => (
                      <span key={`f${i}`} className="absolute inset-x-0 bg-success/25" style={{ top: `${b.top}%`, height: `${b.height}%` }} />
                    ))}
                    {shown.map((p, lane) =>
                      dayBlocks(p.busy, d, timeZone, hours).map((b, i) => (
                        <span
                          key={`${p.userId}-${i}`}
                          title={`${p.name} busy`}
                          className={cn("pointer-events-none absolute rounded-[3px]", colorFor(people, p.userId).block)}
                          style={{
                            top: `${b.top}%`,
                            height: `${b.height}%`,
                            left: `calc(${(lane * 100) / shown.length}% + 1px)`,
                            width: `calc(${100 / shown.length}% - 2px)`,
                          }}
                        />
                      )),
                    )}
                    {manual &&
                      manualCells.map((slot) => {
                        const block = dayBlocks(slotIntervals([slot], Math.min(manual.step, duration)), d, timeZone, hours)[0];
                        if (!block) return null;
                        const pressed = selected.includes(slot);
                        const label = `Offer ${dayLabel(d, prefs)} at ${formatTime(Date.parse(slot), prefs)} by hand`;
                        return (
                          <button
                            key={`hand-${slot}`}
                            type="button"
                            aria-label={label}
                            title={label}
                            aria-pressed={pressed}
                            data-manual-start={slot}
                            disabled={!pressed && selected.length >= limit}
                            onClick={() => onToggleSlot(slot, true)}
                            className="absolute inset-x-0.5 z-[5] overflow-hidden rounded-[3px] border border-dashed border-transparent px-0.5 text-left text-[10px] leading-none tabular-nums hover:border-warning-foreground hover:bg-warning/60 focus-visible:outline-2 focus-visible:outline-primary disabled:hover:border-transparent disabled:hover:bg-transparent"
                            style={{ top: `${block.top}%`, height: `${block.height}%` }}
                          >
                            {pressed ? formatTime(Date.parse(slot), prefs) : null}
                          </button>
                        );
                      })}
                    {offered.map((slot) => {
                      if (formatDate(localDateOf(Date.parse(slot), timeZone)) !== formatDate(d)) return null;
                      const block = dayBlocks(slotIntervals([slot], duration), d, timeZone, hours)[0];
                      if (!block) return null;
                      const pressed = selected.includes(slot);
                      const label = `Offer ${dayLabel(d, prefs)} at ${formatTime(Date.parse(slot), prefs)}`;
                      return (
                        <button
                          key={`offer-${slot}`}
                          type="button"
                          aria-label={label}
                          title={label}
                          aria-pressed={pressed}
                          disabled={!pressed && selected.length >= limit}
                          onClick={() => onToggleSlot(slot)}
                          className="absolute inset-x-0.5 z-10 overflow-hidden rounded-[3px] border border-transparent px-0.5 text-left text-[10px] leading-none tabular-nums hover:border-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
                          style={{ top: `${block.top}%`, height: `${block.height}%` }}
                        >
                          {formatTime(Date.parse(slot), prefs)}
                        </button>
                      );
                    })}
                    {dayBlocks(picks, d, timeZone, hours).map((b, i) => (
                      <span
                        key={`p${i}`}
                        className="pointer-events-none absolute inset-x-0.5 rounded-[3px] border-2 border-primary bg-primary/10"
                        style={{ top: `${b.top}%`, height: `${b.height}%` }}
                      />
                    ))}
                    {dayBlocks(handPicks, d, timeZone, hours).map((b, i) => (
                      <span
                        key={`h${i}`}
                        className={cn("pointer-events-none absolute inset-x-0.5 z-[4] rounded-[3px]", MANUAL_PICK_CLASS)}
                        style={{ top: `${b.top}%`, height: `${b.height}%` }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
