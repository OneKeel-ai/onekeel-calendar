import { CircleAlert, CircleCheck, Circle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { SetupStep } from "../status";

const ICON = { done: CircleCheck, attention: CircleAlert, todo: Circle } as const;
const LABEL = { done: "Done", attention: "Needs attention", todo: "To do" } as const;

/** One row per setup area; every action goes to the page that really saves the setting. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
      {steps.map((step) => {
        const Icon = ICON[step.state];
        return (
          <li key={step.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <Icon
              aria-hidden
              className={cn(
                "size-[18px] shrink-0",
                step.state === "done" && "text-success",
                step.state === "attention" && "text-destructive",
                step.state === "todo" && "text-muted-foreground",
              )}
            />
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
              <p className="text-sm font-medium">
                {step.title}
                <span className="sr-only">: {LABEL[step.state]}</span>
              </p>
              <p className="text-[13px] text-muted-foreground">{step.detail}</p>
            </div>
            <Button asChild variant={step.state === "done" ? "outline" : "default"} className="h-8 rounded-md px-3 text-[13px]">
              <Link href={step.href}>{step.action}</Link>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}
