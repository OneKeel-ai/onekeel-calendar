import { Alert, AlertDescription } from "@/components/ui/alert";
import { settingsCardClass } from "@/features/settings/components/settings-section";
import { cn } from "@/lib/cn";
import type { GuardBlocker } from "../server/guard";
import { blockerMessage, WHAT_PRIVACY_DOES, WHAT_PRIVACY_DOES_NOT } from "./wording";

/** The server's refusal: its message, then one line per team that still blocks it. */
export function GuardErrors({ result }: { result: { message: string; blockers?: readonly GuardBlocker[] } }) {
  const blockers = result.blockers ?? [];
  return (
    <Alert variant="destructive" data-testid="guard-errors">
      <AlertDescription>
        <p>{result.message}</p>
        {blockers.length > 0 && (
          <ul className="mt-1.5 list-disc pl-5">
            {blockers.map((b) => (
              <li key={b.team}>{blockerMessage(b)}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** "What this does": exactly what the server enforces, and what it does not. */
export function WhatPrivacyDoes({ className }: { className?: string }) {
  return (
    <section aria-labelledby="privacy-what" className={cn(settingsCardClass, "flex flex-col gap-2 p-4 text-[13px] leading-5 md:p-5", className)}>
      <h2 id="privacy-what" className="text-sm font-semibold">
        What this does
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
        {WHAT_PRIVACY_DOES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">{WHAT_PRIVACY_DOES_NOT}</p>
    </section>
  );
}
