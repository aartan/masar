export interface PremiumUser {
  id: string;
  name: string;
  email: string;
}

export interface EntitlementView {
  entitled: boolean;
  reason:
    | "none"
    | "trialing"
    | "active"
    | "canceling"
    | "payment_issue"
    | "expired"
    | "canceled"
    | "incomplete"
    | "paused";
  status: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface PremiumSubscriptionView {
  planName: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  status: string;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
}

export interface PremiumStatus {
  connected: boolean;
  user: PremiumUser | null;
  entitlement: EntitlementView | null;
  subscription: PremiumSubscriptionView | null;
  billingConfigured: boolean;
  apiUrl: string;
  error: string | null;
}

export type SyncPhase =
  | "disconnected"
  | "idle"
  | "syncing"
  | "error"
  | "subscription_required";

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  pendingChanges: number;
  lastError: string | null;
  lastConflictCount: number;
  skippedChanges: number;
}

export interface PremiumCredentials {
  email: string;
  password: string;
}

export interface PremiumRegistration extends PremiumCredentials {
  name: string;
}

export interface PremiumActionError {
  error: string;
}
