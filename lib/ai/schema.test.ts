import { describe, expect, test } from "bun:test";

import { architecturalConcurrenceSchema } from "@/lib/ai/schema";

describe("architecturalConcurrenceSchema", () => {
  test("accepts a well-formed concurrence with a resize delta", () => {
    const result = architecturalConcurrenceSchema.safeParse({
      concurs: true,
      confidence: "high",
      citedConcerns: [{ evidenceIds: ["room:study"], topic: "daylight", whyItMatters: "The study has no exterior wall.", recommendation: "Swap it with the adjacent balcony room.", whatItSaves: "Avoids a poorly lit work room." }],
      requirementDeltas: [{ op: "resize_room", roomId: "kitchen", resizeDirection: "increase", summary: "Kitchen is tight for a family of 5." }],
    });

    expect(result.success).toBe(true);
  });

  test("rejects a delta that tries to carry a raw area value", () => {
    const result = architecturalConcurrenceSchema.safeParse({
      concurs: false,
      confidence: "medium",
      citedConcerns: [],
      requirementDeltas: [{ op: "resize_room", roomId: "kitchen", resizeDirection: "increase", targetAreaMm2: 12_000_000, summary: "bigger" }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect((result.data.requirementDeltas[0] as Record<string, unknown>).targetAreaMm2).toBeUndefined();
  });

  test("enforces fields for each delta operation", () => {
    const missingResizeDirection = architecturalConcurrenceSchema.safeParse({
      concurs: true,
      confidence: "medium",
      citedConcerns: [],
      requirementDeltas: [{ op: "resize_room", roomId: "kitchen", summary: "bigger" }],
    });
    const missingNewRoom = architecturalConcurrenceSchema.safeParse({
      concurs: true,
      confidence: "medium",
      citedConcerns: [],
      requirementDeltas: [{ op: "add_room", summary: "add a study" }],
    });
    const missingRoomId = architecturalConcurrenceSchema.safeParse({
      concurs: true,
      confidence: "medium",
      citedConcerns: [],
      requirementDeltas: [{ op: "remove_room", summary: "remove the study" }],
    });

    expect(missingResizeDirection.success).toBe(false);
    expect(missingNewRoom.success).toBe(false);
    expect(missingRoomId.success).toBe(false);
  });

  test("caps requirementDeltas at 6 and citedConcerns at 8", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ op: "remove_room" as const, roomId: `r${index}`, summary: "x" }));
    const result = architecturalConcurrenceSchema.safeParse({ concurs: true, confidence: "low", citedConcerns: [], requirementDeltas: many });

    expect(result.success).toBe(false);
  });
});
