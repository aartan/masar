/**
 * Helpers for the BlockNote document JSON shared by the renderer, the local
 * API and tests.
 *
 * Note images live in Cloudflare R2. A persisted document keeps the image's
 * URL (`/api/images/<imageId>`) in each image block's `url` prop; the renderer
 * hydrates those URLs from the local image cache when available. The free
 * local workspace never uploads images, so its documents keep the data URL
 * the BlockNote upload fallback produced — the same arrangement as whiteboard
 * scenes.
 */

/** The local API path an uploaded note image is served from. */
export const NOTE_IMAGE_URL_PREFIX = "/api/images/";

export interface NoteBlockRecord {
  [key: string]: unknown;
  type?: unknown;
  props?: unknown;
  content?: unknown;
}

/**
 * Parse a persisted document. Returns null for malformed JSON so callers can
 * keep the existing behaviour (store the opaque string) instead of failing a
 * save.
 */
export function parseNoteDocument(raw: string): NoteBlockRecord[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(
    (block): block is NoteBlockRecord =>
      Boolean(block) && typeof block === "object",
  );
}

/** The local-cache serving URL pattern for a note image of a board. */
const NOTE_IMAGE_CACHE_URL_PATTERN =
  /^\/api\/boards\/[^/]+\/images\/([^/]+)\/cache$/;

/** The image id embedded in a note image URL, or null for other values. */
export function noteImageUrlId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(NOTE_IMAGE_URL_PREFIX)) {
    const id = value.slice(NOTE_IMAGE_URL_PREFIX.length).trim();
    return id.length > 0 ? id : null;
  }
  const cacheMatch = NOTE_IMAGE_CACHE_URL_PATTERN.exec(value);
  if (cacheMatch) {
    const id = decodeURIComponent(cacheMatch[1] ?? "");
    return id.length > 0 ? id : null;
  }
  return null;
}

interface NoteBlockTraversal {
  /** Image ids referenced by image blocks (top-level and nested). */
  imageIds: Set<string>;
  /** Image URLs still present in the document (used for cache pruning). */
  liveUrls: Set<string>;
}

function walkBlock(block: NoteBlockRecord, state: NoteBlockTraversal): void {
  const url = block.props && typeof block.props === "object"
    ? (block.props as Record<string, unknown>).url
    : undefined;
  if (block.type === "image" && typeof url === "string") {
    state.liveUrls.add(url);
    const id = noteImageUrlId(url);
    if (id) state.imageIds.add(id);
  }
  const content = block.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        walkBlock(child as NoteBlockRecord, state);
      }
    }
  }
}

/**
 * Image ids referenced by a persisted document. Note images are keyed in the
 * local image cache by their image id, so this doubles as the live-file-id
 * set for cache pruning.
 */
export function collectNoteImageIds(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  const blocks = parseNoteDocument(raw);
  if (!blocks) return [];
  const state: NoteBlockTraversal = { imageIds: new Set(), liveUrls: new Set() };
  for (const block of blocks) walkBlock(block, state);
  return [...state.imageIds];
}

/** The local-cache serving URL for a note image of a board. */
export function noteImageCacheUrl(boardId: string, imageId: string): string {
  return `/api/boards/${boardId}/images/${encodeURIComponent(imageId)}/cache`;
}

/**
 * Rewrite every image block URL in the document with `mapper`. The mapper
 * receives the image id extracted from the current URL (or null for URLs
 * that are not note image references) and returns the replacement URL, or
 * null to keep the current value. Unknown block fields are preserved.
 *
 * Documents without any local-cache serving URLs are returned unchanged so
 * the common save-loop comparison never pays a JSON round-trip on every
 * keystroke.
 */
export function rewriteNoteImageUrls(
  raw: string,
  boardId: string,
  mapper: (imageId: string | null) => string | null,
): string {
  // Fast path: a document without any note image references (canonical or
  // cache-served) needs no rewrite, so the save-loop comparison never pays a
  // JSON round-trip on every keystroke for plain-text notes.
  if (!raw.includes("/cache") && !raw.includes(NOTE_IMAGE_URL_PREFIX)) {
    return raw;
  }
  const blocks = parseNoteDocument(raw);
  if (!blocks) return raw;

  const rewrite = (block: NoteBlockRecord): NoteBlockRecord => {
    const props =
      block.props && typeof block.props === "object"
        ? (block.props as Record<string, unknown>)
        : null;
    let nextProps = props;
    if (block.type === "image" && props && typeof props.url === "string") {
      const replaced = mapper(noteImageUrlId(props.url));
      if (replaced !== null) {
        nextProps = { ...props, url: replaced };
      }
    }
    const content = Array.isArray(block.content)
      ? block.content.map((child) =>
          child && typeof child === "object" && !Array.isArray(child)
            ? rewrite(child as NoteBlockRecord)
            : child,
        )
      : block.content;
    if (nextProps === props && content === block.content) return block;
    return { ...block, ...(nextProps ? { props: nextProps } : {}), content };
  };

  return JSON.stringify(blocks.map(rewrite));
}

/**
 * Serialize a document for persistence: local-cache serving URLs are
 * canonicalized back to their `/api/images/<id>` references so the database
 * and every synced device only ever see the canonical URL.
 */
export function canonicalizeNoteDocument(raw: string, boardId: string): string {
  if (!raw.includes("/cache")) return raw;
  return rewriteNoteImageUrls(raw, boardId, (imageId) =>
    imageId === null ? null : noteImageUrl(imageId),
  );
}

/** A canonical image URL for a stored image id. */
export function noteImageUrl(imageId: string): string {
  return `${NOTE_IMAGE_URL_PREFIX}${imageId}`;
}

/**
 * True when two documents represent the same content, ignoring how images
 * are served (a local-cache URL and the canonical `/api/images/<id>` URL
 * point at the same stored image). Used by the save loop so a hydrated
 * document is not re-saved just because the renderer swapped serving URLs.
 */
export function noteDocumentsEquivalent(
  a: string,
  b: string,
  boardId: string,
): boolean {
  if (a === b) return true;
  return (
    canonicalizeNoteDocument(a, boardId) === canonicalizeNoteDocument(b, boardId)
  );
}
