import * as React from "react";

/**
 * The user's note width preference. Persisted per device in local storage so
 * it survives navigation and reloads, but never affects document content —
 * only the maximum width of the editor column.
 *
 * Narrow is focused writing, Standard is everyday notes (the default), Wide
 * leaves room for research and structured documents. All three are maximum
 * widths: smaller screens keep the responsive padding and just get narrower.
 */

export type NoteWidth = "narrow" | "standard" | "wide";

export const NOTE_WIDTH_CLASSES: Record<NoteWidth, string> = {
  narrow: "max-w-[640px]",
  standard: "max-w-[800px]",
  wide: "max-w-[1040px]",
};

export const NOTE_WIDTH_LABELS: Record<NoteWidth, string> = {
  narrow: "Narrow",
  standard: "Standard",
  wide: "Wide",
};

const NOTE_WIDTH_STORAGE_KEY = "masar:note-width";

function readNoteWidth(): NoteWidth {
  try {
    const stored = window.localStorage.getItem(NOTE_WIDTH_STORAGE_KEY);
    if (stored === "narrow" || stored === "standard" || stored === "wide") {
      return stored;
    }
  } catch {
    // Keep the default width when local storage is unavailable.
  }
  return "standard";
}

export function useNoteWidth(): [NoteWidth, (width: NoteWidth) => void] {
  const [noteWidth, setNoteWidth] = React.useState<NoteWidth>(readNoteWidth);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(NOTE_WIDTH_STORAGE_KEY, noteWidth);
    } catch {
      // The current selection still applies for this session.
    }
  }, [noteWidth]);

  return [noteWidth, setNoteWidth];
}
