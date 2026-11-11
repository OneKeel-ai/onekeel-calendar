"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { manualNotice } from "./manual-times";

const SWITCH_ID = "email-manual-times";
const HELP_ID = "email-manual-times-help";
const ERROR_ID = "email-manual-times-error";

/** Classes of a hand-added pick (dashed amber outline), shared by the grid, the chips and the legend. */
export const MANUAL_PICK_CLASS = "border-2 border-dashed border-warning-foreground bg-warning/60";

/** The "Add times by hand" switch, with its helper text and the server's error for those times. */
export function ManualTimesSwitch({ on, onChange, error }: { on: boolean; onChange: (on: boolean) => void; error?: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid="email-manual-times">
      <div className="flex items-center gap-2">
        <Switch
          id={SWITCH_ID}
          checked={on}
          onCheckedChange={onChange}
          aria-describedby={error ? `${HELP_ID} ${ERROR_ID}` : HELP_ID}
          aria-invalid={error ? true : undefined}
        />
        <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
          Add times by hand
        </Label>
      </div>
      <p id={HELP_ID} className="text-xs text-muted-foreground">
        Offer a time even if the calendar shows it as busy or outside working hours. Use it when you know the time is fine.
      </p>
      {error && (
        <p id={ERROR_ID} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** One line under the planner while any hand-added time is picked. */
export function ManualTimesNotice({ count }: { count: number }) {
  const text = manualNotice(count);
  if (!text) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="email-manual-notice">
      <span aria-hidden className={`inline-block size-3 shrink-0 rounded-sm ${MANUAL_PICK_CLASS}`} />
      {text}
    </p>
  );
}
