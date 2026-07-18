import type { CurrentBuildingRequirements } from "@/lib/building/requirements";
import type { CurrentBuilding } from "@/lib/building/schema";
import { orthogonalPolygonBounds } from "@/lib/building/orthogonal-partition";
import { buildSemanticRenderCameras, type SemanticRenderCamera, type SemanticRenderView } from "@/lib/render/camera";
import type { RenderPurpose, RenderSourceRole } from "@/lib/render/prompts";

export const CURRENT_RENDER_CONTRACT_VERSION = 3 as const;
export const CURRENT_PROMPT_VERSION = "architectural-edit-v3.0.0" as const;

export type CurrentGeometryLock = {
  geometryHash: string;
  openingSignatures: string[];
  floorRegionSignatures: string[];
  roofSignatures: string[];
  supportSignatures: string[];
  guardSignatures: string[];
  pergolaSignatures: string[];
};

export type CurrentRenderSpec = {
  purpose: RenderPurpose;
  sourceRole: RenderSourceRole;
  requestedOutputCount: 1;
  promptVersion: typeof CURRENT_PROMPT_VERSION;
  prompt: string;
  semanticView?: SemanticRenderView;
  semanticCamera?: SemanticRenderCamera;
  geometryLock: CurrentGeometryLock;
  releaseEvalTarget?: "gpt_image_2_designer_elevation";
};

function currentMaterialSchedule(requirements: CurrentBuildingRequirements) {
  const direction = {
    warm_natural: "warm mineral plaster, honed local stone, restrained timber screens, bronze-grey metal and clear low-reflectance glazing",
    light_mineral: "pale mineral plaster, fine light stone, champagne-grey metal, natural timber and clear low-reflectance glazing",
    earthy_textured: "earth-toned lime plaster, precise laterite or textured-brick accents, honed local stone, dark timber and bronze metal",
    monochrome: "refined mineral-concrete tones, charcoal metal, clear low-reflectance glazing and sparse warm timber",
  }[requirements.architecture.materialDirection];
  return `${direction}; premium junctions, slim shadow gaps and durable climate-appropriate detailing`;
}

export function compileCurrentGeometryLock(building: CurrentBuilding): CurrentGeometryLock {
  const openings = building.floors.flatMap((floor) => floor.openings.map((opening) =>
    `${opening.id}:${opening.role}:${floor.id}:${opening.wallId}:${opening.offsetMm}:${opening.widthMm}:${opening.heightMm}:${opening.materialToken}`));
  const regions = building.floors.flatMap((floor) => floor.regions.map((region) =>
    `${floor.id}:${region.id}:${region.kind}:${region.spaceId ?? "none"}:${region.polygon.points.map((point) => `${point.x},${point.y}`).join("|")}`));
  const roofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola").map((roof) =>
    `${roof.id}:${roof.kind}:${roof.planes.length}:${roof.planes.map((plane) => plane.vertices.map((point) => `${point.x},${point.y},${point.z}`).join("|")).join("/")}`);
  const supports = building.secondaryRoofSupports.map((support) =>
    `${support.id}:${support.role}:${support.floorId}:${support.roofSystemIds.join("+")}`);
  const guards = building.edgeProtections.map((guard) =>
    `${guard.id}:${guard.kind}:${guard.floorId}:${guard.heightMm}:${guard.edge.start.x},${guard.edge.start.y}-${guard.edge.end.x},${guard.edge.end.y}`);
  const pergolas = building.roofSystems.filter((roof) => roof.kind === "open_pergola").map((roof) =>
    `${roof.id}:open_pergola:${roof.frameMembers.length}:${roof.slatMembers.length}:${roof.slatSpacingMm}:${roof.openAreaRatio.toFixed(3)}`);
  return {
    geometryHash: building.candidate.geometryHash,
    openingSignatures: openings.sort(),
    floorRegionSignatures: regions.sort(),
    roofSignatures: roofs.sort(),
    supportSignatures: supports.sort(),
    guardSignatures: guards.sort(),
    pergolaSignatures: pergolas.sort(),
  };
}

