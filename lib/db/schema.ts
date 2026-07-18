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
export const projectStatus = pgEnum("project_status", ["draft", "generating", "ready", "failed", "archived", "deleting"]);
export const projectCapabilityProfile = pgEnum("project_capability_profile", ["legacy_view_only", "current_v2", "current_v3"]);
export const designStatus = pgEnum("design_status", [
  "queued",
  "planning",
  "validating",
  "rendering",
  "completed",
  "failed",
]);
export const generationKind = pgEnum("generation_kind", ["design", "render"]);
export const generationStatus = pgEnum("generation_status", ["queued", "processing", "finalizing", "completed", "failed", "canceled"]);
export const generationProvider = pgEnum("generation_provider", ["brickpilot", "fireworks", "replicate"]);
export const renderDispatchState = pgEnum("render_dispatch_state", [
  "reserved",
  "claimed",
  "provider_pending",
  "attached",
  "expired_before_attempt",
  "failed",
]);
export const projectDeletionState = pgEnum("project_deletion_state", [
  "pending",
  "quiescing",
  "deleting_assets",
  "deleting_database",
  "failed",
  "completed",
]);
export const assetKind = pgEnum("asset_kind", ["floor_plan", "render", "report", "source"]);
export const assetRole = pgEnum("asset_role", [
  "legacy",
  "plan_reference",
  "massing_front",
  "massing_rear",
  "massing_iso",
  "massing_collage",
  "massing_top",
  "exterior",
  "exterior_front",
  "exterior_collage",
  "exterior_top",
  "interior",
]);
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
    capabilityProfile: projectCapabilityProfile("capability_profile").notNull().default("current_v3"),
    generatorContractVersion: integer("generator_contract_version").notNull().default(3),
    rolloutEpoch: text("rollout_epoch").notNull().default("v3-ga"),
    clientRequestId: text("client_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_owner_id_idx").on(table.ownerId),
    unique("projects_owner_client_request_unique").on(table.ownerId, table.clientRequestId),
  ],
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
    aiReview: jsonb("ai_review").$type<Record<string, unknown>>(),
    // Additive multi-scheme payload. The canonical fields above always mirror the selected
    // scheme so existing drawing, massing, cost and render consumers remain unchanged.
    schemes: jsonb("schemes").$type<Array<Record<string, unknown>>>(),
    selectedSchemeId: text("selected_scheme_id"),
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
    dispatchToken: text("dispatch_token"),
    dispatchState: renderDispatchState("dispatch_state"),
    dispatchLeaseToken: text("dispatch_lease_token"),
    dispatchLeaseAcquiredAt: timestamp("dispatch_lease_acquired_at", { withTimezone: true }),
    dispatchAttemptedAt: timestamp("dispatch_attempted_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: generationStatus("status").notNull().default("queued"),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finalizingStartedAt: timestamp("finalizing_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("generation_jobs_layout_version_id_idx").on(table.layoutVersionId),
    index("generation_jobs_provider_job_id_idx").on(table.provider, table.providerJobId),
    unique("generation_jobs_dispatch_token_unique").on(table.dispatchToken),
    index("generation_jobs_status_idx").on(table.status),
  ],
);

export const projectDeletionJobs = pgTable(
  "project_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    originalProjectId: uuid("original_project_id").notNull(),
    ownerId: text("owner_id").notNull(),
    confirmationDigest: text("confirmation_digest").notNull(),
    state: projectDeletionState("state").notNull().default("pending"),
    manifestKeys: jsonb("manifest_keys").$type<string[]>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseAcquiredAt: timestamp("lease_acquired_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("project_deletion_jobs_original_project_unique").on(table.originalProjectId),
    index("project_deletion_jobs_owner_id_idx").on(table.ownerId),
    index("project_deletion_jobs_state_idx").on(table.state),
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
    role: assetRole("role").notNull().default("legacy"),
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

export const renderEvalSamples = pgTable(
  "render_eval_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    layoutVersionId: uuid("layout_version_id").notNull().references(() => layoutVersions.id, { onDelete: "cascade" }),
    generationJobId: uuid("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "cascade" }),
    sampleIndex: integer("sample_index").notNull(),
    providerJobId: text("provider_job_id").notNull(),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    prompt: text("prompt").notNull(),
    inputReferences: jsonb("input_references").$type<Array<Record<string, unknown>>>().notNull(),
    semanticCamera: jsonb("semantic_camera").$type<Record<string, unknown>>().notNull(),
    geometryHash: text("geometry_hash").notNull(),
    output: jsonb("output").$type<Record<string, unknown>>().notNull(),
    evaluator: jsonb("evaluator").$type<Record<string, unknown>>(),
    rubricVersion: text("rubric_version").notNull(),
    structural: jsonb("structural").$type<Record<string, boolean>>(),
    aesthetic: jsonb("aesthetic").$type<Record<string, boolean>>(),
    structuralPass: boolean("structural_pass"),
    aestheticPass: boolean("aesthetic_pass"),
    humanDisposition: jsonb("human_disposition").$type<Record<string, unknown>>(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("render_eval_samples_generation_job_unique").on(table.generationJobId),
    unique("render_eval_samples_layout_geometry_index_unique").on(table.layoutVersionId, table.geometryHash, table.sampleIndex),
    index("render_eval_samples_project_id_idx").on(table.projectId),
    index("render_eval_samples_layout_version_id_idx").on(table.layoutVersionId),
  ],
);

export const renderEvalAggregates = pgTable(
  "render_eval_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    layoutVersionId: uuid("layout_version_id").notNull().references(() => layoutVersions.id, { onDelete: "cascade" }),
    geometryHash: text("geometry_hash").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    aggregate: jsonb("aggregate").$type<Record<string, unknown>>().notNull(),
    releaseGatePassed: boolean("release_gate_passed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("render_eval_aggregates_layout_geometry_unique").on(table.layoutVersionId, table.geometryHash),
    index("render_eval_aggregates_project_id_idx").on(table.projectId),
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
