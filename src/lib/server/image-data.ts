export interface DecodedImage {
  bytes: Buffer;
  contentType: string;
}

/** Decode an Excalidraw data URL without trusting its declared type. */
export function decodeDataUrl(value: unknown): DecodedImage | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 5) return null;
  const metadata = value.slice(5, comma);
  const parts = metadata.split(";");
  const contentType = (parts[0] ?? "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) return null;
  const base64 = parts
    .slice(1)
    .some((part) => part.trim().toLowerCase() === "base64");

  try {
    const payload = value.slice(comma + 1);
    const bytes = base64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (bytes.byteLength === 0) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}