function conciseFacts(building: CurrentBuilding, lock: CurrentGeometryLock) {
  const primary = building.facadeZones.find((zone) => zone.role === "primary_road_elevation" && zone.containsMainEntry)!;
  const main = building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry")!;
  const roofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola");
  const pergolas = building.roofSystems.filter((roof) => roof.kind === "open_pergola");
  return [
    `canonical geometry hash ${lock.geometryHash}`,
    `primary road facade ${primary.side} with canonical wall IDs ${primary.exteriorWallIds.join(", ")}`,
    `main entry ${main.id} on wall ${main.wallId}, ${main.widthMm} mm clear, material token ${main.materialToken}`,
    `enclosure/canopy roofs ${roofs.map((roof) => `${roof.id}=${roof.kind}/${roof.planes.length} plane(s)`).join(", ") || "none"}`,
    `secondary roof supports ${building.secondaryRoofSupports.map((support) => `${support.id}=${support.role}`).join(", ") || "none required"}`,
    `edge protections ${building.edgeProtections.map((guard) => `${guard.id}=${guard.kind}/${guard.heightMm}mm`).join(", ") || "none required at this geometry"}`,
    `open pergolas ${pergolas.map((roof) => `${roof.id}=${roof.slatMembers.length} slats/open ratio ${roof.openAreaRatio.toFixed(2)}`).join(", ") || "none requested"}`,
  ].join("; ");
}

function geometryLockInstructions(lock: CurrentGeometryLock) {
  return `GEOMETRY IS IMMUTABLE. Preserve geometry hash ${lock.geometryHash}: exact footprint and floor-region partition; ${lock.openingSignatures.length} canonical openings; ${lock.roofSignatures.length} enclosure/canopy roof systems; ${lock.supportSignatures.length} secondary supports; ${lock.guardSignatures.length} guard systems; ${lock.pergolaSignatures.length} open pergola systems. Do not add, remove, move, resize, mirror, rotate or restyle any opening as a different opening role. Do not flatten or redesign a pitched roof. Do not remove or invent a column, post, ledger, guard, slab, balcony, verandah, canopy or pergola member. An open pergola must remain visibly open and slatted, never a solid plane. Materials may change only surface appearance; they may not change silhouette, thickness, projection, footprint, roof pitch, support position or guard geometry.`;
}

function exteriorPrompt(input: {
  building: CurrentBuilding;
  requirements: CurrentBuildingRequirements;
  camera: SemanticRenderCamera;
  lock: CurrentGeometryLock;
  sourceLabel: string;
  purposeText: string;
  primaryDesignerElevation?: boolean;
  collage?: boolean;
}) {
  const primary = input.building.facadeZones.find((zone) => zone.role === "primary_road_elevation" && zone.containsMainEntry)!;
  const secondaryTokens = input.building.facadeZones.filter((zone) => zone.role !== "primary_road_elevation")
    .flatMap((zone) => zone.allowedMaterialArticulation);
  const compositionLock = input.collage
    ? "Preserve the exact 2-by-2 panel grid, the fitted camera and crop inside every panel, and the relationship between all four views. Keep one consistent material schedule across every panel. Retain small clean panel captions, but remove all SOURCE annotations, clay edge lines and the site grid. Do not collapse the board into one view and do not reproduce a floor plan."
    : "Preserve the fitted source camera direction, crop, focal length, horizon and pixel-space composition. Remove only source annotations, clay edge lines and the site grid.";
  return `EDIT THE SUPPLIED CANONICAL MASSING SOURCE "${input.sourceLabel}". The fitted source composition and semantic camera direction are authoritative; do not invent another camera or reinterpret the house.

SEMANTIC CAMERA
View ${input.camera.view}; facade side ${input.camera.facadeSide}; canonical camera position mm (${input.camera.positionMm.x}, ${input.camera.positionMm.y}, ${input.camera.positionMm.z}); canonical target mm (${input.camera.targetMm.x}, ${input.camera.targetMm.y}, ${input.camera.targetMm.z}); target wall IDs ${input.camera.targetWallIds.join(", ")}; target opening ${input.camera.targetOpeningId ?? "none"}; geometry hash ${input.camera.geometryHash}. ${input.camera.mainEntryMustBeVisible ? "The complete main entry must remain plainly visible, unobstructed and visually distinct in the final frame." : "Retain the supplied contextual composition."} ${input.primaryDesignerElevation ? "This is GPT IMAGE 2, the primary designer-elevation deliverable: the road-facing entrance facade is the visual subject." : "Use this as a supporting context view."}

CANONICAL PHYSICAL FACTS
${conciseFacts(input.building, input.lock)}.

PRESERVATION CONTRACT
${geometryLockInstructions(input.lock)} ${compositionLock}

MATERIAL-ONLY DESIGNER ELEVATION
Apply a sophisticated, buildable ${input.requirements.architecture.style.replaceAll("_", " ")} finish schedule: ${currentMaterialSchedule(input.requirements)}. Concentrate premium articulation on the canonical ${primary.side} primary road facade only, using its allowed tokens: ${primary.allowedMaterialArticulation.join(", ")}. Keep secondary facades quieter and subordinate using only restrained base finishes${secondaryTokens.length ? ` (${[...new Set(secondaryTokens)].join(", ")})` : ""}. Make the ${input.building.floors.flatMap((floor) => floor.openings).find((opening) => opening.role === "main_entry")!.materialToken} main door warmer and more prominent than interior/service doors without changing its dimensions.

OUTPUT
${input.purposeText} Photorealistic premium architectural visualization, landscape 3:2, natural perspective, physically believable daylight and construction. No people, cars, pools, added landscaping that obscures the entry, text, logos or watermarks.`;
}

