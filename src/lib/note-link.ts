/**
 * Strict link URL validation for the note editor.
 *
 * Only web, email and phone links are accepted: `https://`, `http://`,
 * `mailto:` and `tel:`. Bare entries are treated as web addresses and
 * prefixed with `https://` — the behaviour users expect from a friendly
 * editor — while anything else (`javascript:`, `data:`, `file:` and friends)
 * is rejected outright.
 */

export type NoteLinkValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

const HOST_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** True when the value looks like a usable web host (domain, IP, localhost). */
function looksLikeHost(host: string): boolean {
  if (host === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => HOST_LABEL_PATTERN.test(label));
}

const TEL_CHARACTERS = /^[0-9+()#*.,-]+$/;

/**
 * Validate and normalize a link entered by the user. Returns the final URL
 * (with `https://` added for bare web addresses) or a short, user-facing
 * message explaining what to fix.
 */
export function validateNoteLinkUrl(input: string): NoteLinkValidation {
  const value = input.trim();
  if (value === "") {
    return { ok: false, message: "Enter a link." };
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) {
    if (/\s/.test(value)) {
      return { ok: false, message: "Links can’t contain spaces." };
    }
    // Bare value: assume a web address.
    const bare = value.split(/[/?#]/, 1)[0] ?? value;
    if (!looksLikeHost(bare)) {
      return {
        ok: false,
        message: "Enter a complete link, for example example.com.",
      };
    }
    return { ok: true, url: `https://${value}` };
  }

  const scheme = `${schemeMatch[1]!.toLowerCase()}:`;
  if (!ALLOWED_PROTOCOLS.has(scheme)) {
    return {
      ok: false,
      message: "Only https://, http://, mailto: and tel: links are allowed.",
    };
  }

  if (scheme === "http:" || scheme === "https:") {
    if (/\s/.test(value)) {
      return { ok: false, message: "Links can’t contain spaces." };
    }
    const rest = value.slice(scheme.length).replace(/^\/\//, "");
    const host = rest.split(/[/?#]/, 1)[0] ?? "";
    if (host === "" || !looksLikeHost(host)) {
      return {
        ok: false,
        message: "Enter a complete link, for example https://example.com.",
      };
    }
    return { ok: true, url: value };
  }

  if (scheme === "mailto:") {
    if (/\s/.test(value)) {
      return { ok: false, message: "Links can’t contain spaces." };
    }
    const address = value.slice(scheme.length).split("?", 1)[0] ?? "";
    if (address === "" || !address.includes("@")) {
      return { ok: false, message: "Enter a valid email address." };
    }
    return { ok: true, url: value };
  }

  // tel: — accept only phone characters (spaces are tolerated and stripped)
  // and require at least one digit.
  const number = value.slice(scheme.length).replace(/\s/g, "");
  if (number === "" || !TEL_CHARACTERS.test(number) || !/\d/.test(number)) {
    return { ok: false, message: "Enter a valid phone number." };
  }
  return { ok: true, url: `tel:${number}` };
}
