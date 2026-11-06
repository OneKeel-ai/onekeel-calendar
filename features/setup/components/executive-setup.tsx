import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const P = "text-[13px] leading-5 text-muted-foreground";
const A = "font-medium text-foreground underline underline-offset-2";

/**
 * How to send times on behalf of an executive: the executive becomes the real host of a team
 * meeting type, so bookings use their calendar and their Zoom. Shown on /setup, and on /schedule
 * while nobody else is available under "Scheduling for".
 */
export function ExecutiveSetupSteps({ compact = false }: { compact?: boolean }) {
  return (
    <section
      aria-labelledby="exec-setup-title"
      className={cn("flex flex-col gap-2", compact && "rounded-xl border border-border bg-card p-4 md:p-5")}
    >
      <h2 id="exec-setup-title" className="text-sm font-semibold">
        Schedule for an executive
      </h2>
      <p className={P}>
        Each executive shows up under Scheduling for only after these steps. To send times for someone else, the meeting
        type has to belong to them. Clients then book straight onto their
        calendar, with their own Zoom link, and you never need to attend.
      </p>
      <ol className={`${P} list-decimal pl-5`}>
        <li>
          Invite each executive into your team on the{" "}
          <Link href="/teams" className={A}>
            Teams
          </Link>{" "}
          page.
        </li>
        <li>
          Each executive signs in once and connects their own Google Calendar and Zoom on their{" "}
          <Link href="/settings/calendars" className={A}>
            Calendars
          </Link>{" "}
          page. This one-time step is required: your access to their calendar, or your own Zoom, can&apos;t stand in for
          it. After that they don&apos;t need to do anything. Until they connect, no times can be offered for them.
        </li>
        <li>A team owner or admin creates a meeting type in that team with only the executive as host.</li>
        <li>
          On Email times, choose the executive under Scheduling for, pick the meeting type and tick times. You can view
          teammates&apos; calendars there to cross-check. Viewing a calendar never invites anyone.
        </li>
      </ol>
      <p className={P}>
        Already sharing an executive&apos;s Google calendar with your account? That only changed where the event was saved.
        The meeting still used your Zoom and listed you as the host. The team setup above makes the executive the real
        host, with their own Zoom.
      </p>
      {compact && (
        <div>
          <Button asChild variant="outline" className="h-8 rounded-md px-3 text-[13px]">
            <Link href="/teams">Open Teams</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
