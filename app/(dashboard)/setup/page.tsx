import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { SetupChecklist } from "@/features/setup/components/setup-checklist";
import { loadSetup } from "@/features/setup/server/load";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Setup" };

const SECTION = "flex flex-col gap-2";
const H2 = "text-sm font-semibold";
const P = "text-[13px] leading-5 text-muted-foreground";

export default async function SetupPage() {
  const user = await requireUser();
  const { steps, calendar } = await loadSetup(getDb(), user);
  const left = steps.filter((s) => s.state !== "done").length;

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Setup</h1>
        <p className="text-sm text-muted-foreground">
          {left === 0 ? "Everything is ready. You can send times by email now." : `${left} ${left === 1 ? "thing" : "things"} left before you can send times by email.`}
        </p>
      </header>

      {!calendar.healthy && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertDescription>
            Online booking is paused until a working calendar is connected. The app can&apos;t tell when you are busy, so it
            offers no times rather than risk a double booking.
          </AlertDescription>
        </Alert>
      )}

      <SetupChecklist steps={steps} />

      <section className={SECTION} aria-labelledby="gmail-title">
        <h2 id="gmail-title" className={H2}>
          Insert times from Gmail
        </h2>
        <p className={P}>
          Optional. Adds a Meeting times button to the Gmail compose window, so you can pick times and drop them into your
          message without leaving it.
        </p>
        <ol className={`${P} list-decimal pl-5`}>
          <li>Download the add-on and unzip it somewhere you will keep it.</li>
          <li>
            In Chrome, open <span className="font-mono text-foreground">chrome://extensions</span> and turn on Developer mode.
          </li>
          <li>Choose Load unpacked and select the unzipped folder.</li>
          <li>Open Gmail, start a new message and look for the button in the compose toolbar.</li>
        </ol>
        <div>
          <Button asChild variant="outline" className="h-8 rounded-md px-3 text-[13px]">
            <a href="/downloads/onekeel-calendar-gmail.zip" download>
              <Download aria-hidden />
              Download Gmail add-on
            </a>
          </Button>
        </div>
      </section>

      <section className={SECTION} aria-labelledby="shared-title">
        <h2 id="shared-title" className={H2}>
          Shared calendars and teams
        </h2>
        <p className={P}>
          To coordinate for someone else, ask them to share their Google calendar with your OneKeel work account and give
          you permission to make changes to events. Then connect your own Google account on the{" "}
          <Link href="/settings/calendars" className="font-medium text-foreground underline underline-offset-2">Calendars</Link>{" "}
          page. Choose their shared calendar under "Use for new bookings" and select the calendars that should block busy
          times. You do not need their password. The{" "}
          <Link href="/teams" className="font-medium text-foreground underline underline-offset-2">Teams</Link>{" "}
          area is for meetings that need multiple hosts.
        </p>
      </section>

      <section className={SECTION} aria-labelledby="settings-title">
        <h2 id="settings-title" className={H2}>
          Other settings
        </h2>
        <ul className={`${P} flex flex-wrap gap-x-4 gap-y-1`}>
          {[
            ["/settings/profile", "Profile"],
            ["/availability", "Weekly hours"],
            ["/event-types", "Meeting types"],
            ["/teams", "Teams"],
            ["/bookings", "Bookings"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="font-medium text-foreground underline underline-offset-2">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
