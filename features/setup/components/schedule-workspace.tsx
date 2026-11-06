"use client";

import { useCallback, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailEmbedPanel } from "@/features/embed/email/email-embed-panel";
import { type LoadBusy, pickPrincipal, pickType, planKey } from "@/features/embed/email/planner";
import { loadScheduleAvailability } from "../server/scheduling-actions";
import type { SchedulingPrincipal } from "../types";
import { ExecutiveSetupSteps } from "./executive-setup";

export type { ScheduleType } from "../types";

/**
 * Picks who the times are for, then the meeting type, then shows the email times tool for it.
 * The host decides the booking page, calendar and video link. Changing the host or the meeting
 * type starts a fresh pick list, so times offered for one person can't carry over to another.
 */
export function ScheduleWorkspace({ principals, appUrl }: { principals: SchedulingPrincipal[]; appUrl: string }) {
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const usable = principals.filter((p) => p.types.length > 0);
  const principal = pickPrincipal(principals, principalId);
  const type = principal ? pickType(principal.types, typeId) : undefined;
  const others = usable.filter((p) => p.teamId !== null);

  // Viewing calendars is display only. For your own meeting types, show the first team you are in.
  const viewTeamId = principal?.teamId ?? others[0]?.teamId ?? null;
  const loadBusy = useCallback<LoadBusy>(
    (start, end) => (viewTeamId ? loadScheduleAvailability(viewTeamId, start, end) : Promise.resolve({ members: [] })),
    [viewTeamId],
  );

  if (!principal || !type) return null;
  const self = principal.teamId === null;

  const choosePrincipal = (id: string) => {
    setPrincipalId(id);
    setTypeId(null); // another host's meeting types; start from their first
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-principal">Scheduling for</Label>
            <Select value={principal.id} onValueChange={choosePrincipal}>
              <SelectTrigger id="schedule-principal" className="w-full rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {usable.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-type">Meeting type</Label>
            <Select value={type.id} onValueChange={setTypeId}>
              <SelectTrigger id="schedule-type" className="w-full rounded-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {principal.types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                    {t.hidden ? (self ? " (hidden from your page)" : " (hidden from the team page)") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground" data-testid="schedule-host">
          {self ? (
            <>
              Host: <span className="font-medium text-foreground">you</span>. Booked meetings go on your calendar, with your
              video link.
            </>
          ) : (
            <>
              Host: <span className="font-medium text-foreground">{principal.label}</span>. The times below are the
              host&apos;s free times. Booked meetings go on the host&apos;s calendar, and any Zoom link comes from the
              host&apos;s own Zoom account. Sending times doesn&apos;t add you to the meeting.
            </>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 md:p-5">
        <EmailEmbedPanel
          key={planKey(principal.id, type.id)}
          target={type.target}
          appUrl={appUrl}
          planner={{ hostLabel: self ? "you" : principal.label, loadBusy: viewTeamId ? loadBusy : undefined }}
        />
      </div>

      {others.length === 0 ? (
        <ExecutiveSetupSteps compact />
      ) : (
        <details className="rounded-xl border border-border bg-card text-sm">
          <summary className="cursor-pointer px-4 py-3 font-medium">Add another executive</summary>
          <div className="border-t border-border px-4 py-4">
            <ExecutiveSetupSteps />
          </div>
        </details>
      )}
    </div>
  );
}
