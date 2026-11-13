import { format, parseISO } from "date-fns";

import { PRIORITY_META, TASK_COMPLEXITY_META } from "@/lib/constants";
import type { SyncConflictView } from "@/lib/types";

export interface ConflictLookup {
  columns: Map<string, string>;
  labels: Map<string, string>;
  projects: Map<string, string>;
  folders: Map<string, string>;
}

export interface ConflictDiffRow {
  key: string;
  label: string;
  cloud: string;
  local: string;
  changed: boolean;
  longText?: {
    cloud: string;
    local: string;
  };
}

export interface WhiteboardDiff {
  cloudElements: number;
  localElements: number;
  added: number;
  removed: number;
  modified: number;
}

export interface NoteDiff {
  cloudBlocks: number;
  localBlocks: number;
  added: number;
  removed: number;
  modified: number;
}

export interface ConflictDiff {
  changed: ConflictDiffRow[];
  unchanged: ConflictDiffRow[];
  summary: string;
  whiteboard: WhiteboardDiff | null;
  note: NoteDiff | null;
}

export interface TextDiffLine {
  kind: "equal" | "added" | "removed";
  text: string;
}

type FieldKind = "text" | "longText" | "date" | "timestamp" | "boolean";

interface FieldDefinition {
  key: string;
  label: string;
  kind?: FieldKind;
}

const TASK_FIELDS: FieldDefinition[] = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description", kind: "longText" },
  { key: "column_id", label: "Column" },
  { key: "priority", label: "Priority" },
  { key: "complexity", label: "Effort" },
  { key: "due_date", label: "Due date", kind: "date" },
  { key: "completed_at", label: "Completed", kind: "timestamp" },
  { key: "assignee", label: "Assignee" },
  { key: "position", label: "Order" },
];

const PROJECT_FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description", kind: "longText" },
  { key: "archived", label: "Archived", kind: "boolean" },
  { key: "archived_at", label: "Archived at", kind: "timestamp" },
  { key: "position", label: "Order" },
];

const BOARD_FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description", kind: "longText" },
  { key: "project_id", label: "Project" },
  { key: "folder_id", label: "Folder" },
  { key: "type", label: "Type" },
  { key: "position", label: "Order" },
];

const FOLDER_FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name" },
  { key: "parent_id", label: "Parent folder" },
  { key: "project_id", label: "Project" },
  { key: "position", label: "Order" },
];

const COLUMN_FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name" },
  { key: "is_done", label: "Completion column", kind: "boolean" },
  { key: "position", label: "Order" },
];

const LABEL_FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name" },
  { key: "color", label: "Color" },
];

const SUBTASK_FIELDS: FieldDefinition[] = [
  { key: "title", label: "Title" },
  { key: "completed", label: "Completed", kind: "boolean" },
  { key: "position", label: "Order" },
];

const COMMENT_FIELDS: FieldDefinition[] = [{ key: "body", label: "Comment", kind: "longText" }];

const TASK_LABEL_FIELDS: FieldDefinition[] = [];

/** Never render the URL itself: embedded images may be megabytes of base64. */
const TASK_IMAGE_FIELDS: FieldDefinition[] = [
  { key: "name", label: "File name" },
  { key: "position", label: "Order" },
];

function fieldDefinitions(type: SyncConflictView["entityType"]): FieldDefinition[] {
  switch (type) {
    case "task":
      return TASK_FIELDS;
    case "project":
      return PROJECT_FIELDS;
    case "folder":
      return FOLDER_FIELDS;
    case "board":
      return BOARD_FIELDS;
    case "column":
      return COLUMN_FIELDS;
    case "label":
      return LABEL_FIELDS;
    case "subtask":
      return SUBTASK_FIELDS;
    case "comment":
      return COMMENT_FIELDS;
    case "task_label":
      return TASK_LABEL_FIELDS;
    case "whiteboard":
      return [];
    case "note":
      return [];
    case "task_image":
      return TASK_IMAGE_FIELDS;
  }
}

function rawValue(
  data: Record<string, unknown>,
  key: string,
): unknown {
  return data[key];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not set";
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a");
}

