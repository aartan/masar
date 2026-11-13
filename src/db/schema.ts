import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
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

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    /**
     * Nullable for migration-first deployments, mirroring boards.ownerId: a
     * rolling upgrade may create projects before the new code is everywhere,
     * and the legacy claim command assigns unscoped rows to their owner.
     */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    /**
     * Archiving preserves all contents and makes them read-only; it is a
     * workspace-level flag, not a sync exclusion, so archived projects still
     * synchronise and never diverge between devices.
     */
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("projects_owner_position_idx").on(table.ownerId, table.position),
  ],
);

/**
 * Optional folder used to organise spaces inside a project. Folders form a
 * tree: `parentId` is null for a top-level folder and otherwise points at
 * another folder in the same project. There is deliberately no depth limit.
 * Deleting a folder promotes its direct children to the deleted folder's
 * parent, so spaces and subfolders are never lost.
 */
export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    /**
     * Nullable for the same migration-first reason as projects/boards. New
     * code always writes the owner; the legacy claim command reassigns rows.
     */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => folders.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("folders_project_parent_position_idx").on(
      table.projectId,
      table.parentId,
      table.position,
    ),
    index("folders_owner_parent_position_idx").on(
      table.ownerId,
      table.parentId,
      table.position,
    ),
  ],
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
     *
     * Naming note: the UI calls a board a "space" (Kanban spaces, whiteboard
     * spaces and notes are all spaces). The table, routes, code identifiers
     * and the sync entity keep the legacy "board" name so existing databases
     * and the cloud sync protocol stay untouched.
     */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /**
     * The project this board belongs to. Nullable for migration safety (the
     * migration assigns every existing board to the owner's default project,
     * and the legacy claim backfills unscoped boards).
     */
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /**
     * Optional folder inside the project. Null places the space directly in
     * the project root. Deleting a folder promotes its spaces rather than
     * deleting them, so the FK uses SET NULL as a safety net; the folder
     * service performs the promotion explicitly so sync tombstones are queued.
     */
    folderId: text("folder_id").references(() => folders.id, {
      onDelete: "set null",
    }),
    /**
     * Board type, immutable after creation. 'kanban' is the default so every
     * existing board keeps its behaviour; 'whiteboard' renders an Excalidraw
     * canvas and has no columns; 'note' renders a BlockNote rich-text
     * document and has no columns. The UI calls all three "spaces".
     */
    type: text("type").notNull().default("kanban"),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("boards_position_idx").on(table.position),
    index("boards_owner_position_idx").on(table.ownerId, table.position),
    index("boards_project_position_idx").on(table.projectId, table.position),
    index("boards_folder_position_idx").on(table.folderId, table.position),
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
    /**
     * Optional T-shirt-size estimate. Null means the task has not been
     * estimated, which keeps existing rows untouched when the field is added.
     */
    complexity: text("complexity"),
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
    /** Nullable for databases created before sync support. */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
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
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
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
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("comments_task_idx").on(table.taskId, table.createdAt)],
);

/**
 * Image attached to a task. Premium workspaces store a canonical
 * `/api/images/<imageId>` URL and keep the bytes in R2 plus the local image
 * cache; the free local workspace stores the image as a data URL, the same
 * fallback Notes and whiteboard scenes use. One `task_image` sync entity
 * carries each row, so attachments can be added or removed independently of
 * the parent task.
 */
export const taskImages = sqliteTable(
  "task_images",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    name: text("name"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("task_images_task_position_idx").on(table.taskId, table.position),
  ],
);

/**
 * Excalidraw scene for a whiteboard board, keyed one-to-one by board id. The
 * scene JSON (elements, appState, embedded files) is kept out of the boards
 * table so board-list reads stay small and the size budget is isolated. A
 * single `whiteboard` sync entity carries this row.
 */
