import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * All timestamps are stored as Unix epoch milliseconds so they behave
 * consistently across local SQLite and remote Turso/libSQL.
 */
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/**
 * Authentication tables are managed by Better Auth. They use plural table
 * names because the server and test helpers pass `usePlural: true` to the
 * Drizzle adapter.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    /**
     * Nullable for migration-first deployments: the currently deployed app
     * does not know about this column and may insert rows while the new code
     * rolls out. The application never reads or writes unscoped boards; the
     * legacy claim command assigns them to their explicit owner.
     */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("sage"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("boards_position_idx").on(table.position),
    index("boards_owner_position_idx").on(table.ownerId, table.position),
  ],
);

export const columns = sqliteTable(
  "columns",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("columns_board_idx").on(table.boardId, table.position),
    uniqueIndex("columns_board_name_unique").on(table.boardId, table.name),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("none"),
    dueDate: text("due_date"),
    // Legacy free-text field kept for database compatibility. The app no
    // longer reads or writes it.
    assignee: text("assignee"),
    position: integer("position").notNull().default(0),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tasks_board_idx").on(table.boardId),
    index("tasks_column_position_idx").on(table.columnId, table.position),
    index("tasks_due_date_idx").on(table.dueDate),
    index("tasks_priority_idx").on(table.priority),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("slate"),
    createdAt: createdAt(),
  },
  (table) => [
    index("labels_board_idx").on(table.boardId),
    uniqueIndex("labels_board_name_unique").on(table.boardId, table.name),
  ],
);

export const taskLabels = sqliteTable(
  "task_labels",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index("task_labels_label_idx").on(table.labelId),
  ],
);

export const subtasks = sqliteTable(
  "subtasks",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("subtasks_task_idx").on(table.taskId, table.position),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    author: text("author").notNull().default("You"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("comments_task_idx").on(table.taskId, table.createdAt)],
);

/**
 * Billing tables. Stripe is the source of truth; these rows are a verified,
 * queryable snapshot so workspace requests never need to call Stripe.
 */
export const billingCustomers = sqliteTable(
  "billing_customers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("billing_customers_stripe_customer_idx").on(table.stripeCustomerId),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripePriceId: text("stripe_price_id"),
    status: text("status").notNull(),
    planName: text("plan_name"),
    currency: text("currency"),
    amount: integer("amount"),
    interval: text("interval"),
    currentPeriodEnd: integer("current_period_end", {
      mode: "timestamp_ms",
    }),
    trialStart: integer("trial_start", { mode: "timestamp_ms" }),
    trialEnd: integer("trial_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
    stripeCreatedAt: integer("stripe_created_at", { mode: "timestamp_ms" }),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("subscriptions_user_idx").on(table.userId),
    index("subscriptions_customer_idx").on(table.stripeCustomerId),
  ],
);

export const pendingSignups = sqliteTable(
  "pending_signups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    /** Deleted as soon as the account is provisioned or abandoned by cleanup. */
    passwordHash: text("password_hash"),
    demoContent: integer("demo_content", { mode: "boolean" })
      .notNull()
      .default(false),
    stripeCustomerId: text("stripe_customer_id"),
    checkoutSessionId: text("checkout_session_id"),
    status: text("status").notNull().default("pending"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pending_signups_stripe_customer_idx").on(table.stripeCustomerId),
    index("pending_signups_status_idx").on(table.status),
  ],
);

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: createdAt(),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type ColumnRow = typeof columns.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type BillingCustomerRow = typeof billingCustomers.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PendingSignupRow = typeof pendingSignups.$inferSelect;
export type StripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect;
