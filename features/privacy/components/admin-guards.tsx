"use client";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { settingsCardClass } from "@/features/settings/components/settings-section";
import { cn } from "@/lib/cn";
import { adminRemoveGuardAction, adminSaveGuardAction } from "../server/actions";
import type { GuardResult, GuardView } from "../server/guard";
import { EmailChipsField } from "./email-chips-field";
import { GUARD_ADDRESSES_MAX, GUARD_DELEGATES_MAX, type GuardFormValue, guardEmail, guardForm, guardInput } from "./guard-form";
import { GuardErrors } from "./privacy-parts";
import { guardOrigin, guardRowSummary } from "./wording";

const FAILED = "Couldn't save. Check your connection and try again.";

type FormErrors = { email?: string; delegates?: string; calendarAddresses?: string };

/**
 * "Private calendars" for the instance admin: every private calendar, and a form to protect one
 * before that person signs in. Once the person has an account, only they can change it.
 */
export function AdminGuards({ guards }: { guards: GuardView[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const editingGuard = guards.find((g) => g.email === editing && !g.hasAccount) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="guards-list" className="flex flex-col gap-3">
        <h2 id="guards-list" className="text-base font-semibold">
          Private calendars
        </h2>
        {guards.length === 0 ? (
          <p className={cn(settingsCardClass, "p-4 text-sm text-muted-foreground md:p-5")}>No calendars are private yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-labelledby="guards-list">
            {guards.map((g) => (
              <GuardRow key={g.email} guard={g} editing={editing === g.email} onEdit={() => setEditing(g.email)} />
            ))}
          </ul>
        )}
      </section>

      <GuardForm
        key={editingGuard?.email ?? "new"}
        guard={editingGuard}
        onDone={() => setEditing(null)}
      />
    </div>
  );
}

function GuardRow({ guard, editing, onEdit }: { guard: GuardView; editing: boolean; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<Extract<GuardResult, { ok: false }> | null>(null);
  const summary = guardRowSummary(guard);

  const remove = () =>
    startTransition(async () => {
      let next: GuardResult;
      try {
        next = await adminRemoveGuardAction({ email: guard.email });
      } catch {
        next = { ok: false, message: FAILED };
      }
      if (next.ok) router.refresh();
      else setError(next);
    });

  return (
    <li className={cn(settingsCardClass, "flex flex-col gap-2 p-4 text-sm md:p-5", editing && "ring-2 ring-ring/50")} data-testid="guard-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-all">{guard.email}</span>
        <Badge variant={guard.hasAccount ? "secondary" : "outline"}>{guardOrigin(guard.hasAccount)}</Badge>
      </div>
      <dl className="grid gap-1 text-[13px] leading-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Who can schedule</dt>
        <dd className="break-all">{summary.delegates}</dd>
        <dt className="text-muted-foreground">Protected addresses</dt>
        <dd className="break-all">{summary.addresses}</dd>
      </dl>
      {guard.hasAccount ? (
        <p className="text-[13px] text-muted-foreground">Only they can change this.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-9 rounded-md px-3 text-[13px]" onClick={onEdit} disabled={pending || editing} aria-label={`Edit ${guard.email}`}>
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="h-9 rounded-md px-3 text-[13px] text-muted-foreground" disabled={pending} aria-label={`Remove ${guard.email}`}>
                {pending && <Spinner />}
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop protecting {guard.email}?</AlertDialogTitle>
                <AlertDialogDescription>
                  When they sign in, their calendar will not be private unless they turn on Calendar privacy themselves.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-10 rounded-md">Cancel</AlertDialogCancel>
                <Button type="button" className="h-10 rounded-md bg-destructive-soft px-3.5 text-destructive hover:bg-destructive-soft/80" onClick={remove}>
                  Remove
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
      {error && <GuardErrors result={error} />}
    </li>
  );
}

function GuardForm({ guard, onDone }: { guard: GuardView | null; onDone: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState(guard?.email ?? "");
  const [value, setValue] = useState<GuardFormValue>(() => guardForm(guard));
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<Extract<GuardResult, { ok: false }> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = guard !== null;

  const submit = () => {
    setSaved(null);
    setResult(null);
    const who = guardEmail(email);
    const ready = guardInput(value);
    const local: FormErrors = { ...(!who.ok && { email: who.message }), ...(!ready.ok && { [ready.field]: ready.message }) };
    setErrors(local);
    if (!who.ok || !ready.ok) return;
    startTransition(async () => {
      let next: GuardResult;
      try {
        next = await adminSaveGuardAction({ email: who.email, ...ready.input });
      } catch {
        next = { ok: false, message: FAILED };
      }
      if (next.ok) {
        setSaved(editing ? `Saved changes for ${who.email}.` : `${who.email} is now protected.`);
        if (!editing) {
          setEmail("");
          setValue(guardForm(null));
        }
        onDone();
        router.refresh();
      } else {
        setResult(next);
        setErrors(next.fieldErrors ?? {});
      }
    });
  };

  return (
    <section aria-labelledby="guard-form-title" className={cn(settingsCardClass, "flex flex-col gap-4 p-4 md:p-5")}>
      <div className="flex flex-col gap-1">
        <h2 id="guard-form-title" className="text-base font-semibold">
          {guard ? `Edit ${guard.email}` : "Protect a calendar before the person signs in"}
        </h2>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Their calendar is private from their first sign in. After that, only they can change it.
        </p>
      </div>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guard-email">Their email</Label>
          <Input
            id="guard-email"
            type="email"
            autoComplete="off"
            value={email}
            readOnly={editing}
            disabled={pending}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby="guard-email-hint"
            className="h-9 max-w-md rounded-md"
          />
          <p id="guard-email-hint" className={cn("text-[13px] leading-5", errors.email ? "text-destructive" : "text-muted-foreground")}>
            {errors.email ?? "The address they will sign in with."}
          </p>
        </div>
        <EmailChipsField
          id="guard-delegates"
          label="People who can schedule for them"
          helper="They can see this person's free and busy time, send their times and manage meetings booked for them. Up to 10."
          value={value.delegates}
          onChange={(delegates) => setValue({ ...value, delegates })}
          max={GUARD_DELEGATES_MAX}
          noun="people"
          error={errors.delegates}
          disabled={pending}
        />
        <EmailChipsField
          id="guard-addresses"
          label="Other calendar addresses to protect"
          helper="Add any other address their calendar is shared under, for example an older work address."
          value={value.addresses}
          onChange={(addresses) => setValue({ ...value, addresses })}
          max={GUARD_ADDRESSES_MAX}
          noun="addresses"
          error={errors.calendarAddresses}
          disabled={pending}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-10 rounded-md px-4" disabled={pending}>
            {pending && <Spinner />}
            {editing ? "Save changes" : "Protect calendar"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" className="h-10 rounded-md px-4" disabled={pending} onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </form>
      {saved && (
        <Alert variant="success">
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      {result && <GuardErrors result={result} />}
    </section>
  );
}
