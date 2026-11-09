/** A valid 1x1 PNG used by upload tests. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64",
);

export const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

export function pngDataUrl(bytes: Uint8Array = PNG_BYTES): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}
