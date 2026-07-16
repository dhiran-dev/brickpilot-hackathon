import { describe, expect, test } from "bun:test";

import { AiProviderError } from "@/lib/ai/client";
import { parseNaturalLanguageIntake } from "@/lib/ai/intake";

describe("parseNaturalLanguageIntake", () => {
  test("maps a one-storey sentence into valid requirements without accepting a seed", async () => {
    const result = await parseNaturalLanguageIntake("3BHK east-facing home for four on a 30x50 plot", {
      complete: async () => ({
        siteWidthFeet: 30,
        siteDepthFeet: 50,
        facing: "east",
        floorCount: 1,
        occupants: 4,
        bedroomsGroundFloor: 3,
        bathroomsGroundFloor: 2,
        countryCode: "IN",
        currency: "INR",
      }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.site.facing).toBe("east");
    expect(result.requirements.household.occupants).toBe(4);
    expect(result.requirements.rooms.filter((room) => room.type === "bedroom")).toHaveLength(3);
    expect(result.requirements.rooms.some((room) => ["parking", "pooja", "utility", "courtyard", "study"].includes(room.type))).toBe(false);
    expect(result.requirements.rooms.some((room) => room.type === "dining")).toBe(false);
    expect(result.requirements.rooms.find((room) => room.id === "living")?.name).toBe("Living / dining hall");
    expect(result.requirements.seed).toBe(42);
  });

  test("extracts selected storeys, per-floor rooms, road edges, height and stair width", async () => {
    const result = await parseNaturalLanguageIntake("A G+1 corner home with two bedrooms downstairs and one upstairs", {
      complete: async () => ({
        floorCount: 2,
        roadEdges: ["east", "south"],
        floorHeightMetres: 3.3,
        stairWidthMm: 1100,
        floorPrograms: [
          { level: 0, bedrooms: 2, bathrooms: 2, attachedBathrooms: 1 },
          { level: 1, bedrooms: 1, bathrooms: 1, attachedBathrooms: 1, balcony: true },
        ],
      }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.floors).toHaveLength(2);
    expect(result.requirements.floors.every((floor) => floor.floorHeightMm === 3300)).toBe(true);
    expect(result.requirements.vertical.stairWidthMm).toBe(1100);
    expect(result.requirements.site.roadEdges).toEqual(["east", "south"]);
    expect(result.requirements.rooms.filter((room) => room.type === "bedroom" && room.floorId === "F0")).toHaveLength(2);
    expect(result.requirements.rooms.filter((room) => room.type === "bedroom" && room.floorId === "F1")).toHaveLength(1);
  });

  test("extracts bounded architectural taste without allowing geometry", async () => {
    const result = await parseNaturalLanguageIntake("A stepped Kerala contemporary home with earthy materials and a mixed roof", {
      complete: async () => ({
        bedroomsGroundFloor: 2,
        architecturalStyle: "kerala_contemporary",
        formStrategy: "stepped_terraces",
        roofCharacter: "mixed",
        materialDirection: "earthy_textured",
      }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.architecture).toEqual({
      style: "kerala_contemporary",
      formStrategy: "stepped_terraces",
      roofCharacter: "mixed",
      materialDirection: "earthy_textured",
    });
    expect(result.assumptions.some((assumption) => assumption.startsWith("Assumed a climate-responsive"))).toBe(false);
  });

  test("infers storey count from an upper-floor allocation", async () => {
    const result = await parseNaturalLanguageIntake("Bedrooms on the ground and first floor", {
      complete: async () => ({ floorPrograms: [{ level: 0, bedrooms: 1 }, { level: 1, bedrooms: 2 }] }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.floors).toHaveLength(2);
    expect(result.assumptions).toContain("Inferred the storey count from the highest floor allocation mentioned.");
    expect(result.assumptions).toContain("Assumed a 1000 mm residential stair width.");
    expect(result.assumptions).not.toContain("Assumed a single ground floor; mention a storey count to change it.");
  });

  test("does not accept bathroom counts that were not stated in the sentence", async () => {
    const result = await parseNaturalLanguageIntake("3BHK home for a family", {
      complete: async () => ({ floorPrograms: [{ level: 0, bedrooms: 3, bathrooms: 3, attachedBathrooms: 3 }] }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.rooms.filter((room) => room.type === "bathroom")).toHaveLength(1);
    expect(result.assumptions).toContain("Assumed one shared ground-floor bathroom because none was stated.");
  });

  test("keeps partial country extraction internally consistent", async () => {
    const result = await parseNaturalLanguageIntake("A small home in the US", {
      complete: async () => ({ countryCode: "US", adminArea: "Kerala", locality: "Kochi", currency: "INR", bedroomsGroundFloor: 2 }),
    });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.requirements.region).toMatchObject({ countryCode: "US", adminArea: "Other US state", locality: "General locality", locale: "en-US", currency: "USD" });
    expect(result.assumptions).toContain("Normalized currency to USD to match the selected country.");
  });

  test("re-asks once with the schema error, then succeeds", async () => {
    let call = 0;
    const result = await parseNaturalLanguageIntake("a small two-bedroom house", {
      complete: async () => {
        call += 1;
        return call === 1 ? { siteWidthFeet: "not-a-number" } : { siteWidthFeet: 20, siteDepthFeet: 30, bedroomsGroundFloor: 2 };
      },
    });
    expect(call).toBe(2);
    expect(result.status).toBe("parsed");
  });

  test("rejects forbidden seed and geometry fields after exhausting re-asks", async () => {
    const result = await parseNaturalLanguageIntake("gibberish", { complete: async () => ({ seed: 7, xMm: 100 }) });
    expect(result).toMatchObject({ status: "failed", reason: "could_not_extract" });
  });

  test("rejects an empty extraction after exhausting re-asks", async () => {
    let calls = 0;
    const result = await parseNaturalLanguageIntake("gibberish", { complete: async () => { calls += 1; return {}; } });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: "failed", reason: "could_not_extract" });
    if (result.status === "failed") expect(result.message).toBe("Could not extract enough concrete home requirements. Try a clearer sentence or choose a tuned example.");
  });

  test("returns provider_unavailable when the client throws", async () => {
    const result = await parseNaturalLanguageIntake("3BHK home", {
      complete: async () => { throw new AiProviderError("timeout", "timed out"); },
    });
    expect(result).toMatchObject({ status: "failed", reason: "provider_unavailable" });
  });
});
