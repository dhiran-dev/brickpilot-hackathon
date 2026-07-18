import type { ReadableBuilding } from "@/lib/building/schema";
import { costQuantityFactor } from "@/lib/building/space-semantics";
import type { QuantityTakeoff } from "@/lib/cost/schema";
import { orthogonalPolygonAreaMm2 } from "@/lib/building/orthogonal-partition";

const INFORMATIONAL_BASIS = "Physical-system quantities are informational and remain included in the GFA base rate; no separate unit rates are applied." as const;

function triangleArea3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const cross = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
  return Math.hypot(cross.x, cross.y, cross.z) / 2;
}

function planeAreaMm2(vertices: Array<{ x: number; y: number; z: number }>) {
  return Array.from({ length: Math.max(0, vertices.length - 2) }, (_, index) => triangleArea3(vertices[0], vertices[index + 1], vertices[index + 2])).reduce((sum, area) => sum + area, 0);
}

function memberLength(member: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) {
  return Math.hypot(member.end.x - member.start.x, member.end.y - member.start.y, member.end.z - member.start.z);
}

export function deriveQuantityTakeoff(building: ReadableBuilding): QuantityTakeoff {
  if (building.buildingSchemaVersion === 3) {
    const floorAreasMm2 = building.floors.map((floor) => ({
      floorId: floor.id,
      areaMm2: Math.round(floor.spaces.reduce((sum, space) => {
        const region = floor.regions.find((candidate) => candidate.id === space.regionId);
        return sum + (region ? orthogonalPolygonAreaMm2(region.polygon) * costQuantityFactor(space.type) : 0);
      }, 0)),
    }));
    const enclosureRoofs = building.roofSystems.filter((roof) => roof.kind !== "open_pergola");
    const pergolas = building.roofSystems.filter((roof) => roof.kind === "open_pergola");
    return {
      quantitySchemaVersion: 3,
      grossFloorAreaMm2: floorAreasMm2.reduce((sum, floor) => sum + floor.areaMm2, 0),
      floorAreasMm2,
      floorCount: building.floors.length,
      spaceCount: building.floors.reduce((sum, floor) => sum + floor.spaces.length, 0),
      doorCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "door").length, 0),
      windowCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "window").length, 0),
      stairCount: building.verticalConnectors.length,
      roofSurfaceAreaMm2: Math.round(enclosureRoofs.reduce((sum, roof) => sum + roof.planes.reduce((planeSum, plane) => planeSum + planeAreaMm2(plane.vertices), 0), 0)),
      solidCanopySurfaceAreaMm2: Math.round(enclosureRoofs.filter((roof) => roof.kind === "solid_canopy").reduce((sum, roof) => sum + roof.planes.reduce((planeSum, plane) => planeSum + planeAreaMm2(plane.vertices), 0), 0)),
      canopyPostCount: building.secondaryRoofSupports.filter((support) => support.role === "canopy_post").length,
      pergolaPostCount: building.secondaryRoofSupports.filter((support) => support.role === "pergola_post").length,
      pergolaMemberLengthMm: Math.round(pergolas.reduce((sum, roof) => sum + [...roof.frameMembers, ...roof.slatMembers].reduce((memberSum, member) => memberSum + memberLength(member), 0), 0)),
      edgeProtectionLengthMm: Math.round(building.edgeProtections.reduce((sum, guard) => sum + Math.hypot(guard.edge.end.x - guard.edge.start.x, guard.edge.end.y - guard.edge.start.y), 0)),
      informationalBasis: INFORMATIONAL_BASIS,
    };
  }
  const floorAreasMm2 = building.floors.map((floor) => ({
    floorId: floor.id,
    areaMm2: Math.round(floor.spaces.reduce((sum, space) => sum + space.areaMm2 * costQuantityFactor(space.type), 0)),
  }));

  return {
    grossFloorAreaMm2: floorAreasMm2.reduce((sum, floor) => sum + floor.areaMm2, 0),
    floorAreasMm2,
    floorCount: building.floors.length,
    spaceCount: building.floors.reduce((sum, floor) => sum + floor.spaces.length, 0),
    doorCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "door").length, 0),
    windowCount: building.floors.reduce((sum, floor) => sum + floor.openings.filter((opening) => opening.kind === "window").length, 0),
    stairCount: building.verticalConnectors.length,
  };
}