export function buildCurrentRenderSpecs(input: {
  building: CurrentBuilding;
  requirements: CurrentBuildingRequirements;
  selectedInteriorSpaceId: string;
}): CurrentRenderSpec[] {
  const lock = compileCurrentGeometryLock(input.building);
  const cameras = buildSemanticRenderCameras(input.building);
  const selected = input.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === input.selectedInteriorSpaceId);
  if (!selected) throw new Error("INTERIOR_SPACE_NOT_FOUND");
  const floor = input.building.floors.find((candidate) => candidate.id === selected.floorId)!;
  const region = floor.regions.find((candidate) => candidate.id === selected.regionId)!;
  const bounds = orthogonalPolygonBounds(region.polygon);
  const connectedOpenings = floor.openings.filter((opening) => opening.connects.includes(selected.id));
  const interiorPrompt = `CREATE ONE PHOTOREALISTIC INTERIOR FROM THE SUPPLIED PLAN-DERIVED SOURCE. Canonical geometry hash ${lock.geometryHash}. Selected room ${selected.name} (${selected.type}), ${bounds.width} × ${bounds.depth} mm, with exactly ${connectedOpenings.length} connected canonical openings (${connectedOpenings.map((opening) => opening.id).join(", ") || "none"}). ${geometryLockInstructions(lock)} Furnish only this room with correctly scaled furniture and clear circulation. Do not create false windows, move doors, merge rooms or reproduce plan graphics. Landscape 3:2, eye-level 24–28 mm architectural lens, no people, text, logos or watermarks.`;
  return [
    {
      purpose: "exterior_front", sourceRole: "massing_front", requestedOutputCount: 1,
      promptVersion: CURRENT_PROMPT_VERSION, semanticView: "primary_road_elevation", semanticCamera: cameras.primary_road_elevation,
      geometryLock: lock, releaseEvalTarget: "gpt_image_2_designer_elevation",
      prompt: exteriorPrompt({ building: input.building, requirements: input.requirements, camera: cameras.primary_road_elevation, lock, sourceLabel: "SOURCE A · PRIMARY ROAD / MAIN ENTRY · CAMERA LOCK", purposeText: "One complete road-side designer-elevation three-quarter view.", primaryDesignerElevation: true }),
    },
    {
      purpose: "exterior_collage", sourceRole: "massing_collage", requestedOutputCount: 1,
      promptVersion: CURRENT_PROMPT_VERSION, semanticView: "secondary_context", semanticCamera: cameras.secondary_context, geometryLock: lock,
      prompt: exteriorPrompt({ building: input.building, requirements: input.requirements, camera: cameras.secondary_context, lock, sourceLabel: "SOURCE B · COLLAGE · FOUR FITTED VIEWS", purposeText: "One polished 2-by-2 architectural presentation board matching all four supplied massing panels.", collage: true }),
    },
    {
      purpose: "exterior_top", sourceRole: "massing_top", requestedOutputCount: 1,
      promptVersion: CURRENT_PROMPT_VERSION, semanticView: "aerial", semanticCamera: cameras.aerial, geometryLock: lock,
      prompt: exteriorPrompt({ building: input.building, requirements: input.requirements, camera: cameras.aerial, lock, sourceLabel: "SOURCE C · AERIAL · CAMERA LOCK", purposeText: "One elevated architectural overview showing the canonical roof/support system." }),
    },
    { purpose: "interior", sourceRole: "plan_reference", requestedOutputCount: 1, promptVersion: CURRENT_PROMPT_VERSION, prompt: interiorPrompt, geometryLock: lock },
  ];
}

export function currentRenderSpecPreservesGeometry(spec: CurrentRenderSpec, building: CurrentBuilding) {
  const canonical = compileCurrentGeometryLock(building);
  return spec.geometryLock.geometryHash === canonical.geometryHash
    && JSON.stringify(spec.geometryLock) === JSON.stringify(canonical)
    && spec.prompt.includes(`geometry hash ${canonical.geometryHash}`);
}
