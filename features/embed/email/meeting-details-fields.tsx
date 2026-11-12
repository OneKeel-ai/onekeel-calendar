"use client";

import { X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import {
  addGuest,
  type CommitResult,
  type CopyGate,
  commitDraft,
  filterSuggestions,
  type MeetingDetailsValue,
  OFFER_GUESTS_MAX,
  OFFER_TITLE_MAX,
  type OfferContact,
  removeGuest,
} from "./meeting-details";
import { useOfferContacts } from "./use-offer-save";

const TITLE_ID = "email-offer-title";
const GUESTS_ID = "email-offer-guests";
const LIST_ID = "email-offer-guests-list";
const optionId = (i: number) => `email-offer-guest-option-${i}`;
const hint = "text-[13px] leading-5 text-muted-foreground";
const errorText = "text-[13px] leading-5 text-destructive";

export type MeetingDetailsViewProps = {
  value: MeetingDetailsValue;
  /** Inline error for the address being typed (kept in the field, never a chip). */
  guestError: string | null;
  fieldErrors?: { title?: string; guests?: string };
  suggestions: readonly OfferContact[];
  /** Highlighted suggestion (keyboard). */
  active: number;
  onTitle: (title: string) => void;
  onDraft: (draft: string) => void;
  onRemove: (email: string) => void;
  onPick: (contact: OfferContact) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
};

/** The "Meeting details" fields, without state (rendered by MeetingDetails; tested directly). */
export function MeetingDetailsView(props: MeetingDetailsViewProps) {
  const { value, suggestions, active } = props;
  const titleError = props.fieldErrors?.title;
  const guestError = props.guestError ?? props.fieldErrors?.guests ?? null;
  const open = suggestions.length > 0;
  const full = value.guests.length >= OFFER_GUESTS_MAX;

  return (
    <section aria-labelledby="email-offer-heading" className="flex flex-col gap-3">
      <h2 id="email-offer-heading" className="text-sm font-medium">
        Meeting details
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={TITLE_ID}>Meeting title</Label>
          <Input
            id={TITLE_ID}
            value={value.title}
            maxLength={OFFER_TITLE_MAX}
            onChange={(e) => props.onTitle(e.target.value.slice(0, OFFER_TITLE_MAX))}
            placeholder="Auto Group x OneKeel.ai: Demo"
            autoComplete="off"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={`${TITLE_ID}-hint`}
            className="h-9 rounded-md"
          />
          <p id={`${TITLE_ID}-hint`} className={titleError ? errorText : hint}>
            {titleError ?? "The client sees this, and it becomes the calendar event name. Leave blank to use the standard name."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={GUESTS_ID}>Also invite</Label>
          <div className="relative">
            <div
              className={cn(
                "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
                guestError && "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
              )}
            >
              {value.guests.length > 0 && (
                <ul aria-label="Invited people" className="contents">
                  {value.guests.map((email) => (
                    <li key={email} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-muted py-0.5 pr-0.5 pl-2 text-[13px] leading-5">
                      <span className="truncate">{email}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${email}`}
                        onClick={() => props.onRemove(email)}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                id={GUESTS_ID}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={LIST_ID}
                aria-activedescendant={open ? optionId(active) : undefined}
                aria-invalid={guestError ? true : undefined}
                aria-describedby={`${GUESTS_ID}-hint`}
                autoComplete="off"
                spellCheck={false}
                value={value.draft}
                placeholder={full ? `Up to ${OFFER_GUESTS_MAX} people` : value.guests.length ? "Add another" : "Name or email"}
                onChange={(e) => props.onDraft(e.target.value)}
                onKeyDown={props.onKeyDown}
                onPaste={props.onPaste}
                onBlur={props.onBlur}
                className="h-6 min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
              />
            </div>
            <ul
              id={LIST_ID}
              role="listbox"
              aria-label="Suggested people"
              hidden={!open}
              className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {suggestions.map((c, i) => (
                <li
                  key={c.email}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the field so picking doesn't count as leaving it.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.onPick(c)}
                  className="flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[13px] text-muted-foreground">{c.email}</span>
                </li>
              ))}
            </ul>
          </div>
          <p id={`${GUESTS_ID}-hint`} className={guestError ? errorText : hint} aria-live="polite">
            {guestError ??
              "They are invited automatically when the client picks a time. The host is already included, and you are only added if you add yourself."}
          </p>
        </div>
      </div>
    </section>
  );
}

/** "Meeting details" for Email times: a custom title and people to invite, filled before picking times. */
export function MeetingDetails({
  eventTypeId,
  value,
  onChange,
  fieldErrors,
}: {
  eventTypeId: string;
  value: MeetingDetailsValue;
  onChange: (next: MeetingDetailsValue) => void;
  fieldErrors?: { title?: string; guests?: string };
}) {
  const contacts = useOfferContacts(eventTypeId);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = open ? filterSuggestions(contacts, value.draft, value.guests) : [];
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));

  const apply = (result: CommitResult) => {
    onChange({ ...value, guests: result.guests, draft: result.draft });
    setGuestError(result.error);
    setActive(0);
  };
  const commit = (text: string) => {
    if (text.trim() === "") {
      if (text !== value.draft) onChange({ ...value, draft: "" });
      return;
    }
    apply(commitDraft(value.guests, text));
  };
  const pick = (contact: OfferContact) => {
    apply(addGuest(value.guests, contact.email));
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = suggestions.length;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n > 0) {
      e.preventDefault();
      setActive((highlighted + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = suggestions[highlighted];
      if (chosen) pick(chosen);
      else commit(value.draft);
    } else if (e.key === "," || e.key === ";" || (e.key === " " && value.draft.includes("@"))) {
      // A space only ends an address; while searching by name ("Jane Doe") it is typed as usual.
      e.preventDefault();
      commit(value.draft);
    } else if (e.key === "Escape" && n > 0) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Backspace" && value.draft === "" && value.guests.length > 0) {
      onChange({ ...value, guests: value.guests.slice(0, -1) });
      setGuestError(null);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("@")) return; // plain text: let it paste and filter suggestions
    e.preventDefault();
    commit(`${value.draft}${value.draft ? ", " : ""}${text}`);
    setOpen(false);
  };

  return (
    <MeetingDetailsView
      value={value}
      guestError={guestError}
      fieldErrors={fieldErrors}
      suggestions={suggestions}
      active={highlighted}
      onTitle={(title) => onChange({ ...value, title })}
      onDraft={(draft) => {
        onChange({ ...value, draft });
        setGuestError(null);
        setOpen(true);
        setActive(0);
      }}
      onRemove={(email) => {
        onChange({ ...value, guests: removeGuest(value.guests, email) });
        setGuestError(null);
      }}
      onPick={pick}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={() => {
        setOpen(false);
        commit(value.draft);
      }}
    />
  );
}

/** Why the copy buttons are off right now, with a retry when saving failed. Nothing when copy is allowed or no time is picked. */
export function OfferSaveStatus({ gate, onRetry }: { gate: CopyGate; onRetry: () => void }) {
  // Nothing picked yet: the count under the times already says so.
  if (gate.canCopy || gate.status === "empty") return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="email-offer-status">
      <p role="status" className={gate.status === "error" ? errorText : hint}>
        {gate.message}
      </p>
      {gate.status === "error" && (
        <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
