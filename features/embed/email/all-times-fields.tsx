"use client";

import { TriangleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { allTimesHelp } from "./all-times";

const SWITCH_ID = "email-all-times";
const HELP_ID = "email-all-times-help";
const WARNING_ID = "email-all-times-warning";
const ERROR_ID = "email-all-times-error";

/** "Let the client see all available times", with its helper text, a private-host warning and the server's error for the times. */
export function AllTimesSwitch({
  on,
  onChange,
  hostLabel,
  privateHost,
  error,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  hostLabel: string;
  privateHost: boolean;
  error?: string;
}) {
  const { help, warning } = allTimesHelp(on, hostLabel, privateHost);
  const describedBy = [HELP_ID, warning && WARNING_ID, error && ERROR_ID].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1" data-testid="email-all-times">
      <div className="flex items-center gap-2">
        <Switch id={SWITCH_ID} checked={on} onCheckedChange={onChange} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
        <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
          Let the client see all available times
        </Label>
      </div>
      <p id={HELP_ID} className="text-xs text-muted-foreground">
        {help}
      </p>
      {warning && (
        <p id={WARNING_ID} className="flex items-start gap-1.5 rounded-md border border-warning-border bg-warning px-2 py-1.5 text-xs text-warning-foreground">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {warning}
        </p>
      )}
      {error && (
        <p id={ERROR_ID} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
