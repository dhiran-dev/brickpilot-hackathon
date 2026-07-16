import { z } from "zod";

import { privacySchema, roomTypeSchema } from "@/lib/building/requirements";

const floorIdSchema = z.string().regex(/^F[0-3]$/);
const roomIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const citedConcernSchema = z
  .object({
    ruleId: z.string().optional(),
    floorId: floorIdSchema.optional(),
    objectIds: z.array(z.string()).max(6).default([]),
    evidenceIds: z.array(z.string()).min(1).max(6),
    topic: z.enum(["circulation", "adjacency", "daylight", "orientation", "opening", "vertical_stacking", "structural_coordination", "other"]),
    whyItMatters: z.string().min(1).max(400),
    recommendation: z.string().min(1).max(400),
    whatItSaves: z.string().min(1).max(300),
  })
  .strip();

const baseRequirementDeltaSchema = z
  .object({
    summary: z.string().min(1).max(200),
  })
  .strip();

const addRoomRequirementDeltaSchema = baseRequirementDeltaSchema.extend({
  op: z.literal("add_room"),
  newRoom: z
    .object({
      id: roomIdSchema,
      name: z.string().trim().min(1).max(80),
      type: roomTypeSchema,
      floorId: floorIdSchema,
      privacy: privacySchema.default("semi_private"),
    })
    .strip(),
});

const resizeRoomRequirementDeltaSchema = baseRequirementDeltaSchema.extend({
  op: z.literal("resize_room"),
  roomId: roomIdSchema,
  resizeDirection: z.enum(["increase", "decrease"]),
});

const removeRoomRequirementDeltaSchema = baseRequirementDeltaSchema.extend({
  op: z.literal("remove_room"),
  roomId: roomIdSchema,
});

export const requirementDeltaSchema = z.discriminatedUnion("op", [
  addRoomRequirementDeltaSchema,
  resizeRoomRequirementDeltaSchema,
  removeRoomRequirementDeltaSchema,
]);

export const architecturalConcurrenceSchema = z
  .object({
    concurs: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]),
    citedConcerns: z.array(citedConcernSchema).max(8).default([]),
    requirementDeltas: z.array(requirementDeltaSchema).max(6).default([]),
  })
  .strip();

export type CitedConcern = z.infer<typeof citedConcernSchema>;
export type RequirementDelta = z.infer<typeof requirementDeltaSchema>;
export type ArchitecturalConcurrence = z.infer<typeof architecturalConcurrenceSchema>;

export const architecturalReviewResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reviewed"), review: architecturalConcurrenceSchema }),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_configured", "timeout", "http_error", "invalid_output"]) }),
]);

export type ArchitecturalReviewResult = z.infer<typeof architecturalReviewResultSchema>;
