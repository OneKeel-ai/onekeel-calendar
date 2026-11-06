import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { ExecutiveSetupSteps } from "@/features/setup/components/executive-setup";
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
          {left === 0 ? "Your personal booking page is ready. You can send its times by email." : `${left} ${left === 1 ? "thing" : "things"} left to finish your personal booking page. Team scheduling is separate.`}
        </p>
        <p className={P}>
          Scheduling for someone else? On{" "}
          <Link href="/schedule" className="font-medium text-foreground underline underline-offset-2">Email times</Link>{" "}
          you can send times for any team host who has connected their calendar. You don&apos;t need your own calendar or
          Zoom for that. Connect your own calendar only if you want to see your own busy time there.
        </p>
      </header>

      {!calendar.healthy && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
          <AlertDescription>
            Booking for meetings you host is paused until you connect a working calendar. The app can&apos;t tell when you
            are busy, so your own booking page offers no times rather than risk a double booking. Times for other hosts
            use their calendars, not yours.
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

      <ExecutiveSetupSteps />

      <section className={SECTION} aria-labelledby="video-title">
        <h2 id="video-title" className={H2}>Video meeting links</h2>
        <p className={P}>
          Connect Zoom on the{" "}
          <Link href="/settings/calendars" className="font-medium text-foreground underline underline-offset-2">Calendars</Link>{" "}
          page, then choose Zoom as the location in a meeting type. Each booking gets its own Zoom link, made from the
          host&apos;s Zoom account. Or choose Custom meeting link and paste your usual video-call link. Automatic Google Meet is not enabled on this instance.
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
