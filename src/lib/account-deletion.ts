import { DELETE_ACCOUNT_PHRASE } from "./premium-types";

/**
 * The confirmation is intentionally case-sensitive and whitespace-sensitive:
 * the user must type the exact phrase shown in the dialog.
 */
export function isDeleteAccountConfirmed(value: string): boolean {
  return value === DELETE_ACCOUNT_PHRASE;
}
