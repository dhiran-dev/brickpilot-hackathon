import type { BuildingRequirements } from "@/lib/building/requirements";
import type { Building } from "@/lib/building/schema";
import { massingMetrics } from "@/lib/render/massing";

export type RenderPurpose = "exterior" | "interior";

export type RenderSpec = {
  purpose: RenderPurpose;
  requestedOutputCount: number;
  prompt: string;
};

function metres(valueMm: number) {
  return `${(valueMm / 1000).toFixed(2)} m`;
}

function referenceContract(referenceCount: number) {
  const roles = [
    "Image 1 is the marked canonical plan board containing every floor; preserve its room boundaries, exterior outline, circulation and selected interior source.",
    "Image 2 is the front three-quarter clay massing; preserve its silhouette, storey alignment and opening locations.",
    "Image 3 is the rear three-quarter clay massing; preserve rear massing and opening locations.",
    "Image 4 is the isometric clay massing; use it to reconcile the complete stacked geometry.",
  ];
  return roles.slice(0, referenceCount).join("\n");
}

function buildingFacts(building: Building, requirements: BuildingRequirements) {
  const metrics = massingMetrics(building);
  const floorFacts = [...building.floors]
    .sort((left, right) => left.level - right.level)
    .map((floor) => `${floor.label}: footprint ${metres(floor.envelope.width)} × ${metres(floor.envelope.depth)}, floor-to-floor ${metres(floor.floorHeightMm)}, ${floor.openings.filter((opening) => opening.connects.includes("EXTERIOR")).length} exterior openings`)
    .join("; ");
  return `Canonical facts: exactly ${metrics.storeys} storey${metrics.storeys === 1 ? "" : "s"}; overall height ${metrics.heightM.toFixed(2)} m; site ${metres(building.site.widthMm)} × ${metres(building.site.depthMm)}; facing ${building.site.facing}; road edge(s) ${building.site.roadEdges.join(", ")}; location ${requirements.region.locality ?? requirements.region.adminArea}, ${requirements.region.countryCode}; quality tier ${requirements.budget.qualityTier}. Floors: ${floorFacts}.`;
}

export function buildRenderSpecs(input: {
  building: Building;
  requirements: BuildingRequirements;
  selectedInteriorSpaceId: string;
  referenceCount: number;
}): { exterior: RenderSpec; interior: RenderSpec } {
  const { building, requirements, selectedInteriorSpaceId, referenceCount } = input;
  const selected = building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === selectedInteriorSpaceId);
  if (!selected) throw new Error("INTERIOR_SPACE_NOT_FOUND");
  const selectedFloor = building.floors.find((floor) => floor.id === selected.floorId)!;
  const selectedOpenings = selectedFloor.openings.filter((opening) => opening.connects.includes(selected.id));
  const exteriorOpenings = selectedOpenings.filter((opening) => opening.connects.includes("EXTERIOR"));
  const facts = buildingFacts(building, requirements);
  const references = referenceContract(referenceCount);

  const exteriorPrompt = `Create three coordinated, photorealistic exterior concept renders of the SAME detached residence represented by the supplied architectural references.

REFERENCE CONTRACT
${references}

GEOMETRY LOCK
${facts}
Keep the exact floor count, footprint setbacks, floor heights, stacked volumes, stair/core alignment and exterior door/window positions visible in the references. Do not add, remove or move a storey, wing, balcony, entrance, major void, door or window. Do not mirror or rotate the house relative to the road. If references disagree, Image 1 controls plan geometry and Images 2–4 control the three-dimensional silhouette.

ALLOWED DESIGN WORK
Apply a coherent contemporary residential exterior appropriate to ${requirements.region.locality ?? requirements.region.adminArea}: climate-suitable shade, restrained local stone or mineral plaster, durable timber-toned screening, realistic glazing, buildable parapets, subtle boundary treatment and modest planting. Use physically believable materials and construction thicknesses. Show warm interior light and refined exterior lighting without changing openings.

OUTPUT DIRECTION
The API requests three separate image files. Each returned file must contain exactly ONE continuous, full-bleed landscape 3:2 architectural photograph with one camera angle. Never place multiple views, panels or frames inside one image. Across the three files, vary between a front/arrival three-quarter view, a rear/garden three-quarter view and a complementary eye-level exterior view. Keep materials and lighting consistent across all three. Premium architectural visualization, realistic 28–35 mm lens, natural perspective, no aerial drone view.

Avoid contact sheets, collages, diptychs, triptychs, inset images, fantasy architecture, impossible cantilevers, extra floors, excessive glass, generic white-box mansion styling, people, cars, pools, text, logos and watermarks. These are concept renders grounded in the plan, not construction documents.`;

  const interiorPrompt = `Create one photorealistic furnished interior concept for the exact selected room in the supplied architectural references.

REFERENCE CONTRACT
${references}

ROOM LOCK
Selected room: ${selected.name} (${selected.type}) on ${selectedFloor.label}; canonical clear planning bounds ${metres(selected.bounds.width)} × ${metres(selected.bounds.depth)}; ${selectedOpenings.length} connected openings including ${exteriorOpenings.length} exterior opening${exteriorOpenings.length === 1 ? "" : "s"}. Preserve its rectangular boundary, doors, windows, circulation openings and daylight directions from Image 1. Do not invent a second room, move an opening, widen the footprint or change the ceiling height. ${facts}

ALLOWED DESIGN WORK
Assume a tasteful, practical ${requirements.budget.qualityTier.replaceAll("_", " ")} residential interior suitable for ${requirements.region.locality ?? requirements.region.adminArea}. Add correctly scaled furniture appropriate to a ${selected.type}, layered warm-neutral lighting, durable flooring, a restrained material palette, curtains where windows exist, and one or two tasteful framed paintings or wall artworks. Maintain clear circulation and believable furniture clearances.

OUTPUT DIRECTION
One landscape 3:2, eye-level 24–28 mm interior architectural photograph with natural daylight and warm practical lighting, physically believable materials and lived-in restraint.

Avoid changing geometry, blocking doors, placing furniture across circulation, false windows, excessive luxury, visual clutter, people, text, logos and watermarks. This is a concept render grounded in the selected room, not construction documentation.`;

  return {
    exterior: { purpose: "exterior", requestedOutputCount: 3, prompt: exteriorPrompt },
    interior: { purpose: "interior", requestedOutputCount: 1, prompt: interiorPrompt },
  };
}
