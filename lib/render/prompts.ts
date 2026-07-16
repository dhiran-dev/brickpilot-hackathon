import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { massingMetrics } from "@/lib/render/massing";

export const RENDER_CONTRACT_VERSION = 2;
export const RENDER_PURPOSES = ["exterior_front", "exterior_collage", "exterior_top", "interior"] as const;
export type RenderPurpose = (typeof RENDER_PURPOSES)[number];
export type RenderSourceRole = "massing_front" | "massing_collage" | "massing_top" | "plan_reference";

export type RenderSpec = {
  purpose: RenderPurpose;
  sourceRole: RenderSourceRole;
  requestedOutputCount: 1;
  prompt: string;
};

export function isRenderPurpose(value: unknown): value is RenderPurpose {
  return typeof value === "string" && (RENDER_PURPOSES as readonly string[]).includes(value);
}

function metres(valueMm: number) {
  return `${(valueMm / 1000).toFixed(2)} m`;
}

function buildingFacts(building: Building, requirements: BuildingRequirements) {
  const metrics = massingMetrics(building);
  const floorFacts = [...building.floors]
    .sort((left, right) => left.level - right.level)
    .map((floor) => `${floor.label}: footprint ${metres(floor.envelope.width)} × ${metres(floor.envelope.depth)}, floor-to-floor ${metres(floor.floorHeightMm)}, ${floor.openings.filter((opening) => opening.connects.includes("EXTERIOR")).length} exterior openings`)
    .join("; ");
  return `Canonical facts: exactly ${metrics.storeys} storey${metrics.storeys === 1 ? "" : "s"}; overall height ${metrics.heightM.toFixed(2)} m; site ${metres(building.site.widthMm)} × ${metres(building.site.depthMm)}; facing ${building.site.facing}; road edge(s) ${building.site.roadEdges.join(", ")}; location ${requirements.region.locality ?? requirements.region.adminArea}, ${requirements.region.countryCode}; architectural style ${requirements.architecture.style.replaceAll("_", " ")}; built-form strategy ${requirements.architecture.formStrategy.replaceAll("_", " ")}; roof character ${requirements.architecture.roofCharacter.replaceAll("_", " ")}; material direction ${requirements.architecture.materialDirection.replaceAll("_", " ")}; quality tier ${requirements.budget.qualityTier}. Floors: ${floorFacts}.`;
}

function materialSchedule(requirements: BuildingRequirements) {
  const schedules: Record<BuildingRequirements["architecture"]["materialDirection"], string> = {
    warm_natural: "warm mineral plaster, locally appropriate stone, durable timber-toned screens and warm-grey metal",
    light_mineral: "pale mineral plaster, light local stone, restrained natural timber and champagne-grey metal",
    earthy_textured: "earth-toned lime plaster, textured brick or laterite accents, local stone and dark timber",
    monochrome: "refined exposed-concrete tones, charcoal metal, clear glazing and sparse warm timber accents",
  };
  return schedules[requirements.architecture.materialDirection];
}

function exteriorEditPrompt(input: {
  building: Building;
  requirements: BuildingRequirements;
  sourceLabel: string;
  outputDirection: string;
  collage?: boolean;
}) {
  const locality = input.requirements.region.locality ?? input.requirements.region.adminArea;
  const compositionLock = input.collage
    ? "Preserve the exact 2-by-2 panel grid, the camera and crop inside every panel, and the relationship between all four views. Keep one consistent material schedule across every panel. Retain small clean panel captions, but remove all SOURCE and CAMERA LOCK annotations."
    : "Preserve the source camera position, focal length, crop, horizon and pixel-space composition exactly. Remove the SOURCE/CAMERA LOCK annotation, clay edge lines and site grid from the final photograph.";
  return `EDIT THE SUPPLIED ARCHITECTURAL SOURCE IMAGE. It is labeled \"${input.sourceLabel}\" and is the authoritative camera and geometry reference. Do not invent a new camera or reinterpret the building.

GEOMETRY AND CAMERA LOCK
${buildingFacts(input.building, input.requirements)}
Preserve the exact building silhouette, storey count, floor heights, stacked footprints, setbacks, projections, wall planes, stair/core alignment, roof and parapet outline, and every visible door and window aperture. Every opening is immutable in count, shape, size and position. Do not rotate, mirror, widen or narrow the house. Do not add or remove a floor, wing, balcony, canopy, entrance, major void, door or window. ${compositionLock}

MATERIAL-ONLY ARCHITECTURAL EDIT
Convert only the clay surfaces into a coherent, buildable ${input.requirements.architecture.style.replaceAll("_", " ")} residence suitable for ${locality}. Apply this locked shared schedule: ${materialSchedule(input.requirements)}. Respect the requested ${input.requirements.architecture.roofCharacter.replaceAll("_", " ")} roof character only where it already exists in the source silhouette. Use climate-suitable shade, realistic glazing, subtle shallow reveals, modest planting and warm architectural lighting. Materials are surface finishes: they must not alter usable floor area or the primary silhouette. Keep all construction thicknesses physically believable and keep the palette identical across the other views.

OUTPUT
${input.outputDirection} Photorealistic premium architectural visualization, landscape 3:2, realistic 28–35 mm architectural lens, natural perspective and physically believable lighting. No people, cars, pools, fantasy forms, extra glass, text, logos or watermarks.`;
}