export const whiteboards = sqliteTable("whiteboards", {
  boardId: text("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  scene: text("scene").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * BlockNote document for a note board, keyed one-to-one by board id. The
 * document JSON (an array of BlockNote blocks) is kept out of the boards table
 * so board-list reads stay small and the size budget is isolated — the same
 * arrangement as the whiteboard scene. A single `note` sync entity carries
 * this row. Images inside the document are referenced by `/api/images/<id>`
 * URLs in premium workspaces and embedded as data URLs in the free local
 * workspace (identical to whiteboard scenes).
 */
export const notes = sqliteTable("notes", {
  boardId: text("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  document: text("document").notNull().default("[]"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Metadata for images stored in Cloudflare R2 through the Premium API. Only
 * ids and processed dimensions/sizes live here; image bytes never enter
 * SQLite. Scenes reference these rows with `masar://<id>` markers. This table
 * is local bookkeeping for cleanup, so it has no sync triggers of its own.
 */
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("general"),
    contentType: text("content_type").notNull().default("image/webp"),
    byteSize: integer("byte_size").notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    thumbByteSize: integer("thumb_byte_size").notNull().default(0),
    thumbWidth: integer("thumb_width").notNull().default(0),
    thumbHeight: integer("thumb_height").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index("images_board_idx").on(table.boardId)],
);

/**
 * Local copy of whiteboard image bytes, keyed by the Excalidraw file id.
 *
 * Bytes are retained here the moment an image enters a canvas so the image
 * survives navigation (and restarts) before its R2 upload has completed, and
 * so it can still be displayed when the remote copy is temporarily
 * unreachable. `remote_image_id` is filled in after a successful upload and
 * doubles as an upload ledger: saves remap an already-uploaded file to its
 * reference instead of uploading the bytes again. Rows are removed only once
 * the renderer has confirmed the remote image is available and displayed, or
 * when the file leaves the scene. This table is local-only and has no sync
 * triggers of its own.
 */
export const imageCache = sqliteTable(
  "image_cache",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    remoteImageId: text("remote_image_id"),
    contentType: text("content_type").notNull().default("image/png"),
    byteSize: integer("byte_size").notNull().default(0),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.fileId] }),
    index("image_cache_board_idx").on(table.boardId),
  ],
);

/**
 * Local-only synchronisation bookkeeping. The remote API never reads these
 * tables; they record the outbox and cursor needed to resume after an
 * interrupted connection.
 */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  remoteUserId: text("remote_user_id"),
  lastRevision: integer("last_revision").notNull().default(0),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  bootstrapped: integer("bootstrapped", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Suppresses change triggers while remote changes are being applied. */
  applying: integer("applying", { mode: "boolean" }).notNull().default(false),
});

export const syncChanges = sqliteTable(
  "sync_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    data: text("data").notNull().default("{}"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("sync_changes_entity_idx").on(table.entityType, table.entityId),
  ],
);

/**
 * The server revision of the last state each entity was seen at — recorded
 * when a pulled change is applied. A push states this as its `baseRevision` so
 * the server can prove the edit was sequential (`base === existing.revision`)
 * rather than concurrent, without ever comparing client clocks. Rows only
 * exist for entities that have round-tripped through the cloud; a brand-new
 * local entity has no row and pushes with a null base (which the server treats
 * as a creation). Local-only workspaces never populate this table.
 */
export const syncEntityRevisions = sqliteTable(
  "sync_entity_revisions",
  {
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityType, table.entityId] })],
);

/**
 * A rejected push whose local and cloud snapshots are waiting for the user to
 * choose which version to keep. The row lives locally so conflicts remain
 * visible offline and pull can leave the entity untouched until resolution.
 */
export const syncConflicts = sqliteTable(
  "sync_conflicts",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    localData: text("local_data").notNull().default("{}"),
    localDeleted: integer("local_deleted", { mode: "boolean" })
      .notNull()
      .default(false),
    localUpdatedAt: integer("local_updated_at", { mode: "timestamp_ms" })
      .notNull(),
    cloudData: text("cloud_data").notNull().default("{}"),
    cloudDeleted: integer("cloud_deleted", { mode: "boolean" })
      .notNull()
      .default(false),
    cloudUpdatedAt: integer("cloud_updated_at", { mode: "timestamp_ms" })
      .notNull(),
    winningRevision: integer("winning_revision").notNull(),
    projectId: text("project_id"),
    projectName: text("project_name"),
    boardId: text("board_id"),
    boardName: text("board_name"),
    entityLabel: text("entity_label"),
    createdAt: createdAt(),
  },
  (table) => [
    index("sync_conflicts_entity_idx").on(table.entityType, table.entityId),
  ],
);

/**
 * Billing tables from the retired hosted application. They are retained in the
 * schema so existing SQLite files are untouched, but desktop code no longer
 * reads or writes them. Premium subscription state now lives only in the API.
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
export type ProjectRow = typeof projects.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type ColumnRow = typeof columns.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type WhiteboardRow = typeof whiteboards.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type ImageRow = typeof images.$inferSelect;
export type ImageCacheRow = typeof imageCache.$inferSelect;
export type BillingCustomerRow = typeof billingCustomers.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PendingSignupRow = typeof pendingSignups.$inferSelect;
export type StripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
export type SyncChangeRow = typeof syncChanges.$inferSelect;
export type SyncEntityRevisionRow = typeof syncEntityRevisions.$inferSelect;
export type SyncConflictRow = typeof syncConflicts.$inferSelect;
