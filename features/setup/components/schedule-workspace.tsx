"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EmbedTarget } from "@/features/embed/target";
import { EmailEmbedPanel } from "@/features/embed/email/email-embed-panel";

export type ScheduleType = { id: string; title: string; hidden: boolean; target: EmbedTarget };

/**
 * Picks the meeting type, then shows the standard email times tool for it. The choice lives in
 * page state only, so the address (and anything the Gmail add-on put in it) is left untouched.
 */
export function ScheduleWorkspace({ types, appUrl }: { types: ScheduleType[]; appUrl: string }) {
  const [id, setId] = useState(types[0]?.id ?? "");
  const current = types.find((t) => t.id === id) ?? types[0];
  if (!current) return null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="schedule-type">Meeting type</Label>
        <Select value={current.id} onValueChange={setId}>
          <SelectTrigger id="schedule-type" className="w-full rounded-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title}
                {t.hidden ? " (hidden from your page)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 md:p-5">
        <EmailEmbedPanel key={current.id} target={current.target} appUrl={appUrl} />
      </div>
    </div>
  );
}
