/**
 * Electron prefixes errors rejected by `ipcRenderer.invoke` with the channel
 * name and preserves the thrown error's `name` (for example
 * `PremiumApiError:`). Strip those technical wrappers before the renderer
 * displays the message.
 */
const TECHNICAL_PREFIX =
  /^(?:Error invoking remote method '[^']+':\s*|(?:Error|[A-Za-z_$][\w$]*(?:Error|Exception)):\s*)/;

export function userFacingErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  let previous: string;
  do {
    previous = message;
    message = message.replace(TECHNICAL_PREFIX, "");
  } while (message !== previous);
  return message;
}

/**
 * Return a clean Error for the renderer while keeping the original error as
 * its `cause` for debugging.
 */
export function cleanError(error: unknown): Error {
  return new Error(userFacingErrorMessage(error), { cause: error });
}