export function buildRenderSpecs(input: {
  building: Building;
  requirements: BuildingRequirements;
  selectedInteriorSpaceId: string;
}): RenderSpec[] {
  const { building, requirements, selectedInteriorSpaceId } = input;
  const selected = building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === selectedInteriorSpaceId);
  if (!selected) throw new Error("INTERIOR_SPACE_NOT_FOUND");
  const selectedFloor = building.floors.find((floor) => floor.id === selected.floorId)!;
  const selectedOpenings = selectedFloor.openings.filter((opening) => opening.connects.includes(selected.id));
  const exteriorOpenings = selectedOpenings.filter((opening) => opening.connects.includes("EXTERIOR"));
  const locality = requirements.region.locality ?? requirements.region.adminArea;

  const interiorPrompt = `Create one photorealistic furnished interior photograph for the room highlighted in the supplied canonical plan source labeled \"SOURCE D · INTERIOR · PLAN-DERIVED CAMERA\".

PLAN AND ROOM LOCK
The supplied image is a plan-derived fallback, not a perspective photograph. Translate only the highlighted INTERIOR SOURCE room into one eye-level view; do not reproduce the plan board in the output. Selected room: ${selected.name} (${selected.type}) on ${selectedFloor.label}; canonical clear planning bounds ${metres(selected.bounds.width)} × ${metres(selected.bounds.depth)}; ${selectedOpenings.length} connected openings including ${exteriorOpenings.length} exterior opening${exteriorOpenings.length === 1 ? "" : "s"}. Preserve the rectangular room boundary, door/window count, opening relationships, circulation and daylight directions shown in the plan. Do not invent a second room, move an opening, widen the footprint or change the ceiling height. ${buildingFacts(building, requirements)}

FURNISHING AND MATERIALS
Create a tasteful, practical ${requirements.budget.qualityTier.replaceAll("_", " ")} ${selected.type} suitable for ${locality} in a ${requirements.architecture.style.replaceAll("_", " ")} character. Add correctly scaled furniture, clear circulation, durable flooring, warm-neutral layered lighting, curtains only where windows exist, and one or two restrained framed paintings. Use the same ${materialSchedule(requirements)} schedule as the exterior concepts.

OUTPUT
Exactly one continuous full-bleed landscape 3:2 interior architectural photograph, eye-level 24–28 mm lens, natural daylight and warm practical lighting. Remove source labels and plan graphics. No floor-plan collage, false windows, blocked doors, people, text, logos or watermarks.`;

  return [
    {
      purpose: "exterior_front",
      sourceRole: "massing_front",
      requestedOutputCount: 1,
      prompt: exteriorEditPrompt({
        building,
        requirements,
        sourceLabel: "SOURCE A · FRONT / ROAD · CAMERA LOCK",
        outputDirection: "One complete front/arrival three-quarter view from exactly the supplied camera.",
      }),
    },
    {
      purpose: "exterior_collage",
      sourceRole: "massing_collage",
      requestedOutputCount: 1,
      prompt: exteriorEditPrompt({
        building,
        requirements,
        sourceLabel: "SOURCE B · COLLAGE · FOUR LOCKED VIEWS",
        outputDirection: "One polished 2-by-2 architectural presentation board matching all four supplied massing panels.",
        collage: true,
      }),
    },
    {
      purpose: "exterior_top",
      sourceRole: "massing_top",
      requestedOutputCount: 1,
      prompt: exteriorEditPrompt({
        building,
        requirements,
        sourceLabel: "SOURCE C · HIGH 3/4 · FRONT + RIGHT · CAMERA LOCK",
        outputDirection: "One complete elevated front-right perspective from exactly the supplied camera; this is not a drone redesign.",
      }),
    },
    { purpose: "interior", sourceRole: "plan_reference", requestedOutputCount: 1, prompt: interiorPrompt },
  ];
}
