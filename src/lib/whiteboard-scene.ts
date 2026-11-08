/**
 * Helpers for the whiteboard scene JSON shared by the renderer, the local API
 * and tests.
 *
 * Whiteboard images live in Cloudflare R2. A persisted scene keeps only a
 * `masar://<imageId>` reference in each Excalidraw file's `dataURL` field; the
 * renderer swaps the reference for a temporary data URL when it loads the
 * canvas and swaps it back when it saves. The free local workspace never
 * externalises images, so its scenes keep the data URL.
 */

export const IMAGE_REFERENCE_PREFIX = "masar://";

export interface SceneFileRecord {
  [key: string]: unknown;
  dataURL?: unknown;
}

export interface SceneDocument {
  root: Record<string, unknown>;
  files: Record<string, SceneFileRecord>;
}

export interface WhiteboardSceneSnapshot {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function imageReference(imageId: string): string {
  return `${IMAGE_REFERENCE_PREFIX}${imageId}`;
}

/** Return the image id when `value` is a stored image reference. */
export function imageReferenceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(IMAGE_REFERENCE_PREFIX)) return null;
  const id = value.slice(IMAGE_REFERENCE_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/**
 * Parse a persisted scene. Returns null for malformed JSON so callers can keep
 * the existing behaviour (store the opaque string) instead of failing a save.
 */
export function parseSceneDocument(raw: string): SceneDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const files: Record<string, SceneFileRecord> = {};
  const rawFiles = root.files;
  if (rawFiles && typeof rawFiles === "object" && !Array.isArray(rawFiles)) {
    for (const [fileId, value] of Object.entries(rawFiles)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        files[fileId] = value as SceneFileRecord;
      }
    }
  }
  return { root, files };
}

/** Image ids referenced by a persisted scene, in file order. */
export function collectSceneImageIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const document = parseSceneDocument(raw);
  if (!document) return [];
  const ids = new Set<string>();
  for (const file of Object.values(document.files)) {
    const id = imageReferenceId(file.dataURL);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** File ids used by image elements that are still part of the canvas. */
export function referencedFileIds(elements: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const candidate = element as { fileId?: unknown; isDeleted?: unknown };
    if (candidate.isDeleted === true) continue;
    if (typeof candidate.fileId === "string" && candidate.fileId.length > 0) {
      ids.add(candidate.fileId);
    }
  }
  return ids;
}

function markerForFile(
  file: Record<string, unknown>,
  externalImages: ReadonlyMap<string, string>,
  fileId: string,
): Record<string, unknown> {
  const imageId = externalImages.get(fileId);
  if (!imageId || typeof file.dataURL !== "string") return file;
  return { ...file, dataURL: imageReference(imageId) };
}

/**
 * Serialize an Excalidraw state for persistence. Files that no live element
 * references are dropped (this is also how deleted images leave the scene and
 * become eligible for R2 cleanup), and already-stored images are written as
 * references instead of re-uploading their data URL.
 */
export function serializeWhiteboardScene(
  snapshot: WhiteboardSceneSnapshot,
  externalImages: ReadonlyMap<string, string>,
): string {
  const { collaborators: _collaborators, ...appState } = snapshot.appState;
  const usedFiles = referencedFileIds(snapshot.elements);
  const files: Record<string, unknown> = {};
  for (const [fileId, value] of Object.entries(snapshot.files)) {
    if (!usedFiles.has(fileId)) continue;
    if (!value || typeof value !== "object") continue;
    files[fileId] = markerForFile(
      value as Record<string, unknown>,
      externalImages,
      fileId,
    );
  }
  return JSON.stringify({
    elements: snapshot.elements,
    appState,
    files,
  });
}

/** Map every stored image reference in a scene back to its file id. */
export function sceneImageReferences(raw: string): Map<string, string> {
  const references = new Map<string, string>();
  const document = parseSceneDocument(raw);
  if (!document) return references;
  for (const [fileId, file] of Object.entries(document.files)) {
    const id = imageReferenceId(file.dataURL);
    if (id) references.set(fileId, id);
  }
  return references;
}
