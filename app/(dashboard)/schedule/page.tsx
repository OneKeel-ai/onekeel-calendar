import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { ScheduleWorkspace } from "@/features/setup/components/schedule-workspace";
import { loadSetup } from "@/features/setup/server/load";
import { requireUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Email times" };

export default async function SchedulePage() {
  const user = await requireUser();
  const { emailTypes, calendar, username } = await loadSetup(getDb(), user);
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");

  return (
    <div className="flex w-full max-w-[1104px] flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Email times</h1>
        <p className="text-sm text-muted-foreground">
          Pick a meeting type, tick the times that work and paste them into an email. Each time links to your booking page.
        </p>
      </header>

      {!calendar.healthy && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertDescription>
            No times will show until a working calendar is connected.{" "}
            <Link href="/setup" className="font-medium underline underline-offset-2">
              Open setup
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {emailTypes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {username ? "You have no meeting type that is switched on yet." : "Choose a username first. It is part of every booking link."}
          <Button asChild className="h-8 rounded-md px-3 text-[13px]">
            <Link href={username ? "/event-types/new" : "/settings/profile"}>{username ? "Add a meeting type" : "Open profile"}</Link>
          </Button>
        </div>
      ) : (
        <ScheduleWorkspace
          appUrl={appUrl}
          types={emailTypes.map(({ id, title, hidden, target }) => ({ id, title, hidden, target }))}
        />
      )}

      <p className="max-w-2xl text-xs text-muted-foreground">
        Times come from the calendars checked on the{" "}
        <Link href="/settings/calendars" className="font-medium text-foreground underline underline-offset-2">
          Calendars
        </Link>{" "}
        page and your weekly hours. To coordinate for someone else, follow the shared-calendar steps in{" "}
        <Link href="/setup" className="font-medium text-foreground underline underline-offset-2">
          Setup
        </Link>.
      </p>
    </div>
  );
}
