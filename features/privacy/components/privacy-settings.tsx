"use client";

import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { settingsCardClass } from "@/features/settings/components/settings-section";
import { cn } from "@/lib/cn";
import { removeMyGuardAction, saveMyGuardAction } from "../server/actions";
import type { GuardResult, GuardView } from "../server/guard";
import { EmailChipsField } from "./email-chips-field";
import { GUARD_ADDRESSES_MAX, GUARD_DELEGATES_MAX, type GuardFormValue, guardChanged, guardForm, guardInput } from "./guard-form";
import { GuardErrors, WhatPrivacyDoes } from "./privacy-parts";

const SWITCH_ID = "privacy-switch";
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";

/** "Calendar privacy" for the signed-in user: on/off, who may schedule for them and other addresses to protect. */
export function PrivacySettings({ guard }: { guard: GuardView | null }) {
  const router = useRouter();
  const [on, setOn] = useState(guard !== null);
  const [value, setValue] = useState<GuardFormValue>(() => guardForm(guard));
  const [result, setResult] = useState<GuardResult | null>(null);
  const [localError, setLocalError] = useState<{ field: "delegates" | "calendarAddresses"; message: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const isPrivate = guard !== null;
  const errors = result && !result.ok ? result : null;

  const changeSwitch = (next: boolean) => {
    setResult(null);
    setSaved(null);
    if (!next && isPrivate) {
      setConfirmOff(true); // stays on until confirmed
      return;
    }
    setOn(next);
    if (!next) {
      setValue(guardForm(null));
      setLocalError(null);
    }
  };

  const change = (next: GuardFormValue) => {
    setValue(next);
    setSaved(null);
    setLocalError(null);
  };

  const save = () => {
    const ready = guardInput(value);
    if (!ready.ok) {
      setLocalError({ field: ready.field, message: ready.message });
      return;
    }
    setLocalError(null);
    setSaved(null);
    startTransition(async () => {
      let next: GuardResult;
      try {
        next = await saveMyGuardAction(ready.input);
      } catch {
        next = { ok: false, message: SAVE_FAILED };
      }
      setResult(next);
      if (next.ok) {
        setSaved(isPrivate ? "Saved." : "Your calendar is now private.");
        router.refresh();
      }
    });
  };

  const turnOff = () => {
    startTransition(async () => {
      let next: GuardResult;
      try {
        next = await removeMyGuardAction();
      } catch {
        next = { ok: false, message: SAVE_FAILED };
      }
      setResult(next);
      setConfirmOff(false);
      if (next.ok) {
        setOn(false);
        setValue(guardForm(null));
        setSaved("Your calendar is no longer private.");
        router.refresh();
      }
    });
  };

  const fieldError = (field: "delegates" | "calendarAddresses") =>
    (localError?.field === field ? localError.message : undefined) ?? errors?.fieldErrors?.[field];
  const canSave = on && !pending && (!isPrivate || guardChanged(value, guard));

  return (
    <div className="flex flex-col gap-5">
      <div className={cn(settingsCardClass, "flex flex-col gap-5 p-4 md:p-5")}>
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="privacy-status">
          {isPrivate ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4 text-muted-foreground" aria-hidden />}
          {isPrivate ? "Your calendar is private." : "Your calendar is not private."}
        </p>

        <div className="flex items-center gap-2">
          <Switch id={SWITCH_ID} checked={on} onCheckedChange={changeSwitch} disabled={pending} aria-describedby={`${SWITCH_ID}-help`} />
          <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
            Keep my calendar private
          </Label>
        </div>
        <p id={`${SWITCH_ID}-help`} className="-mt-3 text-[13px] leading-5 text-muted-foreground">
          {on ? "Name everyone who schedules for you, then save." : "Off: your teams' usual rules apply."}
        </p>

        {on && (
          <div className="flex flex-col gap-4">
            <EmailChipsField
              id="privacy-delegates"
              label="People who can schedule for me"
              helper="They can see your free and busy time, send your times and manage meetings booked for you. Up to 10."
              value={value.delegates}
              onChange={(delegates) => change({ ...value, delegates })}
              max={GUARD_DELEGATES_MAX}
              noun="people"
              error={fieldError("delegates")}
              disabled={pending}
            />
            <EmailChipsField
              id="privacy-addresses"
              label="Other calendar addresses to protect"
              helper="Add any other address your calendar is shared under, for example an older work address."
              value={value.addresses}
              onChange={(addresses) => change({ ...value, addresses })}
              max={GUARD_ADDRESSES_MAX}
              noun="addresses"
              error={fieldError("calendarAddresses")}
              disabled={pending}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" className="h-10 rounded-md px-4" disabled={!canSave} onClick={save}>
                {pending && <Spinner />}
                {isPrivate ? "Save changes" : "Save and make private"}
              </Button>
            </div>
          </div>
        )}

        {saved && (
          <Alert variant="success">
            <AlertDescription>{saved}</AlertDescription>
          </Alert>
        )}
        {errors && <GuardErrors result={errors} />}
      </div>

      <WhatPrivacyDoes />

      <AlertDialog open={confirmOff} onOpenChange={(open) => !pending && setConfirmOff(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop keeping your calendar private?</AlertDialogTitle>
            <AlertDialogDescription>
              Your teams&apos; usual rules apply again: teammates can see your free and busy time and schedule for you,
              and your booking pages no longer need a link sent from Email times.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 rounded-md" disabled={pending}>
              Keep it private
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={pending}
              className="h-10 rounded-md bg-destructive-soft px-3.5 text-destructive hover:bg-destructive-soft/80"
              onClick={turnOff}
            >
              {pending && <Spinner />}
              Turn off privacy
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
