import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "judge"]);
export const projectStatus = pgEnum("project_status", ["draft", "generating", "ready", "failed", "archived"]);
export const designStatus = pgEnum("design_status", [
  "queued",
  "planning",
  "validating",
  "rendering",
  "completed",
  "failed",
]);
export const generationKind = pgEnum("generation_kind", ["design", "render"]);
export const generationStatus = pgEnum("generation_status", ["queued", "processing", "completed", "failed", "canceled"]);
export const generationProvider = pgEnum("generation_provider", ["brickpilot", "fireworks", "replicate"]);
export const assetKind = pgEnum("asset_kind", ["floor_plan", "render", "report", "source"]);
export const webhookProvider = pgEnum("webhook_provider", ["replicate"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("judge"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
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
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    unique("accounts_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("projects_owner_id_idx").on(table.ownerId)],
);

export const projectRequirements = pgTable(
  "project_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull(),
    source: text("source").notNull().default("prompt"),
    editPrompt: text("edit_prompt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("project_requirements_project_version_unique").on(table.projectId, table.version),
    index("project_requirements_project_id_idx").on(table.projectId),
  ],
);

export const layoutVersions = pgTable(
  "layout_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requirementVersionId: uuid("requirement_version_id")
      .notNull()
      .references(() => projectRequirements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    prompt: text("prompt").notNull(),
    status: designStatus("status").notNull().default("queued"),
    intent: jsonb("intent").$type<Record<string, unknown>>(),
    layoutJson: jsonb("layout_json").$type<Record<string, unknown>>(),
    validation: jsonb("validation").$type<Record<string, unknown>>(),
    costEstimate: jsonb("cost_estimate").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("layout_versions_project_version_unique").on(table.projectId, table.version),
    index("layout_versions_project_id_idx").on(table.projectId),
    index("layout_versions_requirement_version_id_idx").on(table.requirementVersionId),
    index("layout_versions_status_idx").on(table.status),
  ],
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layoutVersionId: uuid("layout_version_id")
      .notNull()
      .references(() => layoutVersions.id, { onDelete: "cascade" }),
    kind: generationKind("kind").notNull(),
    provider: generationProvider("provider").notNull(),
    providerJobId: text("provider_job_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: generationStatus("status").notNull().default("queued"),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("generation_jobs_layout_version_id_idx").on(table.layoutVersionId),
    index("generation_jobs_provider_job_id_idx").on(table.provider, table.providerJobId),
    index("generation_jobs_status_idx").on(table.status),
  ],
);

export const generatedAssets = pgTable(
  "generated_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    layoutVersionId: uuid("layout_version_id")
      .notNull()
      .references(() => layoutVersions.id, { onDelete: "cascade" }),
    type: assetKind("type").notNull(),
    provider: generationProvider("provider").notNull(),
    status: generationStatus("status").notNull().default("queued"),
    providerJobId: text("provider_job_id"),
    storageKey: text("storage_key").notNull().unique(),
    url: text("url").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("generated_assets_project_id_idx").on(table.projectId),
    index("generated_assets_layout_version_id_idx").on(table.layoutVersionId),
    index("generated_assets_status_idx").on(table.status),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: webhookProvider("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("webhook_events_provider_event_id_unique").on(table.provider, table.providerEventId),
    index("webhook_events_unprocessed_idx").on(table.processedAt),
  ],
);
