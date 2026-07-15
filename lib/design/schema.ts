import { z } from "zod";

const positiveNumber = z.number().finite().positive();

export const generateDesignInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  prompt: z.string().trim().min(20).max(2_000),
});

export const generatedDesignSchema = z.object({
  intent: z.object({
    style: z.string().min(1).max(120),
    site: z.object({
      widthM: positiveNumber.max(500),
      depthM: positiveNumber.max(500),
    }),
    assumptions: z.array(z.string().min(1).max(240)).max(12),
  }),
  floorPlan: z.object({
    totalAreaSqM: positiveNumber.max(100_000),
    rooms: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          name: z.string().min(1).max(80),
          type: z.string().min(1).max(50),
          widthM: positiveNumber.max(100),
          depthM: positiveNumber.max(100),
          areaSqM: positiveNumber.max(10_000),
          xM: z.number().finite().min(0).max(500),
          yM: z.number().finite().min(0).max(500),
        }),
      )
      .min(1)
      .max(30),
    notes: z.array(z.string().min(1).max(240)).max(12),
  }),
  validation: z.object({
    status: z.enum(["pass", "warning", "fail"]),
    score: z.number().int().min(0).max(100),
    checks: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          status: z.enum(["pass", "warning", "fail"]),
          detail: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(20),
  }),
  costEstimate: z.object({
    currency: z.literal("INR"),
    low: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    assumptions: z.array(z.string().min(1).max(240)).max(12),
  }),
});

export type GeneratedDesign = z.infer<typeof generatedDesignSchema>;
