import { getLocalUser } from "./desktop";

export type LocalUser = Awaited<ReturnType<typeof getLocalUser>>;

/**
 * The desktop is a single-user local application. There is no sign-in or
 * remote session for ordinary workspace access; premium account sessions live
 * only in the Electron main process and are used by the API client.
 */
export async function getCurrentUser(): Promise<LocalUser> {
  return getLocalUser();
}

export async function requireApiUser(): Promise<LocalUser> {
  return getLocalUser();
}

export async function requireApiAuthUser(): Promise<LocalUser> {
  return getLocalUser();
}
