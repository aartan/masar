"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Compact input used to rename a sidebar row in place. Enter and blur commit,
 * Escape cancels, and errors keep the input open so the user can retry.
 */
export function InlineRenameInput({
  initialValue,
  ariaLabel,
  maxLength = 80,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: string;
  ariaLabel: string;
  maxLength?: number;
  onCommit: (value: string) => Promise<boolean>;
  onCancel: () => void;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const settledRef = React.useRef(false);
  const committingRef = React.useRef(false);
  const [value, setValue] = React.useState(initialValue);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function commit() {
    if (settledRef.current || committingRef.current) return;
    const next = value.trim();
    if (!next || next === initialValue.trim()) {
      settledRef.current = true;
      onCancel();
      return;
    }
    committingRef.current = true;
    setSaving(true);
    const saved = await onCommit(next);
    if (saved) {
      settledRef.current = true;
      return;
    }
    committingRef.current = false;
    setSaving(false);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!committingRef.current) {
            settledRef.current = true;
            onCancel();
          }
        }
      }}
      onBlur={() => void commit()}
      aria-label={ariaLabel}
      maxLength={maxLength}
      disabled={saving}
      spellCheck={false}
      className={cn(
        "h-6 min-w-0 flex-1 rounded-md border border-sidebar-border bg-background px-1.5 text-[13px] text-sidebar-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        className,
      )}
    />
  );
}
