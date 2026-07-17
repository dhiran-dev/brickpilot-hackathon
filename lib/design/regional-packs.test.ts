import { describe, expect, test } from "bun:test";

import { INDIAN_ADMIN_AREAS, REGIONAL_PACKS, regionalIntakePrefill, resolveRegionalPack } from "@/lib/design/regional-packs";

describe("regional taste packs", () => {
  test("defines one complete pack for each v1 climate class", () => {
    expect(Object.keys(REGIONAL_PACKS).sort()).toEqual(["cold_continental", "hot_dry", "hot_humid", "mediterranean", "temperate"]);
    for (const pack of Object.values(REGIONAL_PACKS)) {
      expect(pack.notes.length).toBeGreaterThan(0);
      expect(pack.materialPalette.exteriorWalls.length).toBeGreaterThan(0);
      expect(pack.materialPalette.direction.length).toBeGreaterThan(0);
    }
    expect(REGIONAL_PACKS.hot_dry.defaultStyle).toBe("regional_vernacular");
    expect(REGIONAL_PACKS.mediterranean.defaultStyle).toBe("modern_luxury");
  });

  test("uses enumerated, case-insensitive Indian state names and abbreviations", () => {
    expect(INDIAN_ADMIN_AREAS.length).toBe(36);
    for (const alias of ["Kerala", "kerala", "KL", " kl "]) {
      expect(resolveRegionalPack("in", alias)).toMatchObject({
        climateClass: "hot_humid",
        confidence: "high",
        source: "admin_area",
        matchedAdminArea: "Kerala",
      });
    }
    expect(resolveRegionalPack("IN", "Delhi").climateClass).toBe("hot_dry");
    expect(resolveRegionalPack("IN", "HP").climateClass).toBe("cold_continental");
    expect(resolveRegionalPack("IN", "Unlisted region")).toMatchObject({ climateClass: "hot_dry", source: "country" });
  });

  test("returns a visible, JSON-serializable warning for an unknown country", () => {
    const resolution = resolveRegionalPack("ZZ", "Somewhere");
    expect(resolution).toMatchObject({ climateClass: "temperate", confidence: "low", source: "temperate_fallback" });
    expect(resolution.warning).toMatchObject({ code: "low_confidence_regional_defaults", severity: "warning" });
    expect(resolution.warning?.message).toContain("ZZ");
    expect(JSON.parse(JSON.stringify(resolution.warning))).toEqual(resolution.warning);
  });

  test("produces editable intake values using the persisted architecture vocabulary", () => {
    expect(regionalIntakePrefill("IN", "KL")).toEqual({
      architecturalStyle: "contemporary_tropical",
      formStrategy: "articulated_wings",
      roofCharacter: "mixed",
      materialDirection: "warm_natural",
      includeCourtyard: true,
    });
    expect(regionalIntakePrefill("CA", "Ontario")).toMatchObject({ formStrategy: "compact", roofCharacter: "sloped", includeCourtyard: false });
  });
});