function formatValue(
  value: unknown,
  key: string,
  kind: FieldKind | undefined,
  lookup: ConflictLookup,
): string {
  if (key === "parent_id") {
    if (value === null || value === undefined || value === "") {
      return "Project root";
    }
    return typeof value === "string"
      ? (lookup.folders.get(value) ?? "Unknown folder")
      : "Unknown folder";
  }
  if (key === "folder_id") {
    if (value === null || value === undefined || value === "") {
      return "Project root";
    }
    return typeof value === "string"
      ? (lookup.folders.get(value) ?? "Unknown folder")
      : "Unknown folder";
  }
  if (value === null || value === undefined || value === "") return "Not set";
  if (kind === "boolean") return value === true || value === 1 ? "Yes" : "No";
  if (kind === "timestamp") return formatTimestamp(value);
  if (kind === "date" && typeof value === "string") {
    try {
      return format(parseISO(value), "MMM d, yyyy");
    } catch {
      return value;
    }
  }
  if (key === "column_id" && typeof value === "string") {
    return lookup.columns.get(value) ?? "Unknown column";
  }
  if (key === "project_id" && typeof value === "string") {
    return lookup.projects.get(value) ?? "Unknown project";
  }
  if (key === "label_id" && typeof value === "string") {
    return lookup.labels.get(value) ?? "Unknown label";
  }
  if (key === "priority" && typeof value === "string") {
    return (
      PRIORITY_META[value as keyof typeof PRIORITY_META]?.label ??
      capitalize(value)
    );
  }
  if (key === "complexity" && typeof value === "string") {
    return (
      TASK_COMPLEXITY_META[value as keyof typeof TASK_COMPLEXITY_META]?.label ??
      value
    );
  }
  if (key === "color" && typeof value === "string") {
    return capitalize(value);
  }
  if (key === "type" && typeof value === "string") {
    return capitalize(value);
  }
  if (key === "position" && typeof value === "number") {
    return `#${value + 1}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseScene(scene: unknown): {
  elements: Array<{ id?: unknown; version?: unknown }>;
} | null {
  if (typeof scene !== "string") return null;
  try {
    const parsed = JSON.parse(scene) as { elements?: unknown };
    return {
      elements: Array.isArray(parsed.elements)
        ? (parsed.elements as Array<{ id?: unknown; version?: unknown }>)
        : [],
    };
  } catch {
    return null;
  }
}

function buildWhiteboardDiff(conflict: SyncConflictView): WhiteboardDiff | null {
  const cloud = parseScene(conflict.winningData.scene);
  const local = parseScene(conflict.incomingData.scene);
  if (!cloud && !local) return null;
  const cloudElements = cloud?.elements ?? [];
  const localElements = local?.elements ?? [];
  const cloudById = new Map(
    cloudElements
      .filter((element) => typeof element.id === "string")
      .map((element) => [element.id as string, element]),
  );
  const localById = new Map(
    localElements
      .filter((element) => typeof element.id === "string")
      .map((element) => [element.id as string, element]),
  );
  let added = 0;
  let modified = 0;
  for (const [id, element] of localById) {
    const previous = cloudById.get(id);
    if (!previous) {
      added += 1;
    } else if (!sameValue(previous.version, element.version)) {
      modified += 1;
    }
  }
  let removed = 0;
  for (const id of cloudById.keys()) {
    if (!localById.has(id)) removed += 1;
  }
  return {
    cloudElements: cloudElements.length,
    localElements: localElements.length,
    added,
    removed,
    modified,
  };
}

interface ParsedNoteBlocks {
  blocks: Array<{ id?: unknown }>;
}

function parseNoteDocumentBlocks(document: unknown): ParsedNoteBlocks | null {
  if (typeof document !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const blocks: Array<{ id?: unknown }> = [];
  const collect = (list: unknown[]) => {
    for (const block of list) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      blocks.push(block as { id?: unknown });
      const content = (block as { content?: unknown }).content;
      if (Array.isArray(content)) collect(content);
    }
  };
  collect(parsed);
  return { blocks };
}

/**
 * Compare two note documents by block identity, mirroring the whiteboard
 * element diff: added/removed/modified counts by block id, with nested blocks
 * included.
 */
function buildNoteDiff(conflict: SyncConflictView): NoteDiff | null {
  const cloud = parseNoteDocumentBlocks(conflict.winningData.document);
  const local = parseNoteDocumentBlocks(conflict.incomingData.document);
  if (!cloud && !local) return null;
  const cloudBlocks = cloud?.blocks ?? [];
  const localBlocks = local?.blocks ?? [];
  const cloudById = new Map(
    cloudBlocks
      .filter((block) => typeof block.id === "string")
      .map((block) => [block.id as string, block]),
  );
  const localById = new Map(
    localBlocks
      .filter((block) => typeof block.id === "string")
      .map((block) => [block.id as string, block]),
  );
  let added = 0;
  let modified = 0;
  for (const [id, block] of localById) {
    const previous = cloudById.get(id);
    if (!previous) {
      added += 1;
    } else if (!sameValue(previous, block)) {
      modified += 1;
    }
  }
  let removed = 0;
  for (const id of cloudById.keys()) {
    if (!localById.has(id)) removed += 1;
  }
  return {
    cloudBlocks: cloudBlocks.length,
    localBlocks: localBlocks.length,
    added,
    removed,
    modified,
  };
}

export function buildConflictDiff(
  conflict: SyncConflictView,
  lookup: ConflictLookup,
): ConflictDiff {
  const whiteboard = buildWhiteboardDiff(conflict);
  const note = buildNoteDiff(conflict);
  const rows: ConflictDiffRow[] = [];

  if (conflict.incomingDeleted !== conflict.winningDeleted) {
    rows.push({
      key: "existence",
      label: "Record",
      local: conflict.incomingDeleted ? "Deleted" : "Present",
      cloud: conflict.winningDeleted ? "Deleted" : "Present",
      changed: true,
    });
  }

  for (const field of fieldDefinitions(conflict.entityType)) {
    const localRaw = rawValue(conflict.incomingData, field.key);
    const cloudRaw = rawValue(conflict.winningData, field.key);
    const local = formatValue(localRaw, field.key, field.kind, lookup);
    const cloud = formatValue(cloudRaw, field.key, field.kind, lookup);
    const changed = !sameValue(localRaw, cloudRaw);
    if (!changed && local === "Not set" && cloud === "Not set") continue;
    rows.push({
      key: field.key,
      label: field.label,
      local,
      cloud,
      changed,
      ...(field.kind === "longText" &&
      (local !== "Not set" || cloud !== "Not set")
        ? {
            longText: {
              cloud: cloud === "Not set" ? "" : cloud,
              local: local === "Not set" ? "" : local,
            },
          }
        : {}),
    });
  }

  const changed = rows.filter((row) => row.changed);
  const unchanged = rows.filter((row) => !row.changed);
  const changedLabels = changed.map((row) => row.label);
  const summary = whiteboard
    ? [
        `${whiteboard.added} added`,
        `${whiteboard.removed} removed`,
        `${whiteboard.modified} modified`,
      ].join(" · ")
    : note
      ? [
          `${note.added} added`,
          `${note.removed} removed`,
          `${note.modified} modified`,
        ].join(" · ")
      : changedLabels.length > 0
        ? `Changed: ${changedLabels.join(", ")}`
        : "Only metadata changed";

  return { changed, unchanged, summary, whiteboard, note };
}

/**
 * Simple line-based LCS diff. It is intentionally local so conflict previews
 * do not add another runtime dependency.
 */
export function diffText(before: string, after: string): TextDiffLine[] {
  const split = (value: string) =>
    value.length === 0 ? [] : value.replace(/\r\n?/g, "\n").split("\n");
  const a = split(before);
  const b = split(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: TextDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "equal", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! });
      i += 1;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ kind: "removed", text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    lines.push({ kind: "added", text: b[j]! });
    j += 1;
  }
  return lines;
}
