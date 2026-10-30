# Subscriptions and billing

Masar's online workspace is paid. Every online account needs an active Stripe
subscription or a valid free trial; accounts are only created after Stripe
confirms that entitlement. The desktop app's local workspace is free and
offline, and never talks to Stripe.

## Access rules

| State | Online access |
| --- | --- |
| `trialing` with `trial_end` in the future | Yes |
| `active` with `current_period_end` in the future | Yes |
| `past_due` before the paid period ends | Yes (payment issue shown) |
| Cancelled at period end (`cancel_at_period_end`) | Yes until the period ends |
| `canceled`, expired, `incomplete`, `paused`, or no subscription | No |
| Desktop local mode (`MASAR_LOCAL_MODE=1`) | Yes, always |

Restricted accounts can still open `/subscription`, manage billing in the
Stripe Customer Portal, and sign out. Workspace pages redirect to
`/subscription?required=1`; workspace API routes return HTTP `402`.
Cancellation keeps access through the end of the paid period. Resubscribing
after expiry never grants a second free trial.

## How the flows work

### New signup

1. `/signup` collects name, email, password, and the optional demo-content
   choice. Nothing is written to Better Auth yet.
2. `POST /api/signup/start` stores a `pending_signups` row (with a password
   hash, never the plain password), creates or reuses a Stripe customer, and
   creates a Checkout Session with a trial.
3. Stripe hosts Checkout. Abandoning or declining it creates no account.
4. On success, `/api/signup/complete` retrieves the Checkout Session and
   subscription directly from Stripe. Only an entitled subscription provisions
   the user, credential, billing customer, and subscription in one transaction;
   the session cookie is written afterwards. The same logic runs from the
   `checkout.session.completed` webhook if the browser never returns.
5. Retries reuse the open Checkout Session and the same customer. Incomplete
   subscriptions are cancelled before a new attempt, and duplicate finishing
   (browser + webhook) recovers the already-provisioned account.

Direct Better Auth sign-up is disabled (`disableSignUp: true`), so
`/api/auth/sign-up/email` cannot bypass Checkout.

### Existing or expired accounts

`POST /api/subscription/checkout` creates a Checkout Session without a trial,
reusing any open session and cancelling abandoned incomplete subscriptions.
`/api/subscription/complete` and the webhook verify and attach the resulting
subscription. Accounts with a valid subscription are refused with `409`
instead of being charged twice.

### Managing billing

`POST /api/subscription/portal` opens the Stripe Customer Portal, where users
update payment methods, view invoices, and cancel. The portal return URL is
`/subscription?portal=return`, which triggers reconciliation against Stripe.

### Webhooks and reconciliation

The only webhook endpoint is `POST /api/stripe/webhook`. Signatures are
verified with `STRIPE_WEBHOOK_SECRET`; invalid signatures get `400`. Each event
id is claimed in `stripe_webhook_events` for deduplication and the claim is
released if processing throws, so Stripe can retry. For subscription state the
handler always re-fetches the live subscription from Stripe rather than
trusting a stale event payload.

Handled events:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The subscription page also reconciles on `?required=1`, `?setup=success`, and
`?portal=return`, and the **Refresh status** button calls
`POST /api/subscription/sync`.

## Stripe setup

All steps below use Stripe **test mode** first.

1. Create a product with **one recurring price** (monthly or yearly) in the
   Stripe Dashboard. Copy the price id (`price_...`). Masar uses a single
   configured price; existing subscriptions keep their original price if you
   later change `STRIPE_PRICE_ID`. Changing the price requires a new price in
   Stripe.
2. Configure the **Customer Portal** (Settings → Billing → Customer portal):
   allow payment-method updates, invoice history, and cancellation. Prefer
   cancellation **at the end of the billing period** so access continues until
   the paid period ends.
3. Copy the values into `.env.local` (or your deployment environment):

   ```bash
   STRIPE_SECRET_KEY="sk_test_..."
   STRIPE_WEBHOOK_SECRET="whsec_..."
   STRIPE_PRICE_ID="price_..."
   STRIPE_TRIAL_DAYS="14"          # default; 0 charges immediately
   BETTER_AUTH_URL="http://localhost:3000"
   ```

4. Apply database migrations (creates the billing and pending-signup tables):

   ```bash
   npm run db:migrate
   ```

5. Forward webhooks locally and restart the dev server after copying the
   printed signing secret:

   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

6. In production, add a webhook endpoint at
   `https://your-domain/api/stripe/webhook` and subscribe it to the events
   listed above. Use the endpoint's signing secret, not the CLI secret.

Without all three Stripe secrets, online billing shows as unavailable and
signup/checkout routes return `503`. Existing access rules still apply from the
last verified database state.

## Testing payments

Use Stripe test mode and these card numbers (any future expiry, any CVC):

| Card | Behavior |
| --- | --- |
| `4242 4242 4242 4242` | Successful payment |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |
| `4000 0000 0000 9995` | Declined |
| `4000 0000 0000 0341` | Attaches, then fails — subscription stays incomplete |

Checkout always collects a payment method, including during the trial. The
card is not charged until the trial ends. Cancel in the Customer Portal before
the trial end to avoid the first charge.

## Desktop local mode

The Electron app defaults to the free local workspace. In local mode the
server sets `MASAR_LOCAL_MODE=1`, uses the local SQLite database, and bypasses
billing entirely in both page and API authorization. Switching from sync mode
back to local never uploads, deletes, or otherwise modifies local data. The
subscription screen and the desktop Settings menu expose **Continue offline** /
**Switch to Local Workspace** whenever the app is running in sync mode.

## Security notes

- The Stripe secret key and webhook secret stay on the server. Card details
  never touch Masar; Checkout and the Customer Portal are hosted by Stripe.
- Account creation and access decisions are server-side. The client redirect
  on `402` is a convenience, not the enforcement point.
- Webhook requests are rejected unless the Stripe signature verifies.
- Passwords are hashed with Better Auth's hasher and stored only in the pending
  row until provisioning, then cleared.
- Treat `stripe_webhook_events` and `pending_signups` as sensitive operational
  tables; they are included in normal database backups.

## Tests

- `tests/billing.test.ts` covers entitlement rules, signup retries, checkout
  failure/abandonment, exactly-once provisioning, existing-account checkout,
  portal creation, duplicate prevention, cancellation, renewal, expiry, and
  webhook deduplication/reconciliation. It uses an in-memory fake gateway and
  never calls Stripe.
- `e2e/subscription.spec.ts` covers the paywall redirect, API `402`, active and
  canceling states, and incomplete checkout in the browser. E2E accounts and
  subscriptions are seeded directly because public sign-up requires Stripe.
