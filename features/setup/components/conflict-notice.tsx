import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ConflictNotice } from "./conflict-note";

/** Compact notice under "Host: ..." saying which calendar settings hide (or skip) free time. */
export function ConflictNoticeView({ notice }: { notice: ConflictNotice | null }) {
  if (!notice) return null;
  return (
    <div
      data-testid="schedule-conflict-note"
      data-tone={notice.tone}
      className={cn(
        "flex max-w-2xl flex-col gap-1 rounded-md border px-3 py-2 text-[13px] leading-5",
        notice.tone === "warning" ? "border-warning-border bg-warning text-warning-foreground" : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {notice.lines.map((line) => (
        <p key={line.text}>
          {line.text}
          {line.links.map((link) => (
            <span key={link.href}>
              {" "}
              <Link href={link.href} className="font-medium underline underline-offset-2">
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
