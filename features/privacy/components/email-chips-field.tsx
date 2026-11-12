"use client";

import { X } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { type ChipList, commitChips, removeChip } from "./guard-form";

const hint = "text-[13px] leading-5 text-muted-foreground";
const errorText = "text-[13px] leading-5 text-destructive";

export type EmailChipsViewProps = {
  id: string;
  label: string;
  helper: string;
  value: ChipList;
  max: number;
  /** Chip list name for screen readers, e.g. "People who can schedule for me". */
  listLabel: string;
  error?: string | null;
  disabled?: boolean;
  onDraft: (draft: string) => void;
  onRemove: (email: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
};

/** Address chips with a text field, without state (rendered by EmailChipsField; tested directly). */
export function EmailChipsView(props: EmailChipsViewProps) {
  const { id, value, error } = props;
  const full = value.items.length >= props.max;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          error && "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
          props.disabled && "opacity-60",
        )}
      >
        {value.items.length > 0 && (
          <ul aria-label={props.listLabel} className="contents">
            {value.items.map((email) => (
              <li key={email} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-muted py-0.5 pr-0.5 pl-2 text-[13px] leading-5">
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  aria-label={`Remove ${email}`}
                  disabled={props.disabled}
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
          id={id}
          type="text"
          inputMode="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          spellCheck={false}
          disabled={props.disabled}
          value={value.draft}
          placeholder={full ? `Up to ${props.max}` : value.items.length ? "Add another" : "name@company.com"}
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          onBlur={props.onBlur}
          className="h-6 min-w-40 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        />
      </div>
      <p id={`${id}-hint`} className={error ? errorText : hint} aria-live="polite">
        {error ?? props.helper}
      </p>
    </div>
  );
}

/** Email chips: Enter, comma, semicolon or a space after an address make a chip; Backspace removes the last one. */
export function EmailChipsField({
  id,
  label,
  helper,
  value,
  onChange,
  max,
  noun,
  error,
  disabled,
}: {
  id: string;
  label: string;
  helper: string;
  value: ChipList;
  onChange: (next: ChipList) => void;
  max: number;
  /** Plural noun for the limit message, e.g. "people". */
  noun: string;
  /** Error from the server for this list. */
  error?: string;
  disabled?: boolean;
}) {
  const [typingError, setTypingError] = useState<string | null>(null);
  const commit = (text: string) => {
    const result = commitChips(value, text, max, noun);
    if (result.list.draft !== value.draft || result.list.items !== value.items) onChange(result.list);
    setTypingError(result.error);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === " " && value.draft.includes("@"))) {
      e.preventDefault();
      commit(value.draft);
    } else if (e.key === "Backspace" && value.draft === "" && value.items.length > 0) {
      onChange({ ...value, items: value.items.slice(0, -1) });
      setTypingError(null);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[,;\s<]/.test(text)) return; // one address: let it paste
    e.preventDefault();
    commit(`${value.draft}${value.draft ? ", " : ""}${text}`);
  };
  return (
    <EmailChipsView
      id={id}
      label={label}
      helper={helper}
      value={value}
      max={max}
      listLabel={label}
      error={typingError ?? error ?? null}
      disabled={disabled}
      onDraft={(draft) => {
        onChange({ ...value, draft });
        setTypingError(null);
      }}
      onRemove={(email) => {
        onChange(removeChip(value, email));
        setTypingError(null);
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={() => commit(value.draft)}
    />
  );
}
